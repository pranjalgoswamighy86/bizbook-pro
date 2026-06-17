'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/formulas'
import { CalendarDays, TrendingUp, TrendingDown, DollarSign } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

interface DayReportData {
  date: string
  sales: number
  purchases: number
  expenses: number
  receipts: number
  payments: number
  bankIn: number
  bankOut: number
  netCash: number
  salesList: Array<{ id: string; invoiceNumber: string; partyName: string; totalAmount: number }>
  purchasesList: Array<{ id: string; invoiceNumber: string; partyName: string; totalAmount: number }>
  expensesList: Array<{ id: string; category: string; description: string; amount: number }>
}

export function DayReport() {
  const { tenant } = useAppStore()
  const [data, setData] = useState<DayReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  useEffect(() => {
    if (!tenant) return
    setLoading(true)
    authFetch('/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'day-report', tenantId: tenant.id, date: selectedDate }),
    })
      .then((r) => { if (!r.ok) throw new Error('API error: ' + r.status); return r.json() }).then(setData).catch(console.error).finally(() => setLoading(false))
  }, [tenant, selectedDate])

  const exportData = data ? [
    { 'Metric': 'Sales', 'Amount': data.sales },
    { 'Metric': 'Purchases', 'Amount': data.purchases },
    { 'Metric': 'Expenses', 'Amount': data.expenses },
    { 'Metric': 'Receipts', 'Amount': data.receipts },
    { 'Metric': 'Payments', 'Amount': data.payments },
    { 'Metric': 'Bank In', 'Amount': data.bankIn },
    { 'Metric': 'Bank Out', 'Amount': data.bankOut },
    { 'Metric': 'Net Cash', 'Amount': data.netCash },
  ] : []

  if (loading || !data) return <div><AppHeader title="Day Report" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  return (
    <div>
      <AppHeader title="Day Report" data={exportData} exportFileName={`day-report-${selectedDate}`} exportSheetName="Day Report" />
      <div className="p-4 sm:p-6 pb-8 space-y-6">
        {/* Date Selector */}
        <div className="flex items-center gap-3">
          <Label>Select Date</Label>
          <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-48" />
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="border-0 shadow-sm"><CardContent className="p-3"><div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-600" /><div><p className="text-xs text-muted-foreground">Sales</p><p className="font-bold text-emerald-600">{formatCurrency(data.sales, tenant?.currency)}</p></div></div></CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="p-3"><div className="flex items-center gap-2"><TrendingDown className="h-4 w-4 text-orange-600" /><div><p className="text-xs text-muted-foreground">Purchases</p><p className="font-bold text-orange-600">{formatCurrency(data.purchases, tenant?.currency)}</p></div></div></CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="p-3"><div className="flex items-center gap-2"><TrendingDown className="h-4 w-4 text-red-600" /><div><p className="text-xs text-muted-foreground">Expenses</p><p className="font-bold text-red-600">{formatCurrency(data.expenses, tenant?.currency)}</p></div></div></CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="p-3"><div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-blue-600" /><div><p className="text-xs text-muted-foreground">Net Cash</p><p className={`font-bold ${data.netCash >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(data.netCash, tenant?.currency)}</p></div></div></CardContent></Card>
        </div>

        {/* Detailed Breakdown */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Sales */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="h-4 w-4 text-emerald-600" />Sales Today</CardTitle></CardHeader>
            <CardContent>
              {data.salesList.length === 0 ? <p className="text-xs text-muted-foreground">No sales</p> : (
                <Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                  <TableBody>{data.salesList.map((s) => (<TableRow key={s.id}><TableCell className="text-xs">{s.invoiceNumber}</TableCell><TableCell className="text-xs">{s.partyName}</TableCell><TableCell className="text-xs text-right">{formatCurrency(s.totalAmount, tenant?.currency)}</TableCell></TableRow>))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Purchases */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="h-4 w-4 text-orange-600" />Purchases Today</CardTitle></CardHeader>
            <CardContent>
              {data.purchasesList.length === 0 ? <p className="text-xs text-muted-foreground">No purchases</p> : (
                <Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                  <TableBody>{data.purchasesList.map((p) => (<TableRow key={p.id}><TableCell className="text-xs">{p.invoiceNumber}</TableCell><TableCell className="text-xs">{p.partyName}</TableCell><TableCell className="text-xs text-right">{formatCurrency(p.totalAmount, tenant?.currency)}</TableCell></TableRow>))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Expenses */}
          <Card className="border-0 shadow-sm md:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="h-4 w-4 text-red-600" />Expenses Today</CardTitle></CardHeader>
            <CardContent>
              {data.expensesList.length === 0 ? <p className="text-xs text-muted-foreground">No expenses</p> : (
                <Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                  <TableBody>{data.expensesList.map((e) => (<TableRow key={e.id}><TableCell className="text-xs">{e.category}</TableCell><TableCell className="text-xs">{e.description}</TableCell><TableCell className="text-xs text-right">{formatCurrency(e.amount, tenant?.currency)}</TableCell></TableRow>))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Cash & Bank Summary */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Cash & Bank Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b"><span>Receipts (Cash/Bank In)</span><span className="text-emerald-600">{formatCurrency(data.receipts, tenant?.currency)}</span></div>
              <div className="flex justify-between py-2 border-b"><span>Payments (Cash/Bank Out)</span><span className="text-red-600">-{formatCurrency(data.payments, tenant?.currency)}</span></div>
              <div className="flex justify-between py-2 border-b"><span>Bank Deposits</span><span className="text-emerald-600">{formatCurrency(data.bankIn, tenant?.currency)}</span></div>
              <div className="flex justify-between py-2 border-b"><span>Bank Withdrawals</span><span className="text-red-600">-{formatCurrency(data.bankOut, tenant?.currency)}</span></div>
              <div className="flex justify-between py-2 font-bold"><span>Net Cash Position</span><span className={data.netCash >= 0 ? 'text-emerald-600' : 'text-red-600'}>{formatCurrency(data.netCash, tenant?.currency)}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
