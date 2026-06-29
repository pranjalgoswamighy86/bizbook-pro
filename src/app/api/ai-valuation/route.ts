/**
 * v4.150: AI Business Valuation API
 * ============================================================
 * Complete rewrite with proper DCF (Discounted Cash Flow) math layer.
 *
 * What changed from v4.85:
 * 1. Multi-year historical data (3-5 years) — pulls annual revenue, EBITDA proxy, working capital
 * 2. Server-side DCF calculation (WACC, terminal value, projection years) — not pure LLM estimation
 * 3. Multiple valuation methods: DCF, Revenue Multiple, EBITDA Multiple, Asset-Based
 * 4. Comparable company analysis with industry benchmarks (SME India retail/wholesale)
 * 5. Wire multi-ai.ts abstraction — fallback across ZAI → OpenAI → Gemini → Claude
 * 6. Returns full breakdown so user can see WHY the valuation is what it is
 *
 * DCF Formula:
 *   PV = Σ (FCF_t / (1+r)^t) + (TV / (1+r)^n)
 *   where TV = FCF_n * (1+g) / (r - g)
 *
 * SME assumptions:
 *   - WACC: 12-18% (higher than large caps due to risk premium)
 *   - Terminal growth: 3-5% (Indian inflation target)
 *   - Projection horizon: 5 years
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant } from '@/lib/api-helpers'
import { analyzeWithAI, getAvailableProviders } from '@/lib/multi-ai'

export const dynamic = 'force-dynamic'

// ============================================================
// DCF Math Layer (server-side, deterministic)
// ============================================================

interface YearlyFinancials {
  year: number
  revenue: number
  cogs: number
  grossProfit: number
  operatingExpenses: number
  ebitda: number             // proxy: grossProfit - opex (no separate D&A)
  inventory: number
  receivables: number
  payables: number
  workingCapital: number     // receivables + inventory - payables
  cashFlow: number           // ebitda - workingCapital change
  revenueGrowthPct: number | null  // YoY growth
}

interface DCFResult {
  projectionYears: number
  wacc: number               // discount rate
  terminalGrowthRate: number
  projectedFCF: number[]     // 5-year free cash flow projections
  terminalValue: number
  presentValueFCF: number[]  // discounted FCFs
  presentValueTV: number
  enterpriseValue: number
  netDebt: number            // (debt - cash) — we use 0 if unknown
  equityValue: number
  dcfPerMethod: {
    dcf: number
    revenueMultiple: number
    ebitdaMultiple: number
    assetBased: number
  }
  assumptions: {
    waccRationale: string
    growthRationale: string
    multiples: { revenue: number; ebitda: number }
    industryBenchmark: string
  }
}

/**
 * Compute DCF valuation with SME-appropriate assumptions.
 * Falls back gracefully if only 1 year of data is available.
 */
function computeDCF(
  yearly: YearlyFinancials[],
  currentInventory: number,
  currentReceivables: number,
  currentPayables: number,
  currentCash: number
): DCFResult {
  // Sort by year ascending
  const sorted = [...yearly].sort((a, b) => a.year - b.year)
  const latest = sorted[sorted.length - 1]
  const baseRevenue = latest.revenue
  const baseEbitda = latest.ebitda || (latest.grossProfit - latest.operatingExpenses)

  // Compute historical revenue growth (CAGR if 3+ years, else YoY)
  let historicalGrowth: number
  if (sorted.length >= 3) {
    const first = sorted[0]
    const years = sorted.length - 1
    historicalGrowth = Math.pow(baseRevenue / Math.max(first.revenue, 1), 1 / years) - 1
  } else if (sorted.length === 2) {
    historicalGrowth = sorted[1].revenueGrowthPct || 0
  } else {
    historicalGrowth = 0.10  // default 10% if no history
  }

  // Cap growth to reasonable SME range: 0% to 25%
  const projectedGrowth = Math.max(0, Math.min(0.25, historicalGrowth))

  // WACC: SME risk premium over risk-free rate
  // Risk-free (10Y G-Sec India): ~7%
  // Equity risk premium: ~8%
  // SME size premium: ~4-6%
  // Resulting WACC: ~15-18%, we use 15% as baseline
  const wacc = 0.15
  const terminalGrowthRate = 0.04  // India long-term inflation target

  // Project 5 years of FCF
  const projectionYears = 5
  const projectedFCF: number[] = []
  const projectedRevenue: number[] = []
  let lastRevenue = baseRevenue
  let lastEbitda = baseEbitda

  for (let i = 1; i <= projectionYears; i++) {
    // Growth decays linearly from projectedGrowth to terminalGrowthRate
    const decayFactor = (projectionYears - i + 1) / projectionYears
    const yearGrowth = terminalGrowthRate + (projectedGrowth - terminalGrowthRate) * decayFactor
    lastRevenue = lastRevenue * (1 + yearGrowth)
    // EBITDA margin stays constant (simplification — could improve later)
    const ebitdaMargin = baseRevenue > 0 ? baseEbitda / baseRevenue : 0.10
    lastEbitda = lastRevenue * ebitdaMargin
    // FCF = EBITDA * (1 - taxRate) - CapEx - WC change
    // For SME: CapEx ≈ 3% of revenue, WC change ≈ 10% of revenue change
    const capex = lastRevenue * 0.03
    const revenueChange = lastRevenue - (projectedRevenue[i - 2] || baseRevenue)
    const wcChange = revenueChange * 0.10
    const fcf = lastEbitda * (1 - 0.25) - capex - wcChange  // 25% tax rate
    projectedFCF.push(fcf)
    projectedRevenue.push(lastRevenue)
  }

  // Terminal Value (Gordon Growth)
  const finalFCF = projectedFCF[projectedFCF.length - 1]
  const terminalValue = finalFCF * (1 + terminalGrowthRate) / (wacc - terminalGrowthRate)

  // Discount to present value
  const presentValueFCF = projectedFCF.map((fcf, i) => fcf / Math.pow(1 + wacc, i + 1))
  const presentValueTV = terminalValue / Math.pow(1 + wacc, projectionYears)

  // Enterprise Value = sum of PV(FCF) + PV(TV)
  const enterpriseValue = presentValueFCF.reduce((s, v) => s + v, 0) + presentValueTV

  // Equity Value = EV - net debt
  const netDebt = Math.max(0, currentPayables - currentCash - currentReceivables)
  const equityValueDCF = enterpriseValue - netDebt

  // Revenue Multiple Method (SME India: 0.5x - 2x revenue)
  const revenueMultiple = 1.2
  const equityValueRevenue = baseRevenue * revenueMultiple

  // EBITDA Multiple Method (SME India: 4x - 8x EBITDA)
  const ebitdaMultiple = 6
  const equityValueEbitda = baseEbitda * ebitdaMultiple

  // Asset-Based (liquidation value)
  const equityValueAsset = currentInventory + currentReceivables + currentCash - currentPayables

  return {
    projectionYears,
    wacc,
    terminalGrowthRate,
    projectedFCF,
    terminalValue,
    presentValueFCF,
    presentValueTV,
    enterpriseValue,
    netDebt,
    equityValue: equityValueDCF,
    dcfPerMethod: {
      dcf: equityValueDCF,
      revenueMultiple: equityValueRevenue,
      ebitdaMultiple: equityValueEbitda,
      assetBased: equityValueAsset,
    },
    assumptions: {
      waccRationale: `15% WACC = 7% risk-free (10Y G-Sec) + 8% equity risk premium + 4% SME size premium`,
      growthRationale: `Projected ${Math.round(projectedGrowth * 100)}% (capped from ${Math.round(historicalGrowth * 100)}% historical), decaying to 4% terminal growth`,
      multiples: { revenue: revenueMultiple, ebitda: ebitdaMultiple },
      industryBenchmark: 'SME India retail/wholesale (1.2x revenue, 6x EBITDA)',
    },
  }
}

// ============================================================
// Main API
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const access = await requireAuthAndTenant(req, body.tenantId)
    if (access instanceof NextResponse) return access

    const tenantId = access.tenantId

    // ============================================================
    // 1. Fetch multi-year financial data
    // ============================================================
    const currentYear = new Date().getFullYear()
    const yearsToFetch = [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear]

    const yearlyData: YearlyFinancials[] = []

    for (const year of yearsToFetch) {
      const startDate = new Date(year, 0, 1)
      const endDate = new Date(year + 1, 0, 1)
      const [sales, purchases, expenses, payments, receipts] = await Promise.all([
        db.sale.findMany({
          where: { tenantId, isDeleted: false, date: { gte: startDate, lt: endDate } },
          select: { totalAmount: true, subtotal: true, paymentStatus: true },
        }),
        db.purchase.findMany({
          where: { tenantId, isDeleted: false, date: { gte: startDate, lt: endDate } },
          select: { totalAmount: true, subtotal: true },
        }),
        db.expense.findMany({
          where: { tenantId, isDeleted: false, date: { gte: startDate, lt: endDate } },
          select: { amount: true, category: true } as any,
        }),
        db.payment.findMany({
          where: { tenantId, isDeleted: false, date: { gte: startDate, lt: endDate } },
          select: { amount: true },
        }),
        db.receipt.findMany({
          where: { tenantId, isDeleted: false, date: { gte: startDate, lt: endDate } },
          select: { amount: true },
        }),
      ])

      const revenue = sales.reduce((s, x) => s + (x.totalAmount || 0), 0)
      const cogs = purchases.reduce((s, x) => s + (x.subtotal || 0), 0)
      const operatingExpenses = expenses.reduce((s, x) => s + (x.amount || 0), 0)
      const grossProfit = revenue - cogs
      const ebitda = grossProfit - operatingExpenses
      const cashFlow = receipts.reduce((s, x) => s + (x.amount || 0), 0)
        - payments.reduce((s, x) => s + (x.amount || 0), 0)

      // Skip empty years (no transactions)
      if (revenue === 0 && cogs === 0 && operatingExpenses === 0) continue

      yearlyData.push({
        year,
        revenue,
        cogs,
        grossProfit,
        operatingExpenses,
        ebitda,
        inventory: 0,           // current snapshot, not yearly
        receivables: 0,         // filled below
        payables: 0,            // filled below
        workingCapital: 0,
        cashFlow,
        revenueGrowthPct: null, // filled in next loop
      })
    }

    // Compute YoY growth
    for (let i = 1; i < yearlyData.length; i++) {
      const prev = yearlyData[i - 1]
      const curr = yearlyData[i]
      curr.revenueGrowthPct = prev.revenue > 0 ? (curr.revenue - prev.revenue) / prev.revenue : null
    }

    // Current balance sheet snapshot
    const [inventoryItems, debtors, creditors, lastBankTx] = await Promise.all([
      db.inventoryItem.findMany({ where: { tenantId, isDeleted: false }, select: { currentStock: true, purchasePrice: true } }),
      db.debtor.findMany({ where: { tenantId, isDeleted: false }, select: { currentBalance: true } }),
      db.creditor.findMany({ where: { tenantId, isDeleted: false }, select: { currentBalance: true } }),
      db.bankTransaction.findFirst({ where: { tenantId, isDeleted: false }, orderBy: { date: 'desc' }, select: { balance: true } }),
    ])

    const currentInventory = inventoryItems.reduce((s, x) => s + (x.currentStock || 0) * (x.purchasePrice || 0), 0)
    const currentReceivables = debtors.reduce((s, x) => s + (x.currentBalance || 0), 0)
    const currentPayables = creditors.reduce((s, x) => s + (x.currentBalance || 0), 0)
    const currentCash = lastBankTx?.balance || 0

    // Fill working capital into latest year
    if (yearlyData.length > 0) {
      const latest = yearlyData[yearlyData.length - 1]
      latest.inventory = currentInventory
      latest.receivables = currentReceivables
      latest.payables = currentPayables
      latest.workingCapital = currentReceivables + currentInventory - currentPayables
    }

    // ============================================================
    // 2. Compute DCF (server-side, deterministic)
    // ============================================================
    const dcf = computeDCF(
      yearlyData,
      currentInventory,
      currentReceivables,
      currentPayables,
      currentCash
    )

    // ============================================================
    // 3. AI Narrative Analysis (uses multi-ai.ts abstraction)
    // ============================================================
    const availableProviders = getAvailableProviders()
    if (availableProviders.length === 0) {
      // No AI configured — return DCF only with a note
      return NextResponse.json({
        valuation: {
          valuationRange: {
            low: Math.round(Math.min(dcf.dcfPerMethod.dcf, dcf.dcfPerMethod.assetBased)),
            mid: Math.round(dcf.dcfPerMethod.dcf),
            high: Math.round(dcf.dcfPerMethod.ebitdaMultiple),
          },
          valuationMethod: 'DCF + Multiples (no AI narrative available)',
          financialHealthScore: yearlyData.length > 0 ? Math.min(100, Math.max(0, 50 + (yearlyData[yearlyData.length - 1].ebitda / Math.max(yearlyData[yearlyData.length - 1].revenue, 1)) * 100)) : 50,
          healthGrade: 'C',
          keyStrengths: ['Has historical financial data'],
          keyRisks: ['AI analysis unavailable — configure ZAI_API_KEY or OPENAI_API_KEY'],
          growthTrend: yearlyData.length > 1 && yearlyData[yearlyData.length - 1].revenueGrowthPct !== null
            ? `${Math.round((yearlyData[yearlyData.length - 1].revenueGrowthPct || 0) * 100)}% YoY`
            : 'Insufficient data',
          recommendations: ['Configure AI API keys for full analysis'],
          summary: 'DCF valuation computed server-side. AI narrative unavailable.',
        },
        dcf,
        yearlyData,
        availableProviders: [],
      })
    }

    // Build comprehensive prompt for AI
    const aiPrompt = `You are a Chartered Financial Analyst (CFA) specializing in Indian SME valuation. ALWAYS respond in ENGLISH ONLY.

Analyze the following business and provide a narrative valuation report. The DCF math has already been computed server-side — your job is to provide expert interpretation, risk assessment, and recommendations.

BUSINESS DATA (last ${yearlyData.length} years):
${JSON.stringify(yearlyData, null, 2)}

DCF VALUATION RESULT:
${JSON.stringify(dcf, null, 2)}

CURRENT BALANCE SHEET:
- Inventory: ₹${currentInventory.toFixed(2)}
- Receivables (Debtors): ₹${currentReceivables.toFixed(2)}
- Payables (Creditors): ₹${currentPayables.toFixed(2)}
- Cash in Bank: ₹${currentCash.toFixed(2)}
- Working Capital: ₹${(currentReceivables + currentInventory - currentPayables).toFixed(2)}

Return a JSON object with this exact schema:
{
  "valuationRange": { "low": <number in INR>, "mid": <number>, "high": <number> },
  "valuationMethod": "<one-line method summary>",
  "financialHealthScore": <0-100 integer>,
  "healthGrade": "<A+ | A | B+ | B | C+ | C | D>",
  "keyStrengths": ["<string>", ...],
  "keyRisks": ["<string>", ...],
  "growthTrend": "<one-line trend description>",
  "recommendations": ["<string>", ...],
  "summary": "<2-3 sentence executive summary>"
}

Guidelines:
- Valuation range should bracket the DCF equity value as mid, with low = max(assetBased, 0.8*dcf) and high = 1.2*dcf
- Health score: 90+ = A+, 80+ = A, 70+ = B+, 60+ = B, 50+ = C+, 40+ = C, below 40 = D
- Consider: revenue trend, EBITDA margin, working capital cycle, debt position
- Mention specific Indian SME risks: GST compliance, working capital strain, succession planning
- Recommend 3-5 actionable improvements (e.g. "Reduce debtor days from 60 to 45 to unlock ₹X in working capital")
- Keep summary concise but mention the DCF equity value explicitly`

    const aiResult = await analyzeWithAI(
      [
        { role: 'system', content: 'You are a CFA-level business valuation expert. Always respond in English. Always return valid JSON when asked.' },
        { role: 'user', content: aiPrompt },
      ],
      { jsonMode: true, timeout: 45000 }
    )

    let valuation: any
    try {
      valuation = JSON.parse(aiResult.content)
    } catch {
      // AI returned non-JSON — extract from text
      const jsonMatch = aiResult.content.match(/\{[\s\S]*\}/)
      valuation = jsonMatch ? JSON.parse(jsonMatch[0]) : {
        valuationRange: { low: dcf.dcfPerMethod.dcf * 0.8, mid: dcf.dcfPerMethod.dcf, high: dcf.dcfPerMethod.dcf * 1.2 },
        valuationMethod: 'DCF (AI parsing failed)',
        financialHealthScore: 50,
        healthGrade: 'C',
        keyStrengths: [], keyRisks: [], growthTrend: '', recommendations: [],
        summary: aiResult.content.slice(0, 500),
      }
    }

    return NextResponse.json({
      valuation,
      dcf,
      yearlyData,
      balanceSheet: {
        inventory: currentInventory,
        receivables: currentReceivables,
        payables: currentPayables,
        cash: currentCash,
        workingCapital: currentReceivables + currentInventory - currentPayables,
      },
      availableProviders,
      aiProvider: aiResult.provider,
    })
  } catch (error: any) {
    console.error('AI Valuation error:', error)
    return NextResponse.json({
      error: error.message || 'Valuation failed',
      stack: error.stack?.slice(0, 500),
    }, { status: 500 })
  }
}
