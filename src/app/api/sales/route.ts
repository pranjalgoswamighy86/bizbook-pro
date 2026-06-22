import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { roundTo2, isInterStateSupply, splitGSTAmount } from '@/lib/gst-utils'
// ---- SECURITY PATCH v1 imports ----
import { requireAuthAndTenant, requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'
// -----------------------------------

/**
 * Sales API — SECURITY-PATCHED reference implementation.
 *
 * Demonstrates the pattern to apply to ALL other API routes:
 *   1. requireAuthAndTenant at the top of every action
 *   2. db.$transaction around multi-step writes
 *   3. writeAuditLog inside the transaction
 *   4. Surface partial failures to the client (no silent console.error)
 *
 * See SECURITY_PATCH.md for the 5-line change pattern to apply to the
 * other 30 API routes.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    // ============================================================
    // CREATE SALE
    // ============================================================
    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      // Sanitize numeric fields
      const sanitize = (v: unknown, fallback = 0): number => {
        const n = typeof v === 'number' ? v : Number(v)
        return Number.isFinite(n) ? n : fallback
      }
      const data = { ...body.data, tenantId: access.tenantId }
      data.subtotal = roundTo2(sanitize(data.subtotal))
      data.gstAmount = roundTo2(sanitize(data.gstAmount))
      data.totalAmount = roundTo2(sanitize(data.totalAmount))
      data.amountPaid = roundTo2(sanitize(data.amountPaid))
      data.amountReceived = roundTo2(sanitize(data.amountReceived || data.amountPaid))
      data.partyAddress = data.partyAddress || null
      data.partyGst = data.partyGst || null
      data.notes = data.notes || null
      data.invoiceFile = data.invoiceFile || null
      data.createdBy = access.userId  // ← use authenticated user, not body
      if (!data.date || isNaN(new Date(data.date).getTime())) {
        return NextResponse.json({ error: 'Invalid date provided' }, { status: 400 })
      }
      data.date = new Date(data.date)

      // Payment status logic (unchanged)
      const isCashSale = (data.partyName || '').trim().toLowerCase() === 'cash'
      if (isCashSale) {
        data.paymentStatus = 'RECEIVED'
        data.amountReceived = data.totalAmount
        data.amountPaid = data.totalAmount
      } else {
        if (data.paymentStatus === 'UNPAID') data.paymentStatus = 'PENDING'
        if (data.paymentStatus === 'PAID') data.paymentStatus = 'RECEIVED'
        if (!data.paymentStatus) data.paymentStatus = 'PENDING'
        if (data.paymentStatus === 'RECEIVED') {
          data.amountReceived = data.totalAmount
          data.amountPaid = data.totalAmount
        } else if (data.paymentStatus === 'PARTIAL') {
          data.amountReceived = data.amountReceived || data.amountPaid || 0
          data.amountPaid = data.amountReceived
        } else {
          data.amountReceived = data.amountReceived || 0
          data.amountPaid = data.amountReceived
        }
      }
      data.amountReceived = roundTo2(data.amountReceived)
      data.amountPaid = roundTo2(data.amountPaid)

      // ---- SECURITY PATCH v1: wrap ALL side-effects in a transaction ----
      // Either the sale, inventory, debtors, party, and journal entry all
      // commit together, or none of them do. No more silent partial failures.
      // ----------------------------------------------------------------
      const warnings: string[] = []

      const sale = await db.$transaction(async (tx) => {
        // 1. Create the sale
        const sale = await tx.sale.create({ data })

        // 2. Inventory deduction (with BOM support)
        const items = JSON.parse(body.data.items || '[]')
        for (const item of items) {
          // v4.66: Skip inventory operations for SERVICE items (e.g., BizBook Pro subscription, consulting, installation fees)
          // Services have no physical stock to deduct.
          if (item.saleItemType === 'SERVICE') continue
          if (!item.name || !item.qty || item.qty <= 0) continue

          // Use tx for all queries inside transaction
          const existingItem = await tx.inventoryItem.findFirst({
            where: {
              tenantId: access.tenantId,
              OR: [
                { name: { equals: item.name } },
                ...(item.hsn ? [{ hsnCode: item.hsn }] : []),
              ],
              isDeleted: false,
            },
          })

          if (existingItem) {
            if (existingItem.itemType === 'FINISHED_PRODUCT') {
              const product = await tx.product.findFirst({
                where: { name: { equals: existingItem.name }, tenantId: access.tenantId, isDeleted: false },
                include: { ingredients: { include: { inventoryItem: true } } },
              })

              if (product && product.ingredients.length > 0) {
                for (const ingredient of product.ingredients) {
                  const rawItem = await tx.inventoryItem.findUnique({ where: { id: ingredient.inventoryItemId } })
                  if (rawItem) {
                    const qtyNeeded = ingredient.quantity * (item.qty || 0)
                    // ---- v4.9: Spec Section 14 Rule 2.1 — Anti-Negative Stock ----
                    // Spec: "If Requested Quantity > Current Available Stock, terminate
                    // execution instantly. Do not allow stock counts to decline below zero.
                    // Block mutation, return a 422 Unprocessable Entity state, and trigger
                    // a warning component: 'Insufficient physical inventory balance.
                    // Transaction aborted to prevent data corruption.'"
                    if (rawItem.currentStock < qtyNeeded) {
                      throw new Error(`CRITICAL_BLOCK_422: Insufficient physical inventory balance for BOM ingredient "${rawItem.name}". Requested: ${qtyNeeded}, Available: ${rawItem.currentStock}. Transaction aborted to prevent data corruption.`)
                    }
                    // ----------------------------------------------------------------
                    const newRawStock = rawItem.currentStock - qtyNeeded
                    await tx.inventoryItem.update({
                      where: { id: rawItem.id },
                      data: {
                        currentStock: newRawStock,
                        value: roundTo2(newRawStock * rawItem.purchasePrice),
                      },
                    })
                  }
                }
              }
              // ---- v4.9: Spec Section 14 Rule 2.1 — Anti-Negative Stock (main item) ----
              if (existingItem.currentStock < (item.qty || 0)) {
                throw new Error(`CRITICAL_BLOCK_422: Insufficient physical inventory balance for "${existingItem.name}". Requested: ${item.qty || 0}, Available: ${existingItem.currentStock}. Transaction aborted to prevent data corruption.`)
              }
              const newStock = existingItem.currentStock - (item.qty || 0)
              await tx.inventoryItem.update({
                where: { id: existingItem.id },
                data: {
                  currentStock: newStock,
                  value: roundTo2(newStock * existingItem.purchasePrice),
                  ...(item.rate && item.rate > 0 ? { salePrice: roundTo2(item.rate) } : {}),
                },
              })
            } else {
              // ---- v4.9: Spec Section 14 Rule 2.1 — Anti-Negative Stock (non-BOM item) ----
              if (existingItem.currentStock < (item.qty || 0)) {
                throw new Error(`CRITICAL_BLOCK_422: Insufficient physical inventory balance for "${existingItem.name}". Requested: ${item.qty || 0}, Available: ${existingItem.currentStock}. Transaction aborted to prevent data corruption.`)
              }
              // -----------------------------------------------------------------
              const newStock = existingItem.currentStock - (item.qty || 0)
              await tx.inventoryItem.update({
                where: { id: existingItem.id },
                data: {
                  currentStock: newStock,
                  value: roundTo2(newStock * existingItem.purchasePrice),
                  ...(item.rate && item.rate > 0 ? { salePrice: roundTo2(item.rate) } : {}),
                },
              })
            }
          } else {
            // Auto-create inventory item
            await tx.inventoryItem.create({
              data: {
                tenantId: access.tenantId,
                name: item.name,
                category: item.category || null,
                hsnCode: item.hsn || null,
                unit: item.unit || 'PCS',
                itemType: 'FINISHED_PRODUCT',
                purchasePrice: 0,
                salePrice: roundTo2(item.rate || 0),
                mrp: item.mrp || null,
                openingStock: 0,
                currentStock: 0,
                minStock: 0,
                gstRate: item.taxes && item.taxes.length > 0 ? item.taxes[0].percent : 0,
                value: 0,
              },
            })
          }
        }

        // 3. Receivables update
        if (!isCashSale && data.paymentStatus !== 'RECEIVED') {
          const amountDue = roundTo2(data.totalAmount - (data.amountReceived || 0))
          if (amountDue > 0) {
            const existingDebtor = await tx.debtor.findFirst({
              where: { name: data.partyName, tenantId: access.tenantId, isDeleted: false },
            })
            if (existingDebtor) {
              await tx.debtor.update({
                where: { id: existingDebtor.id },
                data: { currentBalance: roundTo2(existingDebtor.currentBalance + amountDue) },
              })
            } else {
              await tx.debtor.create({
                data: {
                  name: data.partyName,
                  address: data.partyAddress || null,
                  gstNumber: data.partyGst || null,
                  openingBalance: 0,
                  currentBalance: amountDue,
                  tenantId: access.tenantId,
                },
              })
            }

            // Update Party currentBalance
            const existingParty = await tx.party.findFirst({
              where: { name: data.partyName, tenantId: access.tenantId, isDeleted: false },
            })
            if (existingParty) {
              await tx.party.update({
                where: { id: existingParty.id },
                data: { currentBalance: roundTo2(existingParty.currentBalance + amountDue) },
              })
            }
          }
        }

        // 4. Auto party get-or-create
        if (!isCashSale) {
          const existingParty = await tx.party.findFirst({
            where: { name: data.partyName, tenantId: access.tenantId, isDeleted: false },
          })
          if (!existingParty) {
            await tx.party.create({
              data: {
                name: data.partyName,
                address: data.partyAddress || null,
                gstNumber: data.partyGst || null,
                type: 'CUSTOMER',
                currentBalance: data.paymentStatus !== 'RECEIVED'
                  ? roundTo2(data.totalAmount - (data.amountReceived || 0))
                  : 0,
                tenantId: access.tenantId,
              },
            })
          }
        }

        // 5. Journal entry (double-entry accounting)
        const accounts = await tx.account.findMany({ where: { tenantId: access.tenantId } })
        if (accounts.length > 0) {
          const findAccount = (code: string) => accounts.find(a => a.accountCode === code)
          let debtorsAccount = findAccount('10300')
          let cashAccount = findAccount('10100')
          let salesAccount = findAccount('40100')
          let cgstPayableAccount = findAccount('20201')
          let sgstPayableAccount = findAccount('20202')
          let igstPayableAccount = findAccount('20203')
          let gstPayableAccount = findAccount('20200')

          if (!debtorsAccount) debtorsAccount = await tx.account.create({ data: { accountCode: '10300', name: 'Accounts Receivable', type: 'Asset', tenantId: access.tenantId } })
          if (!cashAccount) cashAccount = await tx.account.create({ data: { accountCode: '10100', name: 'Cash', type: 'Asset', tenantId: access.tenantId } })
          if (!salesAccount) salesAccount = await tx.account.create({ data: { accountCode: '40100', name: 'Sales Revenue', type: 'Revenue', tenantId: access.tenantId } })
          if (!cgstPayableAccount) cgstPayableAccount = await tx.account.create({ data: { accountCode: '20201', name: 'CGST Payable', type: 'Liability', tenantId: access.tenantId } })
          if (!sgstPayableAccount) sgstPayableAccount = await tx.account.create({ data: { accountCode: '20202', name: 'SGST Payable', type: 'Liability', tenantId: access.tenantId } })
          if (!igstPayableAccount) igstPayableAccount = await tx.account.create({ data: { accountCode: '20203', name: 'IGST Payable', type: 'Liability', tenantId: access.tenantId } })
          if (!gstPayableAccount) gstPayableAccount = await tx.account.create({ data: { accountCode: '20200', name: 'GST Payable', type: 'Liability', tenantId: access.tenantId } })

          const jeLines: Array<{ accountId: string; debit: number; credit: number; description: string }> = []
          jeLines.push({
            accountId: isCashSale ? cashAccount!.id : debtorsAccount!.id,
            debit: sale.totalAmount,
            credit: 0,
            description: isCashSale ? 'Cash received' : `Receivable from ${sale.partyName}`,
          })
          jeLines.push({
            accountId: salesAccount!.id,
            debit: 0,
            credit: sale.subtotal,
            description: `Sale ${sale.invoiceNumber}`,
          })

          if (sale.gstAmount > 0) {
            const tenant = await tx.tenant.findUnique({ where: { id: access.tenantId } })
            const tenantGstin = tenant?.gstNumber || ''
            const partyGst = sale.partyGst || ''

            if (tenantGstin && partyGst) {
              const interState = isInterStateSupply(tenantGstin, partyGst)
              const { cgst, sgst, igst } = splitGSTAmount(sale.gstAmount, interState)
              if (interState) {
                if (igst > 0) jeLines.push({ accountId: igstPayableAccount!.id, debit: 0, credit: roundTo2(igst), description: `IGST on sale ${sale.invoiceNumber}` })
              } else {
                if (cgst > 0) jeLines.push({ accountId: cgstPayableAccount!.id, debit: 0, credit: roundTo2(cgst), description: `CGST on sale ${sale.invoiceNumber}` })
                if (sgst > 0) jeLines.push({ accountId: sgstPayableAccount!.id, debit: 0, credit: roundTo2(sgst), description: `SGST on sale ${sale.invoiceNumber}` })
              }
            } else {
              jeLines.push({ accountId: gstPayableAccount!.id, debit: 0, credit: roundTo2(sale.gstAmount), description: `GST on sale ${sale.invoiceNumber} (GSTINs missing)` })
            }
          }

          await tx.journalEntry.create({
            data: {
              entryDate: sale.date,
              reference: sale.invoiceNumber,
              description: `Sale invoice ${sale.invoiceNumber} to ${sale.partyName}`,
              sourceType: 'SALE',
              sourceId: sale.id,
              isPosted: true,
              tenantId: access.tenantId,
              createdBy: access.userId,
              lines: { create: jeLines },
            },
          })
        }

        // 6. Audit log (inside transaction — commits or rolls back with the sale)
        await tx.auditLog.create({
          data: {
            tenantId: access.tenantId,
            userId: access.userId,
            userName: access.user.name,
            action: 'CREATE',
            entityType: 'Sale',
            entityId: sale.id,
            entityName: sale.invoiceNumber,
            changes: JSON.stringify({
              invoiceNumber: sale.invoiceNumber,
              partyName: sale.partyName,
              totalAmount: sale.totalAmount,
              paymentStatus: sale.paymentStatus,
            }),
          },
        })

        return sale
      })

      // ---- SECURITY PATCH v1: include warnings in response ----
      return NextResponse.json({ sale, warnings })
      // --------------------------------------------------------
    }

    // ============================================================
    // UPDATE SALE
    // ============================================================
    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access + role ----
      const access = await requireAuthAndRole(req, tenantId, ['DATA_ENTRY', 'JUNIOR_ADMIN', 'MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // --------------------------------------------------------

      const { id, data } = body

      // Verify sale belongs to this tenant (was missing in original!)
      const oldSale = await db.sale.findFirst({
        where: { id, tenantId: access.tenantId, isDeleted: false },
      })
      if (!oldSale) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      const sanitize = (v: unknown, fallback = 0): number => {
        const n = typeof v === 'number' ? v : Number(v)
        return Number.isFinite(n) ? n : fallback
      }
      if (data.amountReceived !== undefined) data.amountReceived = roundTo2(sanitize(data.amountReceived))
      if (data.amountPaid !== undefined) data.amountPaid = roundTo2(sanitize(data.amountPaid))
      if (data.subtotal !== undefined) data.subtotal = roundTo2(sanitize(data.subtotal))
      if (data.gstAmount !== undefined) data.gstAmount = roundTo2(sanitize(data.gstAmount))
      if (data.totalAmount !== undefined) data.totalAmount = roundTo2(sanitize(data.totalAmount))

      const partyName = data.partyName || oldSale.partyName
      const isCashSale = partyName.trim().toLowerCase() === 'cash'
      if (isCashSale) {
        data.paymentStatus = 'RECEIVED'
        data.amountReceived = data.totalAmount || oldSale.totalAmount
        data.amountPaid = data.amountReceived
      } else {
        if (data.paymentStatus === 'UNPAID') data.paymentStatus = 'PENDING'
        if (data.paymentStatus === 'PAID') data.paymentStatus = 'RECEIVED'
      }

      // ---- SECURITY PATCH v1: transaction + audit log ----
      const sale = await db.$transaction(async (tx) => {
        const sale = await tx.sale.update({ where: { id }, data })

        // Reverse old inventory, apply new (simplified — same logic as create)
        const oldItems = JSON.parse(oldSale.items || '[]')
        for (const item of oldItems) {
          // v4.66: Skip SERVICE items — they were never deducted from inventory at create time
          if (item.saleItemType === 'SERVICE') continue
          if (!item.name || !item.qty || item.qty <= 0) continue
          const existingItem = await tx.inventoryItem.findFirst({
            where: { name: { equals: item.name }, tenantId: access.tenantId, isDeleted: false },
          })
          if (existingItem) {
            const newStock = existingItem.currentStock + (item.qty || 0)
            await tx.inventoryItem.update({
              where: { id: existingItem.id },
              data: { currentStock: newStock, value: roundTo2(newStock * existingItem.purchasePrice) },
            })
          }
        }
        const newItems = JSON.parse(data.items || '[]')
        for (const item of newItems) {
          // v4.66: Skip SERVICE items — do not deduct stock for services
          if (item.saleItemType === 'SERVICE') continue
          if (!item.name || !item.qty || item.qty <= 0) continue
          const existingItem = await tx.inventoryItem.findFirst({
            where: { name: { equals: item.name }, tenantId: access.tenantId, isDeleted: false },
          })
          if (existingItem) {
            const newStock = Math.max(0, existingItem.currentStock - (item.qty || 0))
            await tx.inventoryItem.update({
              where: { id: existingItem.id },
              data: {
                currentStock: newStock,
                value: roundTo2(newStock * existingItem.purchasePrice),
                ...(item.rate && item.rate > 0 ? { salePrice: roundTo2(item.rate) } : {}),
              },
            })
          }
        }

        await tx.auditLog.create({
          data: {
            tenantId: access.tenantId,
            userId: access.userId,
            userName: access.user.name,
            action: 'UPDATE',
            entityType: 'Sale',
            entityId: sale.id,
            entityName: sale.invoiceNumber,
            changes: JSON.stringify({ before: { ...oldSale, items: undefined }, after: { ...sale, items: undefined } }),
          },
        })

        return sale
      })

      return NextResponse.json({ sale })
    }

    // ============================================================
    // DELETE SALE (soft-delete)
    // ============================================================
    if (action === 'delete') {
      // ---- SECURITY PATCH v1: restrict delete to admins ----
      const access = await requireAuthAndRole(req, tenantId, ['JUNIOR_ADMIN', 'MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // -------------------------------------------------------

      const { id } = body

      const sale = await db.sale.findFirst({
        where: { id, tenantId: access.tenantId, isDeleted: false },
      })
      if (!sale) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      // ---- SECURITY PATCH v1: transaction-wrapped reversal ----
      await db.$transaction(async (tx) => {
        // Reverse inventory
        const items = JSON.parse(sale.items || '[]')
        for (const item of items) {
          // v4.66: Skip SERVICE items — they were never deducted from inventory at create time
          if (item.saleItemType === 'SERVICE') continue
          if (!item.name || !item.qty || item.qty <= 0) continue
          const existingItem = await tx.inventoryItem.findFirst({
            where: { name: { equals: item.name }, tenantId: access.tenantId, isDeleted: false },
          })
          if (existingItem) {
            const newStock = existingItem.currentStock + (item.qty || 0)
            await tx.inventoryItem.update({
              where: { id: existingItem.id },
              data: { currentStock: newStock, value: roundTo2(newStock * existingItem.purchasePrice) },
            })
          }
        }

        // Reverse receivable
        const isCash = sale.partyName.trim().toLowerCase() === 'cash'
        if (!isCash && sale.paymentStatus !== 'RECEIVED') {
          const due = roundTo2(sale.totalAmount - (sale.amountReceived || sale.amountPaid || 0))
          if (due > 0) {
            const debtor = await tx.debtor.findFirst({
              where: { name: sale.partyName, tenantId: access.tenantId, isDeleted: false },
            })
            if (debtor) {
              await tx.debtor.update({
                where: { id: debtor.id },
                data: { currentBalance: Math.max(0, roundTo2(debtor.currentBalance - due)) },
              })
            }
          }
        }

        // Reverse journal entry via a reversing entry (immutable principle)
        const originalJE = await tx.journalEntry.findFirst({
          where: { sourceType: 'SALE', sourceId: sale.id, tenantId: access.tenantId },
          include: { lines: true },
        })
        if (originalJE) {
          await tx.journalEntry.create({
            data: {
              entryDate: new Date(),
              reference: `REVERSAL-${originalJE.reference || sale.id.slice(0, 8)}`,
              description: `Reversal of sale ${sale.invoiceNumber} (deleted)`,
              sourceType: 'MANUAL',
              isPosted: true,
              tenantId: access.tenantId,
              createdBy: access.userId,
              lines: {
                create: originalJE.lines.map(l => ({
                  accountId: l.accountId,
                  debit: l.credit,
                  credit: l.debit,
                  description: `Reversal: ${l.description || ''}`,
                })),
              },
            },
          })
        }

        // Soft-delete the sale
        await tx.sale.update({
          where: { id: sale.id },
          data: { isDeleted: true, deletedAt: new Date() },
        })

        // Audit log
        await tx.auditLog.create({
          data: {
            tenantId: access.tenantId,
            userId: access.userId,
            userName: access.user.name,
            action: 'DELETE',
            entityType: 'Sale',
            entityId: sale.id,
            entityName: sale.invoiceNumber,
            changes: JSON.stringify({ reason: 'User deletion' }),
          },
        })
      })

      return NextResponse.json({ success: true })
    }

    // ============================================================
    // LIST SALES
    // ============================================================
    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { startDate, endDate, search } = body
      const where: Record<string, unknown> = {
        tenantId: access.tenantId,    // ← use access.tenantId, not body.tenantId
        isDeleted: false,
      }
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

      const sales = await db.sale.findMany({ where, orderBy: { date: 'desc' } })
      const total = await db.sale.count({ where })
      return NextResponse.json({ sales, total })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    console.error('Sales error:', error)
    // v4.9: Spec Section 14 Rule 2.1 — Anti-Negative Stock returns HTTP 422
    if (error?.message?.includes('CRITICAL_BLOCK_422')) {
      return NextResponse.json(
        {
          error: 'Insufficient physical inventory balance. Transaction aborted to prevent data corruption.',
          code: 'INSUFFICIENT_STOCK',
          details: error.message.replace('CRITICAL_BLOCK_422: ', ''),
        },
        { status: 422 }
      )
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
