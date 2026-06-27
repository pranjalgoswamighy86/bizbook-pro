import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { roundTo2, isInterStateSupply, splitGSTAmount } from '@/lib/gst-utils'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    // Validate tenant exists for write operations
    if (['create', 'update', 'delete'].includes(action)) {
      if (!tenantId) {
        return NextResponse.json({ error: 'No business selected. Please refresh the page and log in again.' }, { status: 400 })
      }
      const tenantExists = await db.tenant.findUnique({ where: { id: tenantId } })
      if (!tenantExists) {
        return NextResponse.json({ error: 'Your session business no longer exists. Please log out and log in again.' }, { status: 401 })
      }
    }

    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      // Sanitize numeric fields to prevent NaN/Infinity crashing Prisma
      const sanitize = (v: unknown, fallback = 0): number => {
        const n = typeof v === 'number' ? v : Number(v)
        return Number.isFinite(n) ? n : fallback
      }
      const data = { ...body.data, tenantId }
      // BUG FIX: Round all monetary values to 2 decimal places
      data.subtotal = roundTo2(sanitize(data.subtotal))
      data.gstAmount = roundTo2(sanitize(data.gstAmount))
      data.totalAmount = roundTo2(sanitize(data.totalAmount))
      data.amountPaid = roundTo2(sanitize(data.amountPaid))

      // v4.125: Anti-Negative Value Validation — purchases can NEVER be negative
      const negFields: string[] = []
      if (data.subtotal < 0) negFields.push('subtotal')
      if (data.gstAmount < 0) negFields.push('gstAmount')
      if (data.totalAmount < 0) negFields.push('totalAmount')
      if (data.amountPaid < 0) negFields.push('amountPaid')
      const purItems = typeof data.items === 'string' ? JSON.parse(data.items) : data.items
      if (Array.isArray(purItems)) {
        for (let i = 0; i < purItems.length; i++) {
          const item = purItems[i]
          if (item.qty !== undefined && item.qty < 0) negFields.push(`item[${i}].qty`)
          if (item.rate !== undefined && item.rate < 0) negFields.push(`item[${i}].rate`)
          if (item.discount !== undefined && item.discount < 0) negFields.push(`item[${i}].discount`)
          if (item.amount !== undefined && item.amount < 0) negFields.push(`item[${i}].amount`)
          if (item.total !== undefined && item.total < 0) negFields.push(`item[${i}].total`)
        }
      }
      if (negFields.length > 0) {
        return NextResponse.json({
          error: `Negative values are not allowed in purchases. Fields: ${negFields.join(', ')}. Use a Debit Note to reverse a purchase instead of negative values.`,
          fields: negFields,
          code: 'NEGATIVE_VALUE_NOT_ALLOWED',
        }, { status: 422 })
      }
      // Ensure empty strings for optional fields become null
      data.partyAddress = data.partyAddress || null
      data.partyGst = data.partyGst || null
      data.notes = data.notes || null
      data.invoiceFile = data.invoiceFile || null
      data.createdBy = data.createdBy || null
      // Validate date
      if (!data.date || isNaN(new Date(data.date).getTime())) {
        return NextResponse.json({ error: 'Invalid date provided' }, { status: 400 })
      }
      data.date = new Date(data.date)

      // ===== PAYMENT STATUS LOGIC FOR PURCHASES =====
      // Purchases use: UNPAID, PARTIAL, PAID
      // If party name is "Cash" (case-insensitive), auto-mark as PAID
      const isCashPurchase = (data.partyName || '').trim().toLowerCase() === 'cash'
      if (isCashPurchase) {
        data.paymentStatus = 'PAID'
        data.amountPaid = data.totalAmount
      } else {
        // Default to UNPAID if not specified
        if (!data.paymentStatus) data.paymentStatus = 'UNPAID'
        // If PAID, set amountPaid to totalAmount
        if (data.paymentStatus === 'PAID') {
          data.amountPaid = data.totalAmount
        }
      }

      // BUG FIX: Round amountPaid
      data.amountPaid = roundTo2(data.amountPaid)

      const purchase = await db.purchase.create({ data })

      // ===== AUTO INVENTORY UPDATE: Stock IN on Purchase =====
      const inventoryUpdates: string[] = []
      try {
        const items = JSON.parse(body.data.items || '[]')
        for (const item of items) {
          if (!item.name || !item.qty || item.qty <= 0) continue

          // Try to find existing inventory item by name (case-insensitive for SQLite)
          const allItems = await db.inventoryItem.findMany({ where: { tenantId } })
          const existingItem = allItems.find(i =>
            i.name.toLowerCase() === item.name.toLowerCase() ||
            (item.hsn && i.hsnCode === item.hsn)
          )

          if (existingItem) {
            // Update existing item: add stock, update purchase price
            const newStock = existingItem.currentStock + (item.qty || 0)
            // BUG FIX: Inventory value should use purchase price (cost excluding GST,
            // since GST Input Credit is claimed separately in journal entry)
            const purchasePrice = roundTo2(item.rate || existingItem.purchasePrice)
            await db.inventoryItem.update({
              where: { id: existingItem.id },
              data: {
                currentStock: newStock,
                value: roundTo2(newStock * purchasePrice),
                purchasePrice: purchasePrice,
                ...(item.category && !existingItem.category ? { category: item.category } : {}),
                ...(item.hsn && !existingItem.hsnCode ? { hsnCode: item.hsn } : {}),
                ...(item.unit && existingItem.unit === 'PCS' && item.unit !== 'PCS' ? { unit: item.unit } : {}),
                ...(item.mrp && (!existingItem.mrp || existingItem.mrp === 0) ? { mrp: item.mrp } : {}),
              }
            })
            inventoryUpdates.push(`${item.name}: +${item.qty} ${item.unit || 'PCS'} (stock now ${newStock})`)
          } else {
            // Create new inventory item from purchase line item
            const purchasePrice = roundTo2(item.rate || 0)
            await db.inventoryItem.create({
              data: {
                tenantId,
                name: item.name,
                category: item.category || null,
                hsnCode: item.hsn || null,
                unit: item.unit || 'PCS',
                itemType: 'RAW_MATERIAL',
                purchasePrice: purchasePrice,
                salePrice: 0,
                mrp: item.mrp || null,
                openingStock: 0,
                currentStock: item.qty || 0,
                minStock: 0,
                gstRate: item.taxes && item.taxes.length > 0 ? item.taxes[0].percent : 0,
                // BUG FIX: Inventory value = qty * purchasePrice (excluding GST, since Input Credit is claimed)
                value: roundTo2((item.qty || 0) * purchasePrice),
              }
            })
            inventoryUpdates.push(`${item.name}: created with ${item.qty} ${item.unit || 'PCS'}`)
          }
        }
      } catch (invError) {
        console.error('Auto inventory update error (purchase):', invError)
      }

      // ===== AUTO PAYABLES UPDATE =====
      // If purchase is not fully paid and party is not Cash, update Creditor
      if (!isCashPurchase && data.paymentStatus !== 'PAID') {
        try {
          const amountDue = roundTo2(data.totalAmount - (data.amountPaid || 0))
          if (amountDue > 0) {
            // Upsert Creditor record
            const existingCreditor = await db.creditor.findFirst({
              where: { name: data.partyName, tenantId }
            })
            if (existingCreditor) {
              await db.creditor.update({
                where: { id: existingCreditor.id },
                data: {
                  currentBalance: roundTo2(existingCreditor.currentBalance + amountDue),
                  address: data.partyAddress || existingCreditor.address,
                  gstNumber: data.partyGst || existingCreditor.gstNumber,
                }
              })
            } else {
              await db.creditor.create({
                data: {
                  name: data.partyName,
                  address: data.partyAddress || null,
                  gstNumber: data.partyGst || null,
                  openingBalance: 0,
                  currentBalance: amountDue,
                  tenantId,
                }
              })
            }
            // Also update Party record if exists
            const existingParty = await db.party.findFirst({
              where: { name: data.partyName, tenantId }
            })
            if (existingParty) {
              await db.party.update({
                where: { id: existingParty.id },
                data: { currentBalance: roundTo2(existingParty.currentBalance + amountDue) }
              })
            }
          }
        } catch (payableError) {
          console.error('Auto payables update error (purchase):', payableError)
        }
      }

      // ===== AUTO PARTY GET-OR-CREATE =====
      if (!isCashPurchase) {
        try {
          const existingParty = await db.party.findFirst({
            where: { name: data.partyName, tenantId }
          })
          if (!existingParty) {
            await db.party.create({
              data: {
                name: data.partyName,
                address: data.partyAddress || null,
                gstNumber: data.partyGst || null,
                type: 'SUPPLIER',
                currentBalance: data.paymentStatus !== 'PAID' ? roundTo2(data.totalAmount - (data.amountPaid || 0)) : 0,
                tenantId,
              }
            })
          }
        } catch (partyError) {
          console.error('Auto party create error (purchase):', partyError)
        }
      }

      // ===== AUTO-POST JOURNAL ENTRY (Double-Entry) =====
      try {
        const accounts = await db.account.findMany({ where: { tenantId } })
        const findAccount = (code: string) => accounts.find(a => a.accountCode === code)

        if (accounts.length > 0) {
          let creditorsAccount = findAccount('20100')
          let cashAccount = findAccount('10100')
          let purchaseAccount = findAccount('50200')

          // BUG FIX: GST Input Credit should be an ASSET (not Expense)
          // GST Input Credit is money recoverable from the government, hence an asset
          // Split into CGST Input, SGST Input, IGST Input for proper GST accounting
          let cgstInputAccount = findAccount('10601')
          let sgstInputAccount = findAccount('10602')
          let igstInputAccount = findAccount('10603')
          // Keep old single account for backward compatibility
          let gstInputAccount = findAccount('50600')

          if (!creditorsAccount) creditorsAccount = await db.account.create({ data: { accountCode: '20100', name: 'Accounts Payable', type: 'Liability', tenantId } })
          if (!cashAccount) cashAccount = await db.account.create({ data: { accountCode: '10100', name: 'Cash', type: 'Asset', tenantId } })
          if (!purchaseAccount) purchaseAccount = await db.account.create({ data: { accountCode: '50200', name: 'Purchase Expenses', type: 'Expense', tenantId } })

          // BUG FIX: Create split GST Input accounts as Assets
          if (!cgstInputAccount) cgstInputAccount = await db.account.create({ data: { accountCode: '10601', name: 'CGST Input Credit', type: 'Asset', tenantId } })
          if (!sgstInputAccount) sgstInputAccount = await db.account.create({ data: { accountCode: '10602', name: 'SGST Input Credit', type: 'Asset', tenantId } })
          if (!igstInputAccount) igstInputAccount = await db.account.create({ data: { accountCode: '10603', name: 'IGST Input Credit', type: 'Asset', tenantId } })
          // Create old single account for fallback (but with correct type: Asset)
          if (!gstInputAccount) gstInputAccount = await db.account.create({ data: { accountCode: '50600', name: 'GST Input Credit', type: 'Asset', tenantId } })

          const isCashPurchase = (data.partyName || '').trim().toLowerCase() === 'cash'
          const jeLines: Array<{ accountId: string; debit: number; credit: number; description: string }> = []

          // Debit: Purchase Expenses (excluding GST)
          jeLines.push({ accountId: purchaseAccount!.id, debit: purchase.subtotal, credit: 0, description: `Purchase ${purchase.invoiceNumber}` })

          // BUG FIX: Debit GST Input Credit with proper CGST/SGST/IGST split
          // Determine if purchase is intra-state or inter-state based on GSTINs
          if (purchase.gstAmount > 0) {
            const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
            const tenantGstin = tenant?.gstNumber || ''
            const partyGst = purchase.partyGst || ''

            if (tenantGstin && partyGst) {
              // For purchases, the supplier is the party and the buyer is the tenant
              const interState = isInterStateSupply(partyGst, tenantGstin)
              const { cgst, sgst, igst } = splitGSTAmount(purchase.gstAmount, interState)

              if (interState) {
                // Inter-state: full IGST as Input Credit
                if (igst > 0) {
                  jeLines.push({ accountId: igstInputAccount!.id, debit: roundTo2(igst), credit: 0, description: `IGST on purchase ${purchase.invoiceNumber}` })
                }
              } else {
                // Intra-state: CGST Input + SGST Input
                if (cgst > 0) {
                  jeLines.push({ accountId: cgstInputAccount!.id, debit: roundTo2(cgst), credit: 0, description: `CGST on purchase ${purchase.invoiceNumber}` })
                }
                if (sgst > 0) {
                  jeLines.push({ accountId: sgstInputAccount!.id, debit: roundTo2(sgst), credit: 0, description: `SGST on purchase ${purchase.invoiceNumber}` })
                }
              }
            } else {
              // BUG FIX: If GSTINs are not available, cannot determine intra/inter-state
              // Fall back to single GST Input Credit account
              jeLines.push({ accountId: gstInputAccount!.id, debit: roundTo2(purchase.gstAmount), credit: 0, description: `GST on purchase ${purchase.invoiceNumber} (unable to determine CGST/SGST/IGST split — GSTINs missing)` })
            }
          }

          // Credit: Cash or Creditors (total including GST)
          jeLines.push({ accountId: isCashPurchase ? cashAccount!.id : creditorsAccount!.id, debit: 0, credit: purchase.totalAmount, description: isCashPurchase ? 'Cash paid' : `Payable to ${purchase.partyName}` })

          await db.journalEntry.create({
            data: {
              entryDate: purchase.date,
              reference: purchase.invoiceNumber,
              description: `Purchase invoice ${purchase.invoiceNumber} from ${purchase.partyName}`,
              sourceType: 'PURCHASE',
              sourceId: purchase.id,
              isPosted: true,
              tenantId,
              createdBy: data.createdBy || null,
              lines: { create: jeLines }
            }
          })
        }
      } catch (jeError) {
        console.error('Auto journal entry error (purchase):', jeError)
      }

      return NextResponse.json({ purchase, inventoryUpdates })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body

      // Get old purchase to reverse changes
      const oldPurchase = await db.purchase.findUnique({ where: { id } })
      if (!oldPurchase) {
        return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
      }

      // BUG FIX: Round monetary values in update
      const sanitize = (v: unknown, fallback = 0): number => {
        const n = typeof v === 'number' ? v : Number(v)
        return Number.isFinite(n) ? n : fallback
      }
      if (data.amountPaid !== undefined) data.amountPaid = roundTo2(sanitize(data.amountPaid))
      if (data.subtotal !== undefined) data.subtotal = roundTo2(sanitize(data.subtotal))
      if (data.gstAmount !== undefined) data.gstAmount = roundTo2(sanitize(data.gstAmount))
      if (data.totalAmount !== undefined) data.totalAmount = roundTo2(sanitize(data.totalAmount))

      // Handle Cash purchase auto-status
      const partyName = data.partyName || oldPurchase.partyName
      const isCashPurchase = partyName.trim().toLowerCase() === 'cash'
      if (isCashPurchase) {
        data.paymentStatus = 'PAID'
        data.amountPaid = data.totalAmount || oldPurchase.totalAmount
      }

      const purchase = await db.purchase.update({ where: { id }, data })

      // Reverse old inventory, then apply new
      const inventoryUpdates: string[] = []
      if (oldPurchase) {
        try {
          const oldItems = JSON.parse(oldPurchase.items || '[]')
          // Reverse old stock
          for (const item of oldItems) {
            if (!item.name || !item.qty || item.qty <= 0) continue
            const allItems = await db.inventoryItem.findMany({ where: { tenantId } })
            const existingItem = allItems.find(i => i.name.toLowerCase() === item.name.toLowerCase())
            if (existingItem) {
              const newStock = Math.max(0, existingItem.currentStock - (item.qty || 0))
              await db.inventoryItem.update({
                where: { id: existingItem.id },
                data: { currentStock: newStock, value: roundTo2(newStock * existingItem.purchasePrice) }
              })
            }
          }

          // Apply new stock
          const newItems = JSON.parse(data.items || '[]')
          for (const item of newItems) {
            if (!item.name || !item.qty || item.qty <= 0) continue
            const allItems = await db.inventoryItem.findMany({ where: { tenantId } })
            const existingItem = allItems.find(i => i.name.toLowerCase() === item.name.toLowerCase())
            if (existingItem) {
              const newStock = existingItem.currentStock + (item.qty || 0)
              const purchasePrice = roundTo2(item.rate || existingItem.purchasePrice)
              await db.inventoryItem.update({
                where: { id: existingItem.id },
                data: {
                  currentStock: newStock,
                  value: roundTo2(newStock * purchasePrice),
                  purchasePrice: purchasePrice,
                }
              })
              inventoryUpdates.push(`${item.name}: stock adjusted to ${newStock}`)
            } else {
              const purchasePrice = roundTo2(item.rate || 0)
              await db.inventoryItem.create({
                data: {
                  tenantId, name: item.name, category: item.category || null,
                  hsnCode: item.hsn || null, unit: item.unit || 'PCS',
                  itemType: 'RAW_MATERIAL',
                  purchasePrice: purchasePrice, salePrice: 0, mrp: item.mrp || null,
                  openingStock: 0, currentStock: item.qty || 0, minStock: 0,
                  gstRate: item.taxes && item.taxes.length > 0 ? item.taxes[0].percent : 0,
                  value: roundTo2((item.qty || 0) * purchasePrice),
                }
              })
              inventoryUpdates.push(`${item.name}: created with ${item.qty} ${item.unit || 'PCS'}`)
            }
          }
        } catch (invError) {
          console.error('Auto inventory update error (purchase update):', invError)
        }
      }

      // Update payables: reverse old, apply new
      try {
        const oldIsCash = oldPurchase.partyName.trim().toLowerCase() === 'cash'
        const newIsCash = isCashPurchase

        // Reverse old payable
        if (!oldIsCash && oldPurchase.paymentStatus !== 'PAID') {
          const oldDue = roundTo2(oldPurchase.totalAmount - (oldPurchase.amountPaid || 0))
          if (oldDue > 0) {
            const creditor = await db.creditor.findFirst({ where: { name: oldPurchase.partyName, tenantId } })
            if (creditor) {
              await db.creditor.update({
                where: { id: creditor.id },
                data: { currentBalance: Math.max(0, roundTo2(creditor.currentBalance - oldDue)) }
              })
            }
          }
        }

        // Apply new payable
        if (!newIsCash && purchase.paymentStatus !== 'PAID') {
          const newDue = roundTo2(purchase.totalAmount - (purchase.amountPaid || 0))
          if (newDue > 0) {
            const creditor = await db.creditor.findFirst({ where: { name: purchase.partyName, tenantId } })
            if (creditor) {
              await db.creditor.update({
                where: { id: creditor.id },
                data: { currentBalance: roundTo2(creditor.currentBalance + newDue) }
              })
            } else {
              await db.creditor.create({
                data: {
                  name: purchase.partyName,
                  address: purchase.partyAddress || null,
                  gstNumber: purchase.partyGst || null,
                  currentBalance: newDue,
                  tenantId,
                }
              })
            }
          }
        }
      } catch (payableError) {
        console.error('Payables update error (purchase update):', payableError)
      }

      return NextResponse.json({ purchase, inventoryUpdates })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, tenantId: tid } = body

      // Reverse inventory + payables before deleting
      const purchase = await db.purchase.findUnique({ where: { id } })
      if (purchase) {
        try {
          const items = JSON.parse(purchase.items || '[]')
          for (const item of items) {
            if (!item.name || !item.qty || item.qty <= 0) continue
            const tid2 = tid || purchase.tenantId
            const allItems = await db.inventoryItem.findMany({ where: { tenantId: tid2 } })
            const existingItem = allItems.find(i => i.name.toLowerCase() === item.name.toLowerCase())
            if (existingItem) {
              const newStock = Math.max(0, existingItem.currentStock - (item.qty || 0))
              await db.inventoryItem.update({
                where: { id: existingItem.id },
                data: { currentStock: newStock, value: roundTo2(newStock * existingItem.purchasePrice) }
              })
            }
          }
        } catch (invError) {
          console.error('Auto inventory reverse error (purchase delete):', invError)
        }

        // Reverse payable
        try {
          const isCash = purchase.partyName.trim().toLowerCase() === 'cash'
          if (!isCash && purchase.paymentStatus !== 'PAID') {
            const due = roundTo2(purchase.totalAmount - (purchase.amountPaid || 0))
            if (due > 0) {
              const creditor = await db.creditor.findFirst({
                where: { name: purchase.partyName, tenantId: tid || purchase.tenantId }
              })
              if (creditor) {
                await db.creditor.update({
                  where: { id: creditor.id },
                  data: { currentBalance: Math.max(0, roundTo2(creditor.currentBalance - due)) }
                })
              }
            }
          }
        } catch (payableError) {
          console.error('Payables reverse error (purchase delete):', payableError)
        }
      }

      await db.purchase.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
      return NextResponse.json({ success: true })
    }

    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { startDate, endDate, search } = body
      const where: Record<string, unknown> = { tenantId, isDeleted: false }
      if (startDate && endDate) {
        where.date = { gte: new Date(startDate), lt: new Date(endDate) }
      }
      if (search) {
        where.OR = [
          { partyName: { contains: search } },
          { invoiceNumber: { contains: search } },
          { notes: { contains: search } },
        ]
      }
      const purchases = await db.purchase.findMany({ where, orderBy: { date: 'desc' } })
      const total = await db.purchase.count({ where })
      return NextResponse.json({ purchases, total })
    }

    if (action === 'stats') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { startDate, endDate } = body
      const where: Record<string, unknown> = { tenantId, isDeleted: false }
      if (startDate && endDate) {
        where.date = { gte: new Date(startDate), lt: new Date(endDate) }
      }
      const purchases = await db.purchase.findMany({ where })
      // BUG FIX: Round stats to 2 decimal places
      const totalPurchases = roundTo2(purchases.reduce((sum, p) => sum + p.totalAmount, 0))
      const totalPaid = roundTo2(purchases.reduce((sum, p) => sum + p.amountPaid, 0))
      const totalDue = roundTo2(totalPurchases - totalPaid)
      return NextResponse.json({ totalPurchases, totalPaid, totalDue, count: purchases.length })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: unknown) {
    console.error('Purchases error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
