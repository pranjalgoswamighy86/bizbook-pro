import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateFinancialYears, calculateValuation, normalizeAiValuationSummary } from '../.test-build/ai-valuation-calculations.js'

test('aggregates Indian financial-year data and calculates year-on-year growth', () => {
  const rows = aggregateFinancialYears([
    { year: 'FY 2024-25', revenue: 1000000, purchases: 500000, expenses: 200000 },
    { year: 'FY 2025-26', revenue: 1200000, purchases: 600000, expenses: 240000 },
  ])
  assert.equal(rows[0].ebitda, 300000)
  assert.equal(rows[0].revenueGrowthPct, null)
  assert.equal(rows[1].revenueGrowthPct, 0.2)
  assert.equal(rows[1].cashFlow, 360000)
})

test('returns complete, bounded valuation and frontend-compatible DCF fields', () => {
  const yearly = aggregateFinancialYears([
    { year: 'FY 2024-25', revenue: 1000000, purchases: 600000, expenses: 200000 },
    { year: 'FY 2025-26', revenue: 1200000, purchases: 700000, expenses: 220000 },
  ])
  const result = calculateValuation(yearly, { inventory: 100000, receivables: 150000, payables: 60000, cash: 90000 })
  assert.ok(Number.isFinite(result.valuation.valuationRange.mid))
  assert.ok(result.valuation.valuationRange.low <= result.valuation.valuationRange.mid)
  assert.ok(result.valuation.valuationRange.mid <= result.valuation.valuationRange.high)
  assert.ok(result.valuation.financialHealthScore >= 0 && result.valuation.financialHealthScore <= 100)
  assert.ok(['A', 'B', 'C', 'D'].includes(result.valuation.healthGrade))
  assert.equal(result.dcf.projectionYears, 5)
  assert.equal(result.dcf.projections.length, 5)
  for (const field of ['dcf', 'revenueMultiple', 'ebitdaMultiple', 'assetBased']) assert.ok(Number.isFinite(result.dcf.dcfPerMethod[field]))
  assert.equal(result.yearlyData[1].year, 'FY 2025-26')
})

test('zero and negative input values do not produce NaN or Infinity', () => {
  const yearly = aggregateFinancialYears([
    { year: 'FY 2025-26', revenue: 0, purchases: 200, expenses: 500 },
  ])
  const result = calculateValuation(yearly, { inventory: 0, receivables: -10, payables: 200, cash: 0 })
  const values = [result.valuation.valuationRange.low, result.valuation.valuationRange.mid, result.valuation.valuationRange.high, result.dcf.enterpriseValue, result.dcf.equityValue]
  assert.ok(values.every(Number.isFinite))
  assert.equal(result.valuation.valuationRange.low, 0)
  assert.equal(result.valuation.valuationRange.mid, 0)
  assert.equal(result.valuation.valuationRange.high, 0)
})

test('AI qualitative response is safely parsed and bounded; invalid JSON degrades gracefully', () => {
  const parsed = normalizeAiValuationSummary(JSON.stringify({
    summary: 'A concise summary',
    keyStrengths: ['Strength'],
    keyRisks: ['Risk'],
    recommendations: ['Recommendation'],
  }))
  assert.equal(parsed.summary, 'A concise summary')
  assert.deepEqual(parsed.keyStrengths, ['Strength'])
  assert.deepEqual(normalizeAiValuationSummary('not json').keyRisks, [])
  assert.ok(normalizeAiValuationSummary(null).summary.length > 0)
})
