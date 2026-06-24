'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore, canEdit, canCorrect } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { BarcodeScanner } from '@/components/app/barcode-scanner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatCurrency, formatDate, getDateFilterRange } from '@/lib/formulas'
import { isInterStateSupply } from '@/lib/gst-utils'
import { Plus, Pencil, Trash2, X, ChevronDown, Eye, Loader2, Sparkles } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { PartySuggest } from '@/components/app/party-suggest'
import { ItemSuggest } from '@/components/app/item-suggest'
import { triggerBackupDownload } from '@/hooks/use-excel-backup'
import { authFetch } from '@/lib/auth-fetch'

// ===== ENHANCED ITEM INTERFACE =====
interface TaxEntry {
  name: string       // e.g., "GST", "VAT", "Excise Duty", "Import Duty", "Custom Tax"
  percent: number    // e.g., 18
  percentOn: string  // e.g., "Amount" (base amount), "Amount+GST" (cascading)
  amount: number     // computed
}

interface PurchaseItem {
  name: string
  category: string
  hsn: string
  unit: string
  qty: number
  rate: number
  taxes: TaxEntry[]
  mrp: number
  discount: number
  amount: number       // qty * rate - discount
  totalTax: number     // sum of all tax amounts
  total: number        // amount + totalTax
}

interface Purchase {
  id: string; invoiceNumber: string; date: string; partyName: string; partyAddress: string | null
  partyGst: string | null; items: string; subtotal: number; gstAmount: number; totalAmount: number
  paymentStatus: string; amountPaid: number; notes: string | null; invoiceFile: string | null
  einvoiceIrn: string | null; einvoiceAckNo: string | null; einvoiceAckDate: string | null
  einvoiceQrCodeText: string | null; einvoiceStatus: string
}

const PRESET_TAXES = ['GST', 'CGST', 'SGST', 'IGST', 'VAT', 'Excise Duty', 'Import Duty', 'Cess', 'Surcharge']

const emptyTax = (name = 'GST', percent = 0): TaxEntry => ({
  name, percent, percentOn: 'Amount', amount: 0
})

const emptyItem = (): PurchaseItem => ({
  name: '', category: '', hsn: '', unit: 'PCS', qty: 1, rate: 0,
  taxes: [emptyTax()], mrp: 0, discount: 0, amount: 0, totalTax: 0, total: 0
})

export function PurchaseRegister() {
  const { tenant, user, dateFilter, searchQuery, setView } = useAppStore()
  const isAuthenticated = useAppStore(s => s.isAuthenticated)
  const { toast } = useToast()
  // Note: Invoice file upload has been moved to AI Smart Import module
  const [savedInvoiceFileRef, setSavedInvoiceFileRef] = useState<string | null>(null)
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [viewItem, setViewItem] = useState<Purchase | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const isCashParty = (name: string) => name.trim().toLowerCase() === 'cash'

  const [form, setForm] = useState({
    invoiceNumber: '', date: new Date().toISOString().split('T')[0],
    partyName: 'Cash', partyAddress: '', partyGst: '',
    paymentStatus: 'PAID', amountPaid: 0, notes: '',
  })
  const [items, setItems] = useState<PurchaseItem[]>([emptyItem()])

  const fetchPurchases = useCallback(async () => {
    if (!tenant) return
    try {
      const range = getDateFilterRange(dateFilter)
      const res = await authFetch('/api/purchases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list', tenantId: tenant.id,
          startDate: range.start.toISOString(), endDate: range.end.toISOString(),
          search: searchQuery || undefined
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setPurchases(data.purchases || [])
      }
    } catch {
      // Keep existing data on fetch error - don't clear
    } finally {
      setLoading(false)
    }
  }, [tenant, dateFilter, searchQuery])

  useEffect(() => { fetchPurchases() }, [fetchPurchases])

  // ===== COMPUTED VALUES (must be declared before useEffect that references them) =====
  const subtotal = items.reduce((s, i) => s + i.amount, 0)
  const totalTax = items.reduce((s, i) => s + i.totalTax, 0)
  const totalDiscount = items.reduce((s, i) => s + i.discount, 0)
  const totalAmount = subtotal + totalTax

  // Auto-sync amountPaid for cash purchases when totalAmount changes
  useEffect(() => {
    if (isCashParty(form.partyName)) {
      setForm(prev => ({
        ...prev,
        paymentStatus: 'PAID',
        amountPaid: totalAmount,
      }))
    }
  }, [totalAmount, form.partyName])

  // ===== ITEM CALCULATION ENGINE =====
  const calcItemTotals = (item: PurchaseItem): PurchaseItem => {
    const baseAmount = item.qty * item.rate
    const afterDiscount = baseAmount - item.discount

    // Auto-split GST tax entries into CGST+SGST (intra-state) or IGST (inter-state)
    // In purchases: supplier = party (seller), buyer = tenant (company)
    const supplierGstin = form.partyGst || ''
    const buyerGstin = tenant?.gstNumber || ''
    const interState = isInterStateSupply(supplierGstin, buyerGstin)

    const expandedTaxes: TaxEntry[] = []
    for (const tax of item.taxes) {
      if (tax.name.toLowerCase() === 'gst' && tax.percent > 0) {
        // Split "GST 18%" into CGST 9% + SGST 9% (intra-state) or IGST 18% (inter-state)
        if (interState) {
          expandedTaxes.push({ name: 'IGST', percent: tax.percent, percentOn: 'Amount', amount: 0 })
        } else {
          expandedTaxes.push({ name: 'CGST', percent: tax.percent / 2, percentOn: 'Amount', amount: 0 })
          expandedTaxes.push({ name: 'SGST', percent: tax.percent / 2, percentOn: 'Amount', amount: 0 })
        }
      } else {
        // Already CGST/SGST/IGST or non-GST taxes are kept as-is (backward compatible)
        expandedTaxes.push(tax)
      }
    }

    // Calculate taxes sequentially (some may be cascading)
    let runningBase = afterDiscount
    let totalTax = 0
    const computedTaxes = expandedTaxes.map(tax => {
      const taxBase = tax.percentOn === 'Amount' ? afterDiscount : runningBase
      const taxAmount = taxBase * (tax.percent / 100)
      totalTax += taxAmount
      runningBase += taxAmount // cascading for next tax
      return { ...tax, amount: Math.round(taxAmount * 100) / 100 }
    })

    return {
      ...item,
      amount: Math.round(afterDiscount * 100) / 100,
      taxes: computedTaxes,
      totalTax: Math.round(totalTax * 100) / 100,
      total: Math.round((afterDiscount + totalTax) * 100) / 100
    }
  }

  const updateItem = (index: number, field: string, value: string | number) => {
    setItems(prev => prev.map((item, i) => i === index ? calcItemTotals({ ...item, [field]: value }) : item))
  }

  const updateItemTax = (itemIdx: number, taxIdx: number, field: string, value: string | number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== itemIdx) return item
      const newTaxes = item.taxes.map((t, ti) => ti === taxIdx ? { ...t, [field]: value } : t)
      return calcItemTotals({ ...item, taxes: newTaxes })
    }))
  }

  const addTaxToItem = (itemIdx: number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== itemIdx) return item
      return calcItemTotals({ ...item, taxes: [...item.taxes, emptyTax('GST', 0)] })
    }))
  }

  const removeTaxFromItem = (itemIdx: number, taxIdx: number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== itemIdx) return item
      const newTaxes = item.taxes.filter((_, ti) => ti !== taxIdx)
      return calcItemTotals({ ...item, taxes: newTaxes.length > 0 ? newTaxes : [emptyTax()] })
    }))
  }

  const addItem = () => setItems(prev => [...prev, emptyItem()])
  const removeItem = (index: number) => setItems(prev => prev.filter((_, i) => i !== index))

  const resetForm = () => {
    setForm({
      invoiceNumber: `PUR-${Date.now().toString().slice(-6)}`, date: new Date().toISOString().split('T')[0],
      partyName: 'Cash', partyAddress: '', partyGst: '',
      paymentStatus: 'PAID', amountPaid: 0, notes: '',
    })
    setItems([emptyItem()])
    setEditingId(null)
    setSavedInvoiceFileRef(null)
  }

  const handleEdit = (p: Purchase) => {
    setEditingId(p.id)
    setForm({
      invoiceNumber: p.invoiceNumber, date: new Date(p.date).toISOString().split('T')[0],
      partyName: p.partyName, partyAddress: p.partyAddress || '', partyGst: p.partyGst || '',
      paymentStatus: p.paymentStatus, amountPaid: p.amountPaid, notes: p.notes || '',
    })
    try {
      const parsed = JSON.parse(p.items) as PurchaseItem[]
      setItems(parsed.length > 0 ? parsed.map(item => calcItemTotals(item)) : [emptyItem()])
    } catch {
      setItems([emptyItem()])
    }
    setSavedInvoiceFileRef(p.invoiceFile || null)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!tenant) {
      toast({ title: 'Error', description: 'No business selected. Please refresh and try again.', variant: 'destructive' })
      return
    }

    // Validate required fields
    if (!form.partyName.trim()) {
      toast({ title: 'Validation Error', description: 'Supplier name is required', variant: 'destructive' })
      return
    }

    // Validate date is present
    if (!form.date) {
      toast({ title: 'Validation Error', description: 'Date is required', variant: 'destructive' })
      return
    }

    // Check for at least one valid item (with name or rate)
    const hasValidItem = items.some(item => item.name.trim() || item.rate > 0)
    if (!hasValidItem) {
      toast({ title: 'Validation Error', description: 'At least one item with name and rate is required', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      // Sanitize numeric values to prevent NaN errors that crash Prisma
      const safeNum = (v: unknown, fallback = 0): number => {
        const n = typeof v === 'number' ? v : Number(v)
        return Number.isFinite(n) ? n : fallback
      }

      const payload: Record<string, unknown> = {
        invoiceNumber: form.invoiceNumber || `PUR-${Date.now().toString().slice(-6)}`,
        date: new Date(form.date).toISOString(),
        partyName: form.partyName,
        partyAddress: form.partyAddress || null,
        partyGst: form.partyGst || null,
        paymentStatus: form.paymentStatus || 'UNPAID',
        amountPaid: safeNum(form.amountPaid),
        notes: form.notes || null,
        items: JSON.stringify(items),
        subtotal: safeNum(subtotal),
        gstAmount: safeNum(totalTax),
        totalAmount: safeNum(totalAmount),
        createdBy: user?.id || null,
      }
      // Use filename reference for invoice file (not the massive base64 data)
      if (savedInvoiceFileRef) {
        payload.invoiceFile = savedInvoiceFileRef
      } else if (!editingId) {
        payload.invoiceFile = null
      }
      // If editing and no new file uploaded, don't overwrite the existing invoiceFile

      const res = await authFetch('/api/purchases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { action: 'update', id: editingId, data: payload, tenantId: tenant.id } : { action: 'create', tenantId: tenant.id, data: payload }),
      })
      if (res.ok) {
        const data = await res.json()
        const invMsg = data.inventoryUpdates && data.inventoryUpdates.length > 0
          ? ` | Inventory updated: ${data.inventoryUpdates.join(', ')}`
          : ''
        toast({ title: editingId ? 'Purchase updated' : 'Purchase created', description: `${invMsg || 'Saved successfully'} | Journal entry posted to General Ledger`, duration: 5000 })
        // Auto-trigger Excel backup download after every successful purchase save
        triggerBackupDownload(tenant.id, tenant.name, editingId ? 'purchase:update' : 'purchase:create')
        // Show payable toast for UNPAID/PARTIAL purchases (non-cash parties)
        const savedPaymentStatus = payload.paymentStatus as string
        const savedTotalAmount = payload.totalAmount as number
        const savedPartyName = payload.partyName as string
        if (!isCashParty(savedPartyName) && (savedPaymentStatus === 'UNPAID' || savedPaymentStatus === 'PARTIAL')) {
          const balanceDue = savedPaymentStatus === 'UNPAID' ? savedTotalAmount : savedTotalAmount - (payload.amountPaid as number)
          setTimeout(() => {
            toast({ title: 'Payable Added to Creditors', description: `Payable of ${formatCurrency(balanceDue, tenant?.currency)} added to ${savedPartyName} in Creditors` })
          }, 600)
        }
        setShowForm(false)
        resetForm()
        fetchPurchases()
      } else {
        const errData = await res.json().catch(() => ({}))
        console.error('Save error:', errData)
        // If tenant no longer exists (401), force logout
        if (res.status === 401) {
          toast({ title: 'Session expired', description: errData.error || 'Please log in again.', variant: 'destructive' })
          setTimeout(() => { useAppStore.getState().logout() }, 2000)
        } else {
          toast({ title: 'Error saving purchase', description: errData.error || `Server error (${res.status}). Please try again.`, variant: 'destructive' })
        }
      }
    } catch (err) {
      console.error('Save network error:', err)
      toast({ title: 'Network Error', description: 'Could not connect to server. Please check your connection and try again.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Archive this purchase entry? Stock will be reversed from inventory.')) return
    const res = await authFetch('/api/purchases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id, tenantId: tenant?.id }) })
    if (res.ok) { toast({ title: 'Archived', description: 'Purchase archived. Inventory stock reversed.' }); fetchPurchases() }
  }

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      PAID: 'bg-emerald-100 text-emerald-700',
      PARTIAL: 'bg-blue-100 text-blue-700',
      PENDING: 'bg-amber-100 text-amber-700',
      UNPAID: 'bg-red-100 text-red-700',
    }
    return <Badge variant="outline" className={`${styles[status] || 'bg-gray-100 text-gray-700'} border-0 font-medium`}>{status}</Badge>
  }

  const exportData = purchases.map((p) => ({
    'Invoice #': p.invoiceNumber, 'Date': formatDate(p.date), 'Supplier': p.partyName, 'Address': p.partyAddress || '',
    'GST': p.partyGst || '', 'Subtotal': p.subtotal, 'Tax': p.gstAmount, 'Total': p.totalAmount,
    'Status': p.paymentStatus, 'Paid': p.amountPaid, 'Due': p.totalAmount - p.amountPaid,
  }))

  if (loading) return <div><AppHeader title="Purchase Register" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  return (
    <div>
      <AppHeader title="Purchase Register" data={exportData} exportFileName="purchases" exportSheetName="Purchases" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        <div className="flex gap-2">
          {(user ? canEdit(user.role) : isAuthenticated) && (
            <Button onClick={() => { resetForm(); setShowForm(true) }} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4 mr-2" />New Purchase</Button>
          )}
          <Button variant="outline" onClick={() => setView('ai-import')} className="border-violet-300 text-violet-700 hover:bg-violet-50">
            <Sparkles className="h-4 w-4 mr-2" /> AI Smart Import
          </Button>
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Due</TableHead><TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No purchases found</TableCell></TableRow>
                  ) : purchases.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.invoiceNumber}</TableCell>
                      <TableCell>{formatDate(p.date)}</TableCell>
                      <TableCell>{p.partyName}</TableCell>
                      <TableCell className="text-right">{formatCurrency(p.totalAmount, tenant?.currency)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(p.amountPaid, tenant?.currency)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(p.totalAmount - p.amountPaid, tenant?.currency)}</TableCell>
                      <TableCell>{statusBadge(p.paymentStatus)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewItem(p)}><Eye className="h-4 w-4" /></Button>
                          {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(p)}><Pencil className="h-4 w-4" /></Button>}
                          {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-4 w-4" /></Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* ===== ADD/EDIT PURCHASE DIALOG ===== */}
        <Dialog open={showForm} onOpenChange={(open) => { if (!open && !saving) { setShowForm(false) } }}>
          <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto p-6 sm:p-8">
            <DialogHeader>
              <DialogTitle className="text-lg flex items-center gap-2">
                {editingId ? 'Edit Purchase' : 'New Purchase'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-5">
              {/* Invoice Info Row */}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Invoice Number</Label><Input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} /></div>
                <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              </div>

              {/* Supplier Info */}
              <div className="grid grid-cols-3 gap-3">
                <PartySuggest
                  tenantId={tenant?.id}
                  value={form.partyName}
                  onChange={(val) => {
                    const newForm = { ...form, partyName: val }
                    if (isCashParty(val)) {
                      newForm.paymentStatus = 'PAID'
                      newForm.amountPaid = totalAmount
                    }
                    setForm(newForm)
                  }}
                  onPartySelect={(party) => {
                    const newForm = {
                      ...form,
                      partyName: party.name,
                      partyAddress: party.address || '',
                      partyGst: party.gstNumber || '',
                    }
                    if (isCashParty(party.name)) {
                      newForm.paymentStatus = 'PAID'
                      newForm.amountPaid = totalAmount
                    }
                    setForm(newForm)
                  }}
                  label="Supplier Name"
                  placeholder="Type supplier name... (default: Cash)"
                  required={true}
                  partyType="SUPPLIER"
                />
                <div><Label>Supplier Address</Label><Input value={form.partyAddress} onChange={(e) => setForm({ ...form, partyAddress: e.target.value })} placeholder="Full address" /></div>
                <div><Label>Supplier GST</Label><Input value={form.partyGst} onChange={(e) => setForm({ ...form, partyGst: e.target.value })} placeholder="GSTIN" /></div>
              </div>

              {/* AI Smart Import hint */}
              <div className="border rounded-lg p-3 bg-gradient-to-r from-violet-50/80 to-purple-50/80 dark:from-violet-950/20 dark:to-purple-950/20">
                <p className="text-xs text-muted-foreground">
                  💡 To auto-fill purchase details from an invoice image or PDF, use <strong>AI Smart Import</strong> from the sidebar.
                </p>
              </div>

              {/* ===== ITEMS SECTION ===== */}
              <div>
                <Label className="text-sm font-semibold">Items</Label>
                <div className="mt-2 space-y-3">
                  {items.map((item, idx) => (
                    <div key={idx} className="border rounded-lg p-3 bg-white">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-muted-foreground">Item {idx + 1}</span>
                        {items.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        )}
                      </div>
                      {/* v4.90: Redesigned items layout — matching Sale Register */}
                      <div className="space-y-3 mb-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="sm:col-span-2">
                            <ItemSuggest
                              tenantId={tenant?.id}
                              value={item.name}
                              onChange={(val) => updateItem(idx, 'name', val)}
                              onItemSelect={(inv) => {
                                updateItem(idx, 'name', inv.name)
                                updateItem(idx, 'category', inv.category || '')
                                updateItem(idx, 'hsn', inv.hsnCode || '')
                                updateItem(idx, 'unit', inv.unit)
                                updateItem(idx, 'rate', inv.purchasePrice)
                                updateItem(idx, 'mrp', inv.mrp || 0)
                                if (inv.gstRate > 0 && item.taxes[0]) {
                                  updateItemTax(idx, 0, 'name', 'GST')
                                  updateItemTax(idx, 0, 'percent', inv.gstRate)
                                }
                              }}
                              label="Item Name"
                              placeholder="Type to search inventory..."
                              priceType="purchasePrice"
                            />
                          </div>
                          <div>
                            <Label className="text-sm text-muted-foreground block mb-1.5">Unit</Label>
                            <Select value={item.unit} onValueChange={(v) => updateItem(idx, 'unit', v)}>
                              <SelectTrigger className="h-10 text-base w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="PCS">PCS</SelectItem>
                                <SelectItem value="KG">KG</SelectItem>
                                <SelectItem value="KGS">KGS</SelectItem>
                                <SelectItem value="PKT">PKT</SelectItem>
                                <SelectItem value="LTR">LTR</SelectItem>
                                <SelectItem value="MTR">MTR</SelectItem>
                                <SelectItem value="BOX">BOX</SelectItem>
                                <SelectItem value="DOZEN">DOZEN</SelectItem>
                                <SelectItem value="NOS">NOS</SelectItem>
                                <SelectItem value="SET">SET</SelectItem>
                                <SelectItem value="PAIR">PAIR</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <Label className="text-sm text-muted-foreground block mb-1.5">Category</Label>
                            <Input placeholder="e.g. Electronics" className="h-10 text-base" value={item.category} onChange={(e) => updateItem(idx, 'category', e.target.value)} />
                          </div>
                          <div>
                            <Label className="text-sm text-muted-foreground block mb-1.5">HSN Code</Label>
                            <Input placeholder="HSN/SAC" className="h-10 text-base" value={item.hsn} onChange={(e) => updateItem(idx, 'hsn', e.target.value)} />
                          </div>
                          <div></div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <Label className="text-sm text-muted-foreground block mb-1.5">Quantity</Label>
                            <Input type="number" placeholder="0" className="h-10 text-base" value={item.qty || ''} onChange={(e) => updateItem(idx, 'qty', Number(e.target.value))} />
                          </div>
                          <div>
                            <Label className="text-sm text-muted-foreground block mb-1.5">Rate</Label>
                            <Input type="number" placeholder="0.00" className="h-10 text-base" value={item.rate || ''} onChange={(e) => updateItem(idx, 'rate', Number(e.target.value))} />
                          </div>
                          <div>
                            <Label className="text-sm text-muted-foreground block mb-1.5">MRP</Label>
                            <Input type="number" placeholder="0.00" className="h-10 text-base" value={item.mrp || ''} onChange={(e) => updateItem(idx, 'mrp', Number(e.target.value))} />
                          </div>
                          <div>
                            <Label className="text-sm text-muted-foreground block mb-1.5">Discount</Label>
                            <Input type="number" placeholder="0.00" className="h-10 text-base" value={item.discount || ''} onChange={(e) => updateItem(idx, 'discount', Number(e.target.value))} />
                          </div>
                        </div>
                      </div>

                      {/* Tax Section */}
                      <div className="border-t pt-2 mt-1">
                        <div className="flex items-center justify-between mb-1">
                          <Label className="text-xs font-semibold text-muted-foreground">Tax / Duties</Label>
                          <Button variant="ghost" size="sm" className="h-6 text-xs text-blue-600" onClick={() => addTaxToItem(idx)}>
                            <Plus className="h-3 w-3 mr-1" />Add Tax
                          </Button>
                        </div>
                        {item.taxes.map((tax, tIdx) => (
                          <div key={tIdx} className="grid grid-cols-12 gap-2 items-end mb-1">
                            <div className="col-span-3">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" size="sm" className="w-full justify-between text-xs h-8">
                                    {tax.name || 'Select Tax'}
                                    <ChevronDown className="h-3 w-3 ml-1" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-48 p-1" align="start">
                                  {PRESET_TAXES.map(t => (
                                    <Button key={t} variant="ghost" size="sm" className="w-full justify-start text-xs h-7"
                                      onClick={() => updateItemTax(idx, tIdx, 'name', t)}>{t}</Button>
                                  ))}
                                  <div className="border-t my-1" />
                                  <div className="px-2 py-1">
                                    <Input placeholder="Custom tax name" className="h-7 text-xs"
                                      onKeyDown={(e) => { if (e.key === 'Enter') { updateItemTax(idx, tIdx, 'name', (e.target as HTMLInputElement).value); } }} />
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </div>
                            <div className="col-span-2">
                              <Input type="number" placeholder="%" value={tax.percent || ''} className="h-8 text-xs"
                                onChange={(e) => updateItemTax(idx, tIdx, 'percent', Number(e.target.value))} />
                            </div>
                            <div className="col-span-2">
                              <Select value={tax.percentOn} onValueChange={(v) => updateItemTax(idx, tIdx, 'percentOn', v)}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Amount">% On Amount</SelectItem>
                                  <SelectItem value="Amount+Tax">% On Amount+Tax</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-3 text-xs py-1.5 text-muted-foreground">
                              = {formatCurrency(tax.amount, tenant?.currency)}
                            </div>
                            <div className="col-span-2 flex items-center justify-end">
                              {item.taxes.length > 1 && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeTaxFromItem(idx, tIdx)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Item Total */}
                      <div className="border-t pt-2 mt-1 flex justify-between text-sm">
                        <span className="text-muted-foreground">Amount: {formatCurrency(item.amount, tenant?.currency)}</span>
                        <span className="text-muted-foreground">Tax: {formatCurrency(item.totalTax, tenant?.currency)}</span>
                        <span className="font-semibold">Total: {formatCurrency(item.total, tenant?.currency)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="mt-3" onClick={addItem}><Plus className="h-3 w-3 mr-1" />Add Item</Button>
              </div>

              {/* Summary */}
              <div className="border-t pt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal, tenant?.currency)}</span>
                </div>
                {totalDiscount > 0 && <div className="flex justify-between text-emerald-600"><span>Discount</span><span>-{formatCurrency(totalDiscount, tenant?.currency)}</span></div>}
                <div className="flex justify-between">
                  <span>Tax / Duties</span>
                  <span>{formatCurrency(totalTax, tenant?.currency)}</span>
                </div>
                <div className="flex justify-between font-bold text-base">
                  <span>Total</span>
                  <span>{formatCurrency(totalAmount, tenant?.currency)}</span>
                </div>
              </div>

              {/* Payment */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Payment Status</Label>
                  <Select value={form.paymentStatus} onValueChange={(v) => setForm({ ...form, paymentStatus: v })} disabled={isCashParty(form.partyName)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNPAID">Unpaid</SelectItem>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="PARTIAL">Partial</SelectItem>
                      <SelectItem value="PAID">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                  {isCashParty(form.partyName) && <p className="text-xs text-muted-foreground mt-1">Cash purchases are auto-marked as PAID</p>}
                </div>
                <div>
                  <Label>Amount Paid</Label>
                  <Input
                    type="number"
                    value={isCashParty(form.partyName) ? totalAmount : (form.amountPaid || '')}
                    onChange={(e) => setForm({ ...form, amountPaid: Number(e.target.value) })}
                    disabled={isCashParty(form.partyName)}
                  />
                </div>
              </div>
              <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { if (!saving) setShowForm(false) }} disabled={saving}>Cancel</Button>
              <Button type="button" className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {saving ? 'Saving...' : (editingId ? 'Update' : 'Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== VIEW PURCHASE DIALOG ===== */}
        <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Purchase Invoice - {viewItem?.invoiceNumber}</DialogTitle></DialogHeader>
            {viewItem && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <p><strong>Date:</strong> {formatDate(viewItem.date)}</p>
                  <p><strong>Supplier:</strong> {viewItem.partyName}</p>
                  <p><strong>Address:</strong> {viewItem.partyAddress || 'N/A'}</p>
                  <p><strong>GST:</strong> {viewItem.partyGst || 'N/A'}</p>
                  <p><strong>Status:</strong> {statusBadge(viewItem.paymentStatus)}</p>
                  {viewItem.invoiceFile && <p><strong>Invoice:</strong> <a href={`/api/invoice-file?file=${encodeURIComponent(viewItem.invoiceFile)}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 underline hover:text-emerald-700">View Invoice</a></p>}
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead>HSN</TableHead>
                        <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Discount</TableHead><TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        try {
                          return (JSON.parse(viewItem.items) as PurchaseItem[]).map((item, i) => (
                            <TableRow key={i}>
                              <TableCell>{item.name}</TableCell>
                              <TableCell>{item.category || '-'}</TableCell>
                              <TableCell>{item.hsn || '-'}</TableCell>
                              <TableCell className="text-right">{item.qty} {item.unit}</TableCell>
                              <TableCell className="text-right">{formatCurrency(item.rate, tenant?.currency)}</TableCell>
                              <TableCell className="text-right">{item.discount > 0 ? formatCurrency(item.discount, tenant?.currency) : '-'}</TableCell>
                              <TableCell className="text-right">{formatCurrency(item.amount, tenant?.currency)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(item.totalTax, tenant?.currency)}</TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(item.total, tenant?.currency)}</TableCell>
                            </TableRow>
                          ))
                        } catch { return null }
                      })()}
                    </TableBody>
                  </Table>
                </div>
                <div className="border-t pt-2 space-y-1">
                  <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(viewItem.subtotal, tenant?.currency)}</span></div>
                  <div className="flex justify-between"><span>Tax / Duties</span><span>{formatCurrency(viewItem.gstAmount, tenant?.currency)}</span></div>
                  <div className="flex justify-between font-bold"><span>Grand Total</span><span>{formatCurrency(viewItem.totalAmount, tenant?.currency)}</span></div>
                  <div className="flex justify-between"><span>Amount Paid</span><span>{formatCurrency(viewItem.amountPaid, tenant?.currency)}</span></div>
                  <div className="flex justify-between text-destructive font-semibold"><span>Balance Due</span><span>{formatCurrency(viewItem.totalAmount - viewItem.amountPaid, tenant?.currency)}</span></div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
