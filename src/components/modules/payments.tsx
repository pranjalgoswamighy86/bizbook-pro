'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore, canEdit, canCorrect } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate, getDateFilterRange } from '@/lib/formulas'
import { Plus, Pencil, Trash2, CreditCard } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'
import { PartySuggest } from '@/components/app/party-suggest'

interface Payment {
  id: string; date: string; partyName: string; amount: number; paymentMode: string
  reference: string | null; purpose: string | null; invoiceRef: string | null; notes: string | null
}

export function Payments() {
  const { tenant, user, dateFilter, searchQuery } = useAppStore()
  const { toast } = useToast()
  const [payments, setPayments] = useState<Payment[]>([])
  const [totalPayments, setTotalPayments] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], partyName: '', amount: 0, paymentMode: 'CASH', reference: '', purpose: '', invoiceRef: '', notes: '' })

  const fetchData = useCallback(async () => {
    if (!tenant) return
    const range = getDateFilterRange(dateFilter)
    const res = await authFetch('/api/payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', tenantId: tenant.id, startDate: range.start.toISOString(), endDate: range.end.toISOString(), search: searchQuery || undefined }),
    })
    const data = await res.json()
    setPayments(data.payments || [])
    setTotalPayments(data.totalPayments || 0)
    setLoading(false)
  }, [tenant, dateFilter, searchQuery])

  useEffect(() => { fetchData() }, [fetchData])

  const resetForm = () => { setForm({ date: new Date().toISOString().split('T')[0], partyName: '', amount: 0, paymentMode: 'CASH', reference: '', purpose: '', invoiceRef: '', notes: '' }); setEditingId(null) }
  const handleEdit = (p: Payment) => { setEditingId(p.id); setForm({ date: new Date(p.date).toISOString().split('T')[0], partyName: p.partyName, amount: p.amount, paymentMode: p.paymentMode, reference: p.reference || '', purpose: p.purpose || '', invoiceRef: p.invoiceRef || '', notes: p.notes || '' }); setShowForm(true) }

  const handleSave = async () => {
    if (!tenant) return
    const payload = { ...form, date: new Date(form.date).toISOString(), createdBy: user?.id }
    const res = await authFetch('/api/payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingId ? { action: 'update', id: editingId, data: payload } : { action: 'create', tenantId: tenant.id, data: payload }),
    })
    if (res.ok) { toast({ title: editingId ? 'Updated' : 'Created' }); setShowForm(false); resetForm(); fetchData() }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Archive?')) return
    await authFetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    toast({ title: 'Archived' }); fetchData()
  }

  const exportData = payments.map((p) => ({ 'Date': formatDate(p.date), 'Party': p.partyName, 'Amount': p.amount, 'Mode': p.paymentMode, 'Reference': p.reference || '', 'Purpose': p.purpose || '', 'Invoice Ref': p.invoiceRef || '' }))

  if (loading) return <div><AppHeader title="Payments" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  return (
    <div>
      <AppHeader title="Payments (Money Out)" data={exportData} exportFileName="payments" exportSheetName="Payments" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        <Card className="border-0 shadow-sm"><CardContent className="p-4 flex items-center gap-3"><CreditCard className="h-8 w-8 text-red-600" /><div><p className="text-xs text-muted-foreground">Total Payments</p><p className="text-lg font-bold text-red-600">{formatCurrency(totalPayments, tenant?.currency)}</p></div></CardContent></Card>
        {canEdit(user?.role || 'VIEW_ONLY') && <Button onClick={() => { resetForm(); setShowForm(true) }} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4 mr-2" />New Payment</Button>}
        <Card className="border-0 shadow-sm"><CardContent className="p-0"><div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Mode</TableHead><TableHead>Purpose</TableHead><TableHead>Ref</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {payments.length === 0 ? (<TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No payments found</TableCell></TableRow>) : payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{formatDate(p.date)}</TableCell><TableCell>{p.partyName}</TableCell>
                  <TableCell className="text-right font-medium text-red-600">{formatCurrency(p.amount, tenant?.currency)}</TableCell>
                  <TableCell>{p.paymentMode}</TableCell><TableCell>{p.purpose || '-'}</TableCell><TableCell>{p.reference || '-'}</TableCell>
                  <TableCell className="text-right"><div className="flex justify-end gap-1">
                    {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(p)}><Pencil className="h-4 w-4" /></Button>}
                    {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-4 w-4" /></Button>}
                  </div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div></CardContent></Card>

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingId ? 'Edit Payment' : 'New Payment'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
                <div><Label>Payment Mode</Label><Select value={form.paymentMode} onValueChange={(v) => setForm({ ...form, paymentMode: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CASH">Cash</SelectItem><SelectItem value="BANK">Bank</SelectItem><SelectItem value="UPI">UPI</SelectItem><SelectItem value="CHEQUE">Cheque</SelectItem></SelectContent></Select></div>
              </div>
              <PartySuggest
                  tenantId={tenant?.id}
                  value={form.partyName}
                  onChange={(val) => setForm({ ...form, partyName: val })}
                  onPartySelect={(party) => setForm({ ...form, partyName: party.name })}
                  label="Party Name"
                  placeholder="Type party name..."
                />
              <div><Label>Amount</Label><Input type="number" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></div>
              <div><Label>Purpose</Label><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
              <div><Label>Reference</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
              <div><Label>Invoice Reference</Label><Input value={form.invoiceRef} onChange={(e) => setForm({ ...form, invoiceRef: e.target.value })} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave}>{editingId ? 'Update' : 'Save'}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
