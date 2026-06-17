'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, getDateFilterRange, formatDate } from '@/lib/formulas'
import { authFetch } from '@/lib/auth-fetch'
import {
  TrendingUp, TrendingDown, ShoppingCart, Package, Receipt, Building2,
  UserCheck, UserX, AlertTriangle, BarChart3, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface DashboardData {
  totalSales: number
  totalPurchases: number
  totalExpenses: number
  totalInventoryValue: number
  totalReceivable: number
  totalPayable: number
  totalReceipts: number
  totalPayments: number
  netProfit: number
  lowStockCount: number
  inventoryCount: number
  salesCount: number
  purchaseCount: number
  expenseCount: number
  recentBankTxns: Array<{
    id: string; date: string; description: string; deposit: number; withdrawal: number
  }>
  monthlyTrend: Array<{
    month: string; sales: number; purchases: number; expenses: number
  }>
}

export function Dashboard() {
  const { tenant, dateFilter } = useAppStore()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant) return
    const range = getDateFilterRange(dateFilter)
    authFetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'dashboard',
        tenantId: tenant.id,
        startDate: range.start.toISOString(),
        endDate: range.end.toISOString(),
      }),
    })
      .then((r) => { if (!r.ok) throw new Error('API error: ' + r.status); return r.json() })
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [tenant, dateFilter])

  if (loading || !data) {
    return (
      <div>
        <AppHeader title="Dashboard" />
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="animate-pulse"><CardContent className="p-6"><div className="h-20 bg-muted rounded" /></CardContent></Card>
          ))}
        </div>
      </div>
    )
  }

  const stats = [
    { title: 'Total Sales', value: data.totalSales, icon: <ShoppingCart className="h-5 w-5" />, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950', count: `${data.salesCount} invoices`, arrow: <ArrowUpRight className="h-4 w-4" /> },
    { title: 'Total Purchases', value: data.totalPurchases, icon: <Package className="h-5 w-5" />, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950', count: `${data.purchaseCount} invoices`, arrow: <ArrowDownRight className="h-4 w-4" /> },
    { title: 'Total Expenses', value: data.totalExpenses, icon: <Receipt className="h-5 w-5" />, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950', count: `${data.expenseCount} entries`, arrow: <ArrowDownRight className="h-4 w-4" /> },
    { title: 'Net Profit', value: data.netProfit, icon: <TrendingUp className="h-5 w-5" />, color: data.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600', bg: data.netProfit >= 0 ? 'bg-emerald-50 dark:bg-emerald-950' : 'bg-red-50 dark:bg-red-950', count: 'Revenue - Costs', arrow: data.netProfit >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" /> },
    { title: 'Receivable', value: data.totalReceivable, icon: <UserCheck className="h-5 w-5" />, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950', count: 'Money to receive' },
    { title: 'Payable', value: data.totalPayable, icon: <UserX className="h-5 w-5" />, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950', count: 'Money to pay' },
    { title: 'Inventory Value', value: data.totalInventoryValue, icon: <Package className="h-5 w-5" />, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950', count: `${data.inventoryCount} items` },
    { title: 'Low Stock Alerts', value: data.lowStockCount, icon: <AlertTriangle className="h-5 w-5" />, color: 'text-destructive', bg: 'bg-destructive/10', count: 'Items below minimum' },
  ]

  return (
    <div>
      <AppHeader title="Dashboard" />
      <div className="p-4 sm:p-6 pb-8 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s, i) => (
            <Card key={i} className="border-0 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">{s.title}</p>
                    <p className={`text-xl font-bold mt-1 ${s.color}`}>
                      {formatCurrency(s.value, tenant?.currency)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{s.count}</p>
                  </div>
                  <div className={`p-2 rounded-lg ${s.bg} ${s.color}`}>
                    {s.icon}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Monthly Trend Chart */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-600" />
              Monthly Trend (Last 6 Months)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthlyTrend} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value, tenant?.currency)} />
                  <Legend />
                  <Bar dataKey="sales" name="Sales" fill="#059669" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="purchases" name="Purchases" fill="#f97316" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent Bank Transactions */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              Recent Bank Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentBankTxns.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No bank transactions yet</p>
            ) : (
              <div className="space-y-2">
                {data.recentBankTxns.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="text-sm font-medium">{t.description}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(t.date)}</p>
                    </div>
                    <div className="text-right">
                      {t.deposit > 0 ? (
                        <p className="text-sm font-semibold text-emerald-600">+{formatCurrency(t.deposit, tenant?.currency)}</p>
                      ) : (
                        <p className="text-sm font-semibold text-red-600">-{formatCurrency(t.withdrawal, tenant?.currency)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
