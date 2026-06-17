'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Clock, Loader2, Plus, AlertTriangle, XCircle, AlertCircle, Info, Trash2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatDate } from '@/lib/formulas'
import { authFetch } from '@/lib/auth-fetch'

interface BatchRecord {
  id: string
  batchNumber: string
  manufacturingDate: string | null
  expiryDate: string | null
  quantity: number
  supplier: string | null
  notes: string | null
  isActive: boolean
  expiryStatus: string
  inventoryItem: {
    id: string
    name: string
    sku: string | null
    unit: string
  }
}

interface BatchSummary {
  total: number
  expired: number
  critical: number
  nearExpiry60: number
  nearExpiry90: number
  valid: number
}

interface InventoryItemOption {
  id: string
  name: string
  sku: string | null
  unit: string
}

export function BatchExpiry() {
  const { tenant, user } = useAppStore()
  const { toast } = useToast()
  const [batches, setBatches] = useState<BatchRecord[]>([])
  const [summary, setSummary] = useState<BatchSummary>({ total: 0, expired: 0, critical: 0, nearExpiry60: 0, nearExpiry90: 0, valid: 0 })
  const [loading, setLoading] = useState(true)
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([])

  // Filters
  const [expiryFilter, setExpiryFilter] = useState<string>('all')
  const [productFilter, setProductFilter] = useState<string>('all')

  // Add/Edit dialog
  const [showDialog, setShowDialog] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({
    inventoryItemId: '',
    batchNumber: '',
    manufacturingDate: '',
    expiryDate: '',
    quantity: '',
    supplier: '',
    notes: '',
  })

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (!tenant) return
    loadBatches()
    loadInventoryItems()
  }, [tenant, expiryFilter, productFilter])

  const loadBatches = async () => {
    if (!tenant) return
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        action: 'list',
        tenantId: tenant.id,
      }
      if (expiryFilter !== 'all') body.expiryStatus = expiryFilter
      if (productFilter !== 'all') body.productId = productFilter

      const res = await authFetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        setBatches(data.batches)
        setSummary(data.summary)
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load batches', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const loadInventoryItems = async () => {
    if (!tenant) return
    try {
      const res = await authFetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inventory-items', tenantId: tenant.id }),
      })
      if (res.ok) {
        const data = await res.json()
        setInventoryItems(data.items)
      }
    } catch {
      console.error('Failed to load inventory items')
    }
  }

  const handleSave = async () => {
    if (!tenant) return
    if (!form.inventoryItemId || !form.batchNumber) {
      toast({ title: 'Required fields missing', description: 'Product and batch number are required.', variant: 'destructive' })
      return
    }

    try {
      if (editId) {
        const res = await authFetch('/api/batches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update',
            tenantId: tenant.id,
            id: editId,
            userId: user?.id,
            userName: user?.name,
            data: form,
          }),
        })
        if (res.ok) {
          toast({ title: 'Batch updated' })
        } else {
          const err = await res.json()
          toast({ title: 'Error', description: err.error || 'Failed to update batch', variant: 'destructive' })
          return
        }
      } else {
        const res = await authFetch('/api/batches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            tenantId: tenant.id,
            userId: user?.id,
            userName: user?.name,
            data: form,
          }),
        })
        if (res.ok) {
          toast({ title: 'Batch added' })
        } else {
          const err = await res.json()
          toast({ title: 'Error', description: err.error || 'Failed to add batch', variant: 'destructive' })
          return
        }
      }
      setShowDialog(false)
      resetForm()
      loadBatches()
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' })
    }
  }

  const handleDelete = async () => {
    if (!tenant || !deleteId) return
    try {
      const res = await authFetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          tenantId: tenant.id,
          id: deleteId,
          userId: user?.id,
          userName: user?.name,
        }),
      })
      if (res.ok) {
        toast({ title: 'Batch deleted' })
        setDeleteId(null)
        loadBatches()
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete batch', variant: 'destructive' })
    }
  }

  const openEditDialog = (batch: BatchRecord) => {
    setEditId(batch.id)
    setForm({
      inventoryItemId: batch.inventoryItem.id,
      batchNumber: batch.batchNumber,
      manufacturingDate: batch.manufacturingDate ? batch.manufacturingDate.slice(0, 10) : '',
      expiryDate: batch.expiryDate ? batch.expiryDate.slice(0, 10) : '',
      quantity: batch.quantity.toString(),
      supplier: batch.supplier || '',
      notes: batch.notes || '',
    })
    setShowDialog(true)
  }

  const resetForm = () => {
    setEditId(null)
    setForm({ inventoryItemId: '', batchNumber: '', manufacturingDate: '', expiryDate: '', quantity: '', supplier: '', notes: '' })
  }

  const getExpiryBadge = (status: string) => {
    switch (status) {
      case 'expired':
        return <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"><XCircle className="h-3 w-3 mr-1" />Expired</Badge>
      case 'critical':
        return <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"><AlertTriangle className="h-3 w-3 mr-1" />{'<30d'}</Badge>
      case 'near-expiry-60':
        return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"><AlertCircle className="h-3 w-3 mr-1" />{'<60d'}</Badge>
      case 'near-expiry-90':
        return <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"><Info className="h-3 w-3 mr-1" />{'<90d'}</Badge>
      default:
        return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Valid</Badge>
    }
  }

  const getRowStyle = (status: string) => {
    if (status === 'expired') return 'bg-red-50/50 dark:bg-red-950/20'
    if (status === 'critical') return 'bg-red-50/30 dark:bg-red-950/10'
    if (status === 'near-expiry-60') return 'bg-amber-50/30 dark:bg-amber-950/10'
    return ''
  }

  if (loading && batches.length === 0) {
    return (
      <div>
        <AppHeader title="Batch & Expiry" />
        <div className="p-6 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      </div>
    )
  }

  return (
    <div>
      <AppHeader title="Batch & Expiry" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Total Batches</p>
              <p className="text-2xl font-bold">{summary.total}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => setExpiryFilter(expiryFilter === 'expired' ? 'all' : 'expired')}>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Expired</p>
              <p className="text-2xl font-bold text-red-600">{summary.expired}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => setExpiryFilter(expiryFilter === 'critical' ? 'all' : 'critical')}>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">{'<30 Days'}</p>
              <p className="text-2xl font-bold text-red-500">{summary.critical}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => setExpiryFilter(expiryFilter === 'near-expiry' ? 'all' : 'near-expiry')}>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Near Expiry</p>
              <p className="text-2xl font-bold text-amber-600">{summary.nearExpiry60 + summary.nearExpiry90}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => setExpiryFilter('all')}>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Valid</p>
              <p className="text-2xl font-bold text-emerald-600">{summary.valid}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Actions */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
                <Select value={expiryFilter} onValueChange={setExpiryFilter}>
                  <SelectTrigger className="h-9 text-sm w-full sm:w-44">
                    <SelectValue placeholder="Expiry Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="critical">Critical (&lt;30d)</SelectItem>
                    <SelectItem value="near-expiry">Near Expiry (30-90d)</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={productFilter} onValueChange={setProductFilter}>
                  <SelectTrigger className="h-9 text-sm w-full sm:w-44">
                    <SelectValue placeholder="All Products" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Products</SelectItem>
                    {inventoryItems.map(item => (
                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 h-9"
                onClick={() => { resetForm(); setShowDialog(true) }}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Batch
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Batches Table */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-600" />
              Batch Inventory
            </CardTitle>
          </CardHeader>
          <CardContent>
            {batches.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No batches found</p>
                <p className="text-xs text-muted-foreground mt-1">Add batches to track expiry dates for your inventory</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Batch No.</TableHead>
                      <TableHead>Mfg. Date</TableHead>
                      <TableHead>Expiry Date</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-24">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map((batch) => (
                      <TableRow key={batch.id} className={getRowStyle(batch.expiryStatus)}>
                        <TableCell className="font-medium text-sm">{batch.inventoryItem.name}</TableCell>
                        <TableCell className="text-sm font-mono">{batch.batchNumber}</TableCell>
                        <TableCell className="text-sm">{batch.manufacturingDate ? formatDate(batch.manufacturingDate) : '-'}</TableCell>
                        <TableCell className="text-sm">{batch.expiryDate ? formatDate(batch.expiryDate) : '-'}</TableCell>
                        <TableCell className="text-right text-sm">{batch.quantity} {batch.inventoryItem.unit}</TableCell>
                        <TableCell className="text-sm">{batch.supplier || '-'}</TableCell>
                        <TableCell>{getExpiryBadge(batch.expiryStatus)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEditDialog(batch)}>Edit</Button>
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => setDeleteId(batch.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add/Edit Dialog */}
        <Dialog open={showDialog} onOpenChange={(open) => { if (!open) { setShowDialog(false); resetForm() } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-emerald-600" />
                {editId ? 'Edit Batch' : 'Add New Batch'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Product *</Label>
                <Select value={form.inventoryItemId} onValueChange={(v) => setForm({ ...form, inventoryItemId: v })} disabled={!!editId}>
                  <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>
                    {inventoryItems.map(item => (
                      <SelectItem key={item.id} value={item.id}>{item.name}{item.sku ? ` (${item.sku})` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Batch Number *</Label>
                <Input value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} placeholder="e.g., B2024-001" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Manufacturing Date</Label>
                  <Input type="date" value={form.manufacturingDate} onChange={(e) => setForm({ ...form, manufacturingDate: e.target.value })} />
                </div>
                <div>
                  <Label>Expiry Date</Label>
                  <Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Quantity</Label>
                  <Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" />
                </div>
                <div>
                  <Label>Supplier</Label>
                  <Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="Supplier name" />
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setShowDialog(false); resetForm() }}>Cancel</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave}>{editId ? 'Update' : 'Add Batch'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null) }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Batch</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">Are you sure you want to delete this batch? This action cannot be undone.</p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
