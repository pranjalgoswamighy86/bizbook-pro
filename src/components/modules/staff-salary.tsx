'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore, canEdit, canCorrect, canManage } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { FingerprintScanner } from '@/components/app/fingerprint-scanner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/formulas'
import { Plus, Pencil, Trash2, Users, DollarSign, CalendarDays, Fingerprint } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

interface StaffMember {
  id: string; name: string; phone: string | null; email: string | null; role: string | null
  department: string | null; salary: number; joinDate: string | null; isActive: boolean
  salaryPayments: Array<{ id: string; month: string; amount: number; paidDate: string; paymentMode: string; status?: string }>
  fingerprintId?: string | null
  biometricType?: string
}

export function StaffSalary() {
  const { tenant, user, searchQuery } = useAppStore()
  const { toast } = useToast()
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showSalary, setShowSalary] = useState(false)
  // v6.28.0: salaryMode controls the two-step flow:
  //   'pay' = direct payment (legacy, Dr Expense / Cr Cash)
  //   'accrue' = Step 1 only (Dr Expense / Cr AP, status=DUE)
  //   'disburse' = Step 2 (Dr AP / Cr Cash, clears a DUE salary)
  const [salaryMode, setSalaryMode] = useState<'pay' | 'accrue' | 'disburse'>('pay')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null)
  // v6.28.0: for disburse mode, the ID of the DUE salary payment to clear
  const [selectedSalaryPaymentId, setSelectedSalaryPaymentId] = useState<string | null>(null)
  const [salaryForm, setSalaryForm] = useState({ month: '', amount: 0, paidDate: new Date().toISOString().split('T')[0], paymentMode: 'BANK', notes: '' })
  const [form, setForm] = useState<{
    name: string; phone: string; email: string; role: string; department: string; salary: number
    joinDate: string; address: string; aadhaar: string; pan: string
    fingerprintId?: string
    biometricType?: string
  }>({
    name: '', phone: '', email: '', role: '', department: '', salary: 0,
    joinDate: new Date().toISOString().split('T')[0], address: '', aadhaar: '', pan: '',
    fingerprintId: undefined,
    biometricType: 'NONE',
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
    // v6.28.0: Branch on salaryMode to call the right API action.
    //   'pay' → direct payment (legacy single-entry: Dr Expense / Cr Cash)
    //   'accrue' → Step 1: Dr Expense / Cr AP, status=DUE, no cash movement
    //   'disburse' → Step 2: Dr AP / Cr Cash, clears a previously-accrued DUE salary
    if (salaryMode === 'accrue') {
      const res = await authFetch('/api/staff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'accrue-salary',
          staffId: selectedStaffId,
          tenantId: tenant.id,
          month: salaryForm.month,
          amount: salaryForm.amount,
          accrualDate: new Date(salaryForm.paidDate).toISOString(),
          notes: salaryForm.notes,
        }),
      })
      if (res.ok) {
        toast({ title: 'Salary accrued', description: `₹${salaryForm.amount} accrued as Payable for ${salaryForm.month}. Mark as Paid when disbursed.` })
        setShowSalary(false); fetchStaff()
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: 'Accrual failed', description: data.error || 'Unknown error', variant: 'destructive' })
      }
    } else if (salaryMode === 'disburse') {
      if (!selectedSalaryPaymentId) {
        toast({ title: 'No salary selected', description: 'Select a DUE salary to disburse.', variant: 'destructive' })
        return
      }
      const res = await authFetch('/api/staff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark-salary-paid',
          salaryPaymentId: selectedSalaryPaymentId,
          tenantId: tenant.id,
          paymentMode: salaryForm.paymentMode,
          paidDate: new Date(salaryForm.paidDate).toISOString(),
          notes: salaryForm.notes,
        }),
      })
      if (res.ok) {
        toast({ title: 'Salary disbursed', description: `Paid via ${salaryForm.paymentMode}. Accounts Payable cleared.` })
        setShowSalary(false); fetchStaff()
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: 'Disbursement failed', description: data.error || 'Unknown error', variant: 'destructive' })
      }
    } else {
      // 'pay' — legacy direct payment
      const res = await authFetch('/api/staff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay-salary', staffId: selectedStaffId, tenantId: tenant.id, ...salaryForm, paidDate: new Date(salaryForm.paidDate).toISOString() }),
      })
      if (res.ok) { toast({ title: 'Salary paid' }); setShowSalary(false); fetchStaff() }
    }
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
                      {canEdit(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8" title="Accrue Salary (Step 1 — record as Payable)" onClick={() => { setSelectedStaffId(s.id); setSelectedSalaryPaymentId(null); setSalaryMode('accrue'); setSalaryForm({ month: new Date().toISOString().slice(0, 7), amount: s.salary, paidDate: new Date().toISOString().split('T')[0], paymentMode: 'BANK', notes: '' }); setShowSalary(true) }}><CalendarDays className="h-4 w-4 text-amber-600" /></Button>}
                      {canEdit(user?.role || 'VIEW_ONLY') && s.salaryPayments.some(p => (p as any).status === 'DUE') && <Button variant="ghost" size="icon" className="h-8 w-8" title="Mark Paid (Step 2 — disburse a DUE salary)" onClick={() => { setSelectedStaffId(s.id); const duePayment = s.salaryPayments.find(p => (p as any).status === 'DUE')!; setSelectedSalaryPaymentId(duePayment.id); setSalaryMode('disburse'); setSalaryForm({ month: duePayment.month, amount: duePayment.amount, paidDate: new Date().toISOString().split('T')[0], paymentMode: 'BANK', notes: '' }); setShowSalary(true) }}><DollarSign className="h-4 w-4 text-emerald-600" /></Button>}
                      {canEdit(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8" title="Pay Salary (direct — single entry)" onClick={() => { setSelectedStaffId(s.id); setSelectedSalaryPaymentId(null); setSalaryMode('pay'); setSalaryForm({ month: new Date().toISOString().slice(0, 7), amount: s.salary, paidDate: new Date().toISOString().split('T')[0], paymentMode: 'BANK', notes: '' }); setShowSalary(true) }}><Plus className="h-4 w-4 text-emerald-600" /></Button>}
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
              {/* v4.67: Fingerprint Scanner (WebAuthn) + v4.154: USB Scanner (Electron) */}
              <div className="border-t pt-3 space-y-2">
                <Label className="text-xs text-muted-foreground">Biometric Authentication (Optional)</Label>

                {/* v4.154: USB Scanner (only shown in Electron desktop app) */}
                {typeof window !== 'undefined' && window.electron?.isElectron && (
                  <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg p-3">
                    <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-2">
                      USB Fingerprint Scanner
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs border-violet-300 text-violet-700 hover:bg-violet-100"
                      onClick={async () => {
                        if (!window.electron) return
                        const sdkInfo = await window.electron.getFingerprintSdkType()
                        if (sdkInfo.sdkType === 'none' || sdkInfo.sdkType === 'webhid') {
                          alert('No USB scanner SDK detected.\n\nTo enable:\n1. Install SecuGen or DigitalPersona SDK\n2. Set FINGERPRINT_SDK env var\n3. Place .node addon in electron/native-addons/')
                          return
                        }
                        const available = await window.electron.isScannerAvailable()
                        if (!available) {
                          alert('No USB scanner detected. Connect a SecuGen Hamster or DigitalPersona U.are.U scanner.')
                          return
                        }
                        // Subscribe to progress updates
                        window.electron.onEnrollProgress(({ sample, total }) => {
                          alert(`Place finger on scanner (${sample}/${total})`)
                        })
                        const result = await window.electron.enrollFingerprint()
                        if (result.success && result.template) {
                          setForm({ ...form, fingerprintId: result.template, biometricType: 'USB_SCANNER' })
                          alert(`✓ Fingerprint enrolled! Quality: ${result.quality}/100. Click Save to store.`)
                        } else {
                          alert(`✗ Enrollment failed: ${result.error}`)
                        }
                      }}
                    >
                      <Fingerprint className="h-3.5 w-3.5 mr-1" /> Enroll via USB Scanner
                    </Button>
                    {form.fingerprintId && (
                      <p className="text-[10px] text-emerald-600 mt-1">✓ Template captured ({form.biometricType === 'USB_SCANNER' ? 'USB Scanner' : 'WebAuthn'}). Click Save to store.</p>
                    )}
                  </div>
                )}

                {/* WebAuthn (works in browser + Electron) */}
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">
                    WebAuthn (Touch ID / Windows Hello)
                  </p>
                  <FingerprintScanner userId={editingId || undefined} userEmail={form.email} buttonText="Register Fingerprint" />
                </div>
              </div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave}>{editingId ? 'Update' : 'Save'}</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Salary Payment Dialog — v6.28.0: supports pay / accrue / disburse modes */}
        <Dialog open={showSalary} onOpenChange={setShowSalary}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {salaryMode === 'accrue' ? 'Accrue Salary (Step 1 — Payable)' :
                 salaryMode === 'disburse' ? 'Mark Salary Paid (Step 2 — Disburse)' :
                 'Pay Salary (Direct)'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {/* v6.28.0: Mode selector so the user can switch between the three flows */}
              <div className="flex gap-2 p-1 bg-muted rounded-lg">
                <button type="button" onClick={() => setSalaryMode('accrue')} className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition ${salaryMode === 'accrue' ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'text-muted-foreground'}`}>1. Accrue</button>
                <button type="button" onClick={() => setSalaryMode('disburse')} className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition ${salaryMode === 'disburse' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'text-muted-foreground'}`}>2. Disburse</button>
                <button type="button" onClick={() => setSalaryMode('pay')} className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition ${salaryMode === 'pay' ? 'bg-blue-100 text-blue-800 border border-blue-300' : 'text-muted-foreground'}`}>Direct Pay</button>
              </div>
              {salaryMode === 'accrue' && (
                <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 p-2 rounded border border-amber-200">
                  Records salary as an Accounts Payable (Creditor). Posts <strong>Dr Salary Expense / Cr Accounts Payable</strong>. No cash leaves the business yet. Use "Disburse" later when you actually pay.
                </p>
              )}
              {salaryMode === 'disburse' && (
                <p className="text-xs text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 p-2 rounded border border-emerald-200">
                  Clears a previously-accrued DUE salary. Posts <strong>Dr Accounts Payable / Cr Cash|Bank</strong> and reduces the staff's Creditor balance.
                </p>
              )}
              {salaryMode === 'pay' && (
                <p className="text-xs text-blue-700 bg-blue-50 dark:bg-blue-950/30 p-2 rounded border border-blue-200">
                  Direct single-entry payment. Posts <strong>Dr Salary Expense / Cr Cash|Bank</strong>. Use for immediate cash payments; use Accrue+Disburse for proper accrual accounting.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Month</Label><Input type="month" value={salaryForm.month} onChange={(e) => setSalaryForm({ ...salaryForm, month: e.target.value })} disabled={salaryMode === 'disburse'} /></div>
                <div><Label>Amount</Label><Input type="number" value={salaryForm.amount || ''} onChange={(e) => setSalaryForm({ ...salaryForm, amount: Number(e.target.value) })} disabled={salaryMode === 'disburse'} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{salaryMode === 'accrue' ? 'Accrual Date' : 'Paid Date'}</Label><Input type="date" value={salaryForm.paidDate} onChange={(e) => setSalaryForm({ ...salaryForm, paidDate: e.target.value })} /></div>
                <div><Label>Payment Mode</Label><Select value={salaryForm.paymentMode} onValueChange={(v) => setSalaryForm({ ...salaryForm, paymentMode: v })} disabled={salaryMode === 'accrue'}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CASH">Cash</SelectItem><SelectItem value="BANK">Bank Transfer</SelectItem><SelectItem value="CHEQUE">Cheque</SelectItem><SelectItem value="UPI">UPI</SelectItem></SelectContent></Select></div>
              </div>
              <div><Label>Notes</Label><Input value={salaryForm.notes} onChange={(e) => setSalaryForm({ ...salaryForm, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSalary(false)}>Cancel</Button>
              <Button className={salaryMode === 'accrue' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'} onClick={handlePaySalary}>
                {salaryMode === 'accrue' ? 'Accrue Salary' : salaryMode === 'disburse' ? 'Mark as Paid' : 'Pay Salary'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
