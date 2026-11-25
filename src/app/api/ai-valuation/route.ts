import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { analyzeWithAI } from '@/lib/multi-ai'
import { requireAuthAndTenant } from '@/lib/api-helpers'
import { aggregateFinancialYears, calculateValuation, normalizeAiValuationSummary } from '@/lib/ai-valuation-calculations'

function getFinancialYearStart(date: Date): Date {
  const year = date.getFullYear()
  return new Date(year, date.getMonth() >= 3 ? 3 : 3, date.getMonth() >= 3 ? year : year - 1)
}

function getFinancialYearLabel(startYear: number): string {
  return `FY ${startYear}-${String(startYear + 1).slice(-2)}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : ''
    const auth = await requireAuthAndTenant(req, tenantId)
    if (auth instanceof NextResponse) return auth

    const now = new Date()
    const currentStart = new Date(now.getFullYear(), now.getMonth() >= 3 ? 3 : 3, now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1)
    const firstYearStart = new Date(currentStart.getFullYear() - 2, 3, 1)
    const years = [firstYearStart.getFullYear(), firstYearStart.getFullYear() + 1, firstYearStart.getFullYear() + 2]
    const fyRanges = years.map((startYear) => ({
      startYear,
      start: new Date(startYear, 3, 1),
      end: new Date(startYear + 1, 3, 1),
    }))

    const [
      sales,
      purchases,
      expenses,
      inventory,
      debtors,
      creditors,
      bankTransactions,
      cashReceipts,
      cashPayments,
    ] = await Promise.all([
      db.sale.findMany({
        where: { tenantId: auth.tenantId, date: { gte: firstYearStart, lte: now }, invoiceStatus: 'CONFIRMED' },
        select: { date: true, totalAmount: true },
      }),
      db.purchase.findMany({
        where: { tenantId: auth.tenantId, date: { gte: firstYearStart, lte: now } },
        select: { date: true, totalAmount: true },
      }),
      db.expense.findMany({
        where: { tenantId: auth.tenantId, date: { gte: firstYearStart, lte: now } },
        select: { date: true, amount: true },
      }),
      db.inventoryItem.findMany({
        where: { tenantId: auth.tenantId },
        select: { currentStock: true, purchasePrice: true },
      }),
      db.debtor.findMany({
        where: { tenantId: auth.tenantId },
        select: { currentBalance: true },
      }),
      db.creditor.findMany({
        where: { tenantId: auth.tenantId },
        select: { currentBalance: true },
      }),
      db.bankTransaction.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: { date: 'desc' },
        select: { date: true, bankName: true, accountNumber: true, balance: true },
      }),
      db.receipt.findMany({
        where: { tenantId: auth.tenantId, date: { gte: currentStart, lte: now }, paymentMode: 'CASH' },
        select: { amount: true },
      }),
      db.payment.findMany({
        where: { tenantId: auth.tenantId, date: { gte: currentStart, lte: now }, paymentMode: 'CASH' },
        select: { amount: true },
      }),
    ])

    const yearInputs = fyRanges.map(({ startYear, start, end }) => {
      const inRange = <T extends { date: Date }>(rows: T[]) => rows.filter(row => row.date >= start && row.date < end)
      return {
        year: getFinancialYearLabel(startYear),
        revenue: inRange(sales).reduce((sum, row) => sum + row.totalAmount, 0),
        purchases: inRange(purchases).reduce((sum, row) => sum + row.totalAmount, 0),
        expenses: inRange(expenses).reduce((sum, row) => sum + row.amount, 0),
      }
    })
    const yearlyData = aggregateFinancialYears(yearInputs)

    const inventoryValue = inventory.reduce((sum, item) => sum + Math.max(0, item.currentStock) * Math.max(0, item.purchasePrice), 0)
    const receivables = debtors.reduce((sum, row) => sum + Math.max(0, row.currentBalance), 0)
    const payables = creditors.reduce((sum, row) => sum + Math.max(0, row.currentBalance), 0)

    // Bank statement balances are snapshots; use the newest record per account to avoid summing history.
    const latestBankBalances = new Map<string, number>()
    for (const transaction of bankTransactions) {
      const accountKey = transaction.accountNumber || transaction.bankName || 'unspecified-account'
      if (!latestBankBalances.has(accountKey)) latestBankBalances.set(accountKey, transaction.balance)
    }
    const bankCash = [...latestBankBalances.values()].reduce((sum, value) => sum + value, 0)
    // Cash is an FY-to-date flow estimate; opening cash is unavailable in these models.
    const cashFlowCash = cashReceipts.reduce((sum, row) => sum + row.amount, 0) - cashPayments.reduce((sum, row) => sum + row.amount, 0)
    const cash = bankCash + cashFlowCash
    const balanceSheet = {
      inventory: inventoryValue,
      receivables,
      payables,
      cash,
      bank: bankCash,
      cashFlowEstimate: cashFlowCash,
      workingCapital: inventoryValue + receivables + cash - payables,
      assets: inventoryValue + receivables + cash,
      liabilities: payables,
      netWorth: inventoryValue + receivables + cash - payables,
      note: 'Approximate snapshot from inventory at purchase cost, debtor/creditor balances, latest bank statement balances and FY-to-date cash receipts/payments. Opening cash and complete liabilities are not available in these source models.',
    }

    const computed = calculateValuation(yearlyData, balanceSheet)
    let aiProvider = 'none'
    let qualitative = normalizeAiValuationSummary(null)
    const aiPrompt = [
      'Provide qualitative business analysis only. Do not calculate, change, or invent the numerical valuation.',
      'Return strict JSON with keys summary (string), keyStrengths (string array), keyRisks (string array), recommendations (string array).',
      'Analyze the supplied aggregates, explicitly note missing/incomplete financial history and approximate accounting proxies. Do not claim the snapshot is a complete audited balance sheet.',
      JSON.stringify({ yearlyData, balanceSheet, numericalValuation: computed.valuation.valuationRange, financialHealthScore: computed.valuation.financialHealthScore }),
    ].join('\n\n')
    try {
      const result = await analyzeWithAI(aiPrompt, undefined, undefined, { jsonMode: true, maxTokens: 900, temperature: 0.2 })
      aiProvider = result.provider || 'unknown'
      qualitative = normalizeAiValuationSummary(result.result)
    } catch (aiError) {
      console.warn('[AI-Valuation] Qualitative AI analysis unavailable; returning calculation-only estimate:', aiError instanceof Error ? aiError.message : 'Unknown AI error')
    }

    const valuation = {
      ...computed.valuation,
      ...qualitative,
      // If the AI returns empty arrays, retain the conservative generated observations.
      keyStrengths: qualitative.keyStrengths.length ? qualitative.keyStrengths : computed.valuation.keyStrengths,
      keyRisks: qualitative.keyRisks.length ? qualitative.keyRisks : computed.valuation.keyRisks,
      recommendations: qualitative.recommendations.length ? qualitative.recommendations : computed.valuation.recommendations,
      valuationRange: computed.valuation.valuationRange,
      financialHealthScore: computed.valuation.financialHealthScore,
      healthGrade: computed.valuation.healthGrade,
      valuationMethod: computed.valuation.valuationMethod,
      growthTrend: computed.valuation.growthTrend,
    }

    return NextResponse.json({
      success: true,
      valuation,
      dcf: computed.dcf,
      yearlyData: computed.yearlyData,
      balanceSheet,
      aiProvider,
      disclaimer: 'Indicative estimate only—not a certified valuation, audited financial statement or professional financial advice.',
    })
  } catch (error) {
    console.error('[AI-Valuation] Request failed:', error)
    return NextResponse.json({ error: 'Unable to calculate valuation from the available records' }, { status: 500 })
  }
}
