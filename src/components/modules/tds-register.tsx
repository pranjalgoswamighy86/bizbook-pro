'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore, canEdit, canCorrect } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate, getDateFilterRange } from '@/lib/formulas'
import { Plus, Pencil, Trash2, FileText, Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

interface TDSRecord {
  id: string
  date: string
  partyName: string
  partyPan: string | null
  section: string
  natureOfPayment: string
  amount: number
  tdsRate: number
  tdsAmount: number
  status: string // DEDUCTED, PAID, FILED
  challanNumber: string | null
  notes: string | null
}

const TDS_SECTIONS = [
  { code: '194C', label: '194C - Payment to Contractor', rate: 1, threshold: 30000 },
  { code: '194J', label: '194J - Professional/Technical Fees', rate: 10, threshold: 30000 },
  { code: '194I', label: '194I - Rent', rate: 10, threshold: 240000 },
  { code: '194H', label: '194H - Commission/Brokerage', rate: 5, threshold: 15000 },
  { code: '194A', label: '194A - Interest', rate: 10, threshold: 5000 },
  { code: '194Q', label: '194Q - Purchase of Goods', rate: 0.1, threshold: 5000000 },
  { code: '194O', label: '194O - E-commerce Operator', rate: 1, threshold: 500000 },
  { code: '206CR', label: '206CR - TCS on Sale', rate: 1, threshold: 5000000 },
]

export function TDSRegister() {
  const { tenant, user, dateFilter } = useAppStore()
  const { toast } = useToast()
  const [records, setRecords] = useState<TDSRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    partyName: '',
    partyPan: '',
    section: '194C',
    natureOfPayment: '',
    amount: 0,
    tdsRate: 1,
    tdsAmount: 0,
    notes: '',
  })

  const fetchRecords = useCallback(async () => {
    if (!tenant) return
    setLoading(true)
    try {
      const range = getDateFilterRange(dateFilter)
      const res = await authFetch('/api/tds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          tenantId: tenant.id,
          startDate: range.start.toISOString(),
          endDate: range.end.toISOString(),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setRecords(data.records || [])
      }
    } catch {
      // Keep existing data
    } finally {
      setLoading(false)
    }
  }, [tenant, dateFilter])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  const resetForm = () => {
    setForm({
      date: new Date().toISOString().split('T')[0],
      partyName: '', partyPan: '', section: '194C',
      natureOfPayment: '', amount: 0, tdsRate: 1, tdsAmount: 0, notes: '',
    })
    setEditingId(null)
  }

  const handleSectionChange = (sectionCode: string) => {
    const section = TDS_SECTIONS.find(s => s.code === sectionCode)
    if (section) {
      const calculatedTDS = (form.amount * section.rate) / 100
      setForm({ ...form, section: sectionCode, tdsRate: section.rate, tdsAmount: calculatedTDS })
    }
  }

  const handleAmountChange = (amount: number) => {
    const calculatedTDS = (amount * form.tdsRate) / 100
    setForm({ ...form, amount, tdsAmount: calculatedTDS })
  }

  const handleSave = async () => {
    if (!tenant) return
    if (!form.partyName.trim()) {
      toast({ title: 'Error', description: 'Party name is required', variant: 'destructive' })
      return
    }
    if (form.amount <= 0) {
      toast({ title: 'Error', description: 'Amount must be greater than 0', variant: 'destructive' })
      return
    }

    const payload = {
      ...form,
      date: new Date(form.date).toISOString(),
      tdsAmount: form.tdsAmount,
    }

    const res = await authFetch('/api/tds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        editingId
          ? { action: 'update', id: editingId, tenantId: tenant.id, data: payload }
          : { action: 'create', tenantId: tenant.id, data: payload }
      ),
    })

    if (res.ok) {
      toast({ title: editingId ? 'TDS Updated' : 'TDS Entry Created', description: `TDS of ${formatCurrency(form.tdsAmount, tenant.currency)} deducted under Section ${form.section}` })
      setShowForm(false)
      resetForm()
      fetchRecords()
    } else {
      toast({ title: 'Error', description: 'Failed to save TDS entry', variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this TDS entry? A reversing journal entry will be posted.')) return
    const res = await authFetch('/api/tds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id, tenantId: tenant?.id }),
    })
    if (res.ok) {
      toast({ title: 'TDS Entry Deleted', description: 'Reversing journal entry posted.' })
      fetchRecords()
    }
  }

  const totalTDS = records.reduce((sum, r) => sum + r.tdsAmount, 0)
  const totalAmount = records.reduce((sum, r) => sum + r.amount, 0)

  const exportData = records.map(r => ({
    'Date': formatDate(r.date),
    'Party Name': r.partyName,
    'PAN': r.partyPan || '',
    'Section': r.section,
    'Nature of Payment': r.natureOfPayment,
    'Amount': r.amount,
    'TDS Rate %': r.tdsRate,
    'TDS Amount': r.tdsAmount,
    'Status': r.status,
    'Challan #': r.challanNumber || '',
  }))

  if (loading) return <div><AppHeader title="TDS / TCS Register" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  return (
    <div>
      <AppHeader title="TDS / TCS Register" data={exportData} exportFileName="tds-register" exportSheetName="TDS" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Entries</p>
              <p className="text-2xl font-bold">{records.length}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Amount</p>
              <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalAmount, tenant?.currency)}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total TDS Deducted</p>
              <p className="text-2xl font-bold text-rose-600">{formatCurrency(totalTDS, tenant?.currency)}</p>
            </CardContent>
          </Card>
        </div>

        {canEdit(user?.role || 'VIEW_ONLY') && (
          <Button onClick={() => { resetForm(); setShowForm(true) }} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="h-4 w-4 mr-2" /> New TDS Entry
          </Button>
        )}

        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-sm font-semibold px-4 py-3">Date</TableHead>
                    <TableHead className="text-sm font-semibold px-4 py-3">Party Name</TableHead>
                    <TableHead className="text-sm font-semibold px-4 py-3">PAN</TableHead>
                    <TableHead className="text-sm font-semibold px-4 py-3">Section</TableHead>
                    <TableHead className="text-right text-sm font-semibold px-4 py-3">Amount</TableHead>
                    <TableHead className="text-right text-sm font-semibold px-4 py-3">TDS Rate</TableHead>
                    <TableHead className="text-right text-sm font-semibold px-4 py-3">TDS Amount</TableHead>
                    <TableHead className="text-sm font-semibold px-4 py-3">Status</TableHead>
                    <TableHead className="text-right text-sm font-semibold px-4 py-3">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-12">No TDS entries found. Click "New TDS Entry" to add one.</TableCell></TableRow>
                  ) : records.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/30 h-14">
                      <TableCell className="text-sm px-4 py-3">{formatDate(r.date)}</TableCell>
                      <TableCell className="text-sm px-4 py-3 font-medium">{r.partyName}</TableCell>
                      <TableCell className="text-sm px-4 py-3 font-mono">{r.partyPan || '-'}</TableCell>
                      <TableCell className="text-sm px-4 py-3">
                        <Badge variant="outline" className="text-xs bg-blue-50">{r.section}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm px-4 py-3 font-semibold">{formatCurrency(r.amount, tenant?.currency)}</TableCell>
                      <TableCell className="text-right text-sm px-4 py-3">{r.tdsRate}%</TableCell>
                      <TableCell className="text-right text-sm px-4 py-3 font-semibold text-rose-700 dark:text-rose-400">{formatCurrency(r.tdsAmount, tenant?.currency)}</TableCell>
                      <TableCell className="text-sm px-4 py-3">
                        <Badge variant="outline" className={`text-xs ${r.status === 'FILED' ? 'bg-emerald-50 text-emerald-700' : r.status === 'PAID' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right px-4 py-3">
                        <div className="flex justify-end items-center gap-1 flex-nowrap">
                          {canCorrect(user?.role || 'VIEW_ONLY') && (
                            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 hover:bg-amber-50" title="Edit" onClick={() => {
                              setEditingId(r.id)
                              setForm({
                                date: new Date(r.date).toISOString().split('T')[0],
                                partyName: r.partyName,
                                partyPan: r.partyPan || '',
                                section: r.section,
                                natureOfPayment: r.natureOfPayment,
                                amount: r.amount,
                                tdsRate: r.tdsRate,
                                tdsAmount: r.tdsAmount,
                                notes: r.notes || '',
                              })
                              setShowForm(true)
                            }}>
                              <Pencil className="h-5 w-5 text-amber-600" />
                            </Button>
                          )}
                          {canCorrect(user?.role || 'VIEW_ONLY') && (
                            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 hover:bg-rose-50 text-destructive" title="Delete" onClick={() => handleDelete(r.id)}>
                              <Trash2 className="h-5 w-5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* TDS Entry Form Dialog */}
        <Dialog open={showForm} onOpenChange={(open) => { if (!open) setShowForm(false) }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">{editingId ? 'Edit TDS Entry' : 'New TDS Entry'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium">Date</Label>
                  <Input type="date" className="h-10 text-base" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div>
                  <Label className="text-sm font-medium">Party PAN</Label>
                  <Input placeholder="ABCDE1234F" className="h-10 text-base" value={form.partyPan} onChange={(e) => setForm({ ...form, partyPan: e.target.value.toUpperCase() })} />
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Party Name (Deductee)</Label>
                <Input placeholder="Enter party name" className="h-10 text-base" value={form.partyName} onChange={(e) => setForm({ ...form, partyName: e.target.value })} />
              </div>

              <div>
                <Label className="text-sm font-medium">TDS Section</Label>
                <Select value={form.section} onValueChange={handleSectionChange}>
                  <SelectTrigger className="h-10 text-base w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TDS_SECTIONS.map(s => (
                      <SelectItem key={s.code} value={s.code}>{s.label} ({s.rate}%)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm font-medium">Nature of Payment</Label>
                <Input placeholder="e.g., Professional services, Rent, Contract work" className="h-10 text-base" value={form.natureOfPayment} onChange={(e) => setForm({ ...form, natureOfPayment: e.target.value })} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-sm font-medium">Amount (₹)</Label>
                  <Input type="number" placeholder="0.00" className="h-10 text-base" value={form.amount || ''} onChange={(e) => handleAmountChange(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-sm font-medium">TDS Rate (%)</Label>
                  <Input type="number" className="h-10 text-base bg-muted" value={form.tdsRate} readOnly />
                </div>
                <div>
                  <Label className="text-sm font-medium">TDS Amount (₹)</Label>
                  <div className="h-10 flex items-center px-3 bg-rose-50 dark:bg-rose-950/30 rounded-md border border-rose-200">
                    <span className="text-base font-bold text-rose-700 dark:text-rose-400">{formatCurrency(form.tdsAmount, tenant?.currency)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg border border-blue-200">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  <strong>Accounting Entry:</strong><br/>
                  Dr {form.partyName} (Creditor) — {formatCurrency(form.amount, tenant?.currency)}<br/>
                  Cr Cash/Bank — {formatCurrency(form.amount - form.tdsAmount, tenant?.currency)}<br/>
                  Cr TDS Payable — {formatCurrency(form.tdsAmount, tenant?.currency)}
                </p>
              </div>

              <div>
                <Label className="text-sm font-medium">Notes</Label>
                <Input placeholder="Optional notes" className="h-10 text-base" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave}>
                {editingId ? 'Update' : 'Save'} TDS Entry
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
