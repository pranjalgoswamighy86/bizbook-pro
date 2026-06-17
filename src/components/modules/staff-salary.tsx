'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore, canEdit, canCorrect, canManage } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/formulas'
import { Plus, Pencil, Trash2, Users, DollarSign, CalendarDays } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

interface StaffMember {
  id: string; name: string; phone: string | null; email: string | null; role: string | null
  department: string | null; salary: number; joinDate: string | null; isActive: boolean
  salaryPayments: Array<{ id: string; month: string; amount: number; paidDate: string; paymentMode: string }>
}

export function StaffSalary() {
  const { tenant, user, searchQuery } = useAppStore()
  const { toast } = useToast()
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showSalary, setShowSalary] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null)
  const [salaryForm, setSalaryForm] = useState({ month: '', amount: 0, paidDate: new Date().toISOString().split('T')[0], paymentMode: 'BANK', notes: '' })
  const [form, setForm] = useState({
    name: '', phone: '', email: '', role: '', department: '', salary: 0,
    joinDate: new Date().toISOString().split('T')[0], address: '', aadhaar: '', pan: '',
  })

  const fetchStaff = useCallback(async () => {
    if (!tenant) return
    const res = await authFetch('/api/staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', tenantId: tenant.id, search: searchQuery || undefined }),
    })
    const data = await res.json()
    setStaffList(data.staff || [])
    setLoading(false)
  }, [tenant, searchQuery])

  useEffect(() => { fetchStaff() }, [fetchStaff])

  const resetForm = () => { setForm({ name: '', phone: '', email: '', role: '', department: '', salary: 0, joinDate: new Date().toISOString().split('T')[0], address: '', aadhaar: '', pan: '' }); setEditingId(null) }

  const handleEdit = (s: StaffMember) => {
    setEditingId(s.id)
    setForm({ name: s.name, phone: s.phone || '', email: s.email || '', role: s.role || '', department: s.department || '', salary: s.salary, joinDate: s.joinDate ? new Date(s.joinDate).toISOString().split('T')[0] : '', address: '', aadhaar: '', pan: '' })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!tenant) return
    const data = { ...form, joinDate: form.joinDate ? new Date(form.joinDate).toISOString() : null }
    const res = await authFetch('/api/staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingId ? { action: 'update', id: editingId, data } : { action: 'create', tenantId: tenant.id, data }),
    })
    if (res.ok) { toast({ title: editingId ? 'Updated' : 'Created' }); setShowForm(false); resetForm(); fetchStaff() }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Archive this staff member?')) return
    await authFetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    toast({ title: 'Archived' }); fetchStaff()
  }

  const handlePaySalary = async () => {
    if (!selectedStaffId || !tenant) return
    const res = await authFetch('/api/staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pay-salary', staffId: selectedStaffId, tenantId: tenant.id, ...salaryForm, paidDate: new Date(salaryForm.paidDate).toISOString() }),
    })
    if (res.ok) { toast({ title: 'Salary paid' }); setShowSalary(false); fetchStaff() }
  }

  const totalSalary = staffList.filter((s) => s.isActive).reduce((sum, s) => sum + s.salary, 0)
  const activeStaff = staffList.filter((s) => s.isActive).length

  const exportData = staffList.map((s) => ({
    'Name': s.name, 'Phone': s.phone || '', 'Department': s.department || '', 'Role': s.role || '',
    'Monthly Salary': s.salary, 'Join Date': s.joinDate ? formatDate(s.joinDate) : '', 'Status': s.isActive ? 'Active' : 'Inactive',
  }))

  if (loading) return <div><AppHeader title="Staff & Salary" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  return (
    <div>
      <AppHeader title="Staff & Salary Management" data={exportData} exportFileName="staff-salary" exportSheetName="Staff" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="border-0 shadow-sm"><CardContent className="p-4 flex items-center gap-3"><Users className="h-8 w-8 text-blue-600" /><div><p className="text-xs text-muted-foreground">Active Staff</p><p className="text-lg font-bold">{activeStaff}</p></div></CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="p-4 flex items-center gap-3"><DollarSign className="h-8 w-8 text-amber-600" /><div><p className="text-xs text-muted-foreground">Monthly Salary Outflow</p><p className="text-lg font-bold">{formatCurrency(totalSalary, tenant?.currency)}</p></div></CardContent></Card>
        </div>

        {canEdit(user?.role || 'VIEW_ONLY') && <Button onClick={() => { resetForm(); setShowForm(true) }} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4 mr-2" />Add Staff</Button>}

        <Card className="border-0 shadow-sm">
          <CardContent className="p-0"><div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Department</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Salary</TableHead><TableHead>Status</TableHead><TableHead>Last Paid</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {staffList.length === 0 ? (<TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No staff members</TableCell></TableRow>) : staffList.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.department || '-'}</TableCell>
                    <TableCell>{s.role || '-'}</TableCell>
                    <TableCell className="text-right">{formatCurrency(s.salary, tenant?.currency)}</TableCell>
                    <TableCell><Badge variant={s.isActive ? 'default' : 'secondary'} className={s.isActive ? 'bg-emerald-600' : ''}>{s.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                    <TableCell>{s.salaryPayments.length > 0 ? formatDate(s.salaryPayments[0].paidDate) : 'Never'}</TableCell>
                    <TableCell className="text-right"><div className="flex justify-end gap-1">
                      {canEdit(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8" title="Pay Salary" onClick={() => { setSelectedStaffId(s.id); setSalaryForm({ month: new Date().toISOString().slice(0, 7), amount: s.salary, paidDate: new Date().toISOString().split('T')[0], paymentMode: 'BANK', notes: '' }); setShowSalary(true) }}><CalendarDays className="h-4 w-4 text-emerald-600" /></Button>}
                      {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(s)}><Pencil className="h-4 w-4" /></Button>}
                      {canManage(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(s.id)}><Trash2 className="h-4 w-4" /></Button>}
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div></CardContent>
        </Card>

        {/* Staff Form */}
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingId ? 'Edit Staff' : 'Add Staff Member'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
                <div><Label>Role/Designation</Label><Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></div>
                <div><Label>Monthly Salary</Label><Input type="number" value={form.salary || ''} onChange={(e) => setForm({ ...form, salary: Number(e.target.value) })} /></div>
                <div><Label>Join Date</Label><Input type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} /></div>
                <div><Label>Aadhaar</Label><Input value={form.aadhaar} onChange={(e) => setForm({ ...form, aadhaar: e.target.value })} /></div>
              </div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave}>{editingId ? 'Update' : 'Save'}</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Salary Payment Dialog */}
        <Dialog open={showSalary} onOpenChange={setShowSalary}>
          <DialogContent>
            <DialogHeader><DialogTitle>Pay Salary</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Month</Label><Input type="month" value={salaryForm.month} onChange={(e) => setSalaryForm({ ...salaryForm, month: e.target.value })} /></div>
                <div><Label>Amount</Label><Input type="number" value={salaryForm.amount || ''} onChange={(e) => setSalaryForm({ ...salaryForm, amount: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Paid Date</Label><Input type="date" value={salaryForm.paidDate} onChange={(e) => setSalaryForm({ ...salaryForm, paidDate: e.target.value })} /></div>
                <div><Label>Payment Mode</Label><Select value={salaryForm.paymentMode} onValueChange={(v) => setSalaryForm({ ...salaryForm, paymentMode: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CASH">Cash</SelectItem><SelectItem value="BANK">Bank Transfer</SelectItem><SelectItem value="CHEQUE">Cheque</SelectItem></SelectContent></Select></div>
              </div>
              <div><Label>Notes</Label><Input value={salaryForm.notes} onChange={(e) => setSalaryForm({ ...salaryForm, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowSalary(false)}>Cancel</Button><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handlePaySalary}>Pay Salary</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
