import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

// Journal Entries API — Double-entry bookkeeping core
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (!tenantId) {
      return NextResponse.json({ error: 'No business selected' }, { status: 400 })
    }

    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { entryDate, reference, description, lines, sourceType, sourceId, createdBy } = body

      if (!entryDate || !description || !lines || !Array.isArray(lines) || lines.length < 2) {
        return NextResponse.json({ error: 'Entry date, description, and at least 2 lines are required' }, { status: 400 })
      }

      // Validate double-entry: sum of debits must equal sum of credits
      const totalDebits = lines.reduce((s: number, l: { debit?: number }) => s + (l.debit || 0), 0)
      const totalCredits = lines.reduce((s: number, l: { credit?: number }) => s + (l.credit || 0), 0)
      const tolerance = 0.01
      if (Math.abs(totalDebits - totalCredits) > tolerance) {
        return NextResponse.json({
          error: `Double-entry violation: Debits (${totalDebits.toFixed(2)}) must equal Credits (${totalCredits.toFixed(2)})`
        }, { status: 400 })
      }

      // Validate all account IDs exist
      const accountIds = lines.map((l: { accountId: string }) => l.accountId)
      const accounts = await db.account.findMany({ where: { id: { in: accountIds }, tenantId } })
      if (accounts.length !== accountIds.length) {
        const foundIds = new Set(accounts.map(a => a.id))
        const missing = accountIds.filter((id: string) => !foundIds.has(id))
        return NextResponse.json({ error: `Invalid account IDs: ${missing.join(', ')}` }, { status: 400 })
      }

      // Check for inactive accounts
      const inactiveAccounts = accounts.filter(a => !a.isActive)
      if (inactiveAccounts.length > 0) {
        return NextResponse.json({
          error: `Inactive accounts used: ${inactiveAccounts.map(a => a.name).join(', ')}. Reactivate them first.`
        }, { status: 400 })
      }

      const entry = await db.journalEntry.create({
        data: {
          entryDate: new Date(entryDate),
          reference: reference || null,
          description,
          sourceType: sourceType || 'MANUAL',
          sourceId: sourceId || null,
          isPosted: true,
          tenantId,
          createdBy: createdBy || null,
          lines: {
            create: lines.map((l: { accountId: string; debit?: number; credit?: number; description?: string }) => ({
              accountId: l.accountId,
              debit: l.debit || 0,
              credit: l.credit || 0,
              description: l.description || null,
            }))
          }
        },
        include: { lines: { include: { account: true } } }
      })

      return NextResponse.json({ entry })
    }

    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { startDate, endDate, search, sourceType, accountId } = body
      const where: Record<string, unknown> = { tenantId }

      if (startDate && endDate) {
        where.entryDate = { gte: new Date(startDate), lt: new Date(endDate) }
      }
      if (search) {
        where.OR = [
          { description: { contains: search } },
          { reference: { contains: search } },
        ]
      }
      if (sourceType) {
        where.sourceType = sourceType
      }
      if (accountId) {
        where.lines = { some: { accountId } }
      }

      const entries = await db.journalEntry.findMany({
        where,
        include: {
          lines: {
            include: { account: true },
            orderBy: { id: 'asc' as const }
          }
        },
        orderBy: { entryDate: 'desc' },
      })

      return NextResponse.json({ entries })
    }

    if (action === 'get') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      if (!id) return NextResponse.json({ error: 'Entry ID required' }, { status: 400 })

      const entry = await db.journalEntry.findUnique({
        where: { id },
        include: { lines: { include: { account: true }, orderBy: { id: 'asc' as const } } }
      })

      if (!entry || entry.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
      }

      return NextResponse.json({ entry })
    }

    if (action === 'reverse') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      // Create a reversing entry for a posted journal entry (immutable principle)
      const { id, reason, createdBy } = body
      if (!id) return NextResponse.json({ error: 'Entry ID required' }, { status: 400 })

      const originalEntry = await db.journalEntry.findUnique({
        where: { id },
        include: { lines: true }
      })

      if (!originalEntry || originalEntry.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
      }

      if (!originalEntry.isPosted) {
        return NextResponse.json({ error: 'Cannot reverse an unposted entry' }, { status: 400 })
      }

      // Create reversing entry — swap debits and credits
      const reverseEntry = await db.journalEntry.create({
        data: {
          entryDate: new Date(),
          reference: `REVERSAL-${originalEntry.reference || originalEntry.id.slice(0, 8)}`,
          description: reason || `Reversal of entry: ${originalEntry.description}`,
          sourceType: 'MANUAL',
          isPosted: true,
          tenantId,
          createdBy: createdBy || null,
          lines: {
            create: originalEntry.lines.map(l => ({
              accountId: l.accountId,
              debit: l.credit,   // Swap: credit becomes debit
              credit: l.debit,   // Swap: debit becomes credit
              description: `Reversal: ${l.description || ''}`,
            }))
          }
        },
        include: { lines: { include: { account: true } } }
      })

      return NextResponse.json({ entry: reverseEntry })
    }

    if (action === 'auto-post-sale') {
      // Auto-generate journal entry when a sale is created
      const { saleId, saleData } = body
      if (!saleId || !saleData) {
        return NextResponse.json({ error: 'Sale ID and data required' }, { status: 400 })
      }

      // Check if journal entry already exists for this sale
      const existing = await db.journalEntry.findFirst({
        where: { sourceType: 'SALE', sourceId: saleId, tenantId }
      })
      if (existing) {
        return NextResponse.json({ entry: existing, message: 'Journal entry already exists for this sale' })
      }

      // Get or create required accounts
      const accounts = await db.account.findMany({ where: { tenantId } })
      const findAccount = (code: string) => accounts.find(a => a.accountCode === code)

      // We need: Debtors/Cash (debit), Sales Revenue (credit), GST Payable (credit)
      let debtorsAccount = findAccount('10300')
      let cashAccount = findAccount('10100')
      let salesAccount = findAccount('40100')
      let gstPayableAccount = findAccount('20200')

      // Create missing accounts on the fly
      if (!debtorsAccount) {
        debtorsAccount = await db.account.create({ data: { accountCode: '10300', name: 'Accounts Receivable', type: 'Asset', tenantId } })
      }
      if (!cashAccount) {
        cashAccount = await db.account.create({ data: { accountCode: '10100', name: 'Cash', type: 'Asset', tenantId } })
      }
      if (!salesAccount) {
        salesAccount = await db.account.create({ data: { accountCode: '40100', name: 'Sales Revenue', type: 'Revenue', tenantId } })
      }
      if (!gstPayableAccount) {
        gstPayableAccount = await db.account.create({ data: { accountCode: '20200', name: 'GST Payable', type: 'Liability', tenantId } })
      }

      const isCash = (saleData.partyName || '').trim().toLowerCase() === 'cash'
      const lines: { accountId: string; debit: number; credit: number; description: string }[] = []

      // Debit: Cash or Debtors
      lines.push({
        accountId: isCash ? cashAccount!.id : debtorsAccount!.id,
        debit: saleData.totalAmount || 0,
        credit: 0,
        description: isCash ? 'Cash received' : `Amount receivable from ${saleData.partyName}`,
      })

      // Credit: Sales Revenue
      lines.push({
        accountId: salesAccount!.id,
        debit: 0,
        credit: saleData.subtotal || 0,
        description: `Sale ${saleData.invoiceNumber || ''}`,
      })

      // Credit: GST Payable (if GST > 0)
      if (saleData.gstAmount > 0) {
        lines.push({
          accountId: gstPayableAccount!.id,
          debit: 0,
          credit: saleData.gstAmount,
          description: `GST on sale ${saleData.invoiceNumber || ''}`,
        })
      }

      const entry = await db.journalEntry.create({
        data: {
          entryDate: new Date(saleData.date),
          reference: saleData.invoiceNumber || null,
          description: `Sale invoice ${saleData.invoiceNumber || ''} to ${saleData.partyName}`,
          sourceType: 'SALE',
          sourceId: saleId,
          isPosted: true,
          tenantId,
          createdBy: saleData.createdBy || null,
          lines: { create: lines }
        },
        include: { lines: { include: { account: true } } }
      })

      return NextResponse.json({ entry })
    }

    if (action === 'auto-post-purchase') {
      // Auto-generate journal entry when a purchase is created
      const { purchaseId, purchaseData } = body
      if (!purchaseId || !purchaseData) {
        return NextResponse.json({ error: 'Purchase ID and data required' }, { status: 400 })
      }

      const existing = await db.journalEntry.findFirst({
        where: { sourceType: 'PURCHASE', sourceId: purchaseId, tenantId }
      })
      if (existing) {
        return NextResponse.json({ entry: existing, message: 'Journal entry already exists for this purchase' })
      }

      const accounts = await db.account.findMany({ where: { tenantId } })
      const findAccount = (code: string) => accounts.find(a => a.accountCode === code)

      let creditorsAccount = findAccount('20100')
      let cashAccount = findAccount('10100')
      let purchaseAccount = findAccount('50200')
      let gstInputAccount = findAccount('50600')

      if (!creditorsAccount) {
        creditorsAccount = await db.account.create({ data: { accountCode: '20100', name: 'Accounts Payable', type: 'Liability', tenantId } })
      }
      if (!cashAccount) {
        cashAccount = await db.account.create({ data: { accountCode: '10100', name: 'Cash', type: 'Asset', tenantId } })
      }
      if (!purchaseAccount) {
        purchaseAccount = await db.account.create({ data: { accountCode: '50200', name: 'Purchase Expenses', type: 'Expense', tenantId } })
      }
      if (!gstInputAccount) {
        gstInputAccount = await db.account.create({ data: { accountCode: '50600', name: 'GST Input Credit', type: 'Expense', tenantId } })
      }

      const isCash = (purchaseData.partyName || '').trim().toLowerCase() === 'cash'
      const lines: { accountId: string; debit: number; credit: number; description: string }[] = []

      // Debit: Purchase Expenses
      lines.push({
        accountId: purchaseAccount!.id,
        debit: purchaseData.subtotal || 0,
        credit: 0,
        description: `Purchase ${purchaseData.invoiceNumber || ''}`,
      })

      // Debit: GST Input Credit (if GST > 0)
      if (purchaseData.gstAmount > 0) {
        lines.push({
          accountId: gstInputAccount!.id,
          debit: purchaseData.gstAmount,
          credit: 0,
          description: `GST on purchase ${purchaseData.invoiceNumber || ''}`,
        })
      }

      // Credit: Cash or Creditors
      lines.push({
        accountId: isCash ? cashAccount!.id : creditorsAccount!.id,
        debit: 0,
        credit: purchaseData.totalAmount || 0,
        description: isCash ? 'Cash paid' : `Amount payable to ${purchaseData.partyName}`,
      })

      const entry = await db.journalEntry.create({
        data: {
          entryDate: new Date(purchaseData.date),
          reference: purchaseData.invoiceNumber || null,
          description: `Purchase invoice ${purchaseData.invoiceNumber || ''} from ${purchaseData.partyName}`,
          sourceType: 'PURCHASE',
          sourceId: purchaseId,
          isPosted: true,
          tenantId,
          createdBy: purchaseData.createdBy || null,
          lines: { create: lines }
        },
        include: { lines: { include: { account: true } } }
      })

      return NextResponse.json({ entry })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: unknown) {
    console.error('Journal entries error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
