'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileSpreadsheet, Loader2, Download, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatCurrency, formatDate } from '@/lib/formulas'
import { splitGSTAmount, isInterStateSupply, roundTo2 } from '@/lib/gst-utils'
import { authFetch } from '@/lib/auth-fetch'

interface GstSummary {
  period: string
  totalSales: number
  totalPurchases: number
  salesGst: number
  purchaseGst: number
  cgstCollected: number
  sgstCollected: number
  igstCollected: number
  cgstPaid: number
  sgstPaid: number
  igstPaid: number
  netGstPayable: number
  itc: number
}

interface SaleWithGst {
  id: string
  invoiceNumber: string
  date: string
  partyName: string
  partyGst: string | null
  partyAddress?: string | null
  subtotal: number
  gstAmount: number
  totalAmount: number
  items?: string  // JSON string of line items (for HSN summary)
  paymentStatus?: string
  invoiceStatus?: string
}

// v4.149: GSTR-3B HSN-wise summary row (Section 4)
interface HsnSummaryRow {
  hsn: string
  description: string
  uqc: string             // Unit of Quantity Code
  totalQty: number
  totalTaxableValue: number
  totalIgst: number
  totalCgst: number
  totalSgst: number
  totalCess: number
  invoiceCount: number
}

// v4.149: GSTR-9 annual aggregation
interface AnnualSummary {
  financialYear: string
  b2bTaxableValue: number
  b2bIgst: number
  b2bCgst: number
  b2bSgst: number
  b2bCess: number
  b2cTaxableValue: number
  b2cIgst: number
  b2cCgst: number
  b2cSgst: number
  b2cCess: number
  nilRatedExemptTaxableValue: number
  cdnrTaxableValue: number
  cdnrIgst: number
  cdnrCgst: number
  cdnrSgst: number
  totalOutwardValue: number
  totalIgstCollected: number
  totalCgstCollected: number
  totalSgstCollected: number
  totalCessCollected: number
  totalItcIgst: number
  totalItcCgst: number
  totalItcSgst: number
  totalItcCess: number
  totalInwardValue: number
  netTaxPayable: number
  lateFee: number
  interest: number
  penalty: number
  totalTaxPaid: number
  itcCarriedForward: number
}

interface PurchaseWithGst {
  id: string
  invoiceNumber: string
  date: string
  partyName: string
  partyGst: string | null
  subtotal: number
  gstAmount: number
  totalAmount: number
}

export function GstReports() {
  const { tenant } = useAppStore()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<GstSummary | null>(null)
  const [sales, setSales] = useState<SaleWithGst[]>([])
  const [purchases, setPurchases] = useState<PurchaseWithGst[]>([])
  // v4.149: GSTR-3B HSN-wise summary
  const [hsnSummary, setHsnSummary] = useState<HsnSummaryRow[]>([])
  // v4.149: GSTR-9 annual aggregation
  const [annualSummary, setAnnualSummary] = useState<AnnualSummary | null>(null)
  const [annualLoading, setAnnualLoading] = useState(false)

  // Period filter
  const [periodType, setPeriodType] = useState<'month' | 'quarter' | 'year'>('month')
  const [selectedPeriod, setSelectedPeriod] = useState<string>('')

  useEffect(() => {
    if (!tenant) return
    // Default to current month
    const now = new Date()
    setSelectedPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  }, [tenant])

  useEffect(() => {
    if (!tenant || !selectedPeriod) return
    loadGstData()
  }, [tenant, selectedPeriod]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadGstData = async () => {
    if (!tenant || !selectedPeriod) return
    setLoading(true)
    try {
      // Calculate date range from selected period
      const [year, part] = selectedPeriod.split('-').map(Number)
      let startDate: Date
      let endDate: Date

      if (periodType === 'month') {
        startDate = new Date(year, part - 1, 1)
        endDate = new Date(year, part, 1)
      } else if (periodType === 'quarter') {
        const startMonth = (part - 1) * 3
        startDate = new Date(year, startMonth, 1)
        endDate = new Date(year, startMonth + 3, 1)
      } else {
        startDate = new Date(year, 0, 1)
        endDate = new Date(year + 1, 0, 1)
      }

      // Fetch sales and purchases for the period
      const [salesRes, purchasesRes] = await Promise.all([
        authFetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'list',
            tenantId: tenant.id,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          }),
        }),
        authFetch('/api/purchases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'list',
            tenantId: tenant.id,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          }),
        }),
      ])

      const salesData = salesRes.ok ? await salesRes.json() : { sales: [] }
      const purchasesData = purchasesRes.ok ? await purchasesRes.json() : { purchases: [] }

      // All sales/purchases for summary
      const allSales: SaleWithGst[] = salesData.sales || []
      const allPurchases: PurchaseWithGst[] = purchasesData.purchases || []

      const totalSales = allSales.reduce((sum: number, s: SaleWithGst) => sum + s.totalAmount, 0)
      const totalPurchases = allPurchases.reduce((sum: number, p: PurchaseWithGst) => sum + p.totalAmount, 0)
      const salesGst = allSales.reduce((sum: number, s: SaleWithGst) => sum + s.gstAmount, 0)
      const purchaseGst = allPurchases.reduce((sum: number, p: PurchaseWithGst) => sum + p.gstAmount, 0)

      // Use centralized isInterStateSupply from gst-utils.ts for consistency
      // For sales: supplier = tenant (user's business), buyer = party (customer)
      // For purchases: supplier = party (supplier), buyer = tenant (user's business)
      // If tenant has no GSTIN, we cannot determine inter-state — treat as
      // intra-state by default (so CGST+SGST split). This matches what the
      // sale/purchase register does when calculating GST at invoice time.
      const tenantGstin = tenant.gstNumber || ''

      let cgstCollected = 0, sgstCollected = 0, igstCollected = 0
      let cgstPaid = 0, sgstPaid = 0, igstPaid = 0

      for (const s of allSales) {
        if (s.gstAmount === 0) continue // Skip non-GST sales
        const interState = isInterStateSupply(tenantGstin, s.partyGst || '')
        const { cgst, sgst, igst } = splitGSTAmount(s.gstAmount, interState)
        cgstCollected = roundTo2(cgstCollected + cgst)
        sgstCollected = roundTo2(sgstCollected + sgst)
        igstCollected = roundTo2(igstCollected + igst)
      }

      for (const p of allPurchases) {
        if (p.gstAmount === 0) continue // Skip non-GST purchases
        const interState = isInterStateSupply(p.partyGst || '', tenantGstin)
        const { cgst, sgst, igst } = splitGSTAmount(p.gstAmount, interState)
        cgstPaid = roundTo2(cgstPaid + cgst)
        sgstPaid = roundTo2(sgstPaid + sgst)
        igstPaid = roundTo2(igstPaid + igst)
      }

      // ITC (Input Tax Credit) = total GST paid on purchases
      // Net GST payable = Output GST (sales) - Input GST (purchases)
      const itc = roundTo2(purchaseGst)
      const netGstPayable = roundTo2(salesGst - itc)

      setSummary({
        period: selectedPeriod,
        totalSales, totalPurchases, salesGst, purchaseGst,
        cgstCollected, sgstCollected, igstCollected,
        cgstPaid, sgstPaid, igstPaid,
        netGstPayable, itc,
      })
      setSales(allSales)
      setPurchases(allPurchases)

      // v4.149: Compute HSN-wise summary for GSTR-3B Section 4
      const hsnMap = new Map<string, HsnSummaryRow>()
      for (const s of allSales) {
        if (!s.items) continue
        try {
          const items = JSON.parse(s.items) as Array<{
            hsn?: string
            name?: string
            qty?: number
            unit?: string
            amount?: number
            gstRate?: number
            taxes?: { cgst?: number; sgst?: number; igst?: number; cess?: number }
          }>
          for (const item of items) {
            const hsn = item.hsn || '0000'
            const existing = hsnMap.get(hsn) || {
              hsn, description: item.name || '', uqc: item.unit || 'OTH',
              totalQty: 0, totalTaxableValue: 0, totalIgst: 0, totalCgst: 0,
              totalSgst: 0, totalCess: 0, invoiceCount: 0,
            }
            existing.totalQty += Number(item.qty || 0)
            existing.totalTaxableValue = roundTo2(existing.totalTaxableValue + Number(item.amount || 0))
            existing.totalIgst = roundTo2(existing.totalIgst + Number(item.taxes?.igst || 0))
            existing.totalCgst = roundTo2(existing.totalCgst + Number(item.taxes?.cgst || 0))
            existing.totalSgst = roundTo2(existing.totalSgst + Number(item.taxes?.sgst || 0))
            existing.totalCess = roundTo2(existing.totalCess + Number(item.taxes?.cess || 0))
            existing.invoiceCount += 1
            if (!existing.description && item.name) existing.description = item.name
            hsnMap.set(hsn, existing)
          }
        } catch { /* items JSON malformed */ }
      }
      setHsnSummary(Array.from(hsnMap.values()).sort((a, b) => a.hsn.localeCompare(b.hsn)))
    } catch {
      toast({ title: 'Error', description: 'Failed to load GST data', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  // v4.149: Load GSTR-9 annual summary for a financial year
  // FY "2024-25" runs from 1 Apr 2024 to 31 Mar 2025
  const loadAnnualSummary = async (fyYear: number) => {
    if (!tenant) return
    setAnnualLoading(true)
    try {
      const startDate = new Date(fyYear, 3, 1)
      const endDate = new Date(fyYear + 1, 3, 1)
      const [salesRes, purchasesRes] = await Promise.all([
        authFetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', tenantId: tenant.id, startDate: startDate.toISOString(), endDate: endDate.toISOString() }),
        }),
        authFetch('/api/purchases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', tenantId: tenant.id, startDate: startDate.toISOString(), endDate: endDate.toISOString() }),
        }),
      ])
      const salesData = salesRes.ok ? await salesRes.json() : { sales: [] }
      const purchasesData = purchasesRes.ok ? await purchasesRes.json() : { purchases: [] }
      const fySales: SaleWithGst[] = salesData.sales || []
      const fyPurchases: PurchaseWithGst[] = purchasesData.purchases || []
      const tenantGstin = tenant.gstNumber || ''

      let b2bTaxable = 0, b2bIgst = 0, b2bCgst = 0, b2bSgst = 0
      let b2cTaxable = 0, b2cIgst = 0, b2cCgst = 0, b2cSgst = 0
      let nilRated = 0
      let cdnrTaxable = 0, cdnrIgst = 0, cdnrCgst = 0, cdnrSgst = 0

      for (const s of fySales) {
        const isB2B = !!(s.partyGst && s.partyGst.length === 15)
        const interState = isInterStateSupply(tenantGstin, s.partyGst || '')
        const { cgst, sgst, igst } = splitGSTAmount(s.gstAmount, interState)
        if (s.gstAmount === 0) {
          nilRated = roundTo2(nilRated + s.subtotal)
        } else if (isB2B) {
          b2bTaxable = roundTo2(b2bTaxable + s.subtotal)
          b2bIgst = roundTo2(b2bIgst + igst)
          b2bCgst = roundTo2(b2bCgst + cgst)
          b2bSgst = roundTo2(b2bSgst + sgst)
        } else {
          b2cTaxable = roundTo2(b2cTaxable + s.subtotal)
          b2cIgst = roundTo2(b2cIgst + igst)
          b2cCgst = roundTo2(b2cCgst + cgst)
          b2cSgst = roundTo2(b2cSgst + sgst)
        }
      }

      let itcIgst = 0, itcCgst = 0, itcSgst = 0, totalInward = 0
      for (const p of fyPurchases) {
        const interState = isInterStateSupply(p.partyGst || '', tenantGstin)
        const { cgst, sgst, igst } = splitGSTAmount(p.gstAmount, interState)
        itcIgst = roundTo2(itcIgst + igst)
        itcCgst = roundTo2(itcCgst + cgst)
        itcSgst = roundTo2(itcSgst + sgst)
        totalInward = roundTo2(totalInward + p.subtotal)
      }

      const totalOutward = roundTo2(b2bTaxable + b2cTaxable + nilRated + cdnrTaxable)
      const totalIgstCollected = roundTo2(b2bIgst + b2cIgst + cdnrIgst)
      const totalCgstCollected = roundTo2(b2bCgst + b2cCgst + cdnrCgst)
      const totalSgstCollected = roundTo2(b2bSgst + b2cSgst + cdnrSgst)
      const netTaxPayable = roundTo2(
        totalIgstCollected + totalCgstCollected + totalSgstCollected
        - itcIgst - itcCgst - itcSgst
      )

      setAnnualSummary({
        financialYear: `${fyYear}-${String(fyYear + 1).slice(2)}`,
        b2bTaxableValue: b2bTaxable, b2bIgst, b2bCgst, b2bSgst, b2bCess: 0,
        b2cTaxableValue: b2cTaxable, b2cIgst, b2cCgst, b2cSgst, b2cCess: 0,
        nilRatedExemptTaxableValue: nilRated,
        cdnrTaxableValue: cdnrTaxable, cdnrIgst, cdnrCgst, cdnrSgst,
        totalOutwardValue: totalOutward,
        totalIgstCollected, totalCgstCollected, totalSgstCollected, totalCessCollected: 0,
        totalItcIgst: itcIgst, totalItcCgst: itcCgst, totalItcSgst: itcSgst, totalItcCess: 0,
        totalInwardValue: totalInward,
        netTaxPayable,
        lateFee: 0, interest: 0, penalty: 0,
        totalTaxPaid: netTaxPayable,
        itcCarriedForward: netTaxPayable < 0 ? Math.abs(netTaxPayable) : 0,
      })
    } catch {
      toast({ title: 'Error', description: 'Failed to load annual summary', variant: 'destructive' })
    } finally {
      setAnnualLoading(false)
    }
  }

  const handleExportJson = () => {
    if (!summary) return
    const data = {
      _meta: {
        type: 'GST Report',
        generatedAt: new Date().toISOString(),
        company: tenant?.name,
        period: selectedPeriod,
        periodType,
      },
      summary,
      gstr1: sales.map(s => ({
        invoiceNumber: s.invoiceNumber,
        date: s.date,
        partyName: s.partyName,
        partyGst: s.partyGst,
        taxableValue: s.subtotal,
        gstAmount: s.gstAmount,
        totalAmount: s.totalAmount,
      })),
      gstr3b: {
        outwardSupplies: summary.totalSales,
        inwardSupplies: summary.totalPurchases,
        gstCollected: summary.salesGst,
        itcClaimed: summary.itc,
        netGstPayable: summary.netGstPayable,
      },
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gst_report_${selectedPeriod}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'Exported', description: 'GST report saved as JSON' })
  }

  // Generate period options
  const getPeriodOptions = () => {
    const options: { value: string; label: string }[] = []
    const now = new Date()
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    if (periodType === 'month') {
      for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
        for (let m = 11; m >= 0; m--) {
          if (y === now.getFullYear() && m > now.getMonth()) continue
          const val = `${y}-${String(m + 1).padStart(2, '0')}`
          options.push({ value: val, label: `${months[m]} ${y}` })
        }
      }
    } else if (periodType === 'quarter') {
      for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
        for (let q = 4; q >= 1; q--) {
          if (y === now.getFullYear() && q > Math.ceil((now.getMonth() + 1) / 3)) continue
          options.push({ value: `${y}-${q}`, label: `Q${q} ${y} (${months[(q - 1) * 3]}-${months[q * 3 - 1]})` })
        }
      }
    } else {
      for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y--) {
        options.push({ value: `${y}-1`, label: `FY ${y}-${(y + 1).toString().slice(2)}` })
      }
    }

    return options
  }

  if (loading || !summary) {
    return (
      <div>
        <AppHeader title="GST Reports" />
        <div className="p-6 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      </div>
    )
  }

  return (
    <div>
      <AppHeader title="GST Reports" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        {/* Period Selector */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Period:</span>
                <Select value={periodType} onValueChange={(v) => { setPeriodType(v as 'month' | 'quarter' | 'year'); setSelectedPeriod('') }}>
                  <SelectTrigger className="h-9 w-28 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Monthly</SelectItem>
                    <SelectItem value="quarter">Quarterly</SelectItem>
                    <SelectItem value="year">Yearly</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                  <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="Select period" /></SelectTrigger>
                  <SelectContent>
                    {getPeriodOptions().map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" className="h-9 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50 ml-auto" onClick={handleExportJson}>
                <Download className="h-3.5 w-3.5 mr-1" /> Export JSON
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Sales</p>
              <p className="text-lg font-bold text-emerald-600">{formatCurrency(summary.totalSales, tenant?.currency)}</p>
              <p className="text-xs text-muted-foreground">GST: {formatCurrency(summary.salesGst, tenant?.currency)}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Purchases</p>
              <p className="text-lg font-bold text-orange-600">{formatCurrency(summary.totalPurchases, tenant?.currency)}</p>
              <p className="text-xs text-muted-foreground">GST: {formatCurrency(summary.purchaseGst, tenant?.currency)}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">ITC (Input Tax Credit)</p>
              <p className="text-lg font-bold text-blue-600">{formatCurrency(summary.itc, tenant?.currency)}</p>
              <p className="text-xs text-muted-foreground">From purchases</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Net GST Payable</p>
              <p className={`text-lg font-bold ${summary.netGstPayable >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {formatCurrency(summary.netGstPayable, tenant?.currency)}
              </p>
              <p className="text-xs text-muted-foreground">Collected - ITC</p>
            </CardContent>
          </Card>
        </div>

        {/* GST Breakdown Tabs */}
        <Tabs defaultValue="gstr1">
          <TabsList className="flex-wrap">
            <TabsTrigger value="gstr1">GSTR-1 (Sales)</TabsTrigger>
            <TabsTrigger value="gstr3b">GSTR-3B (Summary)</TabsTrigger>
            <TabsTrigger value="gstr9">GSTR-9 (Annual)</TabsTrigger>
            <TabsTrigger value="breakdown">GST Breakdown</TabsTrigger>
          </TabsList>

          {/* GSTR-1 Tab */}
          <TabsContent value="gstr1">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  GSTR-1: Outward Supplies (Sales)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sales.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">No sales in this period</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[50vh] overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Party</TableHead>
                          <TableHead>GSTIN</TableHead>
                          <TableHead className="text-right">Taxable</TableHead>
                          <TableHead className="text-right">GST</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sales.map(s => (
                          <TableRow key={s.id}>
                            <TableCell className="font-mono text-sm">{s.invoiceNumber}</TableCell>
                            <TableCell className="text-sm">{formatDate(s.date)}</TableCell>
                            <TableCell className="text-sm">{s.partyName}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{s.partyGst || '-'}</TableCell>
                            <TableCell className="text-right text-sm">{formatCurrency(s.subtotal, tenant?.currency)}</TableCell>
                            <TableCell className="text-right text-sm">{formatCurrency(s.gstAmount, tenant?.currency)}</TableCell>
                            <TableCell className="text-right text-sm font-medium">{formatCurrency(s.totalAmount, tenant?.currency)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* GSTR-3B Tab */}
          <TabsContent value="gstr3b">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-orange-600" />
                  GSTR-3B: Summary Return
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Outward Supplies */}
                  <div className="bg-emerald-50 dark:bg-emerald-950 p-4 rounded-lg">
                    <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 mb-3">GST Collected on Sales</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">CGST</p>
                        <p className="text-lg font-bold">{formatCurrency(summary.cgstCollected, tenant?.currency)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">SGST</p>
                        <p className="text-lg font-bold">{formatCurrency(summary.sgstCollected, tenant?.currency)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">IGST</p>
                        <p className="text-lg font-bold">{formatCurrency(summary.igstCollected, tenant?.currency)}</p>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-800">
                      <p className="text-xs text-muted-foreground">Total GST Collected</p>
                      <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(summary.salesGst, tenant?.currency)}</p>
                    </div>
                  </div>

                  {/* ITC */}
                  <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
                    <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-3">Input Tax Credit (GST Paid on Purchases)</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">CGST</p>
                        <p className="text-lg font-bold">{formatCurrency(summary.cgstPaid, tenant?.currency)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">SGST</p>
                        <p className="text-lg font-bold">{formatCurrency(summary.sgstPaid, tenant?.currency)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">IGST</p>
                        <p className="text-lg font-bold">{formatCurrency(summary.igstPaid, tenant?.currency)}</p>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-800">
                      <p className="text-xs text-muted-foreground">Total ITC</p>
                      <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatCurrency(summary.itc, tenant?.currency)}</p>
                    </div>
                  </div>

                  {/* v4.149: HSN-wise Summary (GSTR-3B Section 4) */}
                  {hsnSummary.length > 0 && (
                    <div className="bg-purple-50 dark:bg-purple-950 p-4 rounded-lg">
                      <h4 className="text-sm font-semibold text-purple-700 dark:text-purple-300 mb-3">
                        HSN-wise Summary (GSTR-3B Section 4)
                      </h4>
                      <div className="overflow-x-auto max-h-72 overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">HSN</TableHead>
                              <TableHead className="text-xs">Description</TableHead>
                              <TableHead className="text-xs text-right">Qty</TableHead>
                              <TableHead className="text-xs text-right">Taxable</TableHead>
                              <TableHead className="text-xs text-right">IGST</TableHead>
                              <TableHead className="text-xs text-right">CGST</TableHead>
                              <TableHead className="text-xs text-right">SGST</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {hsnSummary.map(row => (
                              <TableRow key={row.hsn}>
                                <TableCell className="font-mono text-xs">{row.hsn}</TableCell>
                                <TableCell className="text-xs">{row.description.slice(0, 40)}</TableCell>
                                <TableCell className="text-right text-xs">{row.totalQty}</TableCell>
                                <TableCell className="text-right text-xs">{formatCurrency(row.totalTaxableValue, tenant?.currency)}</TableCell>
                                <TableCell className="text-right text-xs">{formatCurrency(row.totalIgst, tenant?.currency)}</TableCell>
                                <TableCell className="text-right text-xs">{formatCurrency(row.totalCgst, tenant?.currency)}</TableCell>
                                <TableCell className="text-right text-xs">{formatCurrency(row.totalSgst, tenant?.currency)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Net Payable */}
                  <div className={`${summary.netGstPayable >= 0 ? 'bg-red-50 dark:bg-red-950' : 'bg-emerald-50 dark:bg-emerald-950'} p-4 rounded-lg`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-semibold">Net GST Payable</h4>
                        <p className="text-xs text-muted-foreground">GST Collected − ITC</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {summary.netGstPayable >= 0 ? (
                          <TrendingUp className="h-5 w-5 text-red-600" />
                        ) : (
                          <TrendingDown className="h-5 w-5 text-emerald-600" />
                        )}
                        <p className={`text-2xl font-bold ${summary.netGstPayable >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {formatCurrency(summary.netGstPayable, tenant?.currency)}
                        </p>
                      </div>
                    </div>
                    {summary.netGstPayable < 0 && (
                      <p className="text-xs text-emerald-600 mt-2">
                        <Minus className="h-3 w-3 inline" /> You have a credit balance of {formatCurrency(Math.abs(summary.netGstPayable), tenant?.currency)} that can be carried forward.
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* v4.149: GSTR-9 Annual Report Tab */}
          <TabsContent value="gstr9">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-violet-600" />
                  GSTR-9: Annual Return (Consolidated)
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Filed annually by 31st December following the financial year end. Consolidates all GSTR-1 and GSTR-3B filings.
                </p>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-4">
                  <span className="text-sm font-medium">Financial Year:</span>
                  <Select defaultValue={String(new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1)}
                    onValueChange={(v) => loadAnnualSummary(Number(v))}>
                    <SelectTrigger className="h-9 w-40 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 6 }, (_, i) => {
                        const fy = new Date().getFullYear() - (new Date().getMonth() >= 3 ? 0 : 1) - i
                        return <SelectItem key={fy} value={String(fy)}>FY {fy}-{String(fy + 1).slice(2)}</SelectItem>
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {annualLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
                  </div>
                ) : !annualSummary ? (
                  <div className="text-center py-12">
                    <p className="text-sm text-muted-foreground">Select a financial year to load annual summary.</p>
                    <Button variant="outline" size="sm" className="mt-3"
                      onClick={() => loadAnnualSummary(new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1)}>
                      Load Current FY
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="border-l-4 border-violet-500 pl-4">
                      <h4 className="text-sm font-semibold text-violet-700 dark:text-violet-300">Part I — General Information</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Financial Year: <span className="font-mono">{annualSummary.financialYear}</span>
                      </p>
                    </div>

                    <div className="border-l-4 border-emerald-500 pl-4">
                      <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 mb-3">
                        Part II — Details of Outward &amp; Inward Supplies
                      </h4>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Nature of Supplies</TableHead>
                              <TableHead className="text-xs text-right">Taxable Value</TableHead>
                              <TableHead className="text-xs text-right">IGST</TableHead>
                              <TableHead className="text-xs text-right">CGST</TableHead>
                              <TableHead className="text-xs text-right">SGST</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow>
                              <TableCell className="text-xs">B2B (Registered)</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.b2bTaxableValue, tenant?.currency)}</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.b2bIgst, tenant?.currency)}</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.b2bCgst, tenant?.currency)}</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.b2bSgst, tenant?.currency)}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="text-xs">B2C (Unregistered)</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.b2cTaxableValue, tenant?.currency)}</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.b2cIgst, tenant?.currency)}</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.b2cCgst, tenant?.currency)}</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.b2cSgst, tenant?.currency)}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="text-xs">Nil-rated / Exempt</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.nilRatedExemptTaxableValue, tenant?.currency)}</TableCell>
                              <TableCell colSpan={3} className="text-center text-xs text-muted-foreground">—</TableCell>
                            </TableRow>
                            <TableRow className="font-semibold border-t-2 bg-violet-50 dark:bg-violet-950">
                              <TableCell className="text-xs">Total Outward</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.totalOutwardValue, tenant?.currency)}</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.totalIgstCollected, tenant?.currency)}</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.totalCgstCollected, tenant?.currency)}</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.totalSgstCollected, tenant?.currency)}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="text-xs">Total Inward (Purchases)</TableCell>
                              <TableCell className="text-right text-xs">{formatCurrency(annualSummary.totalInwardValue, tenant?.currency)}</TableCell>
                              <TableCell colSpan={3} className="text-center text-xs text-muted-foreground">—</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    <div className="border-l-4 border-blue-500 pl-4">
                      <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-3">
                        Part III — Details of Input Tax Credit
                      </h4>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded">
                          <p className="text-xs text-muted-foreground">Total ITC (IGST)</p>
                          <p className="text-lg font-bold text-blue-700">{formatCurrency(annualSummary.totalItcIgst, tenant?.currency)}</p>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded">
                          <p className="text-xs text-muted-foreground">Total ITC (CGST)</p>
                          <p className="text-lg font-bold text-blue-700">{formatCurrency(annualSummary.totalItcCgst, tenant?.currency)}</p>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded">
                          <p className="text-xs text-muted-foreground">Total ITC (SGST)</p>
                          <p className="text-lg font-bold text-blue-700">{formatCurrency(annualSummary.totalItcSgst, tenant?.currency)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="border-l-4 border-red-500 pl-4">
                      <h4 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-3">
                        Part IV — Tax Liability &amp; Tax Paid
                      </h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-red-50 dark:bg-red-950 p-3 rounded">
                          <p className="text-xs text-muted-foreground">Net Tax Payable</p>
                          <p className="text-xl font-bold text-red-700">{formatCurrency(annualSummary.netTaxPayable, tenant?.currency)}</p>
                        </div>
                        <div className="bg-emerald-50 dark:bg-emerald-950 p-3 rounded">
                          <p className="text-xs text-muted-foreground">ITC Carried Forward</p>
                          <p className="text-xl font-bold text-emerald-700">{formatCurrency(annualSummary.itcCarriedForward, tenant?.currency)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                        if (!annualSummary) return
                        const blob = new Blob([JSON.stringify({
                          _meta: {
                            type: 'GSTR-9 Annual Return',
                            generatedAt: new Date().toISOString(),
                            company: tenant?.name,
                            gstin: tenant?.gstNumber,
                            financialYear: annualSummary.financialYear,
                          },
                          ...annualSummary,
                        }, null, 2)], { type: 'application/json' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `gstr9_FY${annualSummary.financialYear}.json`
                        a.click()
                        URL.revokeObjectURL(url)
                        toast({ title: 'Exported', description: `GSTR-9 FY${annualSummary.financialYear} saved` })
                      }}>
                        <Download className="h-3.5 w-3.5 mr-1" /> Export GSTR-9 JSON
                      </Button>
                    </div>

                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                      ⚠ System-generated summary. Verify against filed GSTR-1 and GSTR-3B returns before submitting GSTR-9.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Breakdown Tab */}
          <TabsContent value="breakdown">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-blue-600" />
                  Detailed GST Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Component</TableHead>
                        <TableHead className="text-right">Collected (Sales)</TableHead>
                        <TableHead className="text-right">Paid (Purchases)</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">CGST</TableCell>
                        <TableCell className="text-right">{formatCurrency(summary.cgstCollected, tenant?.currency)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(summary.cgstPaid, tenant?.currency)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(summary.cgstCollected - summary.cgstPaid, tenant?.currency)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">SGST</TableCell>
                        <TableCell className="text-right">{formatCurrency(summary.sgstCollected, tenant?.currency)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(summary.sgstPaid, tenant?.currency)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(summary.sgstCollected - summary.sgstPaid, tenant?.currency)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">IGST</TableCell>
                        <TableCell className="text-right">{formatCurrency(summary.igstCollected, tenant?.currency)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(summary.igstPaid, tenant?.currency)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(summary.igstCollected - summary.igstPaid, tenant?.currency)}</TableCell>
                      </TableRow>
                      <TableRow className="font-bold border-t-2">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right">{formatCurrency(summary.salesGst, tenant?.currency)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(summary.purchaseGst, tenant?.currency)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(summary.netGstPayable, tenant?.currency)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
