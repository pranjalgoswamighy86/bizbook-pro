'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, getDateFilterRange } from '@/lib/formulas'
import { TrendingUp, TrendingDown, DollarSign, BarChart3 } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { authFetch } from '@/lib/auth-fetch'

interface PnLData {
  totalRevenue: number
  totalCostOfGoods: number
  grossProfit: number
  totalExpenses: number
  netProfit: number
  totalGstCollected: number
  totalGstPaid: number
  netGst: number
  totalReceipts: number
  totalPayments: number
  netCashFlow: number
  expenseByCategory: Record<string, number>
  salesCount: number
  purchaseCount: number
  expenseCount: number
}

const COLORS = ['#059669', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f59e0b']

export function PnLSummary() {
  const { tenant, dateFilter } = useAppStore()
  const [data, setData] = useState<PnLData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant) return
    const range = getDateFilterRange(dateFilter)
    authFetch('/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pnl', tenantId: tenant.id, startDate: range.start.toISOString(), endDate: range.end.toISOString() }),
    })
      .then((r) => { if (!r.ok) throw new Error('API error: ' + r.status); return r.json() }).then(setData).catch(console.error).finally(() => setLoading(false))
  }, [tenant, dateFilter])

  if (loading || !data) return <div><AppHeader title="P&L Summary" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  const expensePieData = Object.entries(data.expenseByCategory).map(([name, value]) => ({ name, value }))

  const exportData = [
    { 'Particular': 'Revenue (Sales)', 'Amount': data.totalRevenue },
    { 'Particular': 'Cost of Goods (Purchases)', 'Amount': -data.totalCostOfGoods },
    { 'Particular': 'Gross Profit', 'Amount': data.grossProfit },
    { 'Particular': 'Total Expenses', 'Amount': -data.totalExpenses },
    { 'Particular': 'Net Profit', 'Amount': data.netProfit },
    { 'Particular': '', 'Amount': 0 },
    { 'Particular': 'GST Collected', 'Amount': data.totalGstCollected },
    { 'Particular': 'GST Paid', 'Amount': -data.totalGstPaid },
    { 'Particular': 'Net GST', 'Amount': data.netGst },
    { 'Particular': '', 'Amount': 0 },
    { 'Particular': 'Total Receipts', 'Amount': data.totalReceipts },
    { 'Particular': 'Total Payments', 'Amount': -data.totalPayments },
    { 'Particular': 'Net Cash Flow', 'Amount': data.netCashFlow },
  ]

  const profitMargin = data.totalRevenue > 0 ? ((data.netProfit / data.totalRevenue) * 100).toFixed(1) : '0'

  return (
    <div>
      <AppHeader title="P&L Summary" data={exportData} exportFileName="pnl-summary" exportSheetName="P&L" />
      <div className="p-4 sm:p-6 pb-8 space-y-6">
        {/* Top KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950"><TrendingUp className="h-6 w-6 text-emerald-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Net Profit</p>
                <p className={`text-xl font-bold ${data.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatCurrency(data.netProfit, tenant?.currency)}
                </p>
                <p className="text-xs text-muted-foreground">Margin: {profitMargin}%</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950"><DollarSign className="h-6 w-6 text-blue-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Gross Profit</p>
                <p className="text-xl font-bold">{formatCurrency(data.grossProfit, tenant?.currency)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950"><BarChart3 className="h-6 w-6 text-amber-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Net Cash Flow</p>
                <p className={`text-xl font-bold ${data.netCashFlow >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatCurrency(data.netCashFlow, tenant?.currency)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* P&L Statement */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Profit & Loss Statement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {/* Revenue Section */}
              <div className="bg-emerald-50 dark:bg-emerald-950 p-3 rounded-lg">
                <div className="flex justify-between font-semibold"><span>Revenue (Sales)</span><span className="text-emerald-700">{formatCurrency(data.totalRevenue, tenant?.currency)}</span></div>
                <p className="text-xs text-muted-foreground">{data.salesCount} sale invoices</p>
              </div>
              <div className="bg-orange-50 dark:bg-orange-950 p-3 rounded-lg">
                <div className="flex justify-between font-semibold"><span>Cost of Goods (Purchases)</span><span className="text-orange-700">-{formatCurrency(data.totalCostOfGoods, tenant?.currency)}</span></div>
                <p className="text-xs text-muted-foreground">{data.purchaseCount} purchase invoices</p>
              </div>
              <div className="border-l-4 border-emerald-500 pl-3 py-2">
                <div className="flex justify-between font-bold"><span>Gross Profit</span><span>{formatCurrency(data.grossProfit, tenant?.currency)}</span></div>
              </div>

              <div className="bg-red-50 dark:bg-red-950 p-3 rounded-lg">
                <div className="flex justify-between font-semibold"><span>Total Operating Expenses</span><span className="text-red-700">-{formatCurrency(data.totalExpenses, tenant?.currency)}</span></div>
                <p className="text-xs text-muted-foreground">{data.expenseCount} expense entries</p>
              </div>

              <div className="border-l-4 border-emerald-600 pl-3 py-3 bg-emerald-50 dark:bg-emerald-950 rounded-r-lg">
                <div className="flex justify-between font-bold text-lg"><span>Net Profit</span><span className={data.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}>{formatCurrency(data.netProfit, tenant?.currency)}</span></div>
              </div>

              {/* GST Summary */}
              <div className="mt-4 border-t pt-4">
                <h4 className="font-semibold text-sm mb-2">GST Summary</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span>GST Collected</span><span>{formatCurrency(data.totalGstCollected, tenant?.currency)}</span></div>
                  <div className="flex justify-between"><span>GST Paid</span><span>-{formatCurrency(data.totalGstPaid, tenant?.currency)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Net GST {data.netGst >= 0 ? '(Payable)' : '(Refundable)'}</span><span>{formatCurrency(Math.abs(data.netGst), tenant?.currency)}</span></div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Expense Breakdown Pie Chart */}
        {expensePieData.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Expense Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={expensePieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}>
                      {expensePieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value, tenant?.currency)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
