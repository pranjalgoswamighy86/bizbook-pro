import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'

// =====================================================================
// INVOICE PRINT ROUTE — v5.0 (COMPLETE REBUILD)
// =====================================================================
// Old versions (v4.185–v4.192) accumulated conflicting CSS rules, broken
// media queries, and unreliable auto-detection logic. This file is a
// clean rewrite from scratch with these principles:
//
// 1. ONE route, ONE HTML template, TWO CSS scopes (A4 / thermal)
// 2. Paper size is an explicit query param: ?paper=a4 | ?paper=thermal
//    No media queries, no auto-detection, no surprises.
// 3. Each CSS scope is SELF-CONTAINED — no shared rules, no overrides
// 4. A4 layout uses traditional A4 invoice format (was working in v4.188)
// 5. Thermal layout uses 80mm continuous-roll format with 0 margins
// 6. No flexbox column tricks that push footer off-page
// 7. No `width: 100%` overriding `width: 210mm` conflicts
// 8. Auth via cookie OR token query param (same as before)
// =====================================================================

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: saleId } = await context.params
  if (!saleId) return new NextResponse('Sale ID required', { status: 400 })

  const paper = (req.nextUrl.searchParams.get('paper') || 'a4').toLowerCase()
  const isThermal = paper === 'thermal' || paper === '80mm'

  // Auth: cookie OR token query param
  const cookie = req.cookies.get('bizbook_session')?.value
  const token = req.nextUrl.searchParams.get('token')
  if (!cookie && !token) {
    return new NextResponse('Authentication required', { status: 401 })
  }

  // Load data
  const sale = await db.sale.findUnique({ where: { id: saleId } })
  if (!sale) return new NextResponse('Sale not found', { status: 404 })
  const tenant = await db.tenant.findUnique({ where: { id: sale.tenantId } })
  if (!tenant) return new NextResponse('Tenant not found', { status: 404 })

  let items: any[] = []
  try { items = JSON.parse(sale.items || '[]') } catch { items = [] }

  // ---- Format helpers ----
  const fmtINR = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })
  const fmtDate = (d: Date) => new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: '2-digit'
  })
  const statusText = (() => {
    const u = (sale.paymentStatus || '').toUpperCase()
    if (u === 'PAID' || u === 'RECEIVED') return 'PAID'
    if (u === 'PARTIAL') return 'PARTIAL'
    return 'PENDING'
  })()

  // Live system timestamp: dd/mm/yyyy, HH:MM:SS pm/am
  const now = new Date()
  const sysDate = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const sysTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
  const systemTimestamp = `${sysDate}, ${sysTime}`

  // ---- Data bindings ----
  const sellerName = tenant.name || 'BizBook Pro'
  const sellerAddr = tenant.address || ''
  const sellerPhone = tenant.phone || ''
  const sellerEmail = tenant.email || ''
  const sellerGst = tenant.gstNumber || ''
  const upiId = tenant.upiId || ''
  const buyerName = sale.partyName || ''
  const buyerAddr = sale.partyAddress || ''
  const buyerGst = sale.partyGst || ''
  const invNo = sale.invoiceNumber || ''
  const invDate = fmtDate(sale.date)

  const upiQr = upiId
    ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent('upi://pay?pa=' + upiId + '&pn=' + sellerName + '&am=' + (sale.upiAmount || 0) + '&cu=INR&tn=Invoice ' + invNo)}`
    : ''

  // ---- Item rows ----
  const itemRows = items.map((it, i) => `
    <tr>
      <td class="c-no">${i + 1}</td>
      <td class="c-item">${it.name || ''}${it.saleItemType === 'SERVICE' ? ' [SVC]' : ''}</td>
      <td class="c-hsn">${it.hsn || '—'}</td>
      <td class="c-qty num">${it.qty || 0} ${it.unit || ''}</td>
      <td class="c-rate num">${fmtINR(it.rate)}</td>
      <td class="c-disc num">${it.discount > 0 ? fmtINR(it.discount) : '—'}</td>
      <td class="c-amt num">${fmtINR(it.amount)}</td>
      <td class="c-tax num">${fmtINR(it.totalTax)}</td>
      <td class="c-tot num">${fmtINR(it.total)}</td>
    </tr>`).join('')

  // ---- CSS — pick ONE scope, no overlap ----
  const css = isThermal ? CSS_THERMAL : CSS_A4

  // ---- HTML — single template ----
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Invoice ${invNo}</title>
  <style>${css}</style>
</head>
<body>
  <header class="title">
    <h1>INVOICE</h1>
  </header>

  <section class="parties">
    <div class="seller">
      <div class="lbl">Seller</div>
      <div class="name">${sellerName}</div>
      ${sellerAddr  ? `<div>${sellerAddr}</div>` : ''}
      ${sellerPhone ? `<div>Ph: ${sellerPhone}</div>` : ''}
      ${sellerEmail ? `<div>${sellerEmail}</div>` : ''}
      ${sellerGst   ? `<div>GSTIN: ${sellerGst}</div>` : ''}
    </div>
    <div class="buyer">
      <div class="meta">
        <div class="inv-no">#${invNo}</div>
        <div class="inv-date">${invDate}</div>
        <div class="status ${statusText}">${statusText}</div>
      </div>
      <div class="lbl">Bill To</div>
      <div class="name">${buyerName}</div>
      ${buyerAddr ? `<div>${buyerAddr}</div>` : ''}
      ${buyerGst  ? `<div>GSTIN: ${buyerGst}</div>` : ''}
    </div>
  </section>

  <table class="items">
    <colgroup>
      <col class="c-no"><col class="c-item"><col class="c-hsn"><col class="c-qty">
      <col class="c-rate"><col class="c-disc"><col class="c-amt"><col class="c-tax"><col class="c-tot">
    </colgroup>
    <thead><tr>
      <th class="c-no">#</th>
      <th class="c-item">Item</th>
      <th class="c-hsn">HSN</th>
      <th class="c-qty num">Qty</th>
      <th class="c-rate num">Rate</th>
      <th class="c-disc num">Disc</th>
      <th class="c-amt num">Amt</th>
      <th class="c-tax num">Tax</th>
      <th class="c-tot num">Total</th>
    </tr></thead>
    <tbody>${itemRows}</tbody>
  </table>

  <section class="totals">
    <div class="row"><span>Subtotal</span><span>${fmtINR(sale.subtotal)}</span></div>
    <div class="row"><span>Tax</span><span>${fmtINR(sale.gstAmount)}</span></div>
    <div class="row grand"><span>GRAND TOTAL</span><span>${fmtINR(sale.totalAmount)}</span></div>
    <div class="row"><span>Received</span><span>${fmtINR(sale.amountReceived || sale.amountPaid)}</span></div>
    <div class="row due"><span>Balance Due</span><span>${fmtINR(sale.totalAmount - (sale.amountReceived || sale.amountPaid))}</span></div>
  </section>

  ${sale.notes ? `<section class="notes"><strong>Notes:</strong> ${sale.notes}</section>` : ''}

  ${sale.einvoiceStatus === 'GENERATED' ? `
  <section class="einv">
    <strong>E-INVOICE VERIFIED</strong>
    <div>IRN: <code>${sale.einvoiceIrn || ''}</code></div>
    ${sale.einvoiceAckNo ? `<div>Ack: ${sale.einvoiceAckNo}</div>` : ''}
  </section>` : ''}

  ${upiQr ? `<section class="qr"><img src="${upiQr}" alt="UPI"><div>Scan to Pay ${fmtINR(sale.upiAmount || 0)}</div></section>` : ''}

  <section class="sig">
    <div class="line"></div>
    <div>Authorised Signatory</div>
    <div class="for">For ${sellerName}</div>
  </section>

  <footer class="footer">
    <div>Computer-generated invoice from BizBook Pro</div>
    <div>by Tahigo International — <span class="ts">${systemTimestamp}</span></div>
    <div class="ver">v5.1 · ${paper.toUpperCase()}</div>
  </footer>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-BizBook-Version': 'v5.1',
      'X-Frame-Options': 'ALLOWALL',
    },
  })
}

// =====================================================================
// CSS — A4 LAYOUT (210mm × 297mm sheet)
// Traditional invoice format, edge-to-edge, no flexbox tricks
// =====================================================================
const CSS_A4 = `
@page { size: A4; margin: 10mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: Arial, Helvetica, sans-serif;
  color: #000;
  font-size: 12pt;
  line-height: 1.4;
}
.title { text-align: center; border-bottom: 3px solid #000; padding-bottom: 6mm; margin-bottom: 6mm; }
.title h1 { font-size: 28pt; font-weight: bold; letter-spacing: 4px; }

.parties { display: flex; gap: 10mm; margin-bottom: 6mm; }
.seller, .buyer { flex: 1; }
.buyer { text-align: right; }
.parties .lbl { font-size: 9pt; font-weight: bold; text-transform: uppercase; color: #b91c1c; letter-spacing: 1px; margin-bottom: 2mm; border-bottom: 1px solid #b91c1c; padding-bottom: 1mm; }
.parties .name { font-size: 14pt; font-weight: bold; margin-bottom: 2mm; }
.parties div { font-size: 10pt; margin-bottom: 1mm; }

.buyer .meta { margin-bottom: 4mm; }
.inv-no { font-size: 16pt; font-weight: bold; }
.inv-date { font-size: 11pt; }
.status { display: inline-block; margin-top: 2mm; padding: 2px 10px; font-size: 10pt; font-weight: bold; border: 2px solid #000; }
.status.PAID { background: #14532d; color: #fff; border-color: #14532d; }
.status.PENDING { color: #b91c1c; border-color: #b91c1c; }
.status.PARTIAL { background: #1e3a8a; color: #fff; border-color: #1e3a8a; }

.items { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
.items th, .items td { border: 1px solid #000; padding: 4px 6px; font-size: 10pt; }
.items th { background: #000; color: #fff; font-weight: bold; text-transform: uppercase; font-size: 9pt; }
.items td.num, .items th.num { text-align: right; }
.items td.c-tot { font-weight: bold; }

.totals { width: 60%; margin-left: 40%; margin-bottom: 6mm; }
.totals .row { display: flex; justify-content: space-between; padding: 4px 6px; border-bottom: 1px solid #ccc; font-size: 11pt; }
.totals .grand { font-size: 14pt; font-weight: bold; background: #000; color: #fff; border: 2px solid #000; padding: 6px; margin-top: 2mm; }
.totals .due { color: #b91c1c; font-weight: bold; border-bottom: none; }

.notes, .einv { padding: 4mm; border: 1px solid #000; margin-bottom: 4mm; font-size: 10pt; }
.einv { background: #f0fdf4; }
.einv code { font-family: monospace; word-break: break-all; }

.qr { text-align: center; margin: 4mm 0; }
.qr img { width: 120px; height: 120px; border: 1px solid #ccc; }
.qr div { font-size: 10pt; font-weight: bold; margin-top: 2mm; }

.sig { margin-top: 8mm; text-align: right; }
.sig .line { border-top: 1px solid #000; width: 50mm; margin-left: auto; margin-bottom: 2mm; }
.sig div { font-size: 10pt; }
.sig .for { font-size: 9pt; color: #555; }

.footer { margin-top: 8mm; padding-top: 3mm; border-top: 2px solid #000; text-align: center; font-size: 9pt; color: #555; }
.footer .ts { font-family: monospace; }
.footer .ver { font-size: 7pt; color: #999; margin-top: 1mm; }

@media print {
  .items th { background: #000 !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .totals .grand, .status.PAID, .status.PARTIAL { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`

// =====================================================================
// CSS — THERMAL 80mm LAYOUT (continuous roll)
// v5.1: @page size 80mm 9999mm — tricks browser into treating the entire
//       document as ONE long page, no pagination. Removed all page-break
//       rules so content flows continuously along the roll.
//       For TRUE continuous-roll (no browser pagination at all), use the
//       Electron desktop app which bypasses the browser print engine.
// =====================================================================
const CSS_THERMAL = `
@page { size: 80mm 9999mm; margin: 0; }
* {
  margin: 0; padding: 0; box-sizing: border-box;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
body {
  font-family: 'Courier New', monospace;
  color: #000;
  width: 80mm;
  padding: 2mm;
  font-size: 11pt;
  line-height: 1.3;
}

.title { text-align: center; border-bottom: 2px solid #000; padding-bottom: 2mm; margin-bottom: 2mm; }
.title h1 { font-size: 16pt; font-weight: bold; letter-spacing: 2px; }

.parties { margin-bottom: 2mm; }
.seller, .buyer { width: 100%; }
.buyer { margin-top: 2mm; padding-top: 2mm; border-top: 1px dashed #000; }
.parties .lbl { font-size: 8pt; font-weight: bold; text-transform: uppercase; color: #b91c1c; letter-spacing: 1px; margin-bottom: 1mm; }
.parties .name { font-size: 12pt; font-weight: bold; margin-bottom: 1mm; }
.parties div { font-size: 9pt; margin-bottom: 0.5mm; word-break: break-word; }

.buyer .meta { text-align: center; margin-bottom: 2mm; padding-bottom: 2mm; border-bottom: 1px dashed #000; }
.inv-no { font-size: 12pt; font-weight: bold; }
.inv-date { font-size: 9pt; }
.status { display: inline-block; margin-top: 1mm; padding: 1px 6px; font-size: 8pt; font-weight: bold; border: 1px solid #000; }
.status.PAID { background: #14532d !important; color: #fff !important; border-color: #14532d !important; }
.status.PENDING { color: #b91c1c !important; border-color: #b91c1c !important; }
.status.PARTIAL { background: #1e3a8a !important; color: #fff !important; border-color: #1e3a8a !important; }

.items { width: 100%; border-collapse: collapse; margin-bottom: 2mm; table-layout: fixed; }
.items th, .items td { border: 1px solid #000; padding: 1.5px 2px; font-size: 8pt; word-break: break-word; }
.items th { background: #000 !important; color: #fff !important; font-weight: bold; text-transform: uppercase; font-size: 7pt; }
.items td.num, .items th.num { text-align: right; white-space: nowrap; }
.items td.c-tot { font-weight: bold; }
/* Hide narrow-only columns on thermal */
.items .c-hsn, .items .c-disc, .items .c-amt { display: none; }
.c-no { width: 6%; }
.c-item { width: 44%; }
.c-qty { width: 16%; }
.c-rate { width: 16%; }
.c-tax { width: 8%; }
.c-tot { width: 10%; }

.totals { width: 100%; margin-bottom: 2mm; }
.totals .row { display: flex; justify-content: space-between; padding: 1.5px 0; border-bottom: 1px dashed #000; font-size: 9pt; }
.totals .grand { font-size: 11pt; font-weight: bold; background: #000 !important; color: #fff !important; border: 1px solid #000; padding: 2px 4px; margin-top: 1mm; }
.totals .due { color: #b91c1c !important; font-weight: bold; border-bottom: none; }

.notes, .einv { padding: 1.5mm; border: 1px solid #000; margin-bottom: 2mm; font-size: 8pt; word-break: break-word; }
.einv { background: #f0fdf4; }
.einv code { font-family: monospace; word-break: break-all; font-size: 7pt; }

.qr { text-align: center; margin: 2mm 0; }
.qr img { width: 80px; height: 80px; border: 1px solid #000; }
.qr div { font-size: 8pt; font-weight: bold; margin-top: 1mm; }

.sig { margin-top: 3mm; text-align: center; }
.sig .line { border-top: 1px solid #000; width: 60%; margin: 0 auto 1mm; }
.sig div { font-size: 8pt; }
.sig .for { font-size: 7pt; color: #555; }

.footer { margin-top: 3mm; padding-top: 2mm; border-top: 2px solid #000; text-align: center; font-size: 7pt; }
.footer .ts { font-family: monospace; word-break: break-all; }
.footer .ver { font-size: 6pt; color: #999; margin-top: 1mm; }
`
