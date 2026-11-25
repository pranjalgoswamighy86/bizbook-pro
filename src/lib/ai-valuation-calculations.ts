export interface FinancialYearInput {
  year: string
  revenue: number
  purchases: number
  expenses: number
}

export interface ValuationFinancialYear {
  year: string
  revenue: number
  purchases: number
  expenses: number
  ebitda: number
  revenueGrowthPct: number | null
  cashFlow: number
}

export interface ValuationSnapshot {
  valuation: {
    valuationRange: { low: number; mid: number; high: number }
    financialHealthScore: number
    healthGrade: 'A' | 'B' | 'C' | 'D'
    valuationMethod: string
    growthTrend: string
    summary: string
    keyStrengths: string[]
    keyRisks: string[]
    recommendations: string[]
  }
  dcf: {
    dcfPerMethod: { dcf: number; revenueMultiple: number; ebitdaMultiple: number; assetBased: number }
    wacc: number
    terminalGrowthRate: number
    projectionYears: number
    terminalValue: number
    presentValueTV: number
    enterpriseValue: number
    netDebt: number
    equityValue: number
    projections: Array<{ year: number; revenue: number; ebitda: number; cashFlow: number; presentValue: number }>
    assumptions: { waccRationale: string; growthRationale: string; industryBenchmark: string }
  }
  yearlyData: ValuationFinancialYear[]
}

const safe = (value: number) => Number.isFinite(value) ? value : 0
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function aggregateFinancialYears(input: FinancialYearInput[]): ValuationFinancialYear[] {
  const years = input.map((row) => ({
    year: row.year,
    revenue: Math.max(0, safe(row.revenue)),
    purchases: Math.max(0, safe(row.purchases)),
    expenses: Math.max(0, safe(row.expenses)),
  }))
  return years.map((row, index) => {
    const prior = years[index - 1]
    const ebitda = row.revenue - row.purchases - row.expenses
    return {
      ...row,
      ebitda,
      revenueGrowthPct: prior && prior.revenue > 0 ? (row.revenue - prior.revenue) / prior.revenue : null,
      cashFlow: ebitda,
    }
  })
}

export function calculateValuation(
  yearlyData: ValuationFinancialYear[],
  balanceSheet: { inventory: number; receivables: number; payables: number; cash: number },
): ValuationSnapshot {
  const history = [...yearlyData].sort((a, b) => a.year.localeCompare(b.year))
  const latest = history.at(-1) ?? { year: '', revenue: 0, purchases: 0, expenses: 0, ebitda: 0, revenueGrowthPct: null, cashFlow: 0 }
  const prior = history.at(-2)
  const margin = latest.revenue > 0 ? latest.ebitda / latest.revenue : 0
  const growth = prior && prior.revenue > 0 ? clamp((latest.revenue - prior.revenue) / prior.revenue, -0.2, 0.5) : 0
  const wacc = 0.18
  const terminalGrowthRate = 0.03
  const projectionYears = 5
  const projections: ValuationSnapshot['dcf']['projections'] = []
  let projectedRevenue = latest.revenue
  let projectedCashFlow = latest.ebitda
  let dcfEnterpriseValue = 0
  for (let year = 1; year <= projectionYears; year++) {
    projectedRevenue *= 1 + growth
    projectedCashFlow = projectedRevenue * margin
    const presentValue = projectedCashFlow / Math.pow(1 + wacc, year)
    dcfEnterpriseValue += presentValue
    projections.push({ year, revenue: projectedRevenue, ebitda: projectedCashFlow, cashFlow: projectedCashFlow, presentValue })
  }
  const terminalCashFlow = projectedCashFlow * (1 + terminalGrowthRate)
  const terminalValue = wacc > terminalGrowthRate ? terminalCashFlow / (wacc - terminalGrowthRate) : 0
  const presentValueTV = terminalValue / Math.pow(1 + wacc, projectionYears)
  dcfEnterpriseValue += presentValueTV

  const cash = Math.max(0, safe(balanceSheet.cash))
  const payables = Math.max(0, safe(balanceSheet.payables))
  const netDebt = payables - cash
  const dcfEquity = Math.max(0, dcfEnterpriseValue - netDebt)
  const revenueMultiple = Math.max(0, latest.revenue * clamp(0.5 + margin, 0.25, 1.5))
  const ebitdaMultiple = Math.max(0, latest.ebitda * (latest.ebitda > 0 ? 4 : 0))
  const assetBased = Math.max(0, safe(balanceSheet.inventory) + safe(balanceSheet.receivables) + cash - payables)
  const candidates = [dcfEquity, revenueMultiple, ebitdaMultiple, assetBased].filter(v => Number.isFinite(v) && v >= 0)
  const central = candidates.length ? candidates.reduce((sum, value) => sum + value, 0) / candidates.length : 0
  const low = Math.max(0, Math.min(...candidates) * 0.85)
  const high = Math.max(low, Math.max(...candidates) * 1.15)

  const growthPct = prior && prior.revenue > 0 ? (latest.revenue - prior.revenue) / prior.revenue : null
  const growthTrend = growthPct === null ? 'Insufficient history' : growthPct > 0.05 ? 'Growing' : growthPct < -0.05 ? 'Declining' : 'Stable'
  const assets = Math.max(0, safe(balanceSheet.inventory)) + Math.max(0, safe(balanceSheet.receivables)) + cash
  const liabilityStrength = assets > 0 ? clamp((assets - payables) / assets, -1, 1) : (payables === 0 ? 0.5 : -0.5)
  const healthScore = Math.round(clamp(50 + margin * 100 + (growthPct ?? 0) * 40 + liabilityStrength * 20, 0, 100))
  const healthGrade = healthScore >= 85 ? 'A' : healthScore >= 70 ? 'B' : healthScore >= 50 ? 'C' : 'D'
  const keyStrengths: string[] = []
  const keyRisks: string[] = []
  const recommendations: string[] = []
  if (margin > 0.15) keyStrengths.push('Operating profit proxy is above 15% of recorded revenue.')
  if (growthPct !== null && growthPct > 0) keyStrengths.push('Recorded revenue increased compared with the previous financial year.')
  if (cash >= payables) keyStrengths.push('Estimated cash balances cover recorded trade payables.')
  if (margin <= 0) keyRisks.push('Recorded purchases and expenses are equal to or greater than revenue.')
  if (growthPct !== null && growthPct < 0) keyRisks.push('Recorded revenue declined compared with the previous financial year.')
  if (payables > cash) keyRisks.push('Recorded trade payables exceed estimated cash balances.')
  if (!history.length || latest.revenue <= 0) keyRisks.push('Revenue history is insufficient for a dependable earnings-based valuation.')
  if (margin <= 0) recommendations.push('Review product pricing, gross margins, purchase costs and operating expenses.')
  if (growthPct !== null && growthPct <= 0) recommendations.push('Investigate revenue trends, customer retention and sales pipeline.')
  recommendations.push('Reconcile inventory, receivables, payables, cash and bank balances against the accounting records.')
  recommendations.push('Have a qualified valuation professional review the assumptions before relying on this estimate.')
  const summary = 'Indicative estimate based on recorded sales, purchases, expenses and balance-sheet snapshots. EBITDA and cash flow are simplified proxies; this is not a certified valuation or a full accounting balance sheet.'
  return {
    valuation: {
      valuationRange: { low, mid: central, high },
      financialHealthScore: healthScore,
      healthGrade,
      valuationMethod: 'Weighted DCF, revenue, EBITDA and asset-based estimates',
      growthTrend,
      summary,
      keyStrengths,
      keyRisks,
      recommendations,
    },
    dcf: {
      dcfPerMethod: { dcf: dcfEquity, revenueMultiple, ebitdaMultiple, assetBased },
      wacc,
      terminalGrowthRate,
      projectionYears,
      terminalValue,
      presentValueTV,
      enterpriseValue: dcfEnterpriseValue,
      netDebt,
      equityValue: dcfEquity,
      projections,
      assumptions: {
        waccRationale: 'Illustrative 18% discount rate to reflect small-business risk; not a market-calibrated WACC.',
        growthRationale: 'Recent revenue growth is capped at -20% to +50%; if history is unavailable, growth is assumed flat. Terminal growth is 3%.',
        industryBenchmark: 'Generic heuristic multiples, not industry-specific comparable-company data.',
      },
    },
    yearlyData: history,
  }
}

export function normalizeAiValuationSummary(raw: unknown): Pick<ValuationSnapshot['valuation'], 'summary' | 'keyStrengths' | 'keyRisks' | 'recommendations'> {
  const defaults = {
    summary: 'Financial estimates are ready. AI qualitative analysis was unavailable.',
    keyStrengths: [] as string[],
    keyRisks: [] as string[],
    recommendations: [] as string[],
  }
  if (typeof raw !== 'string' || !raw.trim()) return defaults
  try {
    const parsed = JSON.parse(raw)
    const cleanList = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 5) : []
    return {
      summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim().slice(0, 1200) : defaults.summary,
      keyStrengths: cleanList(parsed.keyStrengths),
      keyRisks: cleanList(parsed.keyRisks),
      recommendations: cleanList(parsed.recommendations),
    }
  } catch {
    return defaults
  }
}
