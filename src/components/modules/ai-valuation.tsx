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

  const runValuation = async () => {
    setLoading(true)
    setValuation(null)
    try {
      // Call server-side AI valuation API
      const res = await authFetch('/api/ai-valuation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant?.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Valuation failed')

      setValuation(data.valuation)
      toast({ title: '✓ Valuation Complete', description: `Estimated value: ₹${(data.valuation?.valuationRange?.mid || 0).toLocaleString('en-IN')}` })
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
