import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { verifySessionToken } from '@/lib/auth'

// This route returns a STANDALONE HTML page for printing.
// It bypasses the Service Worker entirely — the browser loads it fresh every time.
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  const saleId = params.id
  if (!saleId) {
    return new NextResponse('Sale ID required', { status: 400 })
  }

  // v4.190: EXPLICIT PAPER SIZE SELECTION (replaces unreliable CSS media queries)
  // The CSS `@media print and (max-width: 90mm)` query does NOT reliably fire
  // in browsers' print preview (Chrome evaluates media features against the
  // screen viewport, not the selected paper size). This caused thermal users
  // to keep getting the A4 layout compressed into 80mm paper.
  //
  // Fix: server reads `?paper=thermal|a4` query param and renders ONLY the
  // corresponding layout's CSS — no media query, no fallback, no ambiguity.
  // The UI passes the user's paper preference (saved in localStorage) as the
  // query param when opening the print iframe.

  const paper = (req.nextUrl.searchParams.get('paper') || 'a4').toLowerCase()
  const isThermal = paper === 'thermal' || paper === '80mm' || paper === 'receipt'

  // Auth: check cookie OR query param token
  const cookie = req.cookies.get('bizbook_session')?.value
  const authToken = req.nextUrl.searchParams.get('token')
  if (!cookie && !authToken) {
    return new NextResponse('Authentication required. Please log in.', { status: 401 })
  }

  const sale = await db.sale.findUnique({ where: { id: saleId } })
  if (!sale) {
    return new NextResponse('Sale not found', { status: 404 })
  }

  const tenant = await db.tenant.findUnique({ where: { id: sale.tenantId } })
  if (!tenant) {
    return new NextResponse('Tenant not found', { status: 404 })
  }

  // Parse items
  let parsedItems: any[] = []
  try {
    parsedItems = JSON.parse(sale.items || '[]')
  } catch { /* empty */ }

  // ============================================================
  // DYNAMIC DATA BINDINGS
  // ============================================================
  const sellerName   = tenant.name    || 'BizBook Pro'
  const sellerAddr   = tenant.address || ''
  const sellerPhone  = tenant.phone   || ''
  const sellerEmail  = tenant.email   || ''
  const sellerGst    = tenant.gstNumber || ''
  const upiId        = tenant.upiId   || ''

  const buyerName    = sale.partyName    || ''
  const buyerAddr    = sale.partyAddress || ''
  const buyerGst     = sale.partyGst     || ''

  const invoiceNo    = sale.invoiceNumber || ''
  const invoiceDate  = new Date(sale.date).toLocaleDateString('en-IN', {
                         day: '2-digit', month: '2-digit', year: '2-digit'
                       })
  const statusFlag   = (() => {
                         const u = (sale.paymentStatus || '').toUpperCase()
                         if (u === 'PAID' || u === 'RECEIVED') return 'PAID'
                         if (u === 'PARTIAL') return 'PARTIAL'
                         return 'PENDING'
                       })()

  const now = new Date()
  const sysDate = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const sysTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
  const systemTimestamp = `${sysDate}, ${sysTime}`

  const fmtCurrency = (amt: number) => {
    return '₹' + Number(amt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const upiQrCode = upiId
    ? 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent('upi://pay?pa=' + upiId + '&pn=' + (sellerName) + '&am=' + (sale.upiAmount || 0) + '&cu=INR&tn=Invoice ' + invoiceNo)
    : null

  // ============================================================
  // BUILD CSS — based on paper selection, NO media query wrapping
  // ============================================================
  let pageCss: string

  if (isThermal) {
    // === THERMAL 80MM CONTINUOUS ROLL ===
    pageCss = `
      @page { size: 80mm auto; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: 80mm;
        margin: 0;
        padding: 0;
      }
      body {
        font-family: 'Courier New', monospace;
        color: #000;
        display: block;
        width: 80mm;
      }
      /* Continuous roll — NO pagination */
      * {
        page-break-before: avoid !important;
        page-break-after: avoid !important;
        page-break-inside: avoid !important;
        break-before: avoid !important;
        break-after: avoid !important;
        break-inside: avoid !important;
      }

      .title-banner {
        width: 80mm;
        padding: 3mm 1mm 2mm 1mm;
        border-bottom: 2px solid #000;
        text-align: center;
      }
      .title-banner h1 { font-size: 26px; font-weight: 900; letter-spacing: 3px; line-height: 1.1; }

      .header-row { display: block; width: 80mm; border-bottom: 0; }
      .header-cell {
        width: 80mm;
        padding: 2mm 1mm;
        border-bottom: 1px dashed #000;
      }
      .header-cell.left { border-right: 0; }

      .block-label {
        font-size: 13px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 2px;
        color: #b91c1c;
        margin-bottom: 3px;
        border-bottom: 1px solid #b91c1c;
        padding-bottom: 2px;
      }
      .seller-block .field-name,
      .buyer-block .field-name {
        font-size: 18px;
        font-weight: 900;
        margin-bottom: 3px;
        line-height: 1.2;
      }
      .seller-block .field,
      .buyer-block .field {
        font-size: 13px;
        margin-bottom: 2px;
        line-height: 1.35;
        word-break: break-word;
        font-weight: 600;
      }
      .seller-block .field .lbl,
      .buyer-block .field .lbl {
        display: inline-block;
        font-weight: 900;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #555;
        margin-right: 5px;
      }

      .meta-block {
        text-align: center;
        padding: 2mm 1mm;
        margin: 0;
        border-bottom: 1px dashed #000;
      }
      .meta-block .inv-no {
        font-size: 18px;
        font-weight: 900;
        letter-spacing: 1px;
      }
      .meta-block .inv-date {
        font-size: 14px;
        font-weight: 800;
        margin-top: 2px;
      }
      .meta-block .status-flag {
        display: inline-block;
        margin-top: 4px;
        padding: 3px 12px;
        font-size: 14px;
        font-weight: 900;
        letter-spacing: 2px;
        border: 2px solid #000;
      }
      .meta-block .status-flag.PAID    { background: #14532d; color: #fff; border-color: #14532d; }
      .meta-block .status-flag.PENDING { background: #fff;    color: #b91c1c; border-color: #b91c1c; }
      .meta-block .status-flag.PARTIAL { background: #1e3a8a; color: #fff; border-color: #1e3a8a; }

      .items-section {
        width: 80mm;
        padding: 2mm 1mm;
      }
      table.items {
        width: 100%;
        border-collapse: collapse;
      }
      table.items thead th {
        background: #000;
        color: #fff;
        padding: 4px 2px;
        font-size: 13px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 1px;
        border: 1px solid #000;
        text-align: left;
      }
      table.items thead th.num { text-align: right; }
      table.items tbody td {
        padding: 4px 2px;
        font-size: 14px;
        border: 1px solid #000;
        vertical-align: top;
        word-break: break-word;
      }
      table.items tbody td.num {
        text-align: right;
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        white-space: nowrap;
      }
      table.items tbody td.col-tot { font-weight: 900; }
      table.items tbody td.col-item { font-weight: 700; }
      table.items tbody .svc {
        font-size: 12px;
        color: #b91c1c;
        font-weight: 900;
      }
      /* Hide less-critical columns on thermal to maximize width */
      table.items .col-hsn,  table.items thead .col-hsn,
      table.items .col-disc, table.items thead .col-disc,
      table.items .col-amt,  table.items thead .col-amt { display: none; }

      .bottom-row {
        display: block;
        width: 80mm;
        border-top: 2px solid #000;
      }
      .bottom-cell.left,
      .bottom-cell.right {
        width: 80mm;
        padding: 2mm 1mm;
        border-right: 0;
        border-bottom: 2px solid #000;
      }

      .summary-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 3px 0;
        font-size: 15px;
        font-weight: 700;
        border-bottom: 1px dashed #000;
      }
      .summary-row:last-child { border-bottom: none; }
      .summary-row.total {
        font-size: 20px;
        font-weight: 900;
        border-top: 2px solid #000;
        border-bottom: 2px solid #000;
        padding: 5px 0;
        margin-top: 4px;
        background: #000;
        color: #fff;
      }
      .summary-row.due { font-weight: 900; color: #b91c1c; }

      .qr-cell { text-align: center; }
      .qr-cell img {
        width: 120px;
        height: 120px;
        border: 2px solid #000;
        padding: 2px;
        background: #fff;
      }
      .qr-cell .qr-label {
        font-size: 13px;
        font-weight: 900;
        margin-top: 4px;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #b91c1c;
      }
      .qr-cell .sig {
        margin-top: 3mm;
        border-top: 2px solid #000;
        padding-top: 2mm;
        font-size: 14px;
        font-weight: 900;
      }
      .qr-cell .sig small {
        display: block;
        font-size: 12px;
        font-weight: 600;
        margin-top: 2px;
      }

      .terms {
        width: 80mm;
        padding: 2mm 1mm;
        border-bottom: 2px solid #000;
        font-size: 13px;
        line-height: 1.4;
        font-weight: 600;
      }
      .terms strong { font-size: 14px; font-weight: 900; }

      .einvoice-block {
        width: 80mm;
        padding: 2mm 1mm;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 2px solid #000;
        background: #f0fdf4;
      }
      .einvoice-block h4 { font-size: 14px; margin-bottom: 4px; font-weight: 900; }
      .einvoice-block .meta { font-size: 12px; line-height: 1.4; }

      .footer {
        width: 80mm;
        padding: 3mm 1mm;
        text-align: center;
        background: #000;
        color: #fff;
        font-weight: 700;
      }
      .footer .line1 { font-size: 12px; margin-bottom: 2px; }
      .footer .line2 { font-size: 12px; font-weight: 900; letter-spacing: 0.5px; }
      .footer .line2 .timestamp {
        display: inline-block;
        padding: 2px 6px;
        border: 1px solid #fff;
        font-family: 'Courier New', monospace;
        letter-spacing: 0.5px;
        margin-left: 3px;
      }

      @media print {
        .summary-row.total,
        .footer,
        .meta-block .status-flag.PAID,
        .meta-block .status-flag.PARTIAL,
        table.items thead th {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    `
  } else {
    // === A4 PAPER — edge-to-edge, full table ===
    pageCss = `
      @page { size: A4; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: 210mm;
        min-height: 297mm;
        margin: 0;
        padding: 0;
      }
      body {
        font-family: Arial, Helvetica, sans-serif;
        color: #000;
        padding: 0;
        display: flex;
        flex-direction: column;
        width: 100%;
      }

      .title-banner {
        width: 100%;
        text-align: center;
        padding: 6mm 8mm 4mm 8mm;
        border-bottom: 4px solid #000;
      }
      .title-banner h1 { font-size: 44px; font-weight: 900; letter-spacing: 6px; line-height: 1; }

      .header-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        width: 100%;
        border-bottom: 4px solid #000;
      }
      .header-cell { padding: 5mm 8mm; vertical-align: top; }
      .header-cell.left { border-right: 4px solid #000; }

      .block-label {
        font-size: 14px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 2px;
        color: #b91c1c;
        margin-bottom: 4px;
        border-bottom: 2px solid #b91c1c;
        padding-bottom: 2px;
      }
      .seller-block .field-name,
      .buyer-block .field-name { font-size: 24px; font-weight: 900; margin-bottom: 5px; line-height: 1.15; }
      .seller-block .field,
      .buyer-block .field { font-size: 15px; margin-bottom: 3px; line-height: 1.35; font-weight: 600; }
      .seller-block .field .lbl,
      .buyer-block .field .lbl {
        display: inline-block; font-weight: 900; font-size: 12px; text-transform: uppercase;
        letter-spacing: 1px; color: #555; margin-right: 6px;
      }

      .meta-block {
        text-align: right; padding-bottom: 4mm; margin-bottom: 4mm; border-bottom: 2px dashed #000;
      }
      .meta-block .inv-no { font-size: 26px; font-weight: 900; letter-spacing: 2px; line-height: 1.1; }
      .meta-block .inv-date { font-size: 18px; font-weight: 800; margin-top: 3px; letter-spacing: 1px; }
      .meta-block .status-flag {
        display: inline-block; margin-top: 6px; padding: 4px 16px;
        font-size: 16px; font-weight: 900; letter-spacing: 3px; border: 3px solid #000;
      }
      .meta-block .status-flag.PAID    { background: #14532d; color: #fff; border-color: #14532d; }
      .meta-block .status-flag.PENDING { background: #fff;    color: #b91c1c; border-color: #b91c1c; }
      .meta-block .status-flag.PARTIAL { background: #1e3a8a; color: #fff; border-color: #1e3a8a; }

      .items-section { width: 100%; padding: 0 8mm; flex-grow: 1; }
      table.items { width: 100%; border-collapse: collapse; margin: 0; }
      table.items thead th {
        background: #000; color: #fff; padding: 8px 5px;
        font-size: 14px; font-weight: 900; text-transform: uppercase;
        letter-spacing: 1px; border: 2px solid #000; text-align: left;
      }
      table.items thead th.num { text-align: right; }
      table.items tbody td {
        padding: 6px 5px; font-size: 15px; border: 1px solid #000; vertical-align: top;
      }
      table.items tbody td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
      table.items tbody td.col-tot { font-weight: 900; }
      table.items tbody td.col-hsn { font-family: 'Courier New', monospace; font-weight: 700; letter-spacing: 0.5px; }
      table.items tbody td.col-item { font-weight: 700; }
      table.items tbody .svc { font-size: 11px; color: #b91c1c; font-weight: 900; }

      .bottom-row {
        display: grid; grid-template-columns: 1fr 1fr; width: 100%;
        border-top: 4px solid #000; border-bottom: 4px solid #000;
      }
      .bottom-cell.left  { padding: 5mm 8mm; border-right: 4px solid #000; }
      .bottom-cell.right { padding: 5mm 8mm; }

      .summary-row {
        display: flex; justify-content: space-between; align-items: center;
        padding: 5px 0; font-size: 17px; font-weight: 700; border-bottom: 2px dashed #000;
      }
      .summary-row:last-child { border-bottom: none; }
      .summary-row.total {
        font-size: 26px; font-weight: 900;
        border-top: 3px solid #000; border-bottom: 3px solid #000;
        padding: 8px 0; margin-top: 5px; background: #000; color: #fff;
      }
      .summary-row.due { font-weight: 900; color: #b91c1c; }

      .qr-cell { text-align: center; }
      .qr-cell img { width: 130px; height: 130px; border: 3px solid #000; padding: 3px; background: #fff; }
      .qr-cell .qr-label { font-size: 14px; font-weight: 900; margin-top: 5px; letter-spacing: 1px; text-transform: uppercase; color: #b91c1c; }
      .qr-cell .sig { margin-top: 6mm; border-top: 3px solid #000; padding-top: 3mm; font-size: 14px; font-weight: 900; }
      .qr-cell .sig small { display: block; font-size: 12px; font-weight: 600; margin-top: 2px; }

      .terms {
        width: 100%; padding: 4mm 8mm; border-bottom: 4px solid #000;
        font-size: 15px; line-height: 1.4; font-weight: 600;
      }
      .terms strong { font-size: 17px; font-weight: 900; }

      .einvoice-block {
        width: 100%; padding: 4mm 8mm; display: flex; justify-content: space-between;
        align-items: center; border-bottom: 4px solid #000; background: #f0fdf4;
      }
      .einvoice-block h4 { font-size: 17px; margin-bottom: 4px; font-weight: 900; }
      .einvoice-block .meta { font-size: 14px; line-height: 1.4; }

      .footer {
        width: 100%; padding: 4mm 8mm; text-align: center;
        background: #000; color: #fff; font-weight: 700;
      }
      .footer .line1 { font-size: 14px; margin-bottom: 3px; }
      .footer .line2 { font-size: 14px; font-weight: 900; letter-spacing: 1px; }
      .footer .line2 .timestamp {
        display: inline-block; padding: 3px 10px; border: 2px solid #fff;
        font-family: 'Courier New', monospace; letter-spacing: 1px; margin-left: 5px;
      }

      @media print {
        body { padding: 0; }
        .summary-row.total, .footer,
        .meta-block .status-flag.PAID, .meta-block .status-flag.PARTIAL,
        table.items thead th {
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
      }
    `
  }

  // Item rows
  const itemRows = parsedItems.map((item, i) => `
    <tr>
      <td class="col-no">${i + 1}</td>
      <td class="col-item">${item.name || ''}${item.saleItemType === 'SERVICE' ? ' <span class="svc">[SERVICE]</span>' : ''}</td>
      <td class="col-hsn">${item.hsn || '—'}</td>
      <td class="col-qty num">${item.qty || 0} ${item.unit || ''}</td>
      <td class="col-rate num">${fmtCurrency(item.rate)}</td>
      <td class="col-disc num">${item.discount > 0 ? fmtCurrency(item.discount) : '—'}</td>
      <td class="col-amt num">${fmtCurrency(item.amount)}</td>
      <td class="col-tax num">${fmtCurrency(item.totalTax)}</td>
      <td class="col-tot num">${fmtCurrency(item.total)}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice - ${invoiceNo}</title>
  <style>
    ${pageCss}
    @media screen {
      body {
        max-width: ${isThermal ? '80mm' : '210mm'};
        margin: 0 auto;
        background: #fff;
        box-shadow: 0 0 0 1px #ddd;
      }
    }
  </style>
</head>
<body>

  <div class="title-banner">
    <h1>INVOICE</h1>
  </div>

  <div class="header-row">
    <div class="header-cell left">
      <div class="block-label">Seller</div>
      <div class="seller-block">
        <div class="field-name">${sellerName}</div>
        ${sellerAddr   ? `<div class="field"><span class="lbl">Address</span>${sellerAddr}</div>`   : ''}
        ${sellerPhone  ? `<div class="field"><span class="lbl">Phone</span>${sellerPhone}</div>`    : ''}
        ${sellerEmail  ? `<div class="field"><span class="lbl">Email</span>${sellerEmail}</div>`    : ''}
        ${sellerGst    ? `<div class="field"><span class="lbl">GSTIN</span>${sellerGst}</div>`      : ''}
      </div>
    </div>
    <div class="header-cell right">
      <div class="meta-block">
        <div class="inv-no">#${invoiceNo}</div>
        <div class="inv-date">${invoiceDate}</div>
        <div class="status-flag ${statusFlag}">${statusFlag}</div>
      </div>
      <div class="buyer-block">
        <div class="block-label">Bill To</div>
        <div class="field-name">${buyerName}</div>
        ${buyerAddr ? `<div class="field"><span class="lbl">Address</span>${buyerAddr}</div>` : ''}
        ${buyerGst  ? `<div class="field"><span class="lbl">GSTIN</span>${buyerGst}</div>`    : ''}
      </div>
    </div>
  </div>

  <div class="items-section">
    <table class="items">
      <thead>
        <tr>
          <th class="col-no">#</th>
          <th class="col-item">Item</th>
          <th class="col-hsn">HSN</th>
          <th class="col-qty num">Qty</th>
          <th class="col-rate num">Rate</th>
          <th class="col-disc num">Discount</th>
          <th class="col-amt num">Amount</th>
          <th class="col-tax num">Tax</th>
          <th class="col-tot num">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
  </div>

  <div class="bottom-row">
    <div class="bottom-cell left">
      <div class="summary-row"><span>Subtotal</span><span>${fmtCurrency(sale.subtotal)}</span></div>
      <div class="summary-row"><span>Tax / Duties</span><span>${fmtCurrency(sale.gstAmount)}</span></div>
      <div class="summary-row total"><span>GRAND TOTAL</span><span>${fmtCurrency(sale.totalAmount)}</span></div>
      <div class="summary-row"><span>Amount Received</span><span>${fmtCurrency(sale.amountReceived || sale.amountPaid)}</span></div>
      <div class="summary-row due"><span>Balance Due</span><span>${fmtCurrency(sale.totalAmount - (sale.amountReceived || sale.amountPaid))}</span></div>
    </div>
    <div class="bottom-cell right qr-cell">
      ${upiQrCode
        ? `<img src="${upiQrCode}" alt="UPI QR" /><div class="qr-label">Scan to Pay ${fmtCurrency(sale.upiAmount || 0)}</div>`
        : `<div style="font-size:18px;font-weight:900;letter-spacing:2px;">QR CODE</div>`}
      <div class="sig">Authorised Signatory<small>For ${sellerName}</small></div>
    </div>
  </div>

  ${sale.notes ? `<div class="terms"><strong>Notes:</strong> ${sale.notes}</div>` : ''}

  ${sale.einvoiceStatus === 'GENERATED' ? `
  <div class="einvoice-block">
    <div>
      <h4>E-INVOICE VERIFIED</h4>
      <div class="meta">IRN: <span style="font-family:monospace;word-break:break-all;">${sale.einvoiceIrn || ''}</span></div>
      ${sale.einvoiceAckNo ? `<div class="meta" style="margin-top:3px;">Ack No: ${sale.einvoiceAckNo}</div>` : ''}
    </div>
    ${sale.einvoiceQrCodeText ? `<div style="text-align:center;"><img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(sale.einvoiceQrCodeText)}" alt="QR" style="width:100px;height:100px;border:1px solid #ccc;" /></div>` : ''}
  </div>
  ` : ''}

  <div class="footer">
    <div class="line1">Computer-generated invoice from BizBook Pro</div>
    <div class="line2">by Tahigo International &mdash;<span class="timestamp">${systemTimestamp}</span></div>
  </div>

<script>window.__bizbookInvoiceReady = true;</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
