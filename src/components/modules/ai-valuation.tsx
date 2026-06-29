'use client'

/**
 * Smart AI Company Valuation Page
 * --------------------------------
 * Uses ZAI to analyze the business financials and generate a valuation.
 * Pulls data from: Sales, Purchases, Expenses, Inventory, Bank, Debtors, Creditors.
 * Generates: Business valuation estimate, financial health score, growth trends,
 * risk assessment, and recommendations.
 */

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sparkles, TrendingUp, AlertTriangle, Loader2, DollarSign } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

export function AIValuationPage() {
  const { tenant } = useAppStore()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [valuation, setValuation] = useState<any>(null)
  const [dcf, setDcf] = useState<any>(null)
  const [yearlyData, setYearlyData] = useState<any[]>([])
  const [balanceSheet, setBalanceSheet] = useState<any>(null)
  const [aiProvider, setAiProvider] = useState<string>('')

  const runValuation = async () => {
    setLoading(true)
    setValuation(null)
    setDcf(null)
    setYearlyData([])
    setBalanceSheet(null)
    try {
      const res = await authFetch('/api/ai-valuation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant?.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Valuation failed')

      setValuation(data.valuation)
      setDcf(data.dcf)
      setYearlyData(data.yearlyData || [])
      setBalanceSheet(data.balanceSheet)
      setAiProvider(data.aiProvider || 'none')
      toast({ title: '✓ Valuation Complete', description: `Estimated value: ₹${(data.valuation?.valuationRange?.mid || 0).toLocaleString('en-IN')} (via ${data.aiProvider || 'DCF only'})` })
    } catch (err: any) {
      toast({ title: 'Valuation Failed', description: err?.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-900/30">
            <Sparkles className="h-6 w-6 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Smart AI Company Valuation</h1>
            <p className="text-xs text-muted-foreground">AI-powered business valuation based on your financial data</p>
          </div>
        </div>
        <Button onClick={runValuation} disabled={loading} className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700">
          {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing...</> : <><Sparkles className="h-4 w-4 mr-2" /> Run AI Valuation</>}
        </Button>
      </div>

      {/* Results */}
      {valuation && (
        <div className="space-y-4">
          {/* Valuation Range */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-teal-50">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground font-medium">Conservative</p>
                <p className="text-2xl font-black text-emerald-700">₹{((valuation.valuationRange?.low || 0) / 100000).toFixed(2)}L</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm bg-gradient-to-br from-violet-50 to-purple-50 ring-2 ring-violet-300">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground font-medium">Fair Market Value</p>
                <p className="text-3xl font-black text-violet-700">₹{((valuation.valuationRange?.mid || 0) / 100000).toFixed(2)}L</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-50 to-orange-50">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground font-medium">Optimistic</p>
                <p className="text-2xl font-black text-amber-700">₹{((valuation.valuationRange?.high || 0) / 100000).toFixed(2)}L</p>
              </CardContent>
            </Card>
          </div>

          {/* Health Score + Method */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Financial Health Score</p>
                    <p className="text-3xl font-bold">{valuation.financialHealthScore}/100</p>
                    <p className="text-sm font-bold text-emerald-600">Grade: {valuation.healthGrade}</p>
                  </div>
                  <TrendingUp className="h-10 w-10 text-emerald-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Valuation Method</p>
                <p className="text-sm font-semibold">{valuation.valuationMethod || 'Revenue Multiple'}</p>
                <p className="text-xs text-muted-foreground mt-1">Growth Trend: <span className="font-bold">{valuation.growthTrend}</span></p>
              </CardContent>
            </Card>
          </div>

          {/* Summary */}
          {valuation.summary && (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm">{valuation.summary}</p>
              </CardContent>
            </Card>
          )}

          {/* Strengths + Risks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card className="border-0 shadow-sm bg-emerald-50/50">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-emerald-700">Key Strengths</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1">
                  {(valuation.keyStrengths || []).map((s: string, i: number) => (
                    <li key={i} className="text-xs flex items-start gap-2"><span className="text-emerald-500 mt-0.5">✓</span> {s}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm bg-rose-50/50">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-rose-700 flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> Key Risks</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1">
                  {(valuation.keyRisks || []).map((r: string, i: number) => (
                    <li key={i} className="text-xs flex items-start gap-2"><span className="text-rose-500 mt-0.5">⚠</span> {r}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Recommendations */}
          {valuation.recommendations?.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm">AI Recommendations</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-2">
                  {valuation.recommendations.map((r: string, i: number) => (
                    <li key={i} className="text-xs flex items-start gap-2 p-2 bg-violet-50 rounded-lg">
                      <Sparkles className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
                      {r}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* v4.150: DCF Breakdown */}
          {dcf && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  DCF Valuation Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                {/* Method comparison */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="bg-blue-50 dark:bg-blue-950 p-2 rounded text-center">
                    <p className="text-[10px] text-muted-foreground">DCF (5yr)</p>
                    <p className="text-sm font-bold text-blue-700">₹{((dcf.dcfPerMethod.dcf || 0) / 100000).toFixed(2)}L</p>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-950 p-2 rounded text-center">
                    <p className="text-[10px] text-muted-foreground">Revenue Mult.</p>
                    <p className="text-sm font-bold text-emerald-700">₹{((dcf.dcfPerMethod.revenueMultiple || 0) / 100000).toFixed(2)}L</p>
                  </div>
                  <div className="bg-violet-50 dark:bg-violet-950 p-2 rounded text-center">
                    <p className="text-[10px] text-muted-foreground">EBITDA Mult.</p>
                    <p className="text-sm font-bold text-violet-700">₹{((dcf.dcfPerMethod.ebitdaMultiple || 0) / 100000).toFixed(2)}L</p>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-950 p-2 rounded text-center">
                    <p className="text-[10px] text-muted-foreground">Asset-Based</p>
                    <p className="text-sm font-bold text-amber-700">₹{((dcf.dcfPerMethod.assetBased || 0) / 100000).toFixed(2)}L</p>
                  </div>
                </div>

                {/* DCF components */}
                <div className="text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">WACC (Discount Rate):</span><span className="font-mono font-semibold">{(dcf.wacc * 100).toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Terminal Growth Rate:</span><span className="font-mono font-semibold">{(dcf.terminalGrowthRate * 100).toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Projection Horizon:</span><span className="font-mono font-semibold">{dcf.projectionYears} years</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Terminal Value:</span><span className="font-mono">₹{((dcf.terminalValue || 0) / 100000).toFixed(2)}L</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">PV of Terminal Value:</span><span className="font-mono">₹{((dcf.presentValueTV || 0) / 100000).toFixed(2)}L</span></div>
                  <div className="flex justify-between border-t pt-1"><span className="font-semibold">Enterprise Value:</span><span className="font-mono font-bold">₹{((dcf.enterpriseValue || 0) / 100000).toFixed(2)}L</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">(-) Net Debt:</span><span className="font-mono">₹{((dcf.netDebt || 0) / 100000).toFixed(2)}L</span></div>
                  <div className="flex justify-between border-t pt-1"><span className="font-bold text-blue-700">Equity Value (DCF):</span><span className="font-mono font-bold text-blue-700">₹{((dcf.equityValue || 0) / 100000).toFixed(2)}L</span></div>
                </div>

                {/* Assumptions */}
                <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded text-[10px] space-y-1">
                  <p className="font-semibold text-slate-700 dark:text-slate-300">Key Assumptions</p>
                  <p className="text-muted-foreground">• {dcf.assumptions?.waccRationale}</p>
                  <p className="text-muted-foreground">• {dcf.assumptions?.growthRationale}</p>
                  <p className="text-muted-foreground">• Benchmark: {dcf.assumptions?.industryBenchmark}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* v4.150: Multi-year financial history */}
          {yearlyData.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Historical Financials ({yearlyData.length} years)</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-1">Year</th>
                        <th className="text-right p-1">Revenue</th>
                        <th className="text-right p-1">EBITDA</th>
                        <th className="text-right p-1">Margin</th>
                        <th className="text-right p-1">Growth</th>
                        <th className="text-right p-1">Cash Flow</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearlyData.map(y => (
                        <tr key={y.year} className="border-b">
                          <td className="p-1 font-mono">{y.year}</td>
                          <td className="text-right p-1">₹{(y.revenue / 100000).toFixed(2)}L</td>
                          <td className="text-right p-1">₹{(y.ebitda / 100000).toFixed(2)}L</td>
                          <td className="text-right p-1">{y.revenue > 0 ? ((y.ebitda / y.revenue) * 100).toFixed(1) : '0.0'}%</td>
                          <td className="text-right p-1">{y.revenueGrowthPct !== null ? `${(y.revenueGrowthPct * 100).toFixed(1)}%` : '-'}</td>
                          <td className="text-right p-1">₹{(y.cashFlow / 100000).toFixed(2)}L</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* v4.150: Balance Sheet Snapshot */}
          {balanceSheet && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Balance Sheet Snapshot</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                  <div className="bg-emerald-50 dark:bg-emerald-950 p-2 rounded">
                    <p className="text-[10px] text-muted-foreground">Inventory</p>
                    <p className="font-bold">₹{(balanceSheet.inventory / 100000).toFixed(2)}L</p>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950 p-2 rounded">
                    <p className="text-[10px] text-muted-foreground">Receivables</p>
                    <p className="font-bold">₹{(balanceSheet.receivables / 100000).toFixed(2)}L</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950 p-2 rounded">
                    <p className="text-[10px] text-muted-foreground">Payables</p>
                    <p className="font-bold">₹{(balanceSheet.payables / 100000).toFixed(2)}L</p>
                  </div>
                  <div className="bg-violet-50 dark:bg-violet-950 p-2 rounded">
                    <p className="text-[10px] text-muted-foreground">Cash</p>
                    <p className="font-bold">₹{(balanceSheet.cash / 100000).toFixed(2)}L</p>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-950 p-2 rounded">
                    <p className="text-[10px] text-muted-foreground">Working Cap.</p>
                    <p className="font-bold">₹{(balanceSheet.workingCapital / 100000).toFixed(2)}L</p>
                  </div>
                </div>
                {aiProvider && (
                  <p className="text-[10px] text-muted-foreground mt-3">
                    AI analysis provided by: <span className="font-mono font-semibold">{aiProvider}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && !valuation && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center mb-4">
              <DollarSign className="h-8 w-8 text-violet-500" />
            </div>
            <h3 className="font-semibold text-lg mb-2">AI-Powered Business Valuation</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Get an instant, AI-generated valuation of your business based on sales, purchases, expenses,
              inventory, and financial reports. Click "Run AI Valuation" to begin.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
