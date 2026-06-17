'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/formulas'
import { Scale, TrendingUp, Building2, UserCheck, UserX } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

interface BalanceSheetData {
  assets: { inventory: number; debtors: number; bankBalance: number; total: number }
  liabilities: { creditors: number; total: number }
  equity: { retainedEarnings: number; total: number }
  totalAssetsLiabilities: number
  totalLiabilitiesEquity: number
}

export function BalanceSheet() {
  const { tenant } = useAppStore()
  const [data, setData] = useState<BalanceSheetData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant) return
    authFetch('/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'balance-sheet', tenantId: tenant.id }),
    })
      .then((r) => { if (!r.ok) throw new Error('API error: ' + r.status); return r.json() }).then(setData).catch(console.error).finally(() => setLoading(false))
  }, [tenant])

  if (loading || !data) return <div><AppHeader title="Balance Sheet" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  const exportData = [
    { 'Type': 'ASSETS', 'Particular': '', 'Amount': 0 },
    { 'Type': 'Asset', 'Particular': 'Inventory Value', 'Amount': data.assets.inventory },
    { 'Type': 'Asset', 'Particular': 'Debtors (Receivable)', 'Amount': data.assets.debtors },
    { 'Type': 'Asset', 'Particular': 'Bank Balance', 'Amount': data.assets.bankBalance },
    { 'Type': 'Total', 'Particular': 'Total Assets', 'Amount': data.assets.total },
    { 'Type': '', 'Particular': '', 'Amount': 0 },
    { 'Type': 'LIABILITIES', 'Particular': '', 'Amount': 0 },
    { 'Type': 'Liability', 'Particular': 'Creditors (Payable)', 'Amount': data.liabilities.creditors },
    { 'Type': 'Total', 'Particular': 'Total Liabilities', 'Amount': data.liabilities.total },
    { 'Type': '', 'Particular': '', 'Amount': 0 },
    { 'Type': 'EQUITY', 'Particular': '', 'Amount': 0 },
    { 'Type': 'Equity', 'Particular': 'Retained Earnings (P&L)', 'Amount': data.equity.retainedEarnings },
    { 'Type': 'Total', 'Particular': 'Total Equity', 'Amount': data.equity.total },
    { 'Type': '', 'Particular': '', 'Amount': 0 },
    { 'Type': 'CHECK', 'Particular': 'Total Assets', 'Amount': data.totalAssetsLiabilities },
    { 'Type': 'CHECK', 'Particular': 'Total Liabilities + Equity', 'Amount': data.totalLiabilitiesEquity },
  ]

  const isBalanced = Math.abs(data.totalAssetsLiabilities - data.totalLiabilitiesEquity) < 0.01

  return (
    <div>
      <AppHeader title="Balance Sheet" data={exportData} exportFileName="balance-sheet" exportSheetName="Balance Sheet" />
      <div className="p-4 sm:p-6 pb-8 space-y-6">
        {/* Balance Check */}
        <Card className={`border-0 shadow-sm ${isBalanced ? 'bg-emerald-50 dark:bg-emerald-950' : 'bg-red-50 dark:bg-red-950'}`}>
          <CardContent className="p-4 flex items-center gap-3">
            <Scale className={`h-6 w-6 ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`} />
            <div>
              <p className={`font-semibold ${isBalanced ? 'text-emerald-700' : 'text-red-700'}`}>
                {isBalanced ? 'Balance Sheet is Balanced' : 'Balance Sheet is NOT Balanced'}
              </p>
              <p className="text-xs text-muted-foreground">
                Assets: {formatCurrency(data.totalAssetsLiabilities, tenant?.currency)} = Liabilities + Equity: {formatCurrency(data.totalLiabilitiesEquity, tenant?.currency)}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-3 gap-4">
          {/* Assets */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-600" />Assets</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Inventory</span><span className="font-medium">{formatCurrency(data.assets.inventory, tenant?.currency)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Debtors</span><span className="font-medium">{formatCurrency(data.assets.debtors, tenant?.currency)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Bank Balance</span><span className="font-medium">{formatCurrency(data.assets.bankBalance, tenant?.currency)}</span></div>
                <div className="flex justify-between py-3 font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-2 rounded">
                  <span>Total Assets</span><span>{formatCurrency(data.assets.total, tenant?.currency)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Liabilities */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><UserX className="h-4 w-4 text-red-600" />Liabilities</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Creditors</span><span className="font-medium">{formatCurrency(data.liabilities.creditors, tenant?.currency)}</span></div>
                <div className="flex justify-between py-3 font-bold text-red-700 bg-red-50 dark:bg-red-950 px-2 rounded">
                  <span>Total Liabilities</span><span>{formatCurrency(data.liabilities.total, tenant?.currency)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Equity */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-600" />Equity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Retained Earnings</span><span className={`font-medium ${data.equity.retainedEarnings >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(data.equity.retainedEarnings, tenant?.currency)}</span></div>
                <div className="flex justify-between py-3 font-bold text-blue-700 bg-blue-50 dark:bg-blue-950 px-2 rounded">
                  <span>Total Equity</span><span>{formatCurrency(data.equity.total, tenant?.currency)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
