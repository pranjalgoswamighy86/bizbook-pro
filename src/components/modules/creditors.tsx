'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore, canEdit, canCorrect } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/formulas'
import { Plus, Pencil, Trash2, UserX } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

interface Creditor {
  id: string; name: string; phone: string | null; email: string | null; address: string | null
  gstNumber: string | null; openingBalance: number; currentBalance: number
}

export function Creditors() {
  const { tenant, user, searchQuery } = useAppStore()
  const { toast } = useToast()
  const [creditors, setCreditors] = useState<Creditor[]>([])
  const [totalPayable, setTotalPayable] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', gstNumber: '', openingBalance: 0 })

  const fetchCreditors = useCallback(async () => {
    if (!tenant) return
    const res = await authFetch('/api/creditors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', tenantId: tenant.id, search: searchQuery || undefined }),
    })
    const data = await res.json()
    setCreditors(data.creditors || [])
    setTotalPayable(data.totalPayable || 0)
    setLoading(false)
  }, [tenant, searchQuery])

  useEffect(() => { fetchCreditors() }, [fetchCreditors])

  const resetForm = () => { setForm({ name: '', phone: '', email: '', address: '', gstNumber: '', openingBalance: 0 }); setEditingId(null) }

  const handleEdit = (c: Creditor) => {
    setEditingId(c.id)
    setForm({ name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '', gstNumber: c.gstNumber || '', openingBalance: c.openingBalance })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!tenant) return
    const payload = { ...form, currentBalance: form.openingBalance }
    const res = await authFetch('/api/creditors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingId ? { action: 'update', id: editingId, data: payload } : { action: 'create', tenantId: tenant.id, data: payload }),
    })
    if (res.ok) { toast({ title: editingId ? 'Updated' : 'Created' }); setShowForm(false); resetForm(); fetchCreditors() }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Archive this creditor?')) return
    await authFetch('/api/creditors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    toast({ title: 'Archived' }); fetchCreditors()
  }

  const exportData = creditors.map((c) => ({ 'Name': c.name, 'Phone': c.phone || '', 'Email': c.email || '', 'GST': c.gstNumber || '', 'Opening Balance': c.openingBalance, 'Current Balance': c.currentBalance }))

  if (loading) return <div><AppHeader title="Creditors (Payable)" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  return (
    <div>
      <AppHeader title="Creditors (Accounts Payable)" data={exportData} exportFileName="creditors" exportSheetName="Creditors" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        <Card className="border-0 shadow-sm"><CardContent className="p-4 flex items-center gap-3"><UserX className="h-8 w-8 text-red-600" /><div><p className="text-xs text-muted-foreground">Total Payable</p><p className="text-lg font-bold text-red-600">{formatCurrency(totalPayable, tenant?.currency)}</p></div></CardContent></Card>

        {canEdit(user?.role || 'VIEW_ONLY') && <Button onClick={() => { resetForm(); setShowForm(true) }} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4 mr-2" />Add Creditor</Button>}

        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Email</TableHead><TableHead>GST</TableHead><TableHead className="text-right">Opening Bal.</TableHead><TableHead className="text-right">Current Bal.</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {creditors.length === 0 ? (<TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No creditors found</TableCell></TableRow>) : creditors.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell><TableCell>{c.phone || '-'}</TableCell><TableCell>{c.email || '-'}</TableCell><TableCell>{c.gstNumber || '-'}</TableCell>
                      <TableCell className="text-right">{formatCurrency(c.openingBalance, tenant?.currency)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(c.currentBalance, tenant?.currency)}</TableCell>
                      <TableCell className="text-right"><div className="flex justify-end gap-1">
                        {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(c)}><Pencil className="h-4 w-4" /></Button>}
                        {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(c.id)}><Trash2 className="h-4 w-4" /></Button>}
                      </div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingId ? 'Edit Creditor' : 'Add Creditor'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>GST Number</Label><Input value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} /></div>
                <div><Label>Opening Balance</Label><Input type="number" value={form.openingBalance || ''} onChange={(e) => setForm({ ...form, openingBalance: Number(e.target.value) })} /></div>
              </div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave}>{editingId ? 'Update' : 'Save'}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
