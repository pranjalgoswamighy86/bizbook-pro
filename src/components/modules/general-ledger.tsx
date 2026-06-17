'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore, canEdit, type UserRole } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency, formatDate } from '@/lib/formulas'
import { Loader2, BookOpen, ArrowRightLeft, FileText, ChevronDown, Eye, RotateCcw, Plus } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

interface Account {
  id: string; accountCode: string; name: string; type: string; description: string | null; isActive: boolean
}

interface LedgerLine {
  date: string; reference: string | null; description: string; lineDescription: string | null
  debit: number; credit: number; balance: number
}

interface LedgerData {
  account: { id: string; code: string; name: string; type: string }
  period: { startDate: string | null; endDate: string | null }
  openingBalance: number
  lines: LedgerLine[]
  totals: { debits: number; credits: number }
  closingBalance: number
}

interface JournalEntry {
  id: string; entryDate: string; reference: string | null; description: string
  isPosted: boolean; sourceType: string | null; sourceId: string | null
  lines: { id: string; accountId: string; debit: number; credit: number; description: string | null; account: { id: string; accountCode: string; name: string; type: string } }[]
}

const TYPE_COLORS: Record<string, string> = {
  Asset: 'bg-blue-100 text-blue-800',
  Liability: 'bg-red-100 text-red-800',
  Equity: 'bg-purple-100 text-purple-800',
  Revenue: 'bg-green-100 text-green-800',
  Expense: 'bg-orange-100 text-orange-800',
}

export function GeneralLedger() {
  const { tenant, user } = useAppStore()
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  // Ledger view state
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [ledgerData, setLedgerData] = useState<LedgerData | null>(null)
  const [loadingLedger, setLoadingLedger] = useState(false)

  // Journal entry view
  const [activeTab, setActiveTab] = useState<'ledger' | 'journal' | 'trial'>('ledger')
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
  const [loadingJournal, setLoadingJournal] = useState(false)

  // New journal entry form
  const [showJournalForm, setShowJournalForm] = useState(false)
  const [savingJournal, setSavingJournal] = useState(false)
  const [journalForm, setJournalForm] = useState({
    entryDate: new Date().toISOString().split('T')[0],
    reference: '',
    description: '',
  })
  const [journalLines, setJournalLines] = useState([
    { accountId: '', debit: 0, credit: 0, description: '' },
    { accountId: '', debit: 0, credit: 0, description: '' },
  ])

  // Trial balance
  const [trialBalance, setTrialBalance] = useState<{
    lines: { code: string; name: string; type: string; debit: number; credit: number }[]
    totals: { debit: number; credit: number; isBalanced: boolean }
  } | null>(null)
  const [loadingTrial, setLoadingTrial] = useState(false)

  // View entry dialog
  const [viewEntry, setViewEntry] = useState<JournalEntry | null>(null)

  const fetchAccounts = useCallback(async () => {
    if (!tenant) return
    try {
      const res = await authFetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', tenantId: tenant.id }),
      })
      if (res.ok) {
        const data = await res.json()
        setAccounts(data.accounts || [])
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  const fetchLedger = async () => {
    if (!tenant || !selectedAccountId) {
      toast({ title: 'Select Account', description: 'Please select an account to view its ledger', variant: 'destructive' })
      return
    }
    setLoadingLedger(true)
    try {
      const res = await authFetch('/api/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'account-ledger',
          tenantId: tenant.id,
          accountId: selectedAccountId,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setLedgerData(data)
      } else {
        const data = await res.json()
        toast({ title: 'Error', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load ledger', variant: 'destructive' })
    } finally {
      setLoadingLedger(false)
    }
  }

  const fetchJournalEntries = async () => {
    if (!tenant) return
    setLoadingJournal(true)
    try {
      const res = await authFetch('/api/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', tenantId: tenant.id }),
      })
      if (res.ok) {
        const data = await res.json()
        setJournalEntries(data.entries || [])
      }
    } catch { /* ignore */ } finally {
      setLoadingJournal(false)
    }
  }

  const fetchTrialBalance = async () => {
    if (!tenant) return
    setLoadingTrial(true)
    try {
      const res = await authFetch('/api/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trial-balance', tenantId: tenant.id, asOfDate: new Date().toISOString() }),
      })
      if (res.ok) {
        const data = await res.json()
        setTrialBalance(data)
      }
    } catch { /* ignore */ } finally {
      setLoadingTrial(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'journal' && journalEntries.length === 0) fetchJournalEntries()
    if (activeTab === 'trial' && !trialBalance) fetchTrialBalance()
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveJournalEntry = async () => {
    if (!tenant) return
    if (!journalForm.description) {
      toast({ title: 'Validation', description: 'Description is required', variant: 'destructive' })
      return
    }
    const totalDebits = journalLines.reduce((s, l) => s + (l.debit || 0), 0)
    const totalCredits = journalLines.reduce((s, l) => s + (l.credit || 0), 0)
    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      toast({ title: 'Double-Entry Error', description: `Debits (${totalDebits.toFixed(2)}) must equal Credits (${totalCredits.toFixed(2)})`, variant: 'destructive' })
      return
    }
    const missingAccount = journalLines.find(l => !l.accountId)
    if (missingAccount) {
      toast({ title: 'Validation', description: 'All lines must have an account selected', variant: 'destructive' })
      return
    }

    setSavingJournal(true)
    try {
      const res = await authFetch('/api/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          tenantId: tenant.id,
          entryDate: journalForm.entryDate,
          reference: journalForm.reference || null,
          description: journalForm.description,
          sourceType: 'MANUAL',
          lines: journalLines.map(l => ({
            accountId: l.accountId,
            debit: l.debit || 0,
            credit: l.credit || 0,
            description: l.description || null,
          })),
          createdBy: user?.name || null,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        toast({ title: 'Journal Entry Created', description: `Entry posted: ${journalForm.description}` })
        setShowJournalForm(false)
        setJournalForm({ entryDate: new Date().toISOString().split('T')[0], reference: '', description: '' })
        setJournalLines([
          { accountId: '', debit: 0, credit: 0, description: '' },
          { accountId: '', debit: 0, credit: 0, description: '' },
        ])
        fetchJournalEntries()
      } else {
        toast({ title: 'Error', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to create journal entry', variant: 'destructive' })
    } finally {
      setSavingJournal(false)
    }
  }

  const handleReverseEntry = async (entryId: string) => {
    if (!tenant || !confirm('Create a reversing entry for this journal entry?')) return
    try {
      const res = await authFetch('/api/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reverse',
          tenantId: tenant.id,
          id: entryId,
          reason: 'Manual reversal',
          createdBy: user?.name || null,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        toast({ title: 'Entry Reversed', description: 'A reversing entry has been created' })
        fetchJournalEntries()
      } else {
        toast({ title: 'Error', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to reverse entry', variant: 'destructive' })
    }
  }

  const addJournalLine = () => {
    setJournalLines([...journalLines, { accountId: '', debit: 0, credit: 0, description: '' }])
  }

  const updateJournalLine = (index: number, field: string, value: string | number) => {
    setJournalLines(lines => lines.map((l, i) => i === index ? { ...l, [field]: value } : l))
  }

  const removeJournalLine = (index: number) => {
    if (journalLines.length <= 2) return
    setJournalLines(lines => lines.filter((_, i) => i !== index))
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <AppHeader title="General Ledger" />

      {/* Tab navigation */}
      <div className="flex gap-2 border-b pb-2">
        <Button variant={activeTab === 'ledger' ? 'default' : 'ghost'} size="sm" onClick={() => setActiveTab('ledger')} className="gap-2">
          <BookOpen className="h-4 w-4" /> Account Ledger
        </Button>
        <Button variant={activeTab === 'journal' ? 'default' : 'ghost'} size="sm" onClick={() => setActiveTab('journal')} className="gap-2">
          <ArrowRightLeft className="h-4 w-4" /> Journal Entries
        </Button>
        <Button variant={activeTab === 'trial' ? 'default' : 'ghost'} size="sm" onClick={() => setActiveTab('trial')} className="gap-2">
          <FileText className="h-4 w-4" /> Trial Balance
        </Button>
      </div>

      {/* ACCOUNT LEDGER TAB */}
      {activeTab === 'ledger' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1 flex-1 min-w-[200px]">
                  <Label>Select Account</Label>
                  <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                    <SelectTrigger><SelectValue placeholder="Choose an account..." /></SelectTrigger>
                    <SelectContent>
                      {accounts.map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="font-mono mr-2">{a.accountCode}</span>
                          <Badge className={`ml-1 text-xs ${TYPE_COLORS[a.type] || ''}`}>{a.type}</Badge>
                          {' '}{a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>From</Label>
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>To</Label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
                <Button onClick={fetchLedger} disabled={loadingLedger || !selectedAccountId} className="gap-2">
                  {loadingLedger ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  View Ledger
                </Button>
              </div>
            </CardContent>
          </Card>

          {ledgerData && (
            <Card>
              <CardContent className="py-4">
                {/* Ledger Header */}
                <div className="mb-4">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-lg font-bold">{ledgerData.account.code} — {ledgerData.account.name}</h3>
                    <Badge className={TYPE_COLORS[ledgerData.account.type] || ''}>{ledgerData.account.type}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Period: {ledgerData.period.startDate ? formatDate(ledgerData.period.startDate) : 'All'} to {ledgerData.period.endDate ? formatDate(ledgerData.period.endDate) : 'All'}
                  </p>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Date</TableHead>
                      <TableHead className="w-32">Reference</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-32 text-right">Debit</TableHead>
                      <TableHead className="w-32 text-right">Credit</TableHead>
                      <TableHead className="w-32 text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Opening Balance Row */}
                    <TableRow className="bg-muted/50 font-medium">
                      <TableCell colSpan={3}>Opening Balance</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right font-mono">{formatCurrency(ledgerData.openingBalance)}</TableCell>
                    </TableRow>

                    {/* Transaction lines */}
                    {ledgerData.lines.map((line, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{formatDate(line.date)}</TableCell>
                        <TableCell className="text-sm font-mono">{line.reference || '—'}</TableCell>
                        <TableCell className="text-sm">
                          <div>{line.description}</div>
                          {line.lineDescription && <div className="text-xs text-muted-foreground">{line.lineDescription}</div>}
                        </TableCell>
                        <TableCell className="text-right font-mono">{line.debit > 0 ? formatCurrency(line.debit) : ''}</TableCell>
                        <TableCell className="text-right font-mono">{line.credit > 0 ? formatCurrency(line.credit) : ''}</TableCell>
                        <TableCell className="text-right font-mono font-medium">{formatCurrency(line.balance)}</TableCell>
                      </TableRow>
                    ))}

                    {/* Totals Row */}
                    <TableRow className="bg-muted/50 font-bold border-t-2">
                      <TableCell colSpan={3}>Period Totals</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(ledgerData.totals.debits)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(ledgerData.totals.credits)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(ledgerData.closingBalance)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>

                <div className="mt-3 text-xs text-muted-foreground">
                  Closing Balance = Opening Balance + Total Debits - Total Credits = {formatCurrency(ledgerData.openingBalance)} + {formatCurrency(ledgerData.totals.debits)} - {formatCurrency(ledgerData.totals.credits)} = {formatCurrency(ledgerData.closingBalance)}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* JOURNAL ENTRIES TAB */}
      {activeTab === 'journal' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button onClick={() => setShowJournalForm(true)} disabled={!canEdit(user?.role as UserRole)} className="gap-2">
              <Plus className="h-4 w-4" /> New Journal Entry
            </Button>
            <Button variant="outline" onClick={fetchJournalEntries} className="gap-2">
              <RotateCcw className="h-4 w-4" /> Refresh
            </Button>
          </div>

          {loadingJournal ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : journalEntries.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <ArrowRightLeft className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Journal Entries</h3>
                <p className="text-muted-foreground">Create manual entries or they will be auto-generated when you create sales and purchases.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {journalEntries.map(entry => (
                <Card key={entry.id}>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{entry.description}</span>
                          {entry.sourceType && entry.sourceType !== 'MANUAL' && (
                            <Badge variant="outline" className="text-xs">{entry.sourceType}</Badge>
                          )}
                          <Badge className={entry.isPosted ? 'bg-emerald-100 text-emerald-800' : 'bg-yellow-100 text-yellow-800'}>
                            {entry.isPosted ? 'Posted' : 'Draft'}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatDate(entry.entryDate)} {entry.reference && `| Ref: ${entry.reference}`}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setViewEntry(entry)} className="gap-1">
                          <Eye className="h-3.5 w-3.5" /> View
                        </Button>
                        {entry.isPosted && canEdit(user?.role as UserRole) && (
                          <Button variant="ghost" size="sm" className="text-destructive gap-1" onClick={() => handleReverseEntry(entry.id)}>
                            <RotateCcw className="h-3.5 w-3.5" /> Reverse
                          </Button>
                        )}
                      </div>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entry.lines.map(line => (
                          <TableRow key={line.id}>
                            <TableCell className="text-sm">
                              <span className="font-mono mr-2">{line.account.accountCode}</span>
                              {line.account.name}
                              {line.description && <span className="text-muted-foreground ml-2">— {line.description}</span>}
                            </TableCell>
                            <TableCell className="text-right font-mono">{line.debit > 0 ? formatCurrency(line.debit) : ''}</TableCell>
                            <TableCell className="text-right font-mono">{line.credit > 0 ? formatCurrency(line.credit) : ''}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TRIAL BALANCE TAB */}
      {activeTab === 'trial' && (
        <div className="space-y-4">
          <Button variant="outline" onClick={fetchTrialBalance} disabled={loadingTrial} className="gap-2">
            {loadingTrial ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Refresh Trial Balance
          </Button>

          {trialBalance ? (
            <Card>
              <CardContent className="py-4">
                <div className="mb-4 flex items-center gap-3">
                  <h3 className="text-lg font-bold">Trial Balance</h3>
                  {trialBalance.totals.isBalanced ? (
                    <Badge className="bg-emerald-100 text-emerald-800">Balanced</Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-800">Not Balanced</Badge>
                  )}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Code</TableHead>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="w-28">Type</TableHead>
                      <TableHead className="w-36 text-right">Debit Balance</TableHead>
                      <TableHead className="w-36 text-right">Credit Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trialBalance.lines.map((line, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono">{line.code}</TableCell>
                        <TableCell>{line.name}</TableCell>
                        <TableCell><Badge className={`text-xs ${TYPE_COLORS[line.type] || ''}`}>{line.type}</Badge></TableCell>
                        <TableCell className="text-right font-mono">{line.debit > 0 ? formatCurrency(line.debit) : ''}</TableCell>
                        <TableCell className="text-right font-mono">{line.credit > 0 ? formatCurrency(line.credit) : ''}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold border-t-2 bg-muted/50">
                      <TableCell colSpan={3}>Total</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(trialBalance.totals.debit)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(trialBalance.totals.credit)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                {!trialBalance.totals.isBalanced && (
                  <div className="mt-3 text-sm text-destructive">
                    Difference: {formatCurrency(Math.abs(trialBalance.totals.debit - trialBalance.totals.credit))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : loadingTrial ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : (
            <Card>
              <CardContent className="py-16 text-center">
                <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Trial Balance</h3>
                <p className="text-muted-foreground">Click Refresh to generate the trial balance from posted journal entries.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* New Journal Entry Dialog */}
      <Dialog open={showJournalForm} onOpenChange={setShowJournalForm}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Journal Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Date *</Label>
                <Input type="date" value={journalForm.entryDate} onChange={e => setJournalForm(f => ({ ...f, entryDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Reference</Label>
                <Input placeholder="e.g., INV-001" value={journalForm.reference} onChange={e => setJournalForm(f => ({ ...f, reference: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Description *</Label>
                <Input placeholder="Narration" value={journalForm.description} onChange={e => setJournalForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Line Items</Label>
              {journalLines.map((line, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    {i === 0 && <div className="text-xs text-muted-foreground mb-1">Account</div>}
                    <Select value={line.accountId} onValueChange={v => updateJournalLine(i, 'accountId', v)}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        {accounts.map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.accountCode} - {a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    {i === 0 && <div className="text-xs text-muted-foreground mb-1">Debit</div>}
                    <Input type="number" className="h-9" value={line.debit || ''} placeholder="0.00"
                      onChange={e => updateJournalLine(i, 'debit', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="col-span-3">
                    {i === 0 && <div className="text-xs text-muted-foreground mb-1">Credit</div>}
                    <Input type="number" className="h-9" value={line.credit || ''} placeholder="0.00"
                      onChange={e => updateJournalLine(i, 'credit', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="col-span-1">
                    {i === 0 && <div className="text-xs text-muted-foreground mb-1">&nbsp;</div>}
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removeJournalLine(i)} disabled={journalLines.length <= 2}>
                      ×
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={addJournalLine} className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> Add Line
                </Button>
                <div className="text-sm">
                  <span className="text-muted-foreground">Debits: </span>
                  <span className="font-mono">{formatCurrency(journalLines.reduce((s, l) => s + (l.debit || 0), 0))}</span>
                  <span className="text-muted-foreground ml-4">Credits: </span>
                  <span className="font-mono">{formatCurrency(journalLines.reduce((s, l) => s + (l.credit || 0), 0))}</span>
                  {Math.abs(journalLines.reduce((s, l) => s + (l.debit || 0), 0) - journalLines.reduce((s, l) => s + (l.credit || 0), 0)) > 0.01 && (
                    <span className="text-destructive ml-4 font-medium">Not balanced!</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowJournalForm(false)}>Cancel</Button>
            <Button onClick={handleSaveJournalEntry} disabled={savingJournal}>
              {savingJournal && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Post Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Entry Dialog */}
      <Dialog open={!!viewEntry} onOpenChange={() => setViewEntry(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Journal Entry Details</DialogTitle>
          </DialogHeader>
          {viewEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">Date:</span> {formatDate(viewEntry.entryDate)}</div>
                <div><span className="text-muted-foreground">Reference:</span> {viewEntry.reference || '—'}</div>
                <div className="col-span-2"><span className="text-muted-foreground">Description:</span> {viewEntry.description}</div>
                <div><span className="text-muted-foreground">Source:</span> {viewEntry.sourceType || 'Manual'}</div>
                <div><span className="text-muted-foreground">Status:</span> {viewEntry.isPosted ? 'Posted' : 'Draft'}</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewEntry.lines.map(line => (
                    <TableRow key={line.id}>
                      <TableCell>{line.account.accountCode} - {line.account.name}</TableCell>
                      <TableCell className="text-right font-mono">{line.debit > 0 ? formatCurrency(line.debit) : ''}</TableCell>
                      <TableCell className="text-right font-mono">{line.credit > 0 ? formatCurrency(line.credit) : ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
