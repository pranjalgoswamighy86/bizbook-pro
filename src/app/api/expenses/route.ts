import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'
// v4.155: Auto Excel backup after every expense create/update/delete
import { triggerAutoBackup } from '@/lib/auto-backup'

// =====================================================================
// v6.27.5: Expense → General Ledger auto-posting
// =====================================================================
// Previously, expenses were created/updated/deleted WITHOUT any Journal Entry,
// so the Trial Balance showed zero expense accounts and the GL was permanently
// out of sync with the P&L (which reads the Expense table directly).
//
// Now every expense CRUD operation posts a corresponding JE:
//
//   CREATE:  Dr <Expense account>      amount
//            Cr Cash (10100) OR Bank (10200)   amount   (based on paymentMode)
//
//   UPDATE:  1. Reverse the original JE (swap debit/credit)
//            2. Post a new JE with the new amount/category/paymentMode
//
//   DELETE:  Reverse the original JE (swap debit/credit)
//
// The expense category is mapped to a seeded expense account code:
//   "Rent" → 50300, "Salary" → 50400, "Utility"/"Utilities" → 50500,
//   "Office"/"Supplies" → 50700, "Travel" → 50800, "Bank Charges" → 51000,
//   everything else → 51100 (Miscellaneous Expense).
// =====================================================================

// Map an expense category string to a CoA account code.
// Returns the code of the seeded expense account to debit.
function categoryToAccountCode(category: string): string {
  const c = (category || '').toLowerCase().trim()
  if (c.includes('rent')) return '50300'
  if (c.includes('salary') || c.includes('salaries') || c.includes('wage')) return '50400'
  if (c.includes('utilit') || c.includes('electric') || c.includes('water') || c.includes('internet')) return '50500'
  if (c.includes('office') || c.includes('suppl') || c.includes('stationer')) return '50700'
  if (c.includes('travel') || c.includes('fuel') || c.includes('conveyance')) return '50800'
  if (c.includes('deprec')) return '50900'
  if (c.includes('bank') || c.includes('charge') || c.includes('fee') || c.includes('interest')) return '51000'
  return '51100' // Miscellaneous Expense
}

// Pick the cash-equivalent account code based on paymentMode.
function paymentModeToCreditAccount(paymentMode: string | undefined): string {
  const m = (paymentMode || '').toUpperCase()
  if (m === 'BANK' || m === 'CHEQUE' || m === 'NEFT' || m === 'RTGS' || m === 'UPI') return '10200'
  return '10100' // Cash
}

// Helper: find an account by code + tenant, creating it on the fly if missing.
async function ensureAccount(tx: any, tenantId: string, code: string, name: string, type: string) {
  let acc = await tx.account.findFirst({ where: { accountCode: code, tenantId } })
  if (!acc) {
    acc = await tx.account.create({ data: { accountCode: code, name, type, tenantId, isActive: true } })
  }
  return acc
}

// Helper: post a Journal Entry for an expense. Used by create + update.
async function postExpenseJE(
  tx: any,
  tenantId: string,
  userId: string,
  expense: any,
  expenseCategory: string,
  expenseAmount: number,
  paymentMode: string | undefined,
  expenseDate: Date,
  reversal = false,
) {
  const expenseAccCode = categoryToAccountCode(expenseCategory)
  const creditAccCode = paymentModeToCreditAccount(paymentMode)

  const expenseAccount = await ensureAccount(tx, tenantId, expenseAccCode, expenseCategory || 'Expense', 'Expense')
  const creditAccount = await ensureAccount(tx, tenantId, creditAccCode, creditAccCode === '10100' ? 'Cash' : 'Bank Account', 'Asset')

  const ref = `${reversal ? 'REVERSAL-' : ''}EXP/${expense.id.slice(0, 8)}`

  if (!reversal) {
    // Normal posting: Dr Expense / Cr Cash|Bank
    await tx.journalEntry.create({
      data: {
        entryDate: expenseDate,
        reference: ref,
        description: `Expense: ${expense.description || expenseCategory} (${expenseCategory})`,
        sourceType: 'EXPENSE',
        sourceId: expense.id,
        isPosted: true,
        tenantId,
        createdBy: userId,
        lines: {
          create: [
            { accountId: expenseAccount.id, debit: expenseAmount, credit: 0, description: `${expenseCategory} expense` },
            { accountId: creditAccount.id, debit: 0, credit: expenseAmount, description: `Paid via ${paymentMode || 'CASH'}` },
          ],
        },
      },
    })
  } else {
    // Reversal: swap debit/credit
    await tx.journalEntry.create({
      data: {
        entryDate: new Date(),
        reference: ref,
        description: `Reversal of expense: ${expense.description || expenseCategory}`,
        sourceType: 'MANUAL',
        isPosted: true,
        tenantId,
        createdBy: userId,
        lines: {
          create: [
            { accountId: expenseAccount.id, debit: 0, credit: expenseAmount, description: `Reversal: ${expenseCategory} expense` },
            { accountId: creditAccount.id, debit: expenseAmount, credit: 0, description: `Reversal: Paid via ${paymentMode || 'CASH'}` },
          ],
        },
      },
    })
  }
}

// Helper: find and reverse the original auto-posted JE for an expense.
async function reverseOriginalExpenseJE(tx: any, tenantId: string, userId: string, expenseId: string) {
  const originalJE = await tx.journalEntry.findFirst({
    where: { sourceType: 'EXPENSE', sourceId: expenseId, tenantId },
    include: { lines: true },
  })
  if (originalJE) {
    await tx.journalEntry.create({
      data: {
        entryDate: new Date(),
        reference: `REVERSAL-${originalJE.reference || expenseId.slice(0, 8)}`,
        description: `Reversal of expense (edited or deleted)`,
        sourceType: 'MANUAL',
        isPosted: true,
        tenantId,
        createdBy: userId,
        lines: {
          create: originalJE.lines.map((l: any) => ({
            accountId: l.accountId,
            debit: l.credit,
            credit: l.debit,
            description: `Reversal: ${l.description || ''}`,
          })),
        },
      },
    })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      // v6.27.5: Wrap expense create + JE posting in a transaction
      const expense = await db.$transaction(async (tx) => {
        const created = await tx.expense.create({ data: { ...body.data, tenantId: access.tenantId } })
        // Post the Journal Entry: Dr Expense / Cr Cash|Bank
        await postExpenseJE(
          tx,
          access.tenantId,
          access.userId,
          created,
          created.category,
          created.amount,
          created.paymentMode,
          created.date,
          false,
        )
        return created
      })
      // v4.155: Auto Excel backup after expense create
      // triggerAutoBackup is synchronous fire-and-forget (returns void)
      try { triggerAutoBackup(tenantId, 'expense:create') } catch (e: any) { console.warn('[AutoBackup] expense:create failed:', e?.message) }
      return NextResponse.json({ expense })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      // v6.27.5: verify the expense belongs to this tenant before updating
      const existing = await db.expense.findFirst({ where: { id, tenantId: access.tenantId } })
      if (!existing) {
        return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
      }

      // v6.27.5: reverse original JE + post new JE in a transaction
      const expense = await db.$transaction(async (tx) => {
        const updated = await tx.expense.update({ where: { id }, data })
        // Reverse the original JE
        await reverseOriginalExpenseJE(tx, access.tenantId, access.userId, id)
        // Post a new JE with the updated values
        await postExpenseJE(
          tx,
          access.tenantId,
          access.userId,
          updated,
          updated.category,
          updated.amount,
          updated.paymentMode,
          updated.date,
          false,
        )
        return updated
      })
      // v4.155: Auto Excel backup after expense update
      try { triggerAutoBackup(tenantId, 'expense:update') } catch (e: any) { console.warn('[AutoBackup] expense:update failed:', e?.message) }
      return NextResponse.json({ expense })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      // v6.27.5: verify the expense belongs to this tenant before deleting
      const existing = await db.expense.findFirst({ where: { id, tenantId: access.tenantId } })
      if (!existing) {
        return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
      }

      // v6.27.5: reverse the original JE before soft-deleting
      await db.$transaction(async (tx) => {
        await reverseOriginalExpenseJE(tx, access.tenantId, access.userId, id)
        await tx.expense.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
      })
      // v4.155: Auto Excel backup after expense delete
      try { triggerAutoBackup(tenantId, 'expense:delete') } catch (e: any) { console.warn('[AutoBackup] expense:delete failed:', e?.message) }
      return NextResponse.json({ success: true })
    }

    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { startDate, endDate, search, category } = body
      const where: Record<string, unknown> = { tenantId, isDeleted: false }
      if (startDate && endDate) {
        where.date = { gte: new Date(startDate), lt: new Date(endDate) }
      }
      if (search) {
        where.OR = [
          { description: { contains: search } },
          { category: { contains: search } },
          { reference: { contains: search } },
        ]
      }
      if (category) {
        where.category = category
      }
      // v4.55: Add pagination for 1000+ user scalability (was loading entire table)
      const page = Number(body.page) || 1
      const limit = Math.min(Number(body.limit) || 100, 500) // max 500 per page
      const skip = (page - 1) * limit
      const expenses = await db.expense.findMany({ where, orderBy: { date: 'desc' }, take: limit, skip })
      const total = await db.expense.count({ where })
      return NextResponse.json({ expenses, total, page, limit, hasMore: skip + expenses.length < total })
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
      const expenses = await db.expense.findMany({ where })
      const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)
      const byCategory = expenses.reduce<Record<string, number>>((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + e.amount
        return acc
      }, {})
      return NextResponse.json({ totalExpenses, byCategory, count: expenses.length })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Expenses error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
