'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, getDateFilterRange } from '@/lib/formulas'
import { Loader2, Download } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

interface AccountBalance {
  accountCode: string
  accountName: string
  accountType: string
  debit: number
  credit: number
}

export function TrialBalance() {
  const { tenant, dateFilter } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<AccountBalance[]>([])
  const [totalDebit, setTotalDebit] = useState(0)
  const [totalCredit, setTotalCredit] = useState(0)

  const fetchTrialBalance = useCallback(async () => {
    if (!tenant) return
    setLoading(true)
    try {
      const range = getDateFilterRange(dateFilter)
      const res = await authFetch('/api/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'trial-balance',
          tenantId: tenant.id,
          startDate: range.start.toISOString(),
          endDate: range.end.toISOString(),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setAccounts(data.accounts || [])
        setTotalDebit(data.totalDebit || 0)
        setTotalCredit(data.totalCredit || 0)
      }
    } catch (err) {
      console.error('Trial balance error:', err)
    } finally {
      setLoading(false)
    }
  }, [tenant, dateFilter])

  useEffect(() => { fetchTrialBalance() }, [fetchTrialBalance])

  const exportData = accounts.map(a => ({
    'Account Code': a.accountCode,
    'Account Name': a.accountName,
    'Type': a.accountType,
    'Debit': a.debit || '',
    'Credit': a.credit || '',
  }))

  return (
    <div>
      <AppHeader title="Trial Balance" data={exportData} exportFileName="trial-balance" exportSheetName="Trial Balance" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
            ) : accounts.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">No transactions found. Create some journal entries first.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="text-sm">
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-sm font-semibold px-4 py-3">Code</TableHead>
                      <TableHead className="text-sm font-semibold px-4 py-3">Account Name</TableHead>
                      <TableHead className="text-sm font-semibold px-4 py-3">Type</TableHead>
                      <TableHead className="text-right text-sm font-semibold px-4 py-3">Debit</TableHead>
                      <TableHead className="text-right text-sm font-semibold px-4 py-3">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((acc) => (
                      <TableRow key={acc.accountCode} className="hover:bg-muted/30 h-12">
                        <TableCell className="text-sm px-4 py-3 font-mono">{acc.accountCode}</TableCell>
                        <TableCell className="text-sm px-4 py-3 font-medium">{acc.accountName}</TableCell>
                        <TableCell className="text-sm px-4 py-3 text-muted-foreground">{acc.accountType}</TableCell>
                        <TableCell className="text-right text-sm px-4 py-3 font-semibold">
                          {acc.debit > 0 ? formatCurrency(acc.debit, tenant?.currency) : ''}
                        </TableCell>
                        <TableCell className="text-right text-sm px-4 py-3 font-semibold">
                          {acc.credit > 0 ? formatCurrency(acc.credit, tenant?.currency) : ''}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Totals row */}
                    <TableRow className="border-t-2 border-slate-400 bg-muted/50 font-bold">
                      <TableCell colSpan={3} className="text-sm px-4 py-3 text-right">TOTAL:</TableCell>
                      <TableCell className="text-right text-sm px-4 py-3 text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(totalDebit, tenant?.currency)}
                      </TableCell>
                      <TableCell className="text-right text-sm px-4 py-3 text-rose-700 dark:text-rose-400">
                        {formatCurrency(totalCredit, tenant?.currency)}
                      </TableCell>
                    </TableRow>
                    {/* Balance check */}
                    <TableRow className={Math.abs(totalDebit - totalCredit) < 0.01 ? 'bg-emerald-50 dark:bg-emerald-950/20' : 'bg-rose-50 dark:bg-rose-950/20'}>
                      <TableCell colSpan={3} className="text-sm px-4 py-3 text-right font-semibold">
                        {Math.abs(totalDebit - totalCredit) < 0.01 ? '✅ BALANCED' : '⚠️ NOT BALANCED'}:
                      </TableCell>
                      <TableCell colSpan={2} className="text-sm px-4 py-3 text-center font-bold">
                        Difference: {formatCurrency(Math.abs(totalDebit - totalCredit), tenant?.currency)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
