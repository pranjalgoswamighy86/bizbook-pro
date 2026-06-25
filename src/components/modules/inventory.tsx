'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore, canEdit, canCorrect } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCurrency, formatDate, getDateFilterRange } from '@/lib/formulas'
import { Plus, Pencil, Trash2, AlertTriangle, Package, ArrowUp, ArrowDown, ChefHat, Factory, X, Loader2, Printer, ScanLine } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'
import { BarcodeScanner } from '@/components/app/barcode-scanner'
import { printBarcodeLabel, printBulkBarcodeLabels } from '@/components/app/barcode-label'

interface InventoryItem {
  id: string; name: string; sku: string | null; barcode: string | null; hsnCode: string | null; unit: string
  category: string | null; brand: string | null; itemType: string
  purchasePrice: number; salePrice: number
  mrp: number | null; openingStock: number; currentStock: number; minStock: number
  gstRate: number; value: number
}

interface ProductIngredient {
  id: string
  inventoryItemId: string
  quantity: number
  unit: string
  notes: string | null
  inventoryItem: { name: string; currentStock: number; unit: string; purchasePrice: number }
}

interface Product {
  id: string; name: string; description: string | null; sku: string | null
  category: string | null; salePrice: number; gstRate: number; isActive: boolean
  ingredients: ProductIngredient[]
  createdAt: string; updatedAt: string
}

export function Inventory() {
  const { tenant, user, searchQuery } = useAppStore()
  const { toast } = useToast()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showAdjust, setShowAdjust] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adjustId, setAdjustId] = useState<string | null>(null)
  const [adjustQty, setAdjustQty] = useState(0)
  const [adjustType, setAdjustType] = useState<'in' | 'out'>('in')
  const [totalValue, setTotalValue] = useState(0)
  const [lowStockItems, setLowStockItems] = useState(0)
  const [activeTab, setActiveTab] = useState('raw-materials')

  // Product/BOM states
  const [showProductForm, setShowProductForm] = useState(false)
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [productForm, setProductForm] = useState({
    name: '', description: '', sku: '', category: '', salePrice: 0, gstRate: 18,
  })
  const [bomIngredients, setBomIngredients] = useState<Array<{
    inventoryItemId: string; quantity: number; unit: string; notes: string
  }>>([])

  // Production dialog
  const [showProduce, setShowProduce] = useState(false)
  const [produceProductId, setProduceProductId] = useState<string | null>(null)
  const [produceQty, setProduceQty] = useState(1)
  const [produceCost, setProduceCost] = useState<{ cost: number; ingredients: Array<{ name: string; quantity: number; unit: string; purchasePrice: number; lineCost: number }> } | null>(null)
  const [produceLoading, setProduceLoading] = useState(false)

  const [form, setForm] = useState({
    name: '', sku: '', barcode: '', hsnCode: '', unit: 'PCS', category: '', brand: '',
    purchasePrice: 0, salePrice: 0, mrp: 0, openingStock: 0, currentStock: 0, minStock: 5, gstRate: 18,
    itemType: 'RAW_MATERIAL',
  })

  const fetchItems = useCallback(async () => {
    if (!tenant) return
    const res = await authFetch('/api/inventory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', tenantId: tenant.id, search: searchQuery || undefined }),
    })
    const data = await res.json()
    setItems(data.items || [])
    setTotalValue(data.totalValue || 0)
    setLowStockItems(data.lowStockItems || 0)
    setLoading(false)
  }, [tenant, searchQuery])

  const fetchProducts = useCallback(async () => {
    if (!tenant) return
    const res = await authFetch('/api/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', tenantId: tenant.id, search: searchQuery || undefined }),
    })
    const data = await res.json()
    setProducts(data.products || [])
  }, [tenant, searchQuery])

  useEffect(() => { fetchItems(); fetchProducts() }, [fetchItems, fetchProducts])

  const resetForm = () => {
    setForm({ name: '', sku: '', barcode: '', hsnCode: '', unit: 'PCS', category: '', brand: '', purchasePrice: 0, salePrice: 0, mrp: 0, openingStock: 0, currentStock: 0, minStock: 5, gstRate: 18, itemType: 'RAW_MATERIAL' })
    setEditingId(null)
  }

  const resetProductForm = () => {
    setProductForm({ name: '', description: '', sku: '', category: '', salePrice: 0, gstRate: 18 })
    setBomIngredients([])
    setEditingProductId(null)
  }

  const handleEdit = (item: InventoryItem) => {
    setEditingId(item.id)
    setForm({ name: item.name, sku: item.sku || '', barcode: item.barcode || '', hsnCode: item.hsnCode || '', unit: item.unit, category: item.category || '', brand: item.brand || '', purchasePrice: item.purchasePrice, salePrice: item.salePrice, mrp: item.mrp || 0, openingStock: item.openingStock, currentStock: item.currentStock, minStock: item.minStock, gstRate: item.gstRate, itemType: item.itemType || 'RAW_MATERIAL' })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!tenant) return
    const data = { ...form, value: form.currentStock * form.purchasePrice }
    const res = await authFetch('/api/inventory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingId ? { action: 'update', id: editingId, data, tenantId: tenant.id } : { action: 'create', tenantId: tenant.id, data }),
    })
    if (res.ok) {
      toast({ title: editingId ? 'Item Updated' : 'Item Created', description: `${form.name} saved successfully` })
      setShowForm(false); resetForm(); fetchItems()
    } else {
      const errData = await res.json().catch(() => ({}))
      toast({ title: 'Error', description: errData.error || 'Failed to save item', variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Archive this item?')) return
    const res = await authFetch('/api/inventory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id, tenantId: tenant?.id }),
    })
    if (res.ok) { toast({ title: 'Item Archived', description: 'Item has been soft-deleted.' }); fetchItems() }
    else { toast({ title: 'Error', description: 'Failed to delete item', variant: 'destructive' }) }
  }

  const handleAdjustStock = async () => {
    if (!adjustId || adjustQty <= 0) return
    const res = await authFetch('/api/inventory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'adjust-stock', id: adjustId, quantity: adjustQty, type: adjustType, tenantId: tenant?.id }),
    })
    if (res.ok) { toast({ title: 'Stock adjusted' }); setShowAdjust(false); fetchItems() }
  }

  // Product/BOM handlers
  const handleEditProduct = (product: Product) => {
    setEditingProductId(product.id)
    setProductForm({
      name: product.name, description: product.description || '', sku: product.sku || '',
      category: product.category || '', salePrice: product.salePrice, gstRate: product.gstRate,
    })
    setBomIngredients(product.ingredients.map(ing => ({
      inventoryItemId: ing.inventoryItemId,
      quantity: ing.quantity,
      unit: ing.unit,
      notes: ing.notes || '',
    })))
    setShowProductForm(true)
  }

  const handleSaveProduct = async () => {
    if (!tenant || !productForm.name) return
    if (bomIngredients.length === 0) {
      toast({ title: 'Error', description: 'Add at least one raw material ingredient', variant: 'destructive' })
      return
    }
    const data = { ...productForm, ingredients: bomIngredients }
    const res = await authFetch('/api/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingProductId
        ? { action: 'update', id: editingProductId, data }
        : { action: 'create', tenantId: tenant.id, data }),
    })
    if (res.ok) {
      toast({ title: editingProductId ? 'Product Updated' : 'Product Created' })
      setShowProductForm(false)
      resetProductForm()
      fetchProducts()
      fetchItems() // Refresh inventory too (auto-created FINISHED_PRODUCT item)
    } else {
      const err = await res.json()
      toast({ title: 'Error', description: err.error || 'Failed to save product', variant: 'destructive' })
    }
  }

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('Archive this product and its recipe? The inventory item will be kept.')) return
    const res = await authFetch('/api/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id, tenantId: tenant?.id }),
    })
    if (res.ok) { toast({ title: 'Product Archived' }); fetchProducts(); fetchItems() }
    else { toast({ title: 'Error', description: 'Failed to delete product', variant: 'destructive' }) }
  }

  const handleProduce = async () => {
    if (!tenant || !produceProductId || produceQty <= 0) return
    setProduceLoading(true)
    const res = await authFetch('/api/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'produce', tenantId: tenant.id, productId: produceProductId, quantity: produceQty }),
    })
    if (res.ok) {
      const data = await res.json()
      toast({ title: 'Production Complete', description: `Produced ${produceQty} unit(s). Stock updated.` })
      setShowProduce(false)
      setProduceProductId(null)
      setProduceQty(1)
      setProduceCost(null)
      fetchProducts()
      fetchItems()
    } else {
      const err = await res.json()
      toast({ title: 'Production Failed', description: err.error || 'Insufficient raw materials', variant: 'destructive' })
    }
    setProduceLoading(false)
  }

  const fetchProduceCost = async (productId: string) => {
    if (!tenant) return
    const res = await authFetch('/api/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get-cost', tenantId: tenant.id, productId }),
    })
    if (res.ok) {
      const data = await res.json()
      setProduceCost(data)
    }
  }

  const addBomIngredient = () => {
    setBomIngredients([...bomIngredients, { inventoryItemId: '', quantity: 1, unit: 'PCS', notes: '' }])
  }

  const removeBomIngredient = (idx: number) => {
    setBomIngredients(bomIngredients.filter((_, i) => i !== idx))
  }

  const updateBomIngredient = (idx: number, field: string, value: string | number) => {
    const updated = [...bomIngredients]
    updated[idx] = { ...updated[idx], [field]: value }
    // Auto-fill unit from inventory item
    if (field === 'inventoryItemId') {
      const item = items.find(i => i.id === value)
      if (item) updated[idx].unit = item.unit
    }
    setBomIngredients(updated)
  }

  // Raw materials only (for BOM selection)
  const rawMaterials = items.filter(i => i.itemType === 'RAW_MATERIAL' || !i.itemType)

  const exportData = items.map((i) => ({
    'Name': i.name, 'Type': i.itemType || 'RAW_MATERIAL', 'SKU': i.sku || '', 'HSN': i.hsnCode || '', 'Category': i.category || '', 'Brand': i.brand || '',
    'Unit': i.unit, 'Purchase Price': i.purchasePrice, 'Sale Price': i.salePrice, 'MRP': i.mrp || '',
    'Current Stock': i.currentStock, 'Min Stock': i.minStock, 'Value': i.value, 'GST Rate': i.gstRate,
  }))

  if (loading) return <div><AppHeader title="Inventory Management" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  return (
    <div>
      <AppHeader title="Inventory Management" data={exportData} exportFileName="inventory" exportSheetName="Inventory" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="border-0 shadow-sm"><CardContent className="p-4 flex items-center gap-3"><Package className="h-8 w-8 text-purple-600" /><div><p className="text-xs text-muted-foreground">Total Items</p><p className="text-lg font-bold">{items.length}</p></div></CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="p-4 flex items-center gap-3"><Package className="h-8 w-8 text-emerald-600" /><div><p className="text-xs text-muted-foreground">Total Value</p><p className="text-lg font-bold">{formatCurrency(totalValue, tenant?.currency)}</p></div></CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="p-4 flex items-center gap-3"><AlertTriangle className="h-8 w-8 text-amber-500" /><div><p className="text-xs text-muted-foreground">Low Stock</p><p className="text-lg font-bold text-amber-600">{lowStockItems}</p></div></CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="p-4 flex items-center gap-3"><ChefHat className="h-8 w-8 text-blue-600" /><div><p className="text-xs text-muted-foreground">Products (BOM)</p><p className="text-lg font-bold text-blue-600">{products.length}</p></div></CardContent></Card>
        </div>

        {/* Tabs: Raw Materials / Finished Products (BOM) */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="raw-materials">Raw Materials &amp; Stock</TabsTrigger>
            <TabsTrigger value="products">Products (BOM / Recipes)</TabsTrigger>
          </TabsList>

          {/* ==================== RAW MATERIALS TAB ==================== */}
          <TabsContent value="raw-materials" className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              {canEdit(user?.role || 'VIEW_ONLY') && (
                <Button onClick={() => { resetForm(); setShowForm(true) }} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4 mr-2" />Add Item</Button>
              )}
              {/* v4.110: Print all barcodes bulk button — uses SKU as the barcode value */}
              {items.length > 0 && (
                <Button
                  onClick={() => {
                    const printable = items
                      .filter((i) => (i.sku || '').trim().length > 0)
                      .map((i) => ({
                        name: i.name,
                        barcode: i.sku as string,
                        price: i.salePrice,
                        currency: tenant?.currency,
                      }))
                    if (printable.length === 0) {
                      toast({
                        title: 'No SKUs to print',
                        description: 'Add SKUs to your inventory items first — the SKU is what gets printed as the barcode.',
                        variant: 'destructive',
                        duration: 6000,
                      })
                      return
                    }
                    printBulkBarcodeLabels(printable)
                    toast({ title: `Printing ${printable.length} barcode labels`, duration: 3000 })
                  }}
                  variant="outline"
                  size="sm"
                >
                  <Printer className="h-4 w-4 mr-2" />
                  Print All Barcodes
                </Button>
              )}
            </div>

            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Purch. Price</TableHead>
                      <TableHead className="text-right">Sale Price</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {items.length === 0 ? (
                        <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No inventory items. Add your first item.</TableCell></TableRow>
                      ) : items.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell className="font-medium">{i.name}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={i.itemType === 'FINISHED_PRODUCT' ? 'bg-blue-100 text-blue-700 text-xs' : 'bg-gray-100 text-gray-700 text-xs'}>
                              {i.itemType === 'FINISHED_PRODUCT' ? 'Finished' : 'Raw Material'}
                            </Badge>
                          </TableCell>
                          <TableCell>{i.sku || '-'}</TableCell>
                          <TableCell>{i.category || '-'}</TableCell>
                          <TableCell className="text-right">{formatCurrency(i.purchasePrice, tenant?.currency)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(i.salePrice, tenant?.currency)}</TableCell>
                          <TableCell className="text-right">{i.currentStock} {i.unit}</TableCell>
                          <TableCell className="text-right">{formatCurrency(i.value, tenant?.currency)}</TableCell>
                          <TableCell>
                            {i.currentStock <= i.minStock ? (
                              <Badge variant="destructive" className="text-xs">Low Stock</Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs">In Stock</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {/* v4.110: Print barcode label for this item — uses SKU as the barcode */}
                              {(i.sku || '').trim().length > 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  title={`Print barcode label (SKU: ${i.sku})`}
                                  onClick={() => {
                                    printBarcodeLabel(i.name, i.sku as string, i.salePrice, tenant?.currency)
                                    toast({ title: 'Printing barcode label', description: `SKU: ${i.sku}`, duration: 3000 })
                                  }}
                                >
                                  <Printer className="h-4 w-4 text-blue-600" />
                                </Button>
                              )}
                              {canEdit(user?.role || 'VIEW_ONLY') && (
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setAdjustId(i.id); setAdjustQty(0); setAdjustType('in'); setShowAdjust(true) }}>
                                  <ArrowUp className="h-4 w-4 text-emerald-600" />
                                </Button>
                              )}
                              {canEdit(user?.role || 'VIEW_ONLY') && (
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setAdjustId(i.id); setAdjustQty(0); setAdjustType('out'); setShowAdjust(true) }}>
                                  <ArrowDown className="h-4 w-4 text-orange-600" />
                                </Button>
                              )}
                              {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(i)}><Pencil className="h-4 w-4" /></Button>}
                              {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(i.id)}><Trash2 className="h-4 w-4" /></Button>}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ==================== PRODUCTS / BOM TAB ==================== */}
          <TabsContent value="products" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Define finished products with raw material recipes (Bill of Materials). When you sell a finished product, raw materials are auto-deducted from inventory.</p>
              {canEdit(user?.role || 'VIEW_ONLY') && (
                <Button onClick={() => { resetProductForm(); setShowProductForm(true) }} className="bg-blue-600 hover:bg-blue-700"><ChefHat className="h-4 w-4 mr-2" />Add Product / Recipe</Button>
              )}
            </div>

            {products.length === 0 ? (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-12 text-center">
                  <ChefHat className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <h3 className="font-medium text-lg">No Products Defined Yet</h3>
                  <p className="text-sm text-muted-foreground mt-1">Create products with raw material recipes. When you sell a finished product like a pizza or curry, the raw materials (flour, cheese, vegetables, etc.) will be automatically deducted from inventory.</p>
                  {canEdit(user?.role || 'VIEW_ONLY') && (
                    <Button className="mt-4 bg-blue-600 hover:bg-blue-700" onClick={() => { resetProductForm(); setShowProductForm(true) }}>
                      <Plus className="h-4 w-4 mr-2" />Create Your First Product
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {products.map((product) => {
                  const inventoryItem = items.find(i => i.name.toLowerCase() === product.name.toLowerCase())
                  const totalCost = product.ingredients.reduce((sum, ing) => sum + (ing.quantity * ing.inventoryItem.purchasePrice), 0)
                  return (
                    <Card key={product.id} className="border-0 shadow-sm">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold text-base">{product.name}</h3>
                              <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs">Finished Product</Badge>
                              {!product.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                            </div>
                            {product.description && <p className="text-sm text-muted-foreground mb-2">{product.description}</p>}
                            <div className="flex items-center gap-4 text-sm mb-3">
                              <span>Sale Price: <strong>{formatCurrency(product.salePrice, tenant?.currency)}</strong></span>
                              <span>Production Cost: <strong>{formatCurrency(totalCost, tenant?.currency)}</strong></span>
                              <span>Profit/Unit: <strong className="text-emerald-600">{formatCurrency(product.salePrice - totalCost, tenant?.currency)}</strong></span>
                              {inventoryItem && <span>Stock: <strong>{inventoryItem.currentStock} {inventoryItem.unit}</strong></span>}
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">Recipe (Bill of Materials):</p>
                              {product.ingredients.map((ing, idx) => (
                                <div key={idx} className="flex items-center gap-2 text-sm">
                                  <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                                  <span>{ing.inventoryItem.name}</span>
                                  <span className="text-muted-foreground">{ing.quantity} {ing.unit}</span>
                                  <span className="text-muted-foreground">({formatCurrency(ing.quantity * ing.inventoryItem.purchasePrice, tenant?.currency)})</span>
                                  <span className="text-xs text-muted-foreground">[Stock: {ing.inventoryItem.currentStock} {ing.inventoryItem.unit}]</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 ml-4">
                            {canEdit(user?.role || 'VIEW_ONLY') && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-blue-600 border-blue-200 hover:bg-blue-50"
                                onClick={() => {
                                  setProduceProductId(product.id)
                                  setProduceQty(1)
                                  setProduceCost(null)
                                  fetchProduceCost(product.id)
                                  setShowProduce(true)
                                }}
                              >
                                <Factory className="h-4 w-4 mr-1" />Produce
                              </Button>
                            )}
                            {canCorrect(user?.role || 'VIEW_ONLY') && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditProduct(product)}><Pencil className="h-4 w-4" /></Button>
                            )}
                            {canCorrect(user?.role || 'VIEW_ONLY') && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteProduct(product.id)}><Trash2 className="h-4 w-4" /></Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* ==================== ADD/EDIT INVENTORY ITEM DIALOG ==================== */}
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingId ? 'Edit Item' : 'Add Inventory Item'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {/* v4.91: Item Name with autocomplete suggestions */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Item Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Product name"
                    list="inventory-names-list"
                    autoComplete="off"
                  />
                  {/* Autocomplete suggestions from existing inventory */}
                  <datalist id="inventory-names-list">
                    {items.map(item => (
                      <option key={item.id} value={item.name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <Label>Item Type</Label>
                  <Select value={form.itemType} onValueChange={(val) => setForm({ ...form, itemType: val })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RAW_MATERIAL">Raw Material</SelectItem>
                      <SelectItem value="FINISHED_PRODUCT">Finished Product</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* v4.91: Barcode field — unique product identification number
                  v4.110: Barcode = SKU (per user instruction "barcode is not the name
                         of any product its SKU instead"). The Scan button fills BOTH
                         fields with the scanned value, so they stay in sync. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Barcode (Unique ID)</Label>
                  <div className="flex gap-1">
                    <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value, sku: e.target.value })} placeholder="Scan or enter barcode" />
                    <BarcodeScanner
                      buttonText="Scan"
                      onScan={(code) => {
                        // Scanned value is the SKU — fill both Barcode and SKU fields
                        setForm({ ...form, barcode: code, sku: code })
                        toast({ title: 'Barcode Scanned', description: code, duration: 3000 })
                      }}
                    />
                  </div>
                </div>
                <div>
                  <Label>SKU (used as barcode)</Label>
                  <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value, barcode: e.target.value })} placeholder="Stock keeping unit — printed on barcode label" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>HSN Code</Label><Input value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} placeholder="For GST" /></div>
                <div><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="PCS, KG, LTR" /></div>
                <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Electronics" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Brand</Label><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Purchase Price</Label><Input type="number" value={form.purchasePrice || ''} onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) })} /></div>
                <div><Label>Sale Price</Label><Input type="number" value={form.salePrice || ''} onChange={(e) => setForm({ ...form, salePrice: Number(e.target.value) })} /></div>
                <div><Label>MRP</Label><Input type="number" value={form.mrp || ''} onChange={(e) => setForm({ ...form, mrp: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Opening Stock</Label><Input type="number" value={form.openingStock || ''} onChange={(e) => setForm({ ...form, openingStock: Number(e.target.value) })} /></div>
                <div><Label>Current Stock</Label><Input type="number" value={form.currentStock || ''} onChange={(e) => setForm({ ...form, currentStock: Number(e.target.value) })} /></div>
                <div><Label>Min Stock Alert</Label><Input type="number" value={form.minStock || ''} onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })} /></div>
              </div>
              <div><Label>GST Rate (%)</Label><Input type="number" value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: Number(e.target.value) })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave}>{editingId ? 'Update' : 'Save'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ==================== STOCK ADJUSTMENT DIALOG ==================== */}
        <Dialog open={showAdjust} onOpenChange={setShowAdjust}>
          <DialogContent>
            <DialogHeader><DialogTitle>Adjust Stock - {adjustType === 'in' ? 'Stock In' : 'Stock Out'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button variant={adjustType === 'in' ? 'default' : 'outline'} className={adjustType === 'in' ? 'bg-emerald-600' : ''} onClick={() => setAdjustType('in')}><ArrowUp className="h-4 w-4 mr-1" />Stock In</Button>
                <Button variant={adjustType === 'out' ? 'default' : 'outline'} className={adjustType === 'out' ? 'bg-orange-600' : ''} onClick={() => setAdjustType('out')}><ArrowDown className="h-4 w-4 mr-1" />Stock Out</Button>
              </div>
              <div><Label>Quantity</Label><Input type="number" value={adjustQty || ''} onChange={(e) => setAdjustQty(Number(e.target.value))} min={1} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAdjust(false)}>Cancel</Button>
              <Button className={adjustType === 'in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-orange-600 hover:bg-orange-700'} onClick={handleAdjustStock}>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ==================== ADD/EDIT PRODUCT (BOM) DIALOG ==================== */}
        <Dialog open={showProductForm} onOpenChange={setShowProductForm}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingProductId ? 'Edit Product / Recipe' : 'Add Product / Recipe (Bill of Materials)'}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Define a finished product and the raw materials needed to produce it. When this product is sold, the raw materials will be automatically deducted from inventory.</p>

              <div className="grid grid-cols-2 gap-3">
                <div><Label>Product Name *</Label><Input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="e.g. Margherita Pizza, Chicken Curry" /></div>
                <div><Label>SKU</Label><Input value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} placeholder="Product SKU" /></div>
              </div>
              <div><Label>Description</Label><Input value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} placeholder="Brief description of the product" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Category</Label><Input value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} placeholder="e.g. Pizza, Curry" /></div>
                <div><Label>Sale Price *</Label><Input type="number" value={productForm.salePrice || ''} onChange={(e) => setProductForm({ ...productForm, salePrice: Number(e.target.value) })} /></div>
                <div><Label>GST Rate (%)</Label><Input type="number" value={productForm.gstRate} onChange={(e) => setProductForm({ ...productForm, gstRate: Number(e.target.value) })} /></div>
              </div>

              <Separator />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-base font-semibold">Raw Materials (Recipe / BOM)</Label>
                  <Button variant="outline" size="sm" onClick={addBomIngredient}><Plus className="h-4 w-4 mr-1" />Add Ingredient</Button>
                </div>
                {bomIngredients.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center border rounded-md border-dashed">No ingredients added yet. Click "Add Ingredient" to define the recipe.</p>
                ) : (
                  <div className="space-y-2">
                    {bomIngredients.map((ing, idx) => (
                      <div key={idx} className="flex items-end gap-2 p-2 border rounded-md">
                        <div className="flex-1">
                          <Label className="text-xs">Raw Material</Label>
                          <Select value={ing.inventoryItemId} onValueChange={(val) => updateBomIngredient(idx, 'inventoryItemId', val)}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="Select item" /></SelectTrigger>
                            <SelectContent>
                              {rawMaterials.map((item) => (
                                <SelectItem key={item.id} value={item.id}>{item.name} ({item.currentStock} {item.unit})</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-24">
                          <Label className="text-xs">Qty</Label>
                          <Input type="number" value={ing.quantity || ''} onChange={(e) => updateBomIngredient(idx, 'quantity', Number(e.target.value))} min={0.01} step={0.01} className="h-9" />
                        </div>
                        <div className="w-20">
                          <Label className="text-xs">Unit</Label>
                          <Input value={ing.unit} onChange={(e) => updateBomIngredient(idx, 'unit', e.target.value)} className="h-9" />
                        </div>
                        <div className="w-32">
                          <Label className="text-xs">Notes</Label>
                          <Input value={ing.notes} onChange={(e) => updateBomIngredient(idx, 'notes', e.target.value)} placeholder="Optional" className="h-9" />
                        </div>
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive flex-shrink-0" onClick={() => removeBomIngredient(idx)}><X className="h-4 w-4" /></Button>
                      </div>
                    ))}
                    {/* Cost summary */}
                    <div className="text-sm text-muted-foreground mt-2 p-2 bg-muted rounded-md">
                      <strong>Estimated Production Cost per unit:</strong>{' '}
                      {formatCurrency(
                        bomIngredients.reduce((sum, ing) => {
                          const item = items.find(i => i.id === ing.inventoryItemId)
                          return sum + (item ? ing.quantity * item.purchasePrice : 0)
                        }, 0),
                        tenant?.currency
                      )}
                      {productForm.salePrice > 0 && (
                        <> | <strong>Profit per unit:</strong>{' '}
                        {formatCurrency(
                          productForm.salePrice - bomIngredients.reduce((sum, ing) => {
                            const item = items.find(i => i.id === ing.inventoryItemId)
                            return sum + (item ? ing.quantity * item.purchasePrice : 0)
                          }, 0),
                          tenant?.currency
                        )}</>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowProductForm(false)}>Cancel</Button>
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleSaveProduct}>{editingProductId ? 'Update Product' : 'Create Product'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ==================== PRODUCTION DIALOG ==================== */}
        <Dialog open={showProduce} onOpenChange={setShowProduce}>
          <DialogContent>
            <DialogHeader><DialogTitle>Produce / Manufacture Product</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Convert raw materials into finished product. This will deduct raw materials from inventory and add finished product stock.
              </p>
              <div>
                <Label>Quantity to Produce</Label>
                <Input type="number" value={produceQty} onChange={(e) => setProduceQty(Number(e.target.value))} min={1} />
              </div>
              {produceCost && (
                <div className="space-y-2 p-3 bg-muted rounded-md">
                  <p className="text-sm font-medium">Production Cost Breakdown (per unit):</p>
                  {produceCost.ingredients.map((ing, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span>{ing.name} ({ing.quantity} {ing.unit} x {formatCurrency(ing.purchasePrice, tenant?.currency)})</span>
                      <span>{formatCurrency(ing.lineCost, tenant?.currency)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-bold border-t pt-1 mt-1">
                    <span>Total Cost (x{produceQty}):</span>
                    <span>{formatCurrency(produceCost.cost * produceQty, tenant?.currency)}</span>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowProduce(false)}>Cancel</Button>
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleProduce} disabled={produceLoading}>
                {produceLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Factory className="h-4 w-4 mr-2" />}
                Produce
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

function Separator() {
  return <div className="border-t my-2" />
}
