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
import { Plus, Pencil, Trash2, Eye, ChevronDown, X, Loader2, CheckCircle2, Printer, Package, FileCheck, Sparkles } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { PartySuggest } from '@/components/app/party-suggest'
import { ItemSuggest } from '@/components/app/item-suggest'
import { triggerBackupDownload } from '@/hooks/use-excel-backup'
import { authFetch } from '@/lib/auth-fetch'

// ===== ENHANCED ITEM INTERFACE =====
interface TaxEntry {
  name: string
  percent: number
  percentOn: string  // "Amount" or "Amount+Tax"
  amount: number
}

interface SaleItem {
  name: string
  category: string
  hsn: string
  unit: string
  qty: number
  rate: number
  taxes: TaxEntry[]
  mrp: number
  discount: number
  amount: number
  totalTax: number
  total: number
  itemType?: string
  // v4.65: Item type for sale items
  saleItemType?: 'RETAIL_PRODUCT' | 'FINISHED_PRODUCT' | 'SERVICE'
}

interface Sale {
  id: string; invoiceNumber: string; date: string; partyName: string; partyAddress: string | null
  partyGst: string | null; items: string; subtotal: number; gstAmount: number; totalAmount: number
  paymentStatus: string; paymentMode: string | null; invoiceStatus: string; upiAmount: number; amountPaid: number; amountReceived: number; notes: string | null; invoiceFile: string | null; createdBy: string | null
  einvoiceIrn: string | null; einvoiceAckNo: string | null; einvoiceAckDate: string | null
  einvoiceQrCodeText: string | null; einvoiceStatus: string
}

const PRESET_TAXES = ['GST', 'CGST', 'SGST', 'IGST', 'VAT', 'Excise Duty', 'Import Duty', 'Cess', 'Surcharge']

const emptyTax = (name = 'GST', percent = 0): TaxEntry => ({
  name, percent, percentOn: 'Amount', amount: 0
})

const emptyItem = (): SaleItem => ({
  name: '', category: '', hsn: '', unit: 'PCS', qty: 1, rate: 0,
  taxes: [emptyTax()], mrp: 0, discount: 0, amount: 0, totalTax: 0, total: 0,
  // v4.66: Default to Retail Product — inventory will be deducted on sale.
  // 'FINISHED_PRODUCT' triggers BOM raw-material deduction.
  // 'SERVICE' skips all inventory operations (e.g., BizBook Pro subscription, consulting).
  saleItemType: 'RETAIL_PRODUCT',
})

// v4.66: Item type labels for UI display
const SALE_ITEM_TYPE_LABELS: Record<NonNullable<SaleItem['saleItemType']>, string> = {
  RETAIL_PRODUCT: 'Retail Product',
  FINISHED_PRODUCT: 'Finished Product',
  SERVICE: 'Service',
}

export function SaleRegister() {
  const { tenant, user, dateFilter, searchQuery, setView } = useAppStore()
  const isAuthenticated = useAppStore(s => s.isAuthenticated)
  const { toast } = useToast()
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [viewItem, setViewItem] = useState<Sale | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [justSavedSale, setJustSavedSale] = useState<Sale | null>(null)
  // Note: Invoice file upload has been moved to AI Smart Import module
  const [savedInvoiceFileRef, setSavedInvoiceFileRef] = useState<string | null>(null)

  const [form, setForm] = useState({
    invoiceNumber: '', date: new Date().toISOString().split('T')[0],
    partyName: 'Cash', partyAddress: '', partyGst: '',
    paymentStatus: 'RECEIVED', amountPaid: 0, amountReceived: 0, notes: '',
    // v4.61: Payment Option dropdown
    paymentMode: 'CASH' as 'CASH' | 'UPI' | 'CARD' | 'PART_PAYMENT' | 'OTHERS',
    // v4.62: Part payment — multiple payment methods simultaneously
    ppCash: 0,      // amount paid via Cash
    ppCard: 0,      // amount paid via Card
    ppUpi: 0,       // amount paid via UPI
    ppOther: 0,     // amount paid via Other method
    ppCredit: 0,    // remaining credit (NOT applicable if customer name is "Cash")
    ppOtherRemarks: '', // remarks when ppOther > 0
    paymentRemarks: '',
  })
  const [items, setItems] = useState<SaleItem[]>([emptyItem()])
  const [finishedProductNames, setFinishedProductNames] = useState<string[]>([])

  const fetchSales = useCallback(async () => {
    if (!tenant) return
    try {
      const range = getDateFilterRange(dateFilter)
      const res = await authFetch('/api/sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', tenantId: tenant.id, startDate: range.start.toISOString(), endDate: range.end.toISOString(), search: searchQuery || undefined }),
      })
      if (res.ok) {
        const data = await res.json()
        setSales(data.sales || [])
      }
    } catch {
      // Keep existing data on fetch error
    } finally {
      setLoading(false)
    }
  }, [tenant, dateFilter, searchQuery])

  useEffect(() => { fetchSales() }, [fetchSales])

  // Fetch finished product names for BOM badge detection
  useEffect(() => {
    if (!tenant) return
    const fetchFinishedProducts = async () => {
      try {
        const res = await authFetch('/api/inventory', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', tenantId: tenant.id }),
        })
        if (res.ok) {
          const data = await res.json()
          const names = (data.items || [])
            .filter((item: { itemType: string }) => item.itemType === 'FINISHED_PRODUCT')
            .map((item: { name: string }) => item.name.toLowerCase())
          setFinishedProductNames(names)
        }
      } catch { /* non-critical */ }
    }
    fetchFinishedProducts()
  }, [tenant])

  // ===== COMPUTED VALUES (must be declared before useEffect that references them) =====
  const subtotal = items.reduce((s, i) => s + i.amount, 0)
  const totalTax = items.reduce((s, i) => s + i.totalTax, 0)
  const totalDiscount = items.reduce((s, i) => s + i.discount, 0)
  const totalAmount = subtotal + totalTax

  // v4.62.1: Auto-set payment for Cash sales — Total Amount = Amount Received, Balance Due = 0
  useEffect(() => {
    const isCash = form.partyName.trim().toLowerCase() === 'cash'
    if (isCash) {
      const currentTotal = totalAmount
      setForm(prev => {
        // Force paymentMode to CASH, full amount received, status RECEIVED
        if (prev.paymentMode === 'CASH' && prev.paymentStatus === 'RECEIVED' && prev.amountReceived === currentTotal) return prev
        return {
          ...prev,
          paymentMode: 'CASH',
          paymentStatus: 'RECEIVED',
          amountReceived: currentTotal,
          amountPaid: currentTotal,
          // Reset part payment fields
          ppCash: 0, ppCard: 0, ppUpi: 0, ppOther: 0, ppCredit: 0, ppOtherRemarks: '',
        }
      })
    }
  }, [form.partyName, totalAmount])

  // ===== ITEM CALCULATION ENGINE =====
  const calcItemTotals = (item: SaleItem): SaleItem => {
    const baseAmount = item.qty * item.rate
    const afterDiscount = baseAmount - item.discount

    // Auto-split GST tax entries into CGST+SGST (intra-state) or IGST (inter-state)
    // In sales: supplier = tenant (company), buyer = customer (party)
    const supplierGstin = tenant?.gstNumber || ''
    const buyerGstin = form.partyGst || ''
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

    let runningBase = afterDiscount
    let totalTax = 0
    const computedTaxes = expandedTaxes.map(tax => {
      const taxBase = tax.percentOn === 'Amount' ? afterDiscount : runningBase
      const taxAmount = taxBase * (tax.percent / 100)
      totalTax += taxAmount
      runningBase += taxAmount
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
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item
      const updated = { ...item, [field]: value }
      // Auto-detect itemType when name changes (v4.66: do NOT override SERVICE — user explicitly chose it)
      if (field === 'name' && typeof value === 'string') {
        if (updated.saleItemType !== 'SERVICE') {
          updated.itemType = finishedProductNames.includes(value.toLowerCase()) ? 'FINISHED_PRODUCT' : undefined
          // Auto-set saleItemType to FINISHED_PRODUCT if name matches a known BOM product
          if (finishedProductNames.includes(value.toLowerCase())) {
            updated.saleItemType = 'FINISHED_PRODUCT'
          } else if (updated.saleItemType === 'FINISHED_PRODUCT' && !finishedProductNames.includes(value.toLowerCase())) {
            // Reset to default if name no longer matches a BOM product
            updated.saleItemType = 'RETAIL_PRODUCT'
          }
        }
      }
      return calcItemTotals(updated)
    }))
  }

  // v4.66: Update item type — when user switches to SERVICE, clear BOM badge and inventory-related cues
  const updateItemType = (index: number, newType: 'RETAIL_PRODUCT' | 'FINISHED_PRODUCT' | 'SERVICE') => {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item
      const updated: SaleItem = { ...item, saleItemType: newType }
      // Clear BOM badge for SERVICE items; auto-set BOM badge for FINISHED_PRODUCT only if name matches
      if (newType === 'SERVICE') {
        updated.itemType = undefined
      } else if (newType === 'FINISHED_PRODUCT') {
        // If name matches a known finished product, mark it; otherwise still allow (user explicit choice)
        updated.itemType = item.name && finishedProductNames.includes(item.name.toLowerCase())
          ? 'FINISHED_PRODUCT'
          : 'FINISHED_PRODUCT'
      } else {
        // RETAIL_PRODUCT — auto-detect based on name
        updated.itemType = item.name && finishedProductNames.includes(item.name.toLowerCase())
          ? 'FINISHED_PRODUCT'
          : undefined
      }
      return calcItemTotals(updated)
    }))
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
      invoiceNumber: `INV-${Date.now().toString().slice(-6)}`, date: new Date().toISOString().split('T')[0],
      partyName: 'Cash', partyAddress: '', partyGst: '',
      paymentStatus: 'RECEIVED', amountPaid: 0, amountReceived: 0, notes: '',
      paymentMode: 'CASH', ppCash: 0, ppCard: 0, ppUpi: 0, ppOther: 0, ppCredit: 0, ppOtherRemarks: '', paymentRemarks: '',
    })
    setItems([emptyItem()])
    setEditingId(null)
    setSavedInvoiceFileRef(null)
  }

  // Normalize payment status for backward compat (UNPAID→PENDING, PAID→RECEIVED)
  const normalizeStatus = (status: string): string => {
    if (status === 'UNPAID') return 'PENDING'
    if (status === 'PAID') return 'RECEIVED'
    return status
  }

  const statusLabel = (status: string): string => {
    const normalized = normalizeStatus(status)
    const labels: Record<string, string> = { PENDING: 'Pending', PARTIAL: 'Partial', RECEIVED: 'Received' }
    return labels[normalized] || status
  }

  const handleEdit = (sale: Sale) => {
    setEditingId(sale.id)
    const normalizedStatus = normalizeStatus(sale.paymentStatus)
    setForm({
      invoiceNumber: sale.invoiceNumber, date: new Date(sale.date).toISOString().split('T')[0],
      partyName: sale.partyName, partyAddress: sale.partyAddress || '', partyGst: sale.partyGst || '',
      paymentStatus: normalizedStatus, amountPaid: sale.amountPaid, amountReceived: sale.amountReceived || sale.amountPaid, notes: sale.notes || '',
      // v4.66: Preserve payment-related fields on edit (previously lost, causing TS/runtime issues)
      paymentMode: 'CASH',
      ppCash: 0, ppCard: 0, ppUpi: 0, ppOther: 0, ppCredit: 0, ppOtherRemarks: '', paymentRemarks: '',
    })
    try {
      const parsed = JSON.parse(sale.items) as SaleItem[]
      // v4.66: Backfill saleItemType for legacy items (default to RETAIL_PRODUCT)
      const normalized = parsed.length > 0 ? parsed.map(item => ({
        ...item,
        saleItemType: item.saleItemType || (item.itemType === 'FINISHED_PRODUCT' ? 'FINISHED_PRODUCT' : 'RETAIL_PRODUCT'),
      })) : [emptyItem()]
      setItems(normalized.map(item => calcItemTotals(item)))
    } catch {
      setItems([emptyItem()])
    }
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!tenant) {
      toast({ title: 'Error', description: 'No business selected. Please refresh and try again.', variant: 'destructive' })
      return
    }

    // Validate required fields
    if (!form.partyName.trim()) {
      toast({ title: 'Validation Error', description: 'Customer name is required', variant: 'destructive' })
      return
    }
    const hasValidItem = items.some(item => item.name.trim() || item.rate > 0)
    if (!hasValidItem) {
      toast({ title: 'Validation Error', description: 'At least one item with name and rate is required', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      // v4.62: Calculate payment based on paymentMode
      let finalAmountReceived = 0
      let finalPaymentStatus = form.paymentStatus
      let finalNotes = form.notes || ''

      if (form.paymentMode === 'CASH' || form.paymentMode === 'UPI' || form.paymentMode === 'CARD') {
        finalAmountReceived = totalAmount
        finalPaymentStatus = 'RECEIVED'
      } else if (form.paymentMode === 'PART_PAYMENT') {
        // v4.62: Multiple payment methods — sum all paid amounts
        const cashPaid = Number(form.ppCash) || 0
        const cardPaid = Number(form.ppCard) || 0
        const upiPaid = Number(form.ppUpi) || 0
        const otherPaid = Number(form.ppOther) || 0
        finalAmountReceived = cashPaid + cardPaid + upiPaid + otherPaid

        // Credit = remaining amount (only if customer is NOT "Cash")
        const isCashCustomer = form.partyName.trim().toLowerCase() === 'cash'
        const creditAmount = isCashCustomer ? 0 : Math.max(0, totalAmount - finalAmountReceived)

        // If credit > 0, status is PARTIAL; if everything paid, RECEIVED
        if (finalAmountReceived >= totalAmount) {
          finalPaymentStatus = 'RECEIVED'
        } else if (finalAmountReceived > 0) {
          finalPaymentStatus = 'PARTIAL'
        } else {
          finalPaymentStatus = 'PENDING'
        }

        // Build payment details note
        const paymentParts: string[] = []
        if (cashPaid > 0) paymentParts.push(`Cash: ${cashPaid}`)
        if (cardPaid > 0) paymentParts.push(`Card: ${cardPaid}`)
        if (upiPaid > 0) paymentParts.push(`UPI: ${upiPaid}`)
        if (otherPaid > 0) paymentParts.push(`Other: ${otherPaid}`)
        if (creditAmount > 0) paymentParts.push(`Credit: ${creditAmount}`)
        if (form.ppOtherRemarks) paymentParts.push(`Remarks: ${form.ppOtherRemarks}`)
        if (paymentParts.length > 0) {
          finalNotes = `[Payment: ${paymentParts.join(', ')}]${finalNotes ? ' | ' + finalNotes : ''}`
        }
      } else if (form.paymentMode === 'OTHERS') {
        finalAmountReceived = totalAmount
        finalPaymentStatus = 'RECEIVED'
        if (form.paymentRemarks) {
          finalNotes = `[Payment: ${form.paymentRemarks}]${finalNotes ? ' | ' + finalNotes : ''}`
        }
      }

      const payload: Record<string, unknown> = {
        invoiceNumber: form.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`,
        date: new Date(form.date).toISOString(),
        partyName: form.partyName,
        partyAddress: form.partyAddress || null,
        partyGst: form.partyGst || null,
        paymentStatus: finalPaymentStatus,
        paymentMode: form.paymentMode,
        // v4.106: Save as QUOTATION by default, can be confirmed later
        invoiceStatus: 'QUOTATION',
        // v4.106: Save UPI amount for QR code
        upiAmount: form.paymentMode === 'UPI' ? totalAmount : (form.paymentMode === 'PART_PAYMENT' ? (Number(form.ppUpi) || 0) : 0),
        amountPaid: finalAmountReceived,
        amountReceived: finalAmountReceived,
        notes: finalNotes || null,
        items: JSON.stringify(items),
        subtotal: Number.isFinite(subtotal) ? subtotal : 0,
        gstAmount: Number.isFinite(totalTax) ? totalTax : 0,
        totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
        createdBy: user?.id || null,
      }
      if (savedInvoiceFileRef) {
        payload.invoiceFile = savedInvoiceFileRef
      } else if (!editingId) {
        payload.invoiceFile = null
      }

      const res = await authFetch('/api/sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { action: 'update', id: editingId, data: payload, tenantId: tenant.id } : { action: 'create', tenantId: tenant.id, data: payload }),
      })
      if (res.ok) {
        const data = await res.json()
        const invMsg = data.inventoryUpdates && data.inventoryUpdates.length > 0
          ? ` | Inventory updated: ${data.inventoryUpdates.join(', ')}`
          : ''
        const jeMsg = data.warnings || data.journalEntryPosted ? ' | Journal entry posted to General Ledger' : ''
        toast({ title: editingId ? 'Sale updated' : 'Sale created', description: `Invoice ${form.invoiceNumber}${invMsg}${jeMsg}`, duration: 5000 })
        // Auto-trigger Excel backup download after every successful sale save
        triggerBackupDownload(tenant.id, tenant.name, editingId ? 'sale:update' : 'sale:create')
        // Build a Sale object from the saved data for Print Invoice
        const savedSale: Sale = {
          id: data.sale?.id || '',
          invoiceNumber: form.invoiceNumber,
          date: new Date(form.date).toISOString(),
          partyName: form.partyName,
          partyAddress: form.partyAddress || null,
          partyGst: form.partyGst || null,
          items: JSON.stringify(items),
          subtotal: subtotal,
          gstAmount: totalTax,
          totalAmount: totalAmount,
          paymentStatus: form.paymentStatus,
          paymentMode: form.paymentMode,
          invoiceStatus: 'QUOTATION',
          upiAmount: form.paymentMode === 'UPI' ? totalAmount : (form.paymentMode === 'PART_PAYMENT' ? (Number(form.ppUpi) || 0) : 0),
          amountPaid: form.amountReceived || form.amountPaid || 0,
          amountReceived: form.amountReceived || 0,
          notes: form.notes || null,
          invoiceFile: savedInvoiceFileRef || null,
          einvoiceIrn: null,
          einvoiceAckNo: null,
          einvoiceAckDate: null,
          einvoiceQrCodeText: null,
          einvoiceStatus: 'PENDING',
          createdBy: user?.id || null,
        }
        setJustSavedSale(savedSale)
        setShowForm(false)
        resetForm()
        fetchSales()
      } else {
        const errData = await res.json().catch(() => ({}))
        console.error('Save sale error:', errData)
        // If tenant no longer exists (401), force logout
        if (res.status === 401) {
          toast({ title: 'Session expired', description: errData.error || 'Please log in again.', variant: 'destructive' })
          setTimeout(() => { useAppStore.getState().logout() }, 2000)
        } else {
          toast({ title: 'Error saving sale', description: errData.error || `Server error (${res.status}). Please try again.`, variant: 'destructive' })
        }
      }
    } catch (err) {
      console.error('Save network error:', err)
      toast({ title: 'Network Error', description: 'Could not connect to server. Please check your connection and try again.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }



  // ===== PRINT INVOICE =====
  const handleGenerateEinvoice = async (sale: Sale) => {
    if (!tenant) return
    try {
      const res = await authFetch('/api/einvoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-payload', tenantId: tenant.id, saleId: sale.id }),
      })
      const data = await res.json()
      if (res.ok) {
        // Auto-update the sale's e-invoice status to GENERATED locally
        // (The actual IRN/AckNo/AckDate come from IRP after the user submits the payload)
        try {
          await authFetch('/api/einvoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update-status',
              tenantId: tenant.id,
              saleId: sale.id,
              irn: data.irnHash,
              status: 'GENERATED',
            }),
          })
          // Refresh sales list to show the green checkmark
          fetchSales()
        } catch {
          // Non-fatal — the payload was generated, status update can be retried
          console.warn('Failed to auto-update e-invoice status')
        }

        // Show the e-invoice JSON in a new window for the user to submit to IRP
        const einvoiceWindow = window.open('', '_blank', 'width=900,height=700')
        if (einvoiceWindow) {
          einvoiceWindow.document.write(`<!DOCTYPE html><html><head><title>E-Invoice - ${sale.invoiceNumber}</title>
          <style>body{font-family:monospace;padding:20px;font-size:12px;}pre{background:#f5f5f5;padding:15px;border-radius:8px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;}h2{color:#10b981;margin-bottom:10px;}.info{margin-bottom:15px;padding:10px;background:#f0fdf4;border-radius:6px;border:1px solid #10b981;}.step{margin:10px 0;padding:10px;background:#fef3c7;border-radius:6px;border-left:4px solid #f59e0b;}</style></head><body>
          <h2>GST E-Invoice Payload (INV-01 Schema)</h2>
          <div class="info"><strong>Invoice:</strong> ${sale.invoiceNumber} | <strong>IRN Hash:</strong> ${data.irnHash?.slice(0, 16)}... | <strong>Generated:</strong> ${new Date().toLocaleString()}</div>
          <div class="step"><strong>Next steps:</strong>
            <ol style="margin:8px 0 0 20px;padding:0;">
              <li>Copy the JSON below</li>
              <li>Log in to your IRP/GSP portal (e.g., NIC, Clear, Master India)</li>
              <li>Submit the JSON to generate the official IRN</li>
              <li>Copy the IRN, Ack No, and Ack Date from the IRP response</li>
              <li>Return to BizBook Pro and update the e-invoice status with those values</li>
            </ol>
          </div>
          <pre>${JSON.stringify(data.payload, null, 2)}</pre>
          <div style="margin-top:15px;"><button onclick="navigator.clipboard.writeText(document.querySelector('pre').textContent);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy JSON',2000)" style="padding:8px 20px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;">Copy JSON</button></div>
          </body></html>`)
          einvoiceWindow.document.close()
        }
        toast({ title: 'E-Invoice Payload Generated', description: 'Submit the JSON to your IRP/GSP portal to get the official IRN' })
      } else {
        toast({ title: 'E-Invoice Error', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to generate e-invoice payload', variant: 'destructive' })
    }
  }

  const handlePrintInvoice = (sale: Sale) => {
    // v5.0: Single-click print. Paper size from localStorage (default A4).
    // To switch paper: change `bizbook-paper-pref` in Settings (future)
    // or call handlePrintInvoice(sale, 'thermal') explicitly.
    // Hidden iframe — no new browser tab.
    const token = useAppStore.getState().sessionToken
    const paper = (typeof window !== 'undefined' && localStorage.getItem('bizbook-paper-pref')) || 'a4'
    const url = `/invoice-print/${sale.id}?paper=${paper}&t=${Date.now()}${token ? '&token=' + encodeURIComponent(token) : ''}`
    let iframe = document.getElementById('bizbook-print-iframe') as HTMLIFrameElement | null
    if (!iframe) {
      iframe = document.createElement('iframe')
      iframe.id = 'bizbook-print-iframe'
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
      document.body.appendChild(iframe)
    }
    iframe.onload = () => {
      const cw = iframe!.contentWindow
      if (!cw) return
      cw.focus()
      setTimeout(() => { try { cw.print() } catch (e) { console.error(e) } }, 400)
    }
    iframe.src = url
  }


  const handleDelete = async (id: string) => {
    if (!confirm('Archive this sale entry? Stock will be reversed in inventory.')) return
    const res = await authFetch('/api/sales', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id, tenantId: tenant?.id }),
    })
    if (res.ok) { toast({ title: 'Sale archived', description: 'Inventory stock reversed.' }); fetchSales() }
  }

  const statusBadge = (status: string) => {
    const normalized = normalizeStatus(status)
    const styles: Record<string, string> = {
      PENDING: 'bg-amber-100 text-amber-700',
      PARTIAL: 'bg-blue-100 text-blue-700',
      RECEIVED: 'bg-emerald-100 text-emerald-700',
    }
    return <Badge variant="outline" className={styles[normalized] || 'bg-gray-100 text-gray-700'}>{statusLabel(status)}</Badge>
  }

  const exportData = sales.map((s) => ({
    'Invoice #': s.invoiceNumber, 'Date': formatDate(s.date), 'Customer': s.partyName, 'Address': s.partyAddress || '',
    'GST': s.partyGst || '', 'Subtotal': s.subtotal, 'Tax': s.gstAmount, 'Total': s.totalAmount,
    'Status': statusLabel(s.paymentStatus), 'Received': s.amountReceived || s.amountPaid, 'Due': s.totalAmount - (s.amountReceived || s.amountPaid),
    'Notes': s.notes || '',
  }))

  if (loading) return <div><AppHeader title="Sale Register" /><div className="p-6"><p className="text-muted-foreground">Loading...</p></div></div>

  return (
    <div>
      <AppHeader title="Sale Register" data={exportData} exportFileName="sales-register" exportSheetName="Sales" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        <div className="flex gap-2">
          {(user ? canEdit(user.role) : isAuthenticated) && (
            <Button onClick={() => { resetForm(); setShowForm(true) }} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="h-4 w-4 mr-2" /> New Sale
            </Button>
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
                    <TableHead>Invoice #</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead>
                    <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Due</TableHead><TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No sales found. Click &quot;New Sale&quot; to add one.</TableCell></TableRow>
                  ) : sales.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        {s.invoiceNumber}
                        {s.einvoiceStatus === 'GENERATED' && <span title="E-Invoice Generated" className="ml-1 text-emerald-600">✓</span>}
                        {s.invoiceStatus === 'QUOTATION' && <span className="ml-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">Quotation</span>}
                      </TableCell>
                      <TableCell>{formatDate(s.date)}</TableCell>
                      <TableCell>{s.partyName}</TableCell>
                      <TableCell className="text-right">{formatCurrency(s.totalAmount, tenant?.currency)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(s.amountReceived || s.amountPaid, tenant?.currency)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(s.totalAmount - (s.amountReceived || s.amountPaid), tenant?.currency)}</TableCell>
                      <TableCell>{statusBadge(s.paymentStatus)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Print Invoice" onClick={() => handlePrintInvoice(s)}><Printer className="h-4 w-4" /></Button>
                          {s.partyGst && <Button variant="ghost" size="icon" className="h-8 w-8" title="Generate E-Invoice" onClick={() => handleGenerateEinvoice(s)}><FileCheck className="h-4 w-4" /></Button>}
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewItem(s)}><Eye className="h-4 w-4" /></Button>
                          {/* v4.106: Show Confirm button for Quotation sales */}
                          {s.invoiceStatus === 'QUOTATION' && canEdit(user?.role || 'VIEW_ONLY') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={(s.partyName || '').trim().toLowerCase() === 'cash' ? 'Cannot confirm Cash sale — edit customer name first' : 'Confirm Sale'}
                              disabled={(s.partyName || '').trim().toLowerCase() === 'cash'}
                              onClick={async () => {
                                // v4.160: Cash customer rule — block confirmation in UI
                                if ((s.partyName || '').trim().toLowerCase() === 'cash') {
                                  toast({
                                    title: 'Cannot Confirm',
                                    description: 'Edit the sale and enter the customer\'s real name before confirming.',
                                    variant: 'destructive',
                                  })
                                  return
                                }
                                const res = await authFetch('/api/sales', {
                                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ action: 'confirm-sale', id: s.id, tenantId: tenant?.id }),
                                })
                                if (res.ok) { toast({ title: 'Sale Confirmed', description: 'Tax Invoice locked.' }); fetchSales() }
                                else {
                                  const errData = await res.json().catch(() => ({}))
                                  toast({ title: 'Confirm Failed', description: errData.error || 'Failed', variant: 'destructive' })
                                }
                              }}
                            >
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            </Button>
                          )}
                          {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(s)}><Pencil className="h-4 w-4" /></Button>}
                          {canCorrect(user?.role || 'VIEW_ONLY') && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(s.id)}><Trash2 className="h-4 w-4" /></Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* ===== ADD/EDIT SALE DIALOG ===== */}
        <Dialog open={showForm} onOpenChange={(open) => { if (!open && !saving) { setShowForm(false) } }}>
          <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-lg">{editingId ? 'Edit Sale' : 'New Sale Invoice'}</DialogTitle></DialogHeader>
            <div className="space-y-5">
              {/* Invoice Info */}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Invoice Number</Label><Input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} /></div>
                <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              </div>

              {/* Customer Info */}
              <div className="grid grid-cols-3 gap-3">
                <PartySuggest
                  tenantId={tenant?.id}
                  value={form.partyName}
                  onChange={(val) => setForm({ ...form, partyName: val })}
                  onPartySelect={(party) => {
                    setForm({
                      ...form,
                      partyName: party.name,
                      partyAddress: party.address || '',
                      partyGst: party.gstNumber || '',
                    })
                  }}
                  label="Customer Name"
                  placeholder="Type customer name... (default: Cash)"
                  required={true}
                  partyType="CUSTOMER"
                />
                <div><Label>Customer Address</Label><Input value={form.partyAddress} onChange={(e) => setForm({ ...form, partyAddress: e.target.value })} placeholder="Full address" /></div>
                <div><Label>Customer GST</Label><Input value={form.partyGst} onChange={(e) => setForm({ ...form, partyGst: e.target.value })} placeholder="Optional" /></div>
              </div>

              {/* AI Smart Import hint */}
              <div className="border rounded-lg p-3 bg-gradient-to-r from-violet-50/80 to-purple-50/80 dark:from-violet-950/20 dark:to-purple-950/20">
                <p className="text-xs text-muted-foreground">
                  💡 To auto-fill sale details from an invoice image or PDF, use <strong>AI Smart Import</strong> from the sidebar.
                </p>
              </div>

              {/* ===== ITEMS SECTION ===== */}
              <div>
                {/* v4.111: Bulk Scan button at the top of the Items section.
                    User can rapidly scan multiple barcodes one after another —
                    each scan looks up the inventory item by SKU and adds a new
                    pre-filled row. Closes the scanner only when the user clicks
                    Done or Escape. */}
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <Label className="text-sm font-semibold">Items</Label>
                  <BarcodeScanner
                    buttonText="Scan Barcode to Add Item"
                    continuous={true}
                    onScan={async (code) => {
                      if (!tenant) return
                      try {
                        const res = await authFetch('/api/inventory', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'list', tenantId: tenant.id, search: code }),
                        })
                        if (!res.ok) return
                        const data = await res.json()
                        const match = (data.items || []).find(
                          (inv: { sku?: string | null; barcode?: string | null }) =>
                            (inv.sku && inv.sku.toLowerCase() === code.toLowerCase()) ||
                            (inv.barcode && inv.barcode.toLowerCase() === code.toLowerCase())
                        ) || (data.items || [])[0]
                        if (match) {
                          // Build a new item with the matched item's details pre-filled,
                          // then run it through calcItemTotals so amount/tax/total are correct.
                          const base = emptyItem()
                          base.name = match.name
                          base.category = match.category || ''
                          base.hsn = match.hsnCode || ''
                          base.unit = match.unit
                          base.rate = match.salePrice
                          base.mrp = match.mrp || 0
                          if (match.gstRate > 0) {
                            base.taxes = [{ ...emptyTax('GST', match.gstRate) }]
                          }
                          // Auto-detect BOM item type (same logic as updateItem)
                          if (finishedProductNames.includes(match.name.toLowerCase())) {
                            base.saleItemType = 'FINISHED_PRODUCT'
                            base.itemType = 'FINISHED_PRODUCT'
                          }
                          const finalItem = calcItemTotals(base)
                          setItems(prev => [...prev, finalItem])
                          toast({
                            title: `Added: ${match.name}`,
                            description: `SKU: ${match.sku || code} · ₹${match.salePrice}`,
                            duration: 2000,
                          })
                        } else {
                          toast({
                            title: 'No item matches this barcode',
                            description: `Scanned "${code}" — no inventory item has this SKU. Add it to inventory first.`,
                            variant: 'destructive',
                            duration: 5000,
                          })
                        }
                      } catch {
                        toast({ title: 'Lookup failed', variant: 'destructive' })
                      }
                    }}
                  />
                </div>
                <div className="mt-2 space-y-3">
                  {items.map((item, idx) => (
                    <div key={idx} className="border rounded-lg p-3 bg-white">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-muted-foreground">Item {idx + 1}</span>
                        {items.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        )}
                      </div>
                      {/* v4.95: Responsive layout — stacks on mobile, 2-3 cols on desktop */}
                      <div className="space-y-3 mb-3">
                        {/* Row 1: Item Name (full width on mobile) + Item Type */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="sm:col-span-2">
                            {/* v4.110: Scan Barcode button — scans SKU/barcode, looks up inventory item, auto-fills row */}
                            <div className="flex gap-1.5 items-end">
                              <div className="flex-1">
                                <ItemSuggest
                                  tenantId={tenant?.id}
                                  value={item.name}
                                  onChange={(val) => updateItem(idx, 'name', val)}
                                  onItemSelect={(inv) => {
                                    updateItem(idx, 'name', inv.name)
                                    updateItem(idx, 'category', inv.category || '')
                                    updateItem(idx, 'hsn', inv.hsnCode || '')
                                    updateItem(idx, 'unit', inv.unit)
                                    updateItem(idx, 'rate', inv.salePrice)
                                    updateItem(idx, 'mrp', inv.mrp || 0)
                                    if (inv.gstRate > 0 && item.taxes[0]) {
                                      updateItemTax(idx, 0, 'name', 'GST')
                                      updateItemTax(idx, 0, 'percent', inv.gstRate)
                                    }
                                  }}
                                  label="Item Name"
                                  placeholder="Type to search inventory..."
                                  priceType="salePrice"
                                />
                              </div>
                              <BarcodeScanner
                                buttonText="Scan"
                                onScan={async (code) => {
                                  if (!tenant) return
                                  try {
                                    // Look up inventory item by scanned SKU/barcode
                                    const res = await authFetch('/api/inventory', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ action: 'list', tenantId: tenant.id, search: code }),
                                    })
                                    if (!res.ok) return
                                    const data = await res.json()
                                    const match = (data.items || []).find(
                                      (inv: { sku?: string | null; barcode?: string | null }) =>
                                        (inv.sku && inv.sku.toLowerCase() === code.toLowerCase()) ||
                                        (inv.barcode && inv.barcode.toLowerCase() === code.toLowerCase())
                                    ) || (data.items || [])[0]
                                    if (match) {
                                      // Reuse the same fill logic as ItemSuggest's onItemSelect
                                      updateItem(idx, 'name', match.name)
                                      updateItem(idx, 'category', match.category || '')
                                      updateItem(idx, 'hsn', match.hsnCode || '')
                                      updateItem(idx, 'unit', match.unit)
                                      updateItem(idx, 'rate', match.salePrice)
                                      updateItem(idx, 'mrp', match.mrp || 0)
                                      if (match.gstRate > 0 && item.taxes[0]) {
                                        updateItemTax(idx, 0, 'name', 'GST')
                                        updateItemTax(idx, 0, 'percent', match.gstRate)
                                      }
                                      toast({ title: 'Item found', description: `${match.name} (SKU: ${match.sku || code})`, duration: 3000 })
                                    } else {
                                      toast({
                                        title: 'No item matches this barcode',
                                        description: `Scanned "${code}" but no inventory item has this SKU or barcode. Add the item to inventory first.`,
                                        variant: 'destructive',
                                        duration: 6000,
                                      })
                                    }
                                  } catch {
                                    toast({ title: 'Lookup failed', variant: 'destructive' })
                                  }
                                }}
                              />
                            </div>
                            {item.saleItemType !== 'SERVICE' && (item.itemType === 'FINISHED_PRODUCT' || (item.name && finishedProductNames.includes(item.name.toLowerCase()))) && (
                              <span className="inline-flex items-center gap-1 mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                <Package className="h-3 w-3" /> Includes raw materials
                              </span>
                            )}
                          </div>
                          <div>
                            <Label className="text-sm text-muted-foreground block mb-1.5">Item Type</Label>
                            <Select
                              value={item.saleItemType || 'RETAIL_PRODUCT'}
                              onValueChange={(v: 'RETAIL_PRODUCT' | 'FINISHED_PRODUCT' | 'SERVICE') => updateItemType(idx, v)}
                            >
                              <SelectTrigger className="h-10 text-sm w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="RETAIL_PRODUCT">Retail Product</SelectItem>
                                <SelectItem value="FINISHED_PRODUCT">Finished Product</SelectItem>
                                <SelectItem value="SERVICE">Service</SelectItem>
                              </SelectContent>
                            </Select>
                            {item.saleItemType === 'SERVICE' && (
                              <span className="inline-flex items-center gap-1 mt-1 text-xs text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">
                                <Sparkles className="h-3 w-3" /> No stock
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Row 2: Category, HSN, Unit */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <Label className="text-sm text-muted-foreground block mb-1.5">Category</Label>
                            <Input placeholder="e.g. Electronics" className="h-10" value={item.category} onChange={(e) => updateItem(idx, 'category', e.target.value)} />
                          </div>
                          <div>
                            <Label className="text-sm text-muted-foreground block mb-1.5">HSN Code</Label>
                            <Input placeholder="HSN/SAC" className="h-10" value={item.hsn} onChange={(e) => updateItem(idx, 'hsn', e.target.value)} />
                          </div>
                          <div>
                            <Label className="text-sm text-muted-foreground block mb-1.5">Unit</Label>
                            <Select value={item.unit} onValueChange={(v) => updateItem(idx, 'unit', v)}>
                              <SelectTrigger className="h-10 text-sm w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="PCS">PCS</SelectItem>
                                <SelectItem value="KG">KG</SelectItem>
                                <SelectItem value="LTR">LTR</SelectItem>
                                <SelectItem value="MTR">MTR</SelectItem>
                                <SelectItem value="BOX">BOX</SelectItem>
                                <SelectItem value="DOZEN">DOZEN</SelectItem>
                                <SelectItem value="NOS">NOS</SelectItem>
                                <SelectItem value="SET">SET</SelectItem>
                                <SelectItem value="PAIR">PAIR</SelectItem>
                                <SelectItem value="HRS">HRS</SelectItem>
                                <SelectItem value="JOB">JOB</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                      {/* Row 3: Qty, Rate, MRP, Discount */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                        <div>
                          <Label className="text-sm text-muted-foreground block mb-1.5">Quantity</Label>
                          <Input type="number" placeholder="Qty" className="h-10" value={item.qty || ''} onChange={(e) => updateItem(idx, 'qty', Number(e.target.value))} />
                        </div>
                        <div>
                          <Label className="text-sm text-muted-foreground block mb-1.5">Rate</Label>
                          <Input type="number" placeholder="Rate" className="h-10" value={item.rate || ''} onChange={(e) => updateItem(idx, 'rate', Number(e.target.value))} />
                        </div>
                        <div>
                          <Label className="text-sm text-muted-foreground block mb-1.5">MRP</Label>
                          <Input type="number" placeholder="MRP" className="h-10" value={item.mrp || ''} onChange={(e) => updateItem(idx, 'mrp', Number(e.target.value))} />
                        </div>
                        <div>
                          <Label className="text-sm text-muted-foreground block mb-1.5">Discount</Label>
                          <Input type="number" placeholder="Discount" className="h-10" value={item.discount || ''} onChange={(e) => updateItem(idx, 'discount', Number(e.target.value))} />
                        </div>
                      </div>

                      {/* Tax Section — v4.95 responsive */}
                      <div className="border-t pt-3 mt-2">
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm font-semibold text-muted-foreground">Tax / Duties</Label>
                          <Button variant="ghost" size="sm" className="h-8 text-sm text-blue-600 hover:bg-blue-50" onClick={() => addTaxToItem(idx)}>
                            <Plus className="h-4 w-4 mr-1" />Add Tax
                          </Button>
                        </div>
                        {item.taxes.map((tax, tIdx) => (
                          <div key={tIdx} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center mb-2 p-2 bg-muted/30 rounded-lg">
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
                <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(subtotal, tenant?.currency)}</span></div>
                {totalDiscount > 0 && <div className="flex justify-between text-emerald-600"><span>Discount</span><span>-{formatCurrency(totalDiscount, tenant?.currency)}</span></div>}
                <div className="flex justify-between"><span>Tax / Duties</span><span>{formatCurrency(totalTax, tenant?.currency)}</span></div>
                <div className="flex justify-between font-bold text-base"><span>Total</span><span>{formatCurrency(totalAmount, tenant?.currency)}</span></div>
              </div>

              {/* v4.61: Payment Option dropdown — CASH, UPI, CARD, PART PAYMENT, OTHERS */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Payment Option</Label>
                  <Select
                    value={form.paymentMode}
                    onValueChange={(v: 'CASH' | 'UPI' | 'CARD' | 'PART_PAYMENT' | 'OTHERS') => {
                      const newForm: typeof form = { ...form, paymentMode: v }
                      if (v === 'CASH' || v === 'UPI' || v === 'CARD' || v === 'OTHERS') {
                        newForm.paymentStatus = 'RECEIVED'
                        newForm.amountReceived = totalAmount
                        newForm.amountPaid = totalAmount
                      } else if (v === 'PART_PAYMENT') {
                        newForm.paymentStatus = 'PARTIAL'
                        // v4.62: Reset all part-payment fields when switching to PART_PAYMENT
                        newForm.ppCash = 0
                        newForm.ppCard = 0
                        newForm.ppUpi = 0
                        newForm.ppOther = 0
                        newForm.ppCredit = 0
                        newForm.ppOtherRemarks = ''
                      }
                      setForm(newForm)
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CASH">Cash</SelectItem>
                      <SelectItem value="UPI">UPI</SelectItem>
                      <SelectItem value="CARD">Card</SelectItem>
                      <SelectItem value="PART_PAYMENT">Part Payment</SelectItem>
                      <SelectItem value="OTHERS">Others</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* v4.62: Part Payment — multiple payment methods simultaneously */}
                {form.paymentMode === 'PART_PAYMENT' && (() => {
                  const isCashCustomer = form.partyName.trim().toLowerCase() === 'cash'
                  const cashPaid = Number(form.ppCash) || 0
                  const cardPaid = Number(form.ppCard) || 0
                  const upiPaid = Number(form.ppUpi) || 0
                  const otherPaid = Number(form.ppOther) || 0
                  const totalPaid = cashPaid + cardPaid + upiPaid + otherPaid
                  const creditAmt = isCashCustomer ? 0 : Math.max(0, totalAmount - totalPaid)
                  const balanceDue = Math.max(0, totalAmount - totalPaid - (isCashCustomer ? 0 : creditAmt))

                  return (
                    <>
                      <div className="col-span-2">
                        <p className="text-xs font-semibold text-slate-600 mb-2">Enter amount for each payment method:</p>
                      </div>
                      <div>
                        <Label>Cash</Label>
                        <Input type="number" value={form.ppCash || ''} onChange={(e) => setForm({ ...form, ppCash: Number(e.target.value) || 0 })} placeholder="0" />
                      </div>
                      <div>
                        <Label>Card</Label>
                        <Input type="number" value={form.ppCard || ''} onChange={(e) => setForm({ ...form, ppCard: Number(e.target.value) || 0 })} placeholder="0" />
                      </div>
                      <div>
                        <Label>UPI</Label>
                        <Input type="number" value={form.ppUpi || ''} onChange={(e) => setForm({ ...form, ppUpi: Number(e.target.value) || 0 })} placeholder="0" />
                      </div>
                      <div>
                        <Label>Other</Label>
                        <Input type="number" value={form.ppOther || ''} onChange={(e) => setForm({ ...form, ppOther: Number(e.target.value) || 0 })} placeholder="0" />
                      </div>
                      {/* Other Remarks — only if Other amount > 0 */}
                      {otherPaid > 0 && (
                        <div className="col-span-2">
                          <Label>Other Payment Remarks</Label>
                          <Input value={form.ppOtherRemarks} onChange={(e) => setForm({ ...form, ppOtherRemarks: e.target.value })} placeholder="e.g., Cheque #12345, NEFT, Bank Transfer" />
                        </div>
                      )}
                      {/* Credit — NOT applicable if customer name is "Cash" */}
                      {!isCashCustomer && (
                        <div>
                          <Label>Credit (Balance Due)</Label>
                          <Input type="number" value={creditAmt || ''} readOnly className="bg-slate-100 dark:bg-slate-800" />
                          <p className="text-xs text-muted-foreground mt-1">Auto-calculated: Total − (Cash + Card + UPI + Other)</p>
                        </div>
                      )}
                      {/* Summary */}
                      <div className="col-span-2 bg-amber-50 dark:bg-amber-950 p-3 rounded-lg border border-amber-200 text-sm space-y-1">
                        <div className="flex justify-between"><span>Cash</span><span>{formatCurrency(cashPaid, tenant?.currency)}</span></div>
                        <div className="flex justify-between"><span>Card</span><span>{formatCurrency(cardPaid, tenant?.currency)}</span></div>
                        <div className="flex justify-between"><span>UPI</span><span>{formatCurrency(upiPaid, tenant?.currency)}</span></div>
                        <div className="flex justify-between"><span>Other</span><span>{formatCurrency(otherPaid, tenant?.currency)}</span></div>
                        {!isCashCustomer && (
                          <div className="flex justify-between text-rose-600 font-semibold"><span>Credit</span><span>{formatCurrency(creditAmt, tenant?.currency)}</span></div>
                        )}
                        <div className="border-t pt-1 flex justify-between font-bold text-base">
                          <span>Total Amount</span>
                          <span>{formatCurrency(totalAmount, tenant?.currency)}</span>
                        </div>
                        <div className="flex justify-between text-emerald-600">
                          <span>Amount Received (Cash+Card+UPI+Other)</span>
                          <span>{formatCurrency(totalPaid, tenant?.currency)}</span>
                        </div>
                        {totalPaid + creditAmt !== totalAmount && (
                          <div className="flex justify-between text-rose-600 font-bold">
                            <span>⚠️ Mismatch! Sum ≠ Total</span>
                            <span>{formatCurrency(totalPaid + creditAmt - totalAmount, tenant?.currency)}</span>
                          </div>
                        )}
                      </div>
                    </>
                  )
                })()}

                {/* Others: show remarks */}
                {form.paymentMode === 'OTHERS' && (
                  <div className="col-span-2">
                    <Label>Payment Remarks</Label>
                    <Input
                      value={form.paymentRemarks}
                      onChange={(e) => setForm({ ...form, paymentRemarks: e.target.value })}
                      placeholder="e.g., Cheque #12345, Bank Transfer, NEFT, etc."
                    />
                  </div>
                )}
              </div>

              {/* Summary line showing payment calculation */}
              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border text-sm space-y-1">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(subtotal, tenant?.currency)}</span></div>
                <div className="flex justify-between"><span>GST / Tax</span><span>{formatCurrency(totalTax, tenant?.currency)}</span></div>
                <div className="flex justify-between font-bold text-base"><span>Total Amount</span><span>{formatCurrency(totalAmount, tenant?.currency)}</span></div>
                {(() => {
                  // v4.62.1: If customer is Cash, Amount Received = Total, Balance Due = 0
                  const isCashCustomer = form.partyName.trim().toLowerCase() === 'cash'
                  if (isCashCustomer) {
                    return <>
                      <div className="flex justify-between text-emerald-600"><span>Amount Received</span><span>{formatCurrency(totalAmount, tenant?.currency)}</span></div>
                      <div className="flex justify-between text-emerald-600"><span>Balance Due</span><span>{formatCurrency(0, tenant?.currency)}</span></div>
                    </>
                  }
                  const partPaymentTotal = (Number(form.ppCash) || 0) + (Number(form.ppCard) || 0) + (Number(form.ppUpi) || 0) + (Number(form.ppOther) || 0)
                  const amountReceived = form.paymentMode === 'PART_PAYMENT' ? partPaymentTotal : (form.paymentMode === 'CASH' || form.paymentMode === 'UPI' || form.paymentMode === 'CARD' || form.paymentMode === 'OTHERS' ? totalAmount : 0)
                  return <>
                    <div className="flex justify-between text-emerald-600"><span>Amount Received</span><span>{formatCurrency(amountReceived, tenant?.currency)}</span></div>
                    <div className="flex justify-between text-rose-600"><span>Balance Due</span><span>{formatCurrency(Math.max(0, totalAmount - amountReceived), tenant?.currency)}</span></div>
                  </>
                })()}
              </div>

              <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" /></div>


            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { if (!saving) setShowForm(false) }} disabled={saving}>Cancel</Button>
              <Button type="button" className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {saving ? 'Saving...' : (editingId ? 'Update' : 'Save')} Sale (Quotation)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== VIEW SALE DIALOG ===== */}
        <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center justify-between">
              <span>Sale Invoice - {viewItem?.invoiceNumber}</span>
              {viewItem && <Button variant="outline" size="sm" className="ml-2" onClick={() => handlePrintInvoice(viewItem)}><Printer className="h-4 w-4 mr-1" />Print</Button>}
            </DialogTitle></DialogHeader>
            {viewItem && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <p><strong>Date:</strong> {formatDate(viewItem.date)}</p>
                  <p><strong>Customer:</strong> {viewItem.partyName}</p>
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
                          return (JSON.parse(viewItem.items) as SaleItem[]).map((item, i) => (
                            <TableRow key={i}>
                              <TableCell>
                                {item.name}
                                {/* v4.66: Show item type badge */}
                                {item.saleItemType && item.saleItemType !== 'RETAIL_PRODUCT' && (
                                  <span className={`inline-flex items-center gap-1 ml-1 text-xs px-1.5 py-0.5 rounded-full border ${
                                    item.saleItemType === 'SERVICE'
                                      ? 'text-violet-700 bg-violet-50 border-violet-200'
                                      : 'text-amber-700 bg-amber-50 border-amber-200'
                                  }`}>
                                    {item.saleItemType === 'SERVICE'
                                      ? <><Sparkles className="h-3 w-3" /> Service</>
                                      : <><Package className="h-3 w-3" /> BOM</>}
                                  </span>
                                )}
                                {/* Legacy BOM badge for items without saleItemType */}
                                {!item.saleItemType && (item.itemType === 'FINISHED_PRODUCT' || (item.name && finishedProductNames.includes(item.name.toLowerCase()))) && (
                                  <span className="inline-flex items-center gap-1 ml-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                    <Package className="h-3 w-3" /> BOM
                                  </span>
                                )}
                              </TableCell>
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
                  <div className="flex justify-between"><span>Amount Received</span><span>{formatCurrency(viewItem.amountReceived || viewItem.amountPaid, tenant?.currency)}</span></div>
                  <div className="flex justify-between text-destructive font-semibold"><span>Balance Due</span><span>{formatCurrency(viewItem.totalAmount - (viewItem.amountReceived || viewItem.amountPaid), tenant?.currency)}</span></div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* ===== PRINT INVOICE DIALOG (after saving) ===== */}
        <Dialog open={!!justSavedSale} onOpenChange={(open) => { if (!open) setJustSavedSale(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                Sale Saved Successfully
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p>Invoice <strong>{justSavedSale?.invoiceNumber}</strong> for <strong>{justSavedSale?.partyName}</strong> has been saved as a <strong>Quotation</strong>.</p>
              <p className="text-muted-foreground">Amount: <strong>{formatCurrency(justSavedSale?.totalAmount || 0, tenant?.currency)}</strong></p>
              <p className="text-xs text-amber-600">Quotations can be edited by Data Entry users. Confirm to lock as Tax Invoice.</p>
            </div>
            <DialogFooter className="flex gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => setJustSavedSale(null)}>Close</Button>
              <Button variant="outline" onClick={() => { if (justSavedSale) handlePrintInvoice(justSavedSale); setJustSavedSale(null) }}>
                <Printer className="h-4 w-4 mr-2" /> Print Quotation
              </Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={async () => {
                if (!justSavedSale || !tenant) return
                // v4.160: Cash customer rule — block confirmation
                const isCashCustomer = (justSavedSale.partyName || '').trim().toLowerCase() === 'cash'
                if (isCashCustomer) {
                  toast({
                    title: 'Cannot Confirm Sale',
                    description: 'A sale with customer name "Cash" cannot be confirmed. Edit the sale and enter the customer\'s real name to process a credit sale.',
                    variant: 'destructive',
                    duration: 8000,
                  })
                  return
                }
                const res = await authFetch('/api/sales', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'confirm-sale', id: justSavedSale.id, tenantId: tenant.id }),
                })
                if (res.ok) {
                  toast({ title: 'Sale Confirmed', description: 'Tax Invoice is now locked for Data Entry users.' })
                  setJustSavedSale(null)
                  fetchSales()
                } else {
                  const errData = await res.json().catch(() => ({}))
                  toast({ title: 'Confirm Failed', description: errData.error || 'Failed to confirm sale', variant: 'destructive' })
                }
              }}>
                <CheckCircle2 className="h-4 w-4 mr-2" /> Confirm Sale (Tax Invoice)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
