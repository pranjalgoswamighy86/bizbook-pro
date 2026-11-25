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
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate, getDateFilterRange } from '@/lib/formulas'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

interface Expense {
  id: string; date: string; category: string; description: string; amount: number
  paymentMode: string; reference: string | null; notes: string | null
}

const categories = ['Rent', 'Electricity', 'Internet', 'Transport', 'Office Supplies', 'Marketing', 'Salary', 'Maintenance', 'Insurance', 'Tax', 'Miscellaneous', 'Other']

export function ExpenseRegister() {
  const { tenant, user, dateFilter, searchQuery } = useAppStore()
  const { toast } = useToast()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0], category: 'Other', description: '',
    amount: 0, paymentMode: 'CASH', reference: '', notes: '',
  })

  const fetchExpenses = useCallback(async () => {
    if (!tenant) return
    const range = getDateFilterRange(dateFilter)
    const res = await authFetch('/api/expenses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', tenantId: tenant.id, startDate: range.start.toISOString(), endDate: range.end.toISOString(), search: searchQuery || undefined }),
    })
    const data = await res.json()
    setExpenses(data.expenses || [])
    setLoading(false)
  }, [tenant, dateFilter, searchQuery])

  useEffect(() => { fetchExpenses() }, [fetchExpenses])

  const resetForm = () => {
    setForm({ date: new Date().toISOString().split('T')[0], category: 'Other', description: '', amount: 0, paymentMode: 'CASH', reference: '', notes: '' })
    setEditingId(null)
  }

  const handleEdit = (e: Expense) => {
    setEditingId(e.id)
    setForm({ date: new Date(e.date).toISOString().split('T')[0], category: e.category, description: e.description, amount: e.amount, paymentMode: e.paymentMode, reference: e.reference || '', notes: e.notes || '' })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!tenant) return
    const payload = { ...form, date: new Date(form.date).toISOString(), createdBy: user?.id }
    const res = await authFetch('/api/expenses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingId ? { action: 'update', id: editingId, data: payload } : { action: 'create', tenantId: tenant.id, data: payload }),
    })
    if (res.ok) { toast({ title: editingId ? 'Updated' : 'Created' }); setShowForm(false); resetForm(); fetchExpenses() }
    else { toast({ title: 'Error', variant: 'destructive' }) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Archive this expense?')) return
    await authFetch('/api/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    toast({ title: 'Archived' }); fetchExpenses()
  }

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const exportData = expenses.map((e) => ({
    'Date': formatDate(e.date), 'Category': e.category, 'Description': e.description,
    'Amount': e.amount, 'Payment Mode': e.paymentMode, 'Reference': e.reference || '', 'Notes': e.notes || '',
  }))

  if (loading) return <div><AppHeader title="Expense Register" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  return (
    <div>
      <AppHeader title="Expense Register" data={exportData} exportFileName="expenses" exportSheetName="Expenses" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        <div className="flex items-center justify-between">
          {canEdit(user?.role || 'VIEW_ONLY') && (
            <Button onClick={() => { resetForm(); setShowForm(true) }} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4 mr-2" />New Expense</Button>
          )}
          <div className="text-sm font-semibold text-muted-foreground">
            Total: {formatCurrency(totalExpenses, tenant?.currency)}
          </div>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Mode</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {expenses.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No expenses found</TableCell></TableRow>
                  ) : expenses.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{formatDate(e.date)}</TableCell>
                      <TableCell><span className="px-2 py-1 rounded-full bg-muted text-xs">{e.category}</span></TableCell>
                      <TableCell>{e.description}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(e.amount, tenant?.currency)}</TableCell>
                      <TableCell>{e.paymentMode}</TableCell>
                      <TableCell>{e.reference || '-'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(e)}><Pencil className="h-4 w-4" /></Button>}
                          {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(e.id)}><Trash2 className="h-4 w-4" /></Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingId ? 'Edit Expense' : 'New Expense'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
                <div><Label>Category</Label><Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What was the expense for?" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Amount</Label><Input type="number" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></div>
                <div><Label>Payment Mode</Label><Select value={form.paymentMode} onValueChange={(v) => setForm({ ...form, paymentMode: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CASH">Cash</SelectItem><SelectItem value="BANK">Bank</SelectItem><SelectItem value="UPI">UPI</SelectItem><SelectItem value="CHEQUE">Cheque</SelectItem></SelectContent></Select></div>
              </div>
              <div><Label>Reference</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Optional reference number" /></div>
              <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave}>{editingId ? 'Update' : 'Save'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
