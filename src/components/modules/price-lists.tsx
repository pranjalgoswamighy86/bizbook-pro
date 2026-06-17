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
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tag, Loader2, Plus, Trash2, Edit, Star, ShoppingCart, Package } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatCurrency } from '@/lib/formulas'
import { authFetch } from '@/lib/auth-fetch'

interface PriceListItemRecord {
  id: string
  priceListId: string
  inventoryItemId: string
  price: number
  inventoryItem: {
    id: string
    name: string
    sku: string | null
    unit: string
    salePrice: number
  }
}

interface PriceListRecord {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  isActive: boolean
  items: PriceListItemRecord[]
  createdAt: string
}

interface InventoryItemOption {
  id: string
  name: string
  sku: string | null
  unit: string
  salePrice: number
  purchasePrice: number
}

export function PriceLists() {
  const { tenant, user } = useAppStore()
  const { toast } = useToast()
  const [priceLists, setPriceLists] = useState<PriceListRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([])
  const [activeListId, setActiveListId] = useState<string | null>(null)

  // Add/Edit price list dialog
  const [showListDialog, setShowListDialog] = useState(false)
  const [editListId, setEditListId] = useState<string | null>(null)
  const [listForm, setListForm] = useState({ name: '', description: '', isDefault: false })

  // Edit prices dialog
  const [showPricesDialog, setShowPricesDialog] = useState(false)
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [priceEdits, setPriceEdits] = useState<Record<string, number>>({})

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (!tenant) return
    loadPriceLists()
    loadInventoryItems()
  }, [tenant]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadPriceLists = async () => {
    if (!tenant) return
    setLoading(true)
    try {
      const res = await authFetch('/api/price-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', tenantId: tenant.id }),
      })
      if (res.ok) {
        const data = await res.json()
        setPriceLists(data.priceLists)
        if (data.priceLists.length > 0 && !activeListId) {
          const defaultList = data.priceLists.find((l: PriceListRecord) => l.isDefault)
          setActiveListId((defaultList || data.priceLists[0]).id)
        }
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load price lists', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const loadInventoryItems = async () => {
    if (!tenant) return
    try {
      const res = await authFetch('/api/price-lists', {
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

  const handleSaveList = async () => {
    if (!tenant) return
    if (!listForm.name.trim()) {
      toast({ title: 'Name required', description: 'Price list name is required.', variant: 'destructive' })
      return
    }

    try {
      if (editListId) {
        const res = await authFetch('/api/price-lists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update',
            tenantId: tenant.id,
            id: editListId,
            userId: user?.id,
            userName: user?.name,
            data: listForm,
          }),
        })
        if (res.ok) {
          toast({ title: 'Price list updated' })
        } else {
          const err = await res.json()
          toast({ title: 'Error', description: err.error || 'Failed to update', variant: 'destructive' })
          return
        }
      } else {
        const res = await authFetch('/api/price-lists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            tenantId: tenant.id,
            userId: user?.id,
            userName: user?.name,
            data: { ...listForm, items: [] },
          }),
        })
        if (res.ok) {
          toast({ title: 'Price list created' })
        } else {
          const err = await res.json()
          toast({ title: 'Error', description: err.error || 'Failed to create', variant: 'destructive' })
          return
        }
      }
      setShowListDialog(false)
      resetListForm()
      loadPriceLists()
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' })
    }
  }

  const handleDelete = async () => {
    if (!tenant || !deleteId) return
    try {
      const res = await authFetch('/api/price-lists', {
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
        toast({ title: 'Price list deleted' })
        if (activeListId === deleteId) setActiveListId(null)
        setDeleteId(null)
        loadPriceLists()
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete', variant: 'destructive' })
    }
  }

  const openEditPrices = (listId: string) => {
    const list = priceLists.find(l => l.id === listId)
    if (!list) return
    setEditingListId(listId)
    const edits: Record<string, number> = {}
    // Initialize with current prices or default sale prices
    for (const item of inventoryItems) {
      const existingItem = list.items.find(li => li.inventoryItemId === item.id)
      edits[item.id] = existingItem ? existingItem.price : item.salePrice
    }
    setPriceEdits(edits)
    setShowPricesDialog(true)
  }

  const handleSavePrices = async () => {
    if (!tenant || !editingListId) return
    try {
      const prices = Object.entries(priceEdits)
        .filter(([, price]) => price > 0)
        .map(([inventoryItemId, price]) => ({ inventoryItemId, price }))

      const res = await authFetch('/api/price-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-prices',
          tenantId: tenant.id,
          priceListId: editingListId,
          prices,
        }),
      })
      if (res.ok) {
        toast({ title: 'Prices updated' })
        setShowPricesDialog(false)
        loadPriceLists()
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save prices', variant: 'destructive' })
    }
  }

  const openEditList = (list: PriceListRecord) => {
    setEditListId(list.id)
    setListForm({ name: list.name, description: list.description || '', isDefault: list.isDefault })
    setShowListDialog(true)
  }

  const resetListForm = () => {
    setEditListId(null)
    setListForm({ name: '', description: '', isDefault: false })
  }

  const activeList = priceLists.find(l => l.id === activeListId)

  if (loading && priceLists.length === 0) {
    return (
      <div>
        <AppHeader title="Price Lists" />
        <div className="p-6 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      </div>
    )
  }

  return (
    <div>
      <AppHeader title="Price Lists" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        {/* Price List Cards */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Tag className="h-4 w-4 text-emerald-600" />
            Price Lists
          </h3>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-9" onClick={() => { resetListForm(); setShowListDialog(true) }}>
            <Plus className="h-4 w-4 mr-1" /> New Price List
          </Button>
        </div>

        {priceLists.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-12 text-center">
              <Tag className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No price lists yet</p>
              <p className="text-xs text-muted-foreground mt-1">Create a price list to manage different pricing tiers</p>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 mt-4" onClick={() => { resetListForm(); setListForm({ name: 'Retail', description: 'Default retail prices', isDefault: true }); setShowListDialog(true) }}>
                <Plus className="h-4 w-4 mr-1" /> Create Default Price List
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {priceLists.map(list => (
                <Card
                  key={list.id}
                  className={`border-0 shadow-sm cursor-pointer transition-all hover:shadow-md ${activeListId === list.id ? 'ring-2 ring-emerald-500' : ''}`}
                  onClick={() => setActiveListId(list.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{list.name}</p>
                          {list.isDefault && (
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-xs">
                              <Star className="h-3 w-3 mr-0.5" /> Default
                            </Badge>
                          )}
                        </div>
                        {list.description && <p className="text-xs text-muted-foreground mt-0.5">{list.description}</p>}
                        <p className="text-xs text-muted-foreground mt-1">{list.items.length} products</p>
                      </div>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditList(list)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteId(list.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Active List Detail */}
            {activeList && (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      {activeList.isDefault ? <ShoppingCart className="h-4 w-4 text-emerald-600" /> : <Package className="h-4 w-4 text-orange-600" />}
                      {activeList.name} — Product Prices
                    </CardTitle>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs" onClick={() => openEditPrices(activeList.id)}>
                      <Edit className="h-3.5 w-3.5 mr-1" /> Edit Prices
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {activeList.items.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-sm text-muted-foreground">No prices set yet</p>
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => openEditPrices(activeList.id)}>
                        Set Prices
                      </Button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-[50vh] overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead>SKU</TableHead>
                            <TableHead className="text-right">Default Price</TableHead>
                            <TableHead className="text-right">{activeList.name} Price</TableHead>
                            <TableHead className="text-right">Difference</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activeList.items.map(item => {
                            const diff = item.price - item.inventoryItem.salePrice
                            const pctDiff = item.inventoryItem.salePrice > 0 ? ((diff / item.inventoryItem.salePrice) * 100).toFixed(1) : '0'
                            return (
                              <TableRow key={item.id}>
                                <TableCell className="font-medium text-sm">{item.inventoryItem.name}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{item.inventoryItem.sku || '-'}</TableCell>
                                <TableCell className="text-right text-sm">{formatCurrency(item.inventoryItem.salePrice, tenant?.currency)}</TableCell>
                                <TableCell className="text-right text-sm font-semibold">{formatCurrency(item.price, tenant?.currency)}</TableCell>
                                <TableCell className="text-right text-sm">
                                  <span className={diff > 0 ? 'text-red-600' : diff < 0 ? 'text-emerald-600' : 'text-muted-foreground'}>
                                    {diff > 0 ? '+' : ''}{pctDiff}%
                                  </span>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Add/Edit Price List Dialog */}
        <Dialog open={showListDialog} onOpenChange={(open) => { if (!open) { setShowListDialog(false); resetListForm() } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-emerald-600" />
                {editListId ? 'Edit Price List' : 'New Price List'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name *</Label>
                <Input value={listForm.name} onChange={(e) => setListForm({ ...listForm, name: e.target.value })} placeholder="e.g., Retail, Wholesale, Distributor" />
              </div>
              <div>
                <Label>Description</Label>
                <Input value={listForm.description} onChange={(e) => setListForm({ ...listForm, description: e.target.value })} placeholder="Optional description" />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={listForm.isDefault} onCheckedChange={(v) => setListForm({ ...listForm, isDefault: v })} />
                <Label>Set as default price list</Label>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setShowListDialog(false); resetListForm() }}>Cancel</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSaveList}>{editListId ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Prices Dialog */}
        <Dialog open={showPricesDialog} onOpenChange={(open) => { if (!open) setShowPricesDialog(false) }}>
          <DialogContent className="sm:max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-emerald-600" />
                Edit Prices — {priceLists.find(l => l.id === editingListId)?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="overflow-y-auto max-h-[55vh] space-y-2 pr-1">
              {inventoryItems.map(item => (
                <div key={item.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Default: {formatCurrency(item.salePrice, tenant?.currency)} {item.sku ? `· ${item.sku}` : ''}
                    </p>
                  </div>
                  <div className="w-32 flex-shrink-0">
                    <Label className="text-xs">₹ Price</Label>
                    <Input
                      type="number"
                      value={priceEdits[item.id] ?? ''}
                      onChange={(e) => setPriceEdits({ ...priceEdits, [item.id]: parseFloat(e.target.value) || 0 })}
                      className="h-8 text-sm"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowPricesDialog(false)}>Cancel</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSavePrices}>Save Prices</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <Dialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null) }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Price List</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">Are you sure you want to delete this price list? All prices in this list will be removed.</p>
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
