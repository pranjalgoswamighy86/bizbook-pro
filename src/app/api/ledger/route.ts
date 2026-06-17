import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

// General Ledger API — Generates formatted account ledger with running balances
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (!tenantId) {
      return NextResponse.json({ error: 'No business selected' }, { status: 400 })
    }

    if (action === 'account-ledger') {
      const { accountId, startDate, endDate } = body
      if (!accountId) {
        return NextResponse.json({ error: 'Account ID is required' }, { status: 400 })
      }

      const account = await db.account.findUnique({ where: { id: accountId } })
      if (!account || account.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }

      // Step 1: Calculate Opening Balance (all transactions before startDate)
      let openingBalance = 0
      if (startDate) {
        const beforeLines = await db.journalEntryLine.findMany({
          where: {
            accountId,
            entry: {
              tenantId,
              isPosted: true,
              entryDate: { lt: new Date(startDate) }
            }
          },
          include: { entry: { select: { entryDate: true } } }
        })

        const totalDebitsBefore = beforeLines.reduce((s, l) => s + l.debit, 0)
        const totalCreditsBefore = beforeLines.reduce((s, l) => s + l.credit, 0)

        // Nature of account determines opening balance sign:
        // Asset/Expense: Debit is positive (+), Credit is negative (-)
        // Liability/Equity/Revenue: Credit is positive (+), Debit is negative (-)
        const isDebitNature = account.type === 'Asset' || account.type === 'Expense'
        openingBalance = isDebitNature
          ? totalDebitsBefore - totalCreditsBefore
          : totalCreditsBefore - totalDebitsBefore
      }

      // Step 2: Fetch period transactions chronologically
      const periodWhere: Record<string, unknown> = {
        accountId,
        entry: {
          tenantId,
          isPosted: true,
          ...(startDate && endDate ? { entryDate: { gte: new Date(startDate), lt: new Date(endDate) } } : {}),
          ...(startDate && !endDate ? { entryDate: { gte: new Date(startDate) } } : {}),
          ...(!startDate && endDate ? { entryDate: { lt: new Date(endDate) } } : {}),
        }
      }

      const periodLines = await db.journalEntryLine.findMany({
        where: periodWhere,
        include: {
          entry: { select: { entryDate: true, reference: true, description: true } }
        },
        orderBy: { entry: { entryDate: 'asc' } }
      })

      // Step 3: Calculate running balance for each line
      const isDebitNature = account.type === 'Asset' || account.type === 'Expense'
      let runningBalance = openingBalance

      const ledgerLines = periodLines.map(line => {
        const balanceChange = isDebitNature
          ? line.debit - line.credit
          : line.credit - line.debit
        runningBalance += balanceChange

        return {
          date: line.entry.entryDate,
          reference: line.entry.reference,
          description: line.entry.description,
          lineDescription: line.description,
          debit: line.debit,
          credit: line.credit,
          balance: Math.round(runningBalance * 100) / 100,
        }
      })

      // Step 4: Calculate period totals
      const totalDebits = periodLines.reduce((s, l) => s + l.debit, 0)
      const totalCredits = periodLines.reduce((s, l) => s + l.credit, 0)
      const closingBalance = runningBalance

      return NextResponse.json({
        account: {
          id: account.id,
          code: account.accountCode,
          name: account.name,
          type: account.type,
        },
        period: { startDate: startDate || null, endDate: endDate || null },
        openingBalance: Math.round(openingBalance * 100) / 100,
        lines: ledgerLines,
        totals: {
          debits: Math.round(totalDebits * 100) / 100,
          credits: Math.round(totalCredits * 100) / 100,
        },
        closingBalance: Math.round(closingBalance * 100) / 100,
      })
    }

    if (action === 'trial-balance') {
      // Generate Trial Balance: list all accounts with their net debit/credit balances
      const { asOfDate } = body
      const dateFilter: Record<string, unknown> = { tenantId, isPosted: true }
      if (asOfDate) {
        dateFilter.entryDate = { lt: new Date(asOfDate) }
      }

      const accounts = await db.account.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ type: 'asc' }, { accountCode: 'asc' }],
      })

      const trialBalanceLines: { code: string; name: string; type: string; debit: number; credit: number }[] = []
      let totalDebitBalance = 0
      let totalCreditBalance = 0

      for (const account of accounts) {
        const lines = await db.journalEntryLine.findMany({
          where: {
            accountId: account.id,
            entry: dateFilter,
          }
        })

        const totalDebits = lines.reduce((s, l) => s + l.debit, 0)
        const totalCredits = lines.reduce((s, l) => s + l.credit, 0)
        const netDebit = totalDebits - totalCredits

        if (Math.abs(netDebit) > 0.01) {
          const isDebitNature = account.type === 'Asset' || account.type === 'Expense'
          if ((isDebitNature && netDebit > 0) || (!isDebitNature && netDebit < 0)) {
            trialBalanceLines.push({
              code: account.accountCode,
              name: account.name,
              type: account.type,
              debit: Math.round(Math.abs(netDebit) * 100) / 100,
              credit: 0,
            })
            totalDebitBalance += Math.abs(netDebit)
          } else {
            trialBalanceLines.push({
              code: account.accountCode,
              name: account.name,
              type: account.type,
              debit: 0,
              credit: Math.round(Math.abs(netDebit) * 100) / 100,
            })
            totalCreditBalance += Math.abs(netDebit)
          }
        }
      }

      return NextResponse.json({
        asOfDate: asOfDate || null,
        lines: trialBalanceLines,
        totals: {
          debit: Math.round(totalDebitBalance * 100) / 100,
          credit: Math.round(totalCreditBalance * 100) / 100,
          isBalanced: Math.abs(totalDebitBalance - totalCreditBalance) < 0.01,
        }
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: unknown) {
    console.error('Ledger error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
