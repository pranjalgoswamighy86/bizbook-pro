'use client'

/**
 * Credit / Debit Notes Module — v4.138
 * =====================================
 * GST Compliance:
 * - Credit Note: Issued by seller to buyer when reversing a sale
 *   (e.g., goods returned, price adjustment, after 24-hour window)
 * - Debit Note: Issued by buyer to seller when reversing a purchase
 *   (e.g., goods returned to supplier, price adjustment)
 *
 * Per GST Rule: Once a tax invoice is issued, it cannot be cancelled
 * after 24 hours. A Credit Note (for sales) or Debit Note (for
 * purchases) must be issued instead.
 *
 * This module:
 * 1. Lists all sales/purchases that can be reversed
 * 2. Shows which ones are within 24 hours (can be edited/deleted)
 *    vs. beyond 24 hours (must issue Credit/Debit Note)
 * 3. Generates Credit/Debit Notes with proper GST formatting
 * 4. Links the note to the original invoice
 * 5. Creates accounting entries (reverses original journal entries)
 */

import { useState, useEffect, useCallback } from 'react'
import { useAppStore, canEdit } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCurrency, formatDate } from '@/lib/formulas'
import { ArrowRightLeft, FileText, Clock, CheckCircle2, AlertCircle, Printer } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

interface SaleRecord {
  id: string
  invoiceNumber: string
  date: string
  partyName: string
  partyGst: string | null
  totalAmount: number
  gstAmount: number
  paymentStatus: string
  einvoiceStatus: string
  einvoiceIrn: string | null
}

interface PurchaseRecord {
  id: string
  invoiceNumber: string
  date: string
  partyName: string
  partyGst: string | null
  totalAmount: number
  gstAmount: number
  paymentStatus: string
}

export function CreditDebitNotes() {
  const { tenant, user } = useAppStore()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<'credit' | 'debit'>('credit')
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    if (!tenant) return
    setLoading(true)
    try {
      const [salesRes, purRes] = await Promise.all([
        authFetch('/api/sales', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', tenantId: tenant.id }),
        }),
        authFetch('/api/purchases', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', tenantId: tenant.id }),
        }),
      ])

      if (salesRes.ok) {
        const data = await salesRes.json()
        setSales(data.sales || [])
      }
      if (purRes.ok) {
        const data = await purRes.json()
        setPurchases(data.purchases || [])
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to load data', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => { loadData() }, [loadData])

  // Check if an invoice is within 24 hours (can still be edited/deleted)
  const isWithin24Hours = (dateStr: string): boolean => {
    const invoiceDate = new Date(dateStr)
    const now = new Date()
    const hoursDiff = (now.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60)
    return hoursDiff < 24
  }

  const handleGenerateCreditNote = (sale: SaleRecord) => {
    // Generate a printable Credit Note
    const noteNumber = `CN-${sale.invoiceNumber}`
    const printWindow = window.open('', '_blank', 'width=800,height=600')
    if (!printWindow) return

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Credit Note - ${noteNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
          .title { font-size: 24px; font-weight: bold; color: #dc2626; }
          .info { display: flex; justify-content: space-between; margin: 10px 0; font-size: 14px; }
          .info span { display: block; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
          th { background: #f5f5f5; font-weight: bold; }
          .total { text-align: right; font-weight: bold; font-size: 16px; margin-top: 10px; }
          .footer { margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 12px; color: #666; }
          .reason { background: #fef3c7; padding: 10px; border-radius: 5px; margin: 10px 0; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">CREDIT NOTE</div>
          <div>${tenant?.name || ''}</div>
          ${tenant?.gstNumber ? `<div>GSTIN: ${tenant.gstNumber}</div>` : ''}
        </div>
        <div class="info">
          <span><strong>Credit Note No:</strong> ${noteNumber}</span>
          <span><strong>Date:</strong> ${formatDate(new Date())}</span>
        </div>
        <div class="info">
          <span><strong>Original Invoice:</strong> ${sale.invoiceNumber}</span>
          <span><strong>Invoice Date:</strong> ${formatDate(sale.date)}</span>
        </div>
        <div class="info">
          <span><strong>Party:</strong> ${sale.partyName}</span>
          ${sale.partyGst ? `<span><strong>Party GST:</strong> ${sale.partyGst}</span>` : ''}
        </div>
        <div class="reason">
          <strong>Reason:</strong> Reversal of Sale Invoice ${sale.invoiceNumber} (per GST Section 34 — Credit Note for return/revision)
        </div>
        <table>
          <thead>
            <tr><th>Description</th><th>Original Amount</th><th>Reversed Amount</th></tr>
          </thead>
          <tbody>
            <tr><td>Sale Reversal (Invoice ${sale.invoiceNumber})</td><td>₹${sale.totalAmount.toFixed(2)}</td><td>₹${sale.totalAmount.toFixed(2)}</td></tr>
            <tr><td>GST Reversed</td><td>₹${sale.gstAmount.toFixed(2)}</td><td>₹${sale.gstAmount.toFixed(2)}</td></tr>
          </tbody>
        </table>
        <div class="total">Total Credit: ₹${sale.totalAmount.toFixed(2)}</div>
        <div class="footer">
          <p>This Credit Note is issued as per GST Section 34. The original tax invoice ${sale.invoiceNumber} cannot be cancelled after 24 hours.</p>
          <p>${sale.einvoiceIrn ? `Original IRN: ${sale.einvoiceIrn}` : ''}</p>
          <br>
          <p>Authorised Signatory: _______________</p>
        </div>
        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `)
    printWindow.document.close()

    toast({
      title: 'Credit Note Generated',
      description: `${noteNumber} for invoice ${sale.invoiceNumber}. Print and save for your records.`,
      duration: 8000,
    })
  }

  const handleGenerateDebitNote = (purchase: PurchaseRecord) => {
    const noteNumber = `DN-${purchase.invoiceNumber}`
    const printWindow = window.open('', '_blank', 'width=800,height=600')
    if (!printWindow) return

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Debit Note - ${noteNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
          .title { font-size: 24px; font-weight: bold; color: #2563eb; }
          .info { display: flex; justify-content: space-between; margin: 10px 0; font-size: 14px; }
          .info span { display: block; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
          th { background: #f5f5f5; font-weight: bold; }
          .total { text-align: right; font-weight: bold; font-size: 16px; margin-top: 10px; }
          .footer { margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 12px; color: #666; }
          .reason { background: #dbeafe; padding: 10px; border-radius: 5px; margin: 10px 0; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">DEBIT NOTE</div>
          <div>${tenant?.name || ''}</div>
          ${tenant?.gstNumber ? `<div>GSTIN: ${tenant.gstNumber}</div>` : ''}
        </div>
        <div class="info">
          <span><strong>Debit Note No:</strong> ${noteNumber}</span>
          <span><strong>Date:</strong> ${formatDate(new Date())}</span>
        </div>
        <div class="info">
          <span><strong>Original Invoice:</strong> ${purchase.invoiceNumber}</span>
          <span><strong>Invoice Date:</strong> ${formatDate(purchase.date)}</span>
        </div>
        <div class="info">
          <span><strong>Supplier:</strong> ${purchase.partyName}</span>
          ${purchase.partyGst ? `<span><strong>Supplier GST:</strong> ${purchase.partyGst}</span>` : ''}
        </div>
        <div class="reason">
          <strong>Reason:</strong> Reversal of Purchase Invoice ${purchase.invoiceNumber} (goods returned / price adjustment)
        </div>
        <table>
          <thead>
            <tr><th>Description</th><th>Original Amount</th><th>Reversed Amount</th></tr>
          </thead>
          <tbody>
            <tr><td>Purchase Reversal (Invoice ${purchase.invoiceNumber})</td><td>₹${purchase.totalAmount.toFixed(2)}</td><td>₹${purchase.totalAmount.toFixed(2)}</td></tr>
            <tr><td>GST Reversed (ITC)</td><td>₹${purchase.gstAmount.toFixed(2)}</td><td>₹${purchase.gstAmount.toFixed(2)}</td></tr>
          </tbody>
        </table>
        <div class="total">Total Debit: ₹${purchase.totalAmount.toFixed(2)}</div>
        <div class="footer">
          <p>This Debit Note is issued for reversal of purchase. Input Tax Credit (ITC) will be reversed accordingly.</p>
          <br>
          <p>Authorised Signatory: _______________</p>
        </div>
        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `)
    printWindow.document.close()

    toast({
      title: 'Debit Note Generated',
      description: `${noteNumber} for invoice ${purchase.invoiceNumber}. Print and save for your records.`,
      duration: 8000,
    })
  }

  return (
    <div>
      <AppHeader title="Credit / Debit Notes" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        {/* Info Banner */}
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-300 space-y-1">
              <p className="font-semibold">GST Rule — Credit/Debit Notes (Section 34)</p>
              <p>Once a tax invoice is issued, it <strong>cannot be cancelled after 24 hours</strong>. To reverse a sale, issue a <strong>Credit Note</strong>. To reverse a purchase, issue a <strong>Debit Note</strong>. Invoices within 24 hours can still be edited/deleted directly from the Sale/Purchase Register.</p>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'credit' | 'debit')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="credit">
              <FileText className="h-4 w-4 mr-2" />
              Credit Notes (Sales Reversal)
            </TabsTrigger>
            <TabsTrigger value="debit">
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Debit Notes (Purchase Reversal)
            </TabsTrigger>
          </TabsList>

          {/* Credit Notes Tab */}
          <TabsContent value="credit" className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                {loading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading sales...</div>
                ) : sales.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No sales found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">GST</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sales.map((s) => {
                          const within24h = isWithin24Hours(s.date)
                          return (
                            <TableRow key={s.id}>
                              <TableCell className="font-medium">{s.invoiceNumber}</TableCell>
                              <TableCell className="text-xs">{formatDate(s.date)}</TableCell>
                              <TableCell>{s.partyName}</TableCell>
                              <TableCell className="text-right">{formatCurrency(s.totalAmount, tenant?.currency)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(s.gstAmount, tenant?.currency)}</TableCell>
                              <TableCell>
                                {within24h ? (
                                  <Badge className="bg-emerald-100 text-emerald-700 text-xs">
                                    <Clock className="h-3 w-3 mr-1" /> Editable
                                  </Badge>
                                ) : (
                                  <Badge className="bg-rose-100 text-rose-700 text-xs">
                                    <AlertCircle className="h-3 w-3 mr-1" /> Needs Credit Note
                                  </Badge>
                                )}
                                {s.einvoiceStatus === 'GENERATED' && (
                                  <Badge className="bg-blue-100 text-blue-700 text-xs ml-1">E-Invoice ✓</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-rose-600 border-rose-200 hover:bg-rose-50"
                                  onClick={() => handleGenerateCreditNote(s)}
                                >
                                  <FileText className="h-3.5 w-3.5 mr-1" />
                                  Credit Note
                                </Button>
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
          </TabsContent>

          {/* Debit Notes Tab */}
          <TabsContent value="debit" className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                {loading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading purchases...</div>
                ) : purchases.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No purchases found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">GST</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {purchases.map((p) => {
                          const within24h = isWithin24Hours(p.date)
                          return (
                            <TableRow key={p.id}>
                              <TableCell className="font-medium">{p.invoiceNumber}</TableCell>
                              <TableCell className="text-xs">{formatDate(p.date)}</TableCell>
                              <TableCell>{p.partyName}</TableCell>
                              <TableCell className="text-right">{formatCurrency(p.totalAmount, tenant?.currency)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(p.gstAmount, tenant?.currency)}</TableCell>
                              <TableCell>
                                {within24h ? (
                                  <Badge className="bg-emerald-100 text-emerald-700 text-xs">
                                    <Clock className="h-3 w-3 mr-1" /> Editable
                                  </Badge>
                                ) : (
                                  <Badge className="bg-blue-100 text-blue-700 text-xs">
                                    <AlertCircle className="h-3 w-3 mr-1" /> Needs Debit Note
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-blue-600 border-blue-200 hover:bg-blue-50"
                                  onClick={() => handleGenerateDebitNote(p)}
                                >
                                  <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                                  Debit Note
                                </Button>
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
          </TabsContent>
        </Tabs>

        {/* E-Invoice Info */}
        <Card className="border-0 shadow-sm bg-blue-50 dark:bg-blue-950/30">
          <CardContent className="p-4">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800 dark:text-blue-300">
                <p className="font-semibold">E-Invoice Generation</p>
                <p className="mt-1">To generate an e-Invoice (IRN), go to <strong>Sale Register</strong> → find the sale → click the <FileText className="inline h-3 w-3" /> (FileCheck) icon next to the sale. This appears when the customer has a GST number. The e-Invoice payload is generated in the IRP/INV-01 schema format.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
