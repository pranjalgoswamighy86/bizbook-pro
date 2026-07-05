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

  // v4.188: HYBRID LAYOUT — wide horizontal items table + dynamic template
  // Per screenshot feedback (054638/054657), the stacked-block item layout
  // did not match user expectations. Reverted to a wide horizontal table with
  // all 9 columns (#, Item, HSN, Qty, Rate, Discount, Amount, Tax, Total),
  // while keeping the dynamic seller/buyer bindings, metadata, system
  // timestamp, and edge-to-edge fluid layout from v4.186–v4.187.
  // Items table uses border-collapse so all rows + totals + footer fit on
  // a single A4 page without cut-off.

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
  const systemTimestamp = `${sysDate}, ${sysTime}`

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
  // MULTI-ITEM ROW LOOP — wide horizontal table
  // ============================================================
  const itemRows = parsedItems.map((item, i) => `
    <tr>
      <td class="col-no">${i + 1}</td>
      <td class="col-item">${item.name || ''}${item.saleItemType === 'SERVICE' ? ' <span class="svc">[SERVICE]</span>' : ''}</td>
      <td class="col-hsn">${item.hsn || '—'}</td>
      <td class="col-qty num">${item.qty || 0} ${item.unit || ''}</td>
      <td class="col-rate num">${fmtCurrency(item.rate)}</td>
      <td class="col-disc num">${item.discount > 0 ? fmtCurrency(item.discount) : '—'}</td>
      <td class="col-amt  num">${fmtCurrency(item.amount)}</td>
      <td class="col-tax  num">${fmtCurrency(item.totalTax)}</td>
      <td class="col-tot  num">${fmtCurrency(item.total)}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice - ${invoiceNo}</title>
  <style>
    /* ====================================================================
       v4.188 — HYBRID LAYOUT
       - Wide horizontal items table (9 columns) per screenshot feedback
       - Dynamic seller/buyer bindings + metadata + system timestamp kept
       - Edge-to-edge fluid layout (padding:0, width:100%) kept
       - @media print thermal auto-detect kept
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

    /* --- INVOICE TITLE BANNER --- */
    .title-banner {
      width: 100%;
      text-align: center;
      padding: 6mm 8mm 4mm 8mm;
      border-bottom: 4px solid #000;
    }
    .title-banner h1 {
      font-size: 44px;
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
    .buyer-block .field-name {
      font-size: 24px;
      font-weight: 900;
      margin-bottom: 5px;
      line-height: 1.15;
    }
    .seller-block .field,
    .buyer-block .field {
      font-size: 15px;
      margin-bottom: 3px;
      line-height: 1.35;
      font-weight: 600;
    }
    .seller-block .field .lbl,
    .buyer-block .field .lbl {
      display: inline-block;
      font-weight: 900;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #555;
      margin-right: 6px;
    }

    /* Invoice metadata block */
    .meta-block {
      text-align: right;
      padding-bottom: 4mm;
      margin-bottom: 4mm;
      border-bottom: 2px dashed #000;
    }
    .meta-block .inv-no {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: 2px;
      line-height: 1.1;
    }
    .meta-block .inv-date {
      font-size: 18px;
      font-weight: 800;
      margin-top: 3px;
      letter-spacing: 1px;
    }
    .meta-block .status-flag {
      display: inline-block;
      margin-top: 6px;
      padding: 4px 16px;
      font-size: 16px;
      font-weight: 900;
      letter-spacing: 3px;
      border: 3px solid #000;
    }
    .meta-block .status-flag.PAID    { background: #14532d; color: #fff; border-color: #14532d; }
    .meta-block .status-flag.PENDING { background: #fff;    color: #b91c1c; border-color: #b91c1c; }
    .meta-block .status-flag.PARTIAL { background: #1e3a8a; color: #fff; border-color: #1e3a8a; }

    /* --- ITEM TABLE: wide horizontal, 9 columns --- */
    .items-section {
      width: 100%;
      padding: 0 8mm;
      flex-grow: 1;
    }
    table.items {
      width: 100%;
      border-collapse: collapse;
      margin: 0;
    }
    table.items thead th {
      background: #000;
      color: #fff;
      padding: 8px 5px;
      font-size: 14px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 1px;
      border: 2px solid #000;
      text-align: left;
    }
    table.items thead th.num { text-align: right; }
    table.items tbody td {
      padding: 6px 5px;
      font-size: 15px;
      border: 1px solid #000;
      vertical-align: top;
    }
    table.items tbody td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    table.items tbody td.col-tot {
      font-weight: 900;
    }
    table.items tbody td.col-hsn {
      font-family: 'Courier New', monospace;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    table.items tbody td.col-item { font-weight: 700; }
    table.items tbody .svc {
      font-size: 11px;
      color: #b91c1c;
      font-weight: 900;
    }

    /* --- SUMMARY BLOCK: full page width, side-by-side with QR --- */
    .bottom-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      width: 100%;
      border-top: 4px solid #000;
      border-bottom: 4px solid #000;
    }
    .bottom-cell.left  { padding: 5mm 8mm; border-right: 4px solid #000; }
    .bottom-cell.right { padding: 5mm 8mm; }

    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 0;
      font-size: 17px;
      font-weight: 700;
      border-bottom: 2px dashed #000;
    }
    .summary-row:last-child { border-bottom: none; }
    .summary-row.total {
      font-size: 26px;
      font-weight: 900;
      border-top: 3px solid #000;
      border-bottom: 3px solid #000;
      padding: 8px 0;
      margin-top: 5px;
      background: #000;
      color: #fff;
    }
    .summary-row.due {
      font-weight: 900;
      color: #b91c1c;
    }

    /* QR cell */
    .qr-cell { text-align: center; }
    .qr-cell img {
      width: 130px;
      height: 130px;
      border: 3px solid #000;
      padding: 3px;
      background: #fff;
    }
    .qr-cell .qr-label {
      font-size: 14px;
      font-weight: 900;
      margin-top: 5px;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #b91c1c;
    }
    .qr-cell .sig {
      margin-top: 6mm;
      border-top: 3px solid #000;
      padding-top: 3mm;
      font-size: 14px;
      font-weight: 900;
    }
    .qr-cell .sig small {
      display: block;
      font-size: 12px;
      font-weight: 600;
      margin-top: 2px;
    }

    /* --- TERMS / NOTES --- */
    .terms {
      width: 100%;
      padding: 4mm 8mm;
      border-bottom: 4px solid #000;
      font-size: 15px;
      line-height: 1.4;
      font-weight: 600;
    }
    .terms strong { font-size: 17px; font-weight: 900; }

    /* --- E-INVOICE BLOCK --- */
    .einvoice-block {
      width: 100%;
      padding: 4mm 8mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 4px solid #000;
      background: #f0fdf4;
    }
    .einvoice-block h4 { font-size: 17px; margin-bottom: 4px; font-weight: 900; }
    .einvoice-block .meta { font-size: 14px; line-height: 1.4; }

    /* --- FOOTER: SYSTEM TIMESTAMP --- */
    .footer {
      width: 100%;
      padding: 4mm 8mm;
      text-align: center;
      background: #000;
      color: #fff;
      font-weight: 700;
    }
    .footer .line1 { font-size: 14px; margin-bottom: 3px; }
    .footer .line2 { font-size: 14px; font-weight: 900; letter-spacing: 1px; }
    .footer .line2 .timestamp {
      display: inline-block;
      padding: 3px 10px;
      border: 2px solid #fff;
      font-family: 'Courier New', monospace;
      letter-spacing: 1px;
      margin-left: 5px;
    }

    @media print {
      body { padding: 0; }
      .summary-row.total,
      .footer,
      .meta-block .status-flag.PAID,
      .meta-block .status-flag.PARTIAL,
      table.items thead th {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }

    /* ====================================================================
       THERMAL PRINTER (80mm continuous roll) — auto-detected by browser
       v4.189: Continuous-roll support + edge-to-edge + enlarged fonts
         - @page margin: 0  (no whitespace border)
         - html/body width: 80mm (full paper width, not 76mm)
         - All section paddings reduced to 1mm horizontal
         - Fonts sharply upscaled (header 22px, items 12px, totals 18px)
         - Continuous flow — NO pagination, NO page-break-inside avoid
         - White-space: nowrap on numeric cells prevents wrap/overflow
       ==================================================================== */
    @media print and (max-width: 90mm) {
      @page {
        size: 80mm auto;
        margin: 0;            /* <-- NO WHITESPACE BORDER */
      }
      html, body {
        width: 80mm;          /* <-- FULL PAPER WIDTH (was 76mm) */
        min-height: auto;
        margin: 0;
        padding: 0;           /* <-- NO PADDING */
      }
      body {
        font-family: 'Courier New', monospace;
        display: block;
        width: 80mm;
      }

      /* Disable pagination entirely — continuous roll */
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
        padding: 2mm 1mm;
        border-bottom: 2px solid #000;
        text-align: center;
      }
      .title-banner h1 { font-size: 22px; letter-spacing: 2px; line-height: 1.1; }

      .header-row { display: block; width: 80mm; }
      .header-cell {
        width: 80mm;
        padding: 2mm 1mm;
      }
      .header-cell.left {
        border-right: 0;
        border-bottom: 2px solid #000;
      }

      .block-label {
        font-size: 12px;
        letter-spacing: 1px;
        margin-bottom: 2px;
        padding-bottom: 1px;
      }
      .seller-block .field-name,
      .buyer-block .field-name {
        font-size: 16px;        /* was 13px → +23% */
        margin-bottom: 2px;
        line-height: 1.2;
      }
      .seller-block .field,
      .buyer-block .field {
        font-size: 12px;        /* was 10px → +20% */
        margin-bottom: 1px;
        line-height: 1.3;
        word-break: break-word;
      }
      .seller-block .field .lbl,
      .buyer-block .field .lbl {
        font-size: 10px;        /* was 8px → +25% */
      }

      .meta-block {
        text-align: center;
        padding: 2mm 1mm;
        margin: 0;
        border-bottom: 1px dashed #000;
      }
      .meta-block .inv-no {
        font-size: 16px;        /* was 14px */
        letter-spacing: 1px;
        font-weight: 900;
      }
      .meta-block .inv-date {
        font-size: 13px;        /* was 11px */
        margin-top: 2px;
      }
      .meta-block .status-flag {
        font-size: 13px;        /* was 11px */
        padding: 2px 10px;
        margin-top: 4px;
        letter-spacing: 1px;
      }

      .items-section {
        width: 80mm;
        padding: 0 1mm;
      }
      table.items { width: 100%; }
      table.items thead th {
        padding: 3px 1px;
        font-size: 11px;        /* was 8px → +37% */
        letter-spacing: 0.5px;
      }
      table.items tbody td {
        padding: 3px 1px;
        font-size: 12px;        /* was 9px → +33% */
        white-space: normal;
        word-break: break-word;
      }
      table.items tbody td.num {
        white-space: nowrap;    /* numbers must not wrap */
      }
      table.items .col-hsn { display: none; }
      table.items thead .col-hsn { display: none; }
      /* Drop less-critical columns on thermal to free width */
      table.items .col-disc { display: none; }
      table.items thead .col-disc { display: none; }
      table.items .col-amt { display: none; }
      table.items thead .col-amt { display: none; }

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
        padding: 2px 0;
        font-size: 13px;        /* was 11px → +18% */
        border-bottom: 1px dashed #000;
      }
      .summary-row.total {
        font-size: 18px;        /* was 14px → +28% */
        padding: 4px 0;
        margin-top: 3px;
      }
      .summary-row.due { color: #b91c1c; }

      .qr-cell { text-align: center; }
      .qr-cell img {
        width: 110px;           /* was 80px → +37% */
        height: 110px;
      }
      .qr-cell .qr-label {
        font-size: 12px;        /* was 10px */
        margin-top: 4px;
      }
      .qr-cell .sig {
        margin-top: 3mm;
        padding-top: 2mm;
        font-size: 13px;        /* was 11px */
      }
      .qr-cell .sig small {
        font-size: 11px;        /* was 9px */
      }

      .terms {
        width: 80mm;
        font-size: 12px;        /* was 10px */
        padding: 2mm 1mm;
        border-bottom: 2px solid #000;
      }
      .terms strong { font-size: 13px; }

      .einvoice-block {
        width: 80mm;
        padding: 2mm 1mm;
        display: block;
        text-align: center;
      }
      .einvoice-block h4 { font-size: 13px; }
      .einvoice-block .meta { font-size: 11px; }

      .footer {
        width: 80mm;
        padding: 2mm 1mm;
      }
      .footer .line1 {
        font-size: 11px;        /* was 9px */
        margin-bottom: 2px;
      }
      .footer .line2 {
        font-size: 11px;        /* was 9px */
        letter-spacing: 0.5px;
      }
      .footer .line2 .timestamp {
        padding: 2px 6px;
        border: 1px solid #fff;
        letter-spacing: 0.5px;
        margin-left: 3px;
      }
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

  <!-- ============================================================
       ITEM TABLE — WIDE HORIZONTAL, 9 COLUMNS
       ============================================================ -->
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

  <!-- ============================================================
       BOTTOM ROW: SUMMARY (left) + QR + SIGNATURE (right)
       ============================================================ -->
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

  <!-- ============================================================
       FOOTER: AUTOMATED SYSTEM TIMESTAMP
       Token format: dd/mm/yyyy, HH:MM:SS pm/am  (live execution string)
       ============================================================ -->
  <div class="footer">
    <div class="line1">Computer-generated invoice from BizBook Pro</div>
    <div class="line2">by Tahigo International &mdash;<span class="timestamp">${systemTimestamp}</span></div>
  </div>

<script>
  // v4.189: Parent window calls iframe.contentWindow.print() directly.
  // No auto-print here — the iframe onload handler in sale-register.tsx
  // triggers the print after the document is fully loaded.
  // This avoids double print dialogs and gives the parent control over timing.
  window.__bizbookInvoiceReady = true;
</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
