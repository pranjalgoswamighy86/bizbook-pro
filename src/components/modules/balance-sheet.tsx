'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/formulas'
import { Scale, TrendingUp, Building2, UserCheck, UserX } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

// v6.28.0: Updated interface to match the new GL-based balance-sheet response.
// The old interface only had inventory/debtors/bankBalance; the new one has
// granular asset/liability/equity breakdowns read from the General Ledger.
interface BalanceSheetData {
  asOfDate?: string | null
  assets: {
    cash: number
    bankBalance: number
    accountsReceivable: number
    inventory: number
    gstInputCredit: number
    other: number
    total: number
  }
  liabilities: {
    accountsPayable: number
    gstPayable: number
    tdsPayable: number
    loans: number
    accruedExpenses: number
    other: number
    total: number
  }
  equity: {
    capital: number
    retainedEarnings: number
    drawings: number
    total: number
  }
  totalAssetsLiabilities: number
  totalLiabilitiesEquity: number
  isBalanced?: boolean
  difference?: number
}

export function BalanceSheet() {
  const { tenant } = useAppStore()
  const [data, setData] = useState<BalanceSheetData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant) return
    // v6.28.0: send asOfDate = today so the BS reflects the current financial position.
    // The backend now supports historical BS by passing a different asOfDate.
    authFetch('/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'balance-sheet', tenantId: tenant.id, asOfDate: new Date().toISOString() }),
    })
      .then((r) => { if (!r.ok) throw new Error('API error: ' + r.status); return r.json() }).then(setData).catch(console.error).finally(() => setLoading(false))
  }, [tenant])

  if (loading || !data) return <div><AppHeader title="Balance Sheet" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  const exportData = [
    { 'Type': 'ASSETS', 'Particular': '', 'Amount': 0 },
    { 'Type': 'Asset', 'Particular': 'Cash', 'Amount': data.assets.cash },
    { 'Type': 'Asset', 'Particular': 'Bank Balance', 'Amount': data.assets.bankBalance },
    { 'Type': 'Asset', 'Particular': 'Accounts Receivable', 'Amount': data.assets.accountsReceivable },
    { 'Type': 'Asset', 'Particular': 'Inventory', 'Amount': data.assets.inventory },
    { 'Type': 'Asset', 'Particular': 'GST Input Credit', 'Amount': data.assets.gstInputCredit },
    { 'Type': 'Asset', 'Particular': 'Other Assets', 'Amount': data.assets.other },
    { 'Type': 'Total', 'Particular': 'Total Assets', 'Amount': data.assets.total },
    { 'Type': '', 'Particular': '', 'Amount': 0 },
    { 'Type': 'LIABILITIES', 'Particular': '', 'Amount': 0 },
    { 'Type': 'Liability', 'Particular': 'Accounts Payable', 'Amount': data.liabilities.accountsPayable },
    { 'Type': 'Liability', 'Particular': 'GST Payable', 'Amount': data.liabilities.gstPayable },
    { 'Type': 'Liability', 'Particular': 'TDS Payable', 'Amount': data.liabilities.tdsPayable },
    { 'Type': 'Liability', 'Particular': 'Loans', 'Amount': data.liabilities.loans },
    { 'Type': 'Liability', 'Particular': 'Accrued Expenses', 'Amount': data.liabilities.accruedExpenses },
    { 'Type': 'Liability', 'Particular': 'Other Liabilities', 'Amount': data.liabilities.other },
    { 'Type': 'Total', 'Particular': 'Total Liabilities', 'Amount': data.liabilities.total },
    { 'Type': '', 'Particular': '', 'Amount': 0 },
    { 'Type': 'EQUITY', 'Particular': '', 'Amount': 0 },
    { 'Type': 'Equity', 'Particular': 'Capital', 'Amount': data.equity.capital },
    { 'Type': 'Equity', 'Particular': 'Retained Earnings', 'Amount': data.equity.retainedEarnings },
    { 'Type': 'Equity', 'Particular': 'Drawings (contra)', 'Amount': -data.equity.drawings },
    { 'Type': 'Total', 'Particular': 'Total Equity', 'Amount': data.equity.total },
    { 'Type': '', 'Particular': '', 'Amount': 0 },
    { 'Type': 'CHECK', 'Particular': 'Total Assets', 'Amount': data.totalAssetsLiabilities },
    { 'Type': 'CHECK', 'Particular': 'Total Liabilities + Equity', 'Amount': data.totalLiabilitiesEquity },
  ]

  // v6.28.0: use the backend's isBalanced flag if available; otherwise compute locally
  const isBalanced = data.isBalanced !== undefined ? data.isBalanced : Math.abs(data.totalAssetsLiabilities - data.totalLiabilitiesEquity) < 0.01
  const difference = data.difference !== undefined ? data.difference : Math.abs(data.totalAssetsLiabilities - data.totalLiabilitiesEquity)

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
                {!isBalanced && <span className="text-red-600 font-medium"> (Difference: {formatCurrency(difference, tenant?.currency)})</span>}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                v6.28.0: Now reads from the General Ledger — reconciles with Trial Balance by construction.
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
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Cash</span><span className="font-medium">{formatCurrency(data.assets.cash, tenant?.currency)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Bank Balance</span><span className="font-medium">{formatCurrency(data.assets.bankBalance, tenant?.currency)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Accounts Receivable</span><span className="font-medium">{formatCurrency(data.assets.accountsReceivable, tenant?.currency)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Inventory</span><span className="font-medium">{formatCurrency(data.assets.inventory, tenant?.currency)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="text-sm">GST Input Credit</span><span className="font-medium">{formatCurrency(data.assets.gstInputCredit, tenant?.currency)}</span></div>
                {data.assets.other > 0 && <div className="flex justify-between py-2 border-b"><span className="text-sm">Other Assets</span><span className="font-medium">{formatCurrency(data.assets.other, tenant?.currency)}</span></div>}
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
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Accounts Payable</span><span className="font-medium">{formatCurrency(data.liabilities.accountsPayable, tenant?.currency)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="text-sm">GST Payable</span><span className="font-medium">{formatCurrency(data.liabilities.gstPayable, tenant?.currency)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="text-sm">TDS Payable</span><span className="font-medium">{formatCurrency(data.liabilities.tdsPayable, tenant?.currency)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Loans</span><span className="font-medium">{formatCurrency(data.liabilities.loans, tenant?.currency)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Accrued Expenses</span><span className="font-medium">{formatCurrency(data.liabilities.accruedExpenses, tenant?.currency)}</span></div>
                {data.liabilities.other > 0 && <div className="flex justify-between py-2 border-b"><span className="text-sm">Other Liabilities</span><span className="font-medium">{formatCurrency(data.liabilities.other, tenant?.currency)}</span></div>}
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
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Capital</span><span className="font-medium">{formatCurrency(data.equity.capital, tenant?.currency)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="text-sm">Retained Earnings</span><span className={`font-medium ${data.equity.retainedEarnings >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(data.equity.retainedEarnings, tenant?.currency)}</span></div>
                {data.equity.drawings > 0 && <div className="flex justify-between py-2 border-b"><span className="text-sm">Drawings (contra)</span><span className="font-medium text-red-600">-{formatCurrency(data.equity.drawings, tenant?.currency)}</span></div>}
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
