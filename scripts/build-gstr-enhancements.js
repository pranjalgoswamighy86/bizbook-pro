// scripts/build-gstr-enhancements.js
// Generates the patch for gst-reports.tsx — adds GSTR-3B HSN summary + B2B/B2C classification,
// nil-rated/exempt buckets, and a new GSTR-9 annual report tab.
// Run: node scripts/build-gstr-enhancements.js
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'src', 'components', 'modules', 'gst-reports.tsx')
let src = fs.readFileSync(file, 'utf8')

// ============================================================
// PATCH 1: Extend SaleWithGst interface to include items (for HSN summary)
// ============================================================
src = src.replace(
  `interface SaleWithGst {
  id: string
  invoiceNumber: string
  date: string
  partyName: string
  partyGst: string | null
  subtotal: number
  gstAmount: number
  totalAmount: number
}`,
  `interface SaleWithGst {
  id: string
  invoiceNumber: string
  date: string
  partyName: string
  partyGst: string | null
  partyAddress?: string | null
  subtotal: number
  gstAmount: number
  totalAmount: number
  items?: string  // JSON string of line items
  paymentStatus?: string
  invoiceStatus?: string
}

interface PurchaseWithGstFull {
  id: string
  invoiceNumber: string
  date: string
  partyName: string
  partyGst: string | null
  subtotal: number
  gstAmount: number
  totalAmount: number
  items?: string
}

// v4.149: GSTR-3B HSN-wise summary row
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
  financialYear: string                            // "2024-25"
  // GSTR-1 annual totals
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
  cdnrTaxableValue: number                          // Credit/Debit Notes Registered
  cdnrIgst: number
  cdnrCgst: number
  cdnrSgst: number
  // GSTR-3B annual totals
  totalOutwardValue: number
  totalIgstCollected: number
  totalCgstCollected: number
  totalSgstCollected: number
  totalCessCollected: number
  // ITC (GSTR-2 / GSTR-3B)
  totalItcIgst: number
  totalItcCgst: number
  totalItcSgst: number
  totalItcCess: number
  totalInwardValue: number
  // Net payable
  netTaxPayable: number
  // Late fee / interest / penalty
  lateFee: number
  interest: number
  penalty: number
  // Final
  totalTaxPaid: number
  itcCarriedForward: number
}`
)

console.log('PATCH 1: Extended SaleWithGst + added HsnSummaryRow + AnnualSummary interfaces')

// ============================================================
// PATCH 2: Add state for GSTR-9 + HSN summary
// ============================================================
src = src.replace(
  `  const [sales, setSales] = useState<SaleWithGst[]>([])
  const [purchases, setPurchases] = useState<PurchaseWithGst[]>([])`,
  `  const [sales, setSales] = useState<SaleWithGst[]>([])
  const [purchases, setPurchases] = useState<PurchaseWithGst[]>([])
  // v4.149: GSTR-3B HSN-wise summary
  const [hsnSummary, setHsnSummary] = useState<HsnSummaryRow[]>([])
  // v4.149: GSTR-9 annual aggregation
  const [annualSummary, setAnnualSummary] = useState<AnnualSummary | null>(null)
  const [annualLoading, setAnnualLoading] = useState(false)`
)

console.log('PATCH 2: Added state for HSN summary + annual summary')

// ============================================================
// PATCH 3: Compute HSN-wise summary after loading sales
// ============================================================
src = src.replace(
  `      setSummary({
        period: selectedPeriod,
        totalSales, totalPurchases, salesGst, purchaseGst,
        cgstCollected, sgstCollected, igstCollected,
        cgstPaid, sgstPaid, igstPaid,
        netGstPayable, itc,
      })
      setSales(allSales)
      setPurchases(allPurchases)`,
  `      setSummary({
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
        } catch { /* items JSON malformed — skip */ }
      }
      setHsnSummary(Array.from(hsnMap.values()).sort((a, b) => a.hsn.localeCompare(b.hsn)))`
)

console.log('PATCH 3: Added HSN-wise summary computation')

// ============================================================
// PATCH 4: Add loadAnnualSummary function and GSTR-9 tab
// ============================================================
src = src.replace(
  `  const handleExportJson = () => {`,
  `  // v4.149: Load GSTR-9 annual summary for a financial year
  // FY "2024-25" runs from 1 Apr 2024 to 31 Mar 2025
  const loadAnnualSummary = async (fyYear: number) => {
    if (!tenant) return
    setAnnualLoading(true)
    try {
      const startDate = new Date(fyYear, 3, 1)              // 1 April
      const endDate = new Date(fyYear + 1, 3, 1)             // 1 April next year
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

      // B2B vs B2C classification: B2B = buyer has GSTIN, B2C = no GSTIN
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

      // ITC from purchases
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
      const totalCessCollected = 0
      const netTaxPayable = roundTo2(
        totalIgstCollected + totalCgstCollected + totalSgstCollected + totalCessCollected
        - itcIgst - itcCgst - itcSgst
      )

      setAnnualSummary({
        financialYear: \`\${fyYear}-\${String(fyYear + 1).slice(2)}\`,
        b2bTaxableValue: b2bTaxable, b2bIgst, b2bCgst, b2bSgst, b2bCess: 0,
        b2cTaxableValue: b2cTaxable, b2cIgst, b2cCgst, b2cSgst, b2cCess: 0,
        nilRatedExemptTaxableValue: nilRated,
        cdnrTaxableValue: cdnrTaxable, cdnrIgst, cdnrCgst, cdnrSgst,
        totalOutwardValue: totalOutward,
        totalIgstCollected, totalCgstCollected, totalSgstCollected, totalCessCollected,
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

  const handleExportJson = () => {`
)

console.log('PATCH 4: Added loadAnnualSummary function')

// ============================================================
// PATCH 5: Add GSTR-9 tab trigger
// ============================================================
src = src.replace(
  `        <Tabs defaultValue="gstr1">
          <TabsList>
            <TabsTrigger value="gstr1">GSTR-1 (Sales)</TabsTrigger>
            <TabsTrigger value="gstr3b">GSTR-3B (Summary)</TabsTrigger>
            <TabsTrigger value="breakdown">GST Breakdown</TabsTrigger>
          </TabsList>`,
  `        <Tabs defaultValue="gstr1">
          <TabsList className="flex-wrap">
            <TabsTrigger value="gstr1">GSTR-1 (Sales)</TabsTrigger>
            <TabsTrigger value="gstr3b">GSTR-3B (Summary)</TabsTrigger>
            <TabsTrigger value="gstr9">GSTR-9 (Annual)</TabsTrigger>
            <TabsTrigger value="breakdown">GST Breakdown</TabsTrigger>
          </TabsList>`
)

console.log('PATCH 5: Added GSTR-9 tab trigger')

// ============================================================
// PATCH 6: Add GSTR-3B HSN summary section (before closing </CardContent> of gstr3b tab)
// ============================================================
src = src.replace(
  `                  {/* Net Payable */}
                  <div className={`${summary.netGstPayable >= 0 ? 'bg-red-50 dark:bg-red-950' : 'bg-emerald-50 dark:bg-emerald-950'} p-4 rounded-lg`">`,
  `                  {/* v4.149: HSN-wise Summary (GSTR-3B Section 4) */}
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
                  <div className={`${summary.netGstPayable >= 0 ? 'bg-red-50 dark:bg-red-950' : 'bg-emerald-50 dark:bg-emerald-950'} p-4 rounded-lg`">`
)

console.log('PATCH 6: Added HSN-wise summary section in GSTR-3B')

// ============================================================
// PATCH 7: Add GSTR-9 Annual Report tab content
// ============================================================
src = src.replace(
  `          {/* Breakdown Tab */}
          <TabsContent value="breakdown">`,
  `          {/* v4.149: GSTR-9 Annual Report Tab */}
          <TabsContent value="gstr9">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-violet-600" />
                  GSTR-9: Annual Return (Consolidated)
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  GSTR-9 must be filed by every registered taxpayer (except composition dealers) by 31st December following the financial year.
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
                    {/* Part I: General Information */}
                    <div className="border-l-4 border-violet-500 pl-4">
                      <h4 className="text-sm font-semibold text-violet-700 dark:text-violet-300">Part I — General Information</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Financial Year: <span className="font-mono">{annualSummary.financialYear}</span>
                      </p>
                    </div>

                    {/* Part II: Details of Outward and Inward Supplies */}
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

                    {/* Part III: ITC Details */}
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

                    {/* Part IV: Tax Liability & Paid */}
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

                    {/* Export buttons */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => {
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
                          a.download = \`gstr9_FY\${annualSummary.financialYear}.json\`
                          a.click()
                          URL.revokeObjectURL(url)
                          toast({ title: 'Exported', description: \`GSTR-9 FY\${annualSummary.financialYear} saved\` })
                        }}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" /> Export GSTR-9 JSON
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => {
                          if (!annualSummary) return
                          // Plain-text format that can be copy-pasted into the GST portal
                          const txt = [
                            \`GSTR-9 — Annual Return for FY \${annualSummary.financialYear}\`,
                            \`Company: \${tenant?.name} (GSTIN: \${tenant?.gstNumber || 'N/A'})\`,
                            \`\`,
                            \`PART II: OUTWARD SUPPLIES\`,
                            \`B2B Taxable: \${annualSummary.b2bTaxableValue} (IGST: \${annualSummary.b2bIgst} / CGST: \${annualSummary.b2bCgst} / SGST: \${annualSummary.b2bSgst})\`,
                            \`B2C Taxable: \${annualSummary.b2cTaxableValue} (IGST: \${annualSummary.b2cIgst} / CGST: \${annualSummary.b2cCgst} / SGST: \${annualSummary.b2cSgst})\`,
                            \`Nil-rated / Exempt: \${annualSummary.nilRatedExemptTaxableValue}\`,
                            \`Total Outward: \${annualSummary.totalOutwardValue}\`,
                            \`\`,
                            \`PART III: INPUT TAX CREDIT\`,
                            \`ITC IGST: \${annualSummary.totalItcIgst}\`,
                            \`ITC CGST: \${annualSummary.totalItcCgst}\`,
                            \`ITC SGST: \${annualSummary.totalItcSgst}\`,
                            \`Total Inward: \${annualSummary.totalInwardValue}\`,
                            \`\`,
                            \`PART IV: TAX PAYABLE\`,
                            \`Net Tax Payable: \${annualSummary.netTaxPayable}\`,
                            \`ITC Carried Forward: \${annualSummary.itcCarriedForward}\`,
                          ].join('\\n')
                          const blob = new Blob([txt], { type: 'text/plain' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = \`gstr9_FY\${annualSummary.financialYear}.txt\`
                          a.click()
                          URL.revokeObjectURL(url)
                        }}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" /> Export TXT
                      </Button>
                    </div>

                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                      ⚠ This is a system-generated summary. Verify against your filed GSTR-1 and GSTR-3B returns before submitting GSTR-9 to the GST portal.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Breakdown Tab */}
          <TabsContent value="breakdown">`
)

console.log('PATCH 7: Added GSTR-9 annual report tab content')

// Write the patched file
fs.writeFileSync(file, src, 'utf8')
console.log('\\n✅ All 7 patches applied to gst-reports.tsx')
console.log('File size:', src.length, 'chars')
