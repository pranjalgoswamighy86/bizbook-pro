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

  // v4.187: DYNAMIC TEMPLATE STANDARDIZATION (wireframe: image (1).png)
  // - Seller block (top-left): Seller Name, Address, Phone, Email — DYNAMIC bindings
  // - Invoice metadata (top-right): #INV-XXXXXX, dd/mm/yy, PAID/PENDING status flag
  // - Buyer block (top-right, nested): Bill To / Buyer Name / destination address
  // - Itemized table RESTRUCTURED: each item is a STACKED grid block with a
  //   dedicated HSN vertical column box on the right (no longer a wide table)
  // - Footer: live system timestamp token `dd/mm/yyyy, HH:MM:SS pm/am`
  // - @media print and (max-width: 90mm) thermal auto-detection preserved
  // - Edge-to-edge fluid layout from v4.186 preserved

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
  // DYNAMIC DATA BINDINGS — all field values resolved at render
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

  // Live metadata pulled from the transaction record
  const invoiceNo    = sale.invoiceNumber || ''
  const invoiceDate  = new Date(sale.date).toLocaleDateString('en-IN', {
                         day: '2-digit', month: '2-digit', year: '2-digit'
                       })   // dd/mm/yy
  const statusFlag   = (() => {
                         const u = (sale.paymentStatus || '').toUpperCase()
                         if (u === 'PAID' || u === 'RECEIVED') return 'PAID'
                         if (u === 'PARTIAL') return 'PARTIAL'
                         return 'PENDING'
                       })()

  // Live system timestamp token: dd/mm/yyyy, HH:MM:SS pm/am
  const now = new Date()
  const sysDate = now.toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })
  const sysTime = now.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true
  })
  const systemTimestamp = `${sysDate}, ${sysTime}`   // dd/mm/yyyy, HH:MM:SS pm/am

  // Currency formatter
  const fmtCurrency = (amt: number) => {
    return '₹' + Number(amt || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    })
  }

  // Build UPI QR if configured
  const upiQrCode = upiId
    ? 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent('upi://pay?pa=' + upiId + '&pn=' + (sellerName) + '&am=' + (sale.upiAmount || 0) + '&cu=INR&tn=Invoice ' + invoiceNo)
    : null

  // ============================================================
  // MULTI-ITEM STACKED ARRAY LOOP
  // Each item is rendered as a grid block: details on left, HSN vertical box on right
  // ============================================================
  const itemBlocks = parsedItems.map((item, i) => {
    const itemQty      = `${item.qty || 0} ${item.unit || ''}`
    const itemRate     = fmtCurrency(item.rate)
    const itemDiscount = item.discount > 0 ? fmtCurrency(item.discount) : '₹0.00'
    const itemAmount   = fmtCurrency(item.amount)
    const itemTax      = fmtCurrency(item.totalTax)
    const itemTotal    = fmtCurrency(item.total)
    const hsn          = item.hsn || '—'
    const itemName     = item.name + (item.saleItemType === 'SERVICE' ? ' [SERVICE]' : '')
    return `
    <div class="item-block">
      <div class="item-no">${i + 1}</div>
      <div class="item-detail">
        <div class="item-name">${itemName}</div>
        <div class="item-row"><span class="lbl">Qty</span><span class="val">${itemQty}</span></div>
        <div class="item-row"><span class="lbl">Rate</span><span class="val">${itemRate}</span></div>
        <div class="item-row"><span class="lbl">Discount</span><span class="val">${itemDiscount}</span></div>
        <div class="item-row"><span class="lbl">Amount</span><span class="val">${itemAmount}</span></div>
        <div class="item-row"><span class="lbl">Tax</span><span class="val">${itemTax}</span></div>
        <div class="item-row total-row"><span class="lbl">Total</span><span class="val">${itemTotal}</span></div>
      </div>
      <div class="item-hsn">
        <div class="hsn-label">HSN</div>
        <div class="hsn-value">${hsn}</div>
      </div>
    </div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice - ${invoiceNo}</title>
  <style>
    /* ====================================================================
       v4.187 — DYNAMIC TEMPLATE STANDARDIZATION (wireframe: image 1.png)
       - Edge-to-edge fluid layout (padding: 0, width: 100%)
       - Stacked grid blocks for line items with vertical HSN column
       - Live system timestamp token in footer
       ==================================================================== */
    * { margin: 0; padding: 0; box-sizing: border-box; }

    /* === DEFAULT: A4 PRINTER — full bleed, edge-to-edge === */
    @page { size: A4; margin: 0; }
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

    /* --- INVOICE TITLE BANNER (full-width, centered) --- */
    .title-banner {
      width: 100%;
      text-align: center;
      padding: 8mm 8mm 5mm 8mm;
      border-bottom: 4px solid #000;
    }
    .title-banner h1 {
      font-size: 56px;
      font-weight: 900;
      letter-spacing: 6px;
      line-height: 1;
    }

    /* --- HEADER ROW: seller (left) + metadata/buyer (right) --- */
    .header-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      width: 100%;
      border-bottom: 4px solid #000;
    }
    .header-cell {
      padding: 6mm 8mm;
      vertical-align: top;
    }
    .header-cell.left  { border-right: 4px solid #000; }
    .header-cell.right { }

    .block-label {
      font-size: 16px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #b91c1c;   /* red accent per wireframe */
      margin-bottom: 6px;
      border-bottom: 2px solid #b91c1c;
      padding-bottom: 3px;
    }

    /* Seller field bindings */
    .seller-block .field-name {
      font-size: 28px;
      font-weight: 900;
      margin-bottom: 8px;
      line-height: 1.15;
    }
    .seller-block .field {
      font-size: 18px;
      margin-bottom: 4px;
      line-height: 1.35;
      font-weight: 600;
    }
    .seller-block .field .lbl {
      display: inline-block;
      font-weight: 900;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #555;
      margin-right: 6px;
    }

    /* Invoice metadata (right side, top) */
    .meta-block {
      text-align: right;
      padding-bottom: 5mm;
      margin-bottom: 5mm;
      border-bottom: 2px dashed #000;
    }
    .meta-block .inv-no {
      font-size: 32px;
      font-weight: 900;
      letter-spacing: 2px;
      line-height: 1.1;
    }
    .meta-block .inv-date {
      font-size: 22px;
      font-weight: 800;
      margin-top: 4px;
      letter-spacing: 1px;
    }
    .meta-block .status-flag {
      display: inline-block;
      margin-top: 8px;
      padding: 6px 20px;
      font-size: 20px;
      font-weight: 900;
      letter-spacing: 3px;
      border: 3px solid #000;
    }
    .meta-block .status-flag.PAID     { background: #14532d; color: #fff; border-color: #14532d; }
    .meta-block .status-flag.PENDING  { background: #fff;    color: #b91c1c; border-color: #b91c1c; }
    .meta-block .status-flag.PARTIAL  { background: #1e3a8a; color: #fff; border-color: #1e3a8a; }

    /* Buyer nested block (right side, below meta) */
    .buyer-block .field-name {
      font-size: 24px;
      font-weight: 900;
      margin-bottom: 6px;
      line-height: 1.15;
    }
    .buyer-block .field {
      font-size: 18px;
      margin-bottom: 4px;
      line-height: 1.35;
      font-weight: 600;
    }
    .buyer-block .field .lbl {
      display: inline-block;
      font-weight: 900;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #555;
      margin-right: 6px;
    }

    /* --- ITEMS SECTION: STACKED GRID BLOCKS WITH HSN VERTICAL COLUMN --- */
    .items-section {
      width: 100%;
      padding: 4mm 8mm;
      flex-grow: 1;
    }
    .items-header {
      display: grid;
      grid-template-columns: 8mm 1fr 30mm;
      align-items: center;
      padding: 6px 0;
      border-bottom: 4px solid #000;
    }
    .items-header .col-no   { font-size: 16px; font-weight: 900; color: #b91c1c; text-transform: uppercase; letter-spacing: 1px; }
    .items-header .col-item { font-size: 22px; font-weight: 900; color: #b91c1c; text-transform: uppercase; letter-spacing: 2px; }
    .items-header .col-hsn  { font-size: 22px; font-weight: 900; color: #b91c1c; text-transform: uppercase; letter-spacing: 2px; text-align: center; }

    .item-block {
      display: grid;
      grid-template-columns: 8mm 1fr 30mm;
      border-bottom: 3px solid #000;
      padding: 4mm 0;
      align-items: stretch;
    }
    .item-block:last-child { border-bottom: 4px solid #000; }

    .item-no {
      font-size: 18px;
      font-weight: 900;
      text-align: center;
      padding-top: 2mm;
    }

    .item-detail { padding: 0 4mm; }
    .item-name {
      font-size: 22px;
      font-weight: 900;
      margin-bottom: 4px;
      line-height: 1.2;
    }
    .item-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 2px 0;
      font-size: 18px;
      border-bottom: 1px dotted #ccc;
    }
    .item-row .lbl {
      font-weight: 700;
      color: #555;
      text-transform: uppercase;
      font-size: 14px;
      letter-spacing: 1px;
    }
    .item-row .val {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .item-row.total-row {
      border-top: 2px solid #000;
      border-bottom: none;
      padding-top: 5px;
      margin-top: 4px;
    }
    .item-row.total-row .lbl { color: #000; font-size: 16px; }
    .item-row.total-row .val { font-size: 22px; font-weight: 900; }

    /* HSN vertical column box */
    .item-hsn {
      border: 3px solid #000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3mm 1mm;
      margin-left: 3mm;
      background: #fafafa;
    }
    .item-hsn .hsn-label {
      font-size: 13px;
      font-weight: 900;
      color: #b91c1c;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-bottom: 4px;
      border-bottom: 2px solid #b91c1c;
      padding-bottom: 3px;
      width: 100%;
      text-align: center;
    }
    .item-hsn .hsn-value {
      font-size: 22px;
      font-weight: 900;
      font-family: 'Courier New', monospace;
      letter-spacing: 1px;
      word-break: break-all;
      text-align: center;
    }

    /* --- SUMMARY BLOCK: full page width --- */
    .summary {
      width: 100%;
      padding: 4mm 8mm 6mm 8mm;
      background: #f5f5f5;
      border-bottom: 4px solid #000;
    }
    .summary-box { width: 100%; }
    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 0;
      font-size: 22px;
      font-weight: 700;
      border-bottom: 2px dashed #000;
    }
    .summary-row.total {
      font-size: 32px;
      font-weight: 900;
      border-top: 4px solid #000;
      border-bottom: 4px solid #000;
      padding: 12px 0;
      margin-top: 6px;
      background: #000;
      color: #fff;
    }
    .summary-row.due {
      font-weight: 900;
      color: #b91c1c;
      border-bottom: none;
    }

    /* --- TERMS / NOTES: full-width banner --- */
    .terms {
      width: 100%;
      padding: 5mm 8mm;
      border-bottom: 4px solid #000;
      font-size: 20px;
      line-height: 1.4;
      font-weight: 600;
    }
    .terms strong { font-size: 22px; font-weight: 900; }

    /* --- E-INVOICE BLOCK --- */
    .einvoice-block {
      width: 100%;
      padding: 5mm 8mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 4px solid #000;
      background: #f0fdf4;
    }
    .einvoice-block h4 { font-size: 22px; margin-bottom: 6px; font-weight: 900; }
    .einvoice-block .meta { font-size: 18px; line-height: 1.4; }

    /* --- SIGNATURE + QR ROW --- */
    .sig-row {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      align-items: end;
      padding: 8mm 8mm 4mm 8mm;
      border-bottom: 4px solid #000;
    }
    .sig-cell { text-align: center; }
    .sig-cell.left  { text-align: left; }
    .sig-cell.right { text-align: right; }

    .qr-block {
      text-align: center;
    }
    .qr-block img {
      width: 140px;
      height: 140px;
      border: 3px solid #000;
      padding: 4px;
      background: #fff;
    }
    .qr-block .qr-label {
      font-size: 18px;
      font-weight: 900;
      margin-top: 6px;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .qr-block.upi .qr-label { color: #b91c1c; }

    .signature-box {
      display: inline-block;
      text-align: center;
      border-top: 4px solid #000;
      padding-top: 4mm;
      width: 60mm;
    }
    .signature-box p { font-size: 20px; font-weight: 900; }
    .signature-box small { font-size: 16px; font-weight: 600; }

    /* --- FOOTER: SYSTEM TIMESTAMP --- */
    .footer {
      width: 100%;
      padding: 6mm 8mm;
      text-align: center;
      background: #000;
      color: #fff;
      font-weight: 700;
    }
    .footer .line1 { font-size: 18px; margin-bottom: 4px; }
    .footer .line2 { font-size: 18px; font-weight: 900; letter-spacing: 1px; }
    .footer .line2 .timestamp {
      display: inline-block;
      padding: 4px 12px;
      border: 2px solid #fff;
      font-family: 'Courier New', monospace;
      letter-spacing: 2px;
      margin-left: 6px;
    }

    @media print {
      body { padding: 0; }
      .summary-row.total,
      .footer,
      .meta-block .status-flag.PAID,
      .meta-block .status-flag.PARTIAL {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      thead th {
        background: #000 !important;
        color: #fff !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }

    /* ====================================================================
       THERMAL PRINTER (80mm) — auto-detected by browser
       Triggers when the selected printer/paper width is <= 90mm
       ==================================================================== */
    @media print and (max-width: 90mm) {
      @page { size: 80mm auto; margin: 2mm; }
      html, body {
        width: 76mm;
        min-height: auto;
        padding: 2mm;
      }
      body { font-family: 'Courier New', monospace; display: block; }

      .title-banner { padding: 2mm; border-bottom: 2px solid #000; }
      .title-banner h1 { font-size: 22px; letter-spacing: 2px; }

      .header-row { display: block; }
      .header-cell { padding: 2mm; }
      .header-cell.left { border-right: 0; border-bottom: 2px solid #000; }

      .block-label { font-size: 11px; letter-spacing: 1px; margin-bottom: 2px; padding-bottom: 1px; }
      .seller-block .field-name { font-size: 14px; margin-bottom: 2px; }
      .seller-block .field { font-size: 11px; margin-bottom: 1px; }
      .seller-block .field .lbl { font-size: 9px; }

      .meta-block { text-align: center; padding-bottom: 2mm; margin-bottom: 2mm; border-bottom: 1px dashed #000; }
      .meta-block .inv-no { font-size: 16px; letter-spacing: 1px; }
      .meta-block .inv-date { font-size: 12px; margin-top: 2px; }
      .meta-block .status-flag { font-size: 12px; padding: 2px 10px; margin-top: 4px; letter-spacing: 1px; }

      .buyer-block .field-name { font-size: 13px; margin-bottom: 2px; }
      .buyer-block .field { font-size: 11px; margin-bottom: 1px; }
      .buyer-block .field .lbl { font-size: 9px; }

      .items-section { padding: 2mm; }

      .items-header { grid-template-columns: 5mm 1fr 16mm; padding: 2px 0; border-bottom: 2px solid #000; }
      .items-header .col-no   { font-size: 9px; }
      .items-header .col-item { font-size: 11px; letter-spacing: 1px; }
      .items-header .col-hsn  { font-size: 11px; letter-spacing: 1px; }

      .item-block {
        grid-template-columns: 5mm 1fr 16mm;
        padding: 2mm 0;
        border-bottom: 2px solid #000;
      }
      .item-no { font-size: 10px; padding-top: 1mm; }
      .item-detail { padding: 0 1mm; }
      .item-name { font-size: 12px; margin-bottom: 2px; }
      .item-row { padding: 1px 0; font-size: 10px; border-bottom: 1px dotted #ccc; }
      .item-row .lbl { font-size: 8px; }
      .item-row.total-row { padding-top: 2px; margin-top: 2px; }
      .item-row.total-row .lbl { font-size: 9px; }
      .item-row.total-row .val { font-size: 12px; }

      .item-hsn {
        border: 2px solid #000;
        padding: 1mm 0.5mm;
        margin-left: 1mm;
        background: #fff;
      }
      .item-hsn .hsn-label { font-size: 8px; margin-bottom: 2px; padding-bottom: 1px; letter-spacing: 1px; }
      .item-hsn .hsn-value { font-size: 11px; letter-spacing: 0.5px; }

      .summary { padding: 2mm; }
      .summary-row { padding: 2px 0; font-size: 11px; border-bottom: 1px dashed #000; }
      .summary-row.total { font-size: 14px; padding: 3px 0; margin-top: 3px; }
      .summary-row.due { color: #b91c1c; }

      .terms { font-size: 10px; padding: 2mm; border-bottom: 2px solid #000; }
      .terms strong { font-size: 11px; }

      .einvoice-block { padding: 2mm; display: block; text-align: center; }
      .einvoice-block h4 { font-size: 12px; }
      .einvoice-block .meta { font-size: 10px; }

      .sig-row { display: block; padding: 2mm; border-bottom: 2px solid #000; }
      .sig-cell { text-align: center !important; margin-bottom: 3mm; }
      .sig-cell.right { margin-bottom: 0; }
      .qr-block img { width: 90px; height: 90px; }
      .qr-block .qr-label { font-size: 11px; margin-top: 3px; letter-spacing: 1px; }
      .signature-box { width: 100%; padding-top: 2mm; border-top: 1px solid #000; }
      .signature-box p { font-size: 12px; }
      .signature-box small { font-size: 10px; }

      .footer { padding: 2mm; }
      .footer .line1 { font-size: 10px; margin-bottom: 2px; }
      .footer .line2 { font-size: 10px; letter-spacing: 0.5px; }
      .footer .line2 .timestamp { padding: 2px 6px; border: 1px solid #fff; letter-spacing: 1px; margin-left: 3px; }
    }

    /* === SCREEN PREVIEW — shows A4 layout in browser === */
    @media screen {
      body {
        max-width: 210mm;
        margin: 0 auto;
        background: #fff;
        box-shadow: 0 0 0 1px #ddd;
      }
    }
  </style>
</head>
<body>

  <!-- ============================================================
       TITLE BANNER
       ============================================================ -->
  <div class="title-banner">
    <h1>INVOICE</h1>
  </div>

  <!-- ============================================================
       HEADER ROW: Seller (left) + Invoice Metadata + Buyer (right)
       ============================================================ -->
  <div class="header-row">

    <!-- LEFT: SELLER BLOCK (dynamic bindings) -->
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

    <!-- RIGHT: METADATA + BUYER (nested) -->
    <div class="header-cell right">

      <!-- Invoice metadata block -->
      <div class="meta-block">
        <div class="inv-no">#${invoiceNo}</div>
        <div class="inv-date">${invoiceDate}</div>
        <div class="status-flag ${statusFlag}">${statusFlag}</div>
      </div>

      <!-- Buyer nested block -->
      <div class="buyer-block">
        <div class="block-label">Bill To</div>
        <div class="field-name">${buyerName}</div>
        ${buyerAddr ? `<div class="field"><span class="lbl">Address</span>${buyerAddr}</div>` : ''}
        ${buyerGst  ? `<div class="field"><span class="lbl">GSTIN</span>${buyerGst}</div>`    : ''}
      </div>

    </div>
  </div>

  <!-- ============================================================
       ITEMIZED TABLE — MULTI-ITEM STACKED ARRAY LOOP
       Each item is a grid block: details (left) + HSN vertical column (right)
       ============================================================ -->
  <div class="items-section">
    <div class="items-header">
      <div class="col-no">#</div>
      <div class="col-item">Item</div>
      <div class="col-hsn">HSN</div>
    </div>
    ${itemBlocks}
  </div>

  <!-- ============================================================
       SUMMARY / TOTALS BLOCK (full page width)
       ============================================================ -->
  <div class="summary">
    <div class="summary-box">
      <div class="summary-row"><span>Subtotal</span><span>${fmtCurrency(sale.subtotal)}</span></div>
      <div class="summary-row"><span>Tax / Duties</span><span>${fmtCurrency(sale.gstAmount)}</span></div>
      <div class="summary-row total"><span>GRAND TOTAL</span><span>${fmtCurrency(sale.totalAmount)}</span></div>
      <div class="summary-row"><span>Amount Received</span><span>${fmtCurrency(sale.amountReceived || sale.amountPaid)}</span></div>
      <div class="summary-row due"><span>Balance Due</span><span>${fmtCurrency(sale.totalAmount - (sale.amountReceived || sale.amountPaid))}</span></div>
    </div>
  </div>

  ${sale.notes ? `<div class="terms"><strong>Notes:</strong> ${sale.notes}</div>` : ''}

  ${sale.einvoiceStatus === 'GENERATED' ? `
  <div class="einvoice-block">
    <div>
      <h4>E-INVOICE VERIFIED</h4>
      <div class="meta">IRN: <span style="font-family:monospace;word-break:break-all;">${sale.einvoiceIrn || ''}</span></div>
      ${sale.einvoiceAckNo ? `<div class="meta" style="margin-top:4px;">Ack No: ${sale.einvoiceAckNo}</div>` : ''}
    </div>
    ${sale.einvoiceQrCodeText ? `<div style="text-align:center;"><img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(sale.einvoiceQrCodeText)}" alt="QR" style="width:110px;height:110px;border:1px solid #ccc;" /></div>` : ''}
  </div>
  ` : ''}

  <!-- ============================================================
       SIGNATURE + QR ROW
       ============================================================ -->
  <div class="sig-row">
    <div class="sig-cell left"></div>
    <div class="sig-cell">
      ${upiQrCode ? `
      <div class="qr-block upi">
        <img src="${upiQrCode}" alt="UPI QR" />
        <div class="qr-label">Scan to Pay ${fmtCurrency(sale.upiAmount || 0)}</div>
      </div>` : `<div class="qr-block"><div style="font-size:18px;font-weight:900;letter-spacing:2px;">QR CODE</div></div>`}
    </div>
    <div class="sig-cell right">
      <div class="signature-box">
        <p>Authorised Signatory</p>
        <small>For ${sellerName}</small>
      </div>
    </div>
  </div>

  <!-- ============================================================
       FOOTER: AUTOMATED SYSTEM TIMESTAMP
       Token format: dd/mm/yyyy, HH:MM:SS pm/am  (live execution string)
       ============================================================ -->
  <div class="footer">
    <div class="line1">Computer-generated invoice from BizBook Pro</div>
    <div class="line2">by Tahigo International &mdash;<span class="timestamp">${systemTimestamp}</span></div>
  </div>

<script>window.onload = function() { setTimeout(function() { window.print(); }, 500); };</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
