'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore, canEdit, canCorrect } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate, getDateFilterRange } from '@/lib/formulas'
import { Plus, Pencil, Trash2, Loader2, Sparkles, CheckCircle2, Link2, FileText } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

interface BankTransaction {
  id: string; date: string; description: string; reference: string | null
  deposit: number; withdrawal: number; balance: number; category: string | null
  bankName: string | null; accountNumber: string | null
  matchedSaleId: string | null; matchedPurchaseId: string | null; isReconciled: boolean
}

interface BankStatementUploadRecord {
  id: string; fileName: string; fileType: string; status: string
  transactionCount: number; createdAt: string
}

interface MatchResult {
  type: 'sale' | 'purchase'
  id: string; invoiceNumber: string; date: string; partyName: string
  totalAmount: number; paymentStatus: string; matchScore: number
}

export function BankStatement() {
  const { tenant, user, dateFilter, searchQuery } = useAppStore()
  const { toast } = useToast()
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [uploads, setUploads] = useState<BankStatementUploadRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0], description: '', reference: '',
    deposit: 0, withdrawal: 0, category: '', bankName: '', accountNumber: '',
  })

  // Note: Bank statement upload has been moved to AI Smart Import module

  // Matching state
  const [showMatch, setShowMatch] = useState(false)
  const [matchTransactionId, setMatchTransactionId] = useState<string | null>(null)
  const [matches, setMatches] = useState<MatchResult[]>([])
  const [matchLoading, setMatchLoading] = useState(false)
  const [reconcileLoading, setReconcileLoading] = useState<string | null>(null)

  // Show uploads panel
  const [showUploads, setShowUploads] = useState(false)

  const fetchTxns = useCallback(async () => {
    if (!tenant) return
    const range = getDateFilterRange(dateFilter)
    const res = await authFetch('/api/bank', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', tenantId: tenant.id, startDate: range.start.toISOString(), endDate: range.end.toISOString(), search: searchQuery || undefined }),
    })
    const data = await res.json()
    setTransactions(data.transactions || [])
    setLoading(false)
  }, [tenant, dateFilter, searchQuery])

  const fetchUploads = useCallback(async () => {
    if (!tenant) return
    const res = await authFetch('/api/bank', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list-uploads', tenantId: tenant.id }),
    })
    const data = await res.json()
    setUploads(data.uploads || [])
  }, [tenant])

  useEffect(() => { fetchTxns(); fetchUploads() }, [fetchTxns, fetchUploads])

  const resetForm = () => {
    setForm({ date: new Date().toISOString().split('T')[0], description: '', reference: '', deposit: 0, withdrawal: 0, category: '', bankName: '', accountNumber: '' })
    setEditingId(null)
  }

  const handleEdit = (t: BankTransaction) => {
    setEditingId(t.id)
    setForm({ date: new Date(t.date).toISOString().split('T')[0], description: t.description, reference: t.reference || '', deposit: t.deposit, withdrawal: t.withdrawal, category: t.category || '', bankName: t.bankName || '', accountNumber: t.accountNumber || '' })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!tenant) return
    const lastBalance = transactions.length > 0 ? transactions[0].balance : 0
    const balance = lastBalance + form.deposit - form.withdrawal
    const payload = { ...form, date: new Date(form.date).toISOString(), balance }
    const res = await authFetch('/api/bank', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingId ? { action: 'update', id: editingId, data: payload } : { action: 'create', tenantId: tenant.id, data: payload }),
    })
    if (res.ok) { toast({ title: editingId ? 'Updated' : 'Created' }); setShowForm(false); resetForm(); fetchTxns() }
    else { toast({ title: 'Error', variant: 'destructive' }) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Archive this transaction?')) return
    await authFetch('/api/bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    toast({ title: 'Archived' }); fetchTxns()
  }

  const handleMatchTransaction = async (transactionId: string) => {
    if (!tenant) return
    setMatchTransactionId(transactionId)
    setMatchLoading(true)
    setShowMatch(true)
    try {
      const res = await authFetch('/api/bank', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'match-transactions', tenantId: tenant.id, transactionId }),
      })
      if (res.ok) {
        const data = await res.json()
        setMatches(data.matches || [])
      } else {
        setMatches([])
        toast({ title: 'No matches found', description: 'Could not find matching invoices for this transaction.' })
      }
    } catch {
      setMatches([])
    }
    setMatchLoading(false)
  }

  const handleReconcile = async (matchType: 'sale' | 'purchase', matchId: string) => {
    if (!matchTransactionId) return
    setReconcileLoading(matchId)
    try {
      const res = await authFetch('/api/bank', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reconcile',
          transactionId: matchTransactionId,
          matchType,
          matchId,
        }),
      })
      if (res.ok) {
        toast({
          title: 'Payment Reconciled',
          description: `${matchType === 'sale' ? 'Sale' : 'Purchase'} entry updated. Payment status changed.`
        })
        setShowMatch(false)
        setMatchTransactionId(null)
        fetchTxns()
      } else {
        const err = await res.json()
        toast({ title: 'Reconciliation Failed', description: err.error || 'Error', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to reconcile', variant: 'destructive' })
    }
    setReconcileLoading(null)
  }

  const totalDeposits = transactions.reduce((s, t) => s + t.deposit, 0)
  const totalWithdrawals = transactions.reduce((s, t) => s + t.withdrawal, 0)
  const currentBalance = transactions.length > 0 ? transactions[0].balance : 0
  const unreconciledCount = transactions.filter(t => !t.isReconciled && (t.deposit > 0 || t.withdrawal > 0)).length

  const exportData = transactions.map((t) => ({
    'Date': formatDate(t.date), 'Description': t.description, 'Reference': t.reference || '',
    'Deposit': t.deposit, 'Withdrawal': t.withdrawal, 'Balance': t.balance, 'Category': t.category || '', 'Bank': t.bankName || '',
    'Reconciled': t.isReconciled ? 'Yes' : 'No',
  }))

  if (loading) return <div><AppHeader title="Bank Statement" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  return (
    <div>
      <AppHeader title="Bank Statement" data={exportData} exportFileName="bank-statement" exportSheetName="Bank" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Deposits</p><p className="text-lg font-bold text-emerald-600">{formatCurrency(totalDeposits, tenant?.currency)}</p></CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Withdrawals</p><p className="text-lg font-bold text-red-600">{formatCurrency(totalWithdrawals, tenant?.currency)}</p></CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Current Balance</p><p className="text-lg font-bold">{formatCurrency(currentBalance, tenant?.currency)}</p></CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Unreconciled</p><p className="text-lg font-bold text-amber-600">{unreconciledCount}</p></CardContent></Card>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {canEdit(user?.role || 'VIEW_ONLY') && (
            <Button onClick={() => { resetForm(); setShowForm(true) }} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4 mr-2" />Add Transaction</Button>
          )}
          <Button variant="outline" onClick={() => setShowUploads(!showUploads)}>
            <FileText className="h-4 w-4 mr-2" />Upload History
          </Button>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800">
            <Sparkles className="h-3.5 w-3.5 text-violet-600" />
            <span className="text-xs text-violet-700 dark:text-violet-300">Upload statements via <strong>AI Smart Import</strong></span>
          </div>
        </div>

        {/* Upload History Panel */}
        {showUploads && uploads.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <h3 className="font-medium mb-2">Statement Upload History</h3>
              <div className="space-y-2">
                {uploads.map((upload) => (
                  <div key={upload.id} className="flex items-center justify-between text-sm p-2 bg-muted rounded-md">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{upload.fileName}</span>
                      <Badge variant="secondary" className="text-xs">{upload.fileType}</Badge>
                      <Badge variant={upload.status === 'COMPLETED' ? 'secondary' : upload.status === 'FAILED' ? 'destructive' : 'outline'} className="text-xs">
                        {upload.status === 'COMPLETED' ? 'Completed' : upload.status === 'FAILED' ? 'Failed' : 'Processing'}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground">
                      {upload.transactionCount} transactions | {formatDate(upload.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Transactions Table */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Deposit</TableHead>
                  <TableHead className="text-right">Withdrawal</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {transactions.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No bank transactions yet</TableCell></TableRow>
                  ) : transactions.map((t) => (
                    <TableRow key={t.id} className={t.isReconciled ? 'opacity-60' : ''}>
                      <TableCell>{formatDate(t.date)}</TableCell>
                      <TableCell>{t.description}</TableCell>
                      <TableCell>{t.reference || '-'}</TableCell>
                      <TableCell className="text-right text-emerald-600 font-medium">{t.deposit > 0 ? formatCurrency(t.deposit, tenant?.currency) : '-'}</TableCell>
                      <TableCell className="text-right text-red-600 font-medium">{t.withdrawal > 0 ? formatCurrency(t.withdrawal, tenant?.currency) : '-'}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(t.balance, tenant?.currency)}</TableCell>
                      <TableCell>{t.category || '-'}</TableCell>
                      <TableCell>
                        {t.isReconciled ? (
                          <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Reconciled</Badge>
                        ) : (t.deposit > 0 || t.withdrawal > 0) ? (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">Unreconciled</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {!t.isReconciled && (t.deposit > 0 || t.withdrawal > 0) && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" onClick={() => handleMatchTransaction(t.id)} title="Match to Invoice">
                              <Link2 className="h-4 w-4" />
                            </Button>
                          )}
                          {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(t)}><Pencil className="h-4 w-4" /></Button>}
                          {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(t.id)}><Trash2 className="h-4 w-4" /></Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Add/Edit Transaction Dialog */}
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingId ? 'Edit Transaction' : 'Add Bank Transaction'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
                <div><Label>Reference</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
              </div>
              <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Deposit (In)</Label><Input type="number" value={form.deposit || ''} onChange={(e) => setForm({ ...form, deposit: Number(e.target.value) })} /></div>
                <div><Label>Withdrawal (Out)</Label><Input type="number" value={form.withdrawal || ''} onChange={(e) => setForm({ ...form, withdrawal: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Sales, Rent" /></div>
                <div><Label>Bank Name</Label><Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave}>{editingId ? 'Update' : 'Save'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Match Transaction Dialog */}
        <Dialog open={showMatch} onOpenChange={setShowMatch}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Match Bank Transaction to Invoice</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Select a matching sale or purchase entry to reconcile this bank transaction. The payment status will be automatically updated.
              </p>
              {matchLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">Finding matches...</span>
                </div>
              ) : matches.length === 0 ? (
                <div className="text-center py-8">
                  <Link2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">No matching invoices found for this transaction.</p>
                  <p className="text-sm text-muted-foreground mt-1">Try adjusting the amount or add a manual entry.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {matches.map((match) => (
                    <Card key={match.id} className="border shadow-sm">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className={match.type === 'sale' ? 'bg-emerald-100 text-emerald-700 text-xs' : 'bg-blue-100 text-blue-700 text-xs'}>
                                {match.type === 'sale' ? 'Sale' : 'Purchase'}
                              </Badge>
                              <span className="font-medium text-sm">{match.invoiceNumber}</span>
                              <span className="text-xs text-muted-foreground">{formatDate(match.date)}</span>
                            </div>
                            <p className="text-sm mt-1">{match.partyName} — {formatCurrency(match.totalAmount, tenant?.currency)}</p>
                            <p className="text-xs text-muted-foreground">Status: {match.paymentStatus} | Match Score: {Math.round(match.matchScore * 100)}%</p>
                          </div>
                          <Button
                            size="sm"
                            className={match.type === 'sale' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}
                            onClick={() => handleReconcile(match.type, match.id)}
                            disabled={reconcileLoading === match.id}
                          >
                            {reconcileLoading === match.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                            )}
                            Confirm Match
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowMatch(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
