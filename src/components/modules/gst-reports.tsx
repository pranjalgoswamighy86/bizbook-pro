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
  subtotal: number
  gstAmount: number
  totalAmount: number
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
    } catch {
      toast({ title: 'Error', description: 'Failed to load GST data', variant: 'destructive' })
    } finally {
      setLoading(false)
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
          <TabsList>
            <TabsTrigger value="gstr1">GSTR-1 (Sales)</TabsTrigger>
            <TabsTrigger value="gstr3b">GSTR-3B (Summary)</TabsTrigger>
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
