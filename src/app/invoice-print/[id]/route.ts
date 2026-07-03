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

  // v4.186: FLUID EDGE-TO-EDGE LAYOUT
  // - padding: 0 on body, no whitespace margins
  // - All blocks use width: 100%
  // - Central billing/summary block expanded to full page width (no longer 45%)
  // - Typography sharply upscaled (headers 28-46px, line items 20-22px, totals 36px)
  // - Tables stretch edge-to-edge with no inner gutters
  // - @media print and (max-width: 90mm) auto-detects thermal 80mm printers

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

  // Helper functions
  const fmtCurrency = (amt: number) => {
    return '₹' + Number(amt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  const fmtDate = (dt: Date) => {
    return new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  const normalizeStatus = (s: string) => {
    const u = (s || '').toUpperCase()
    if (u === 'PAID' || u === 'RECEIVED') return 'RECEIVED'
    if (u === 'UNPAID' || u === 'PENDING') return 'PENDING'
    if (u === 'PARTIAL') return 'PARTIAL'
    return u
  }
  const statusLabel = (s: string) => {
    const n = normalizeStatus(s)
    if (n === 'RECEIVED') return 'PAID'
    if (n === 'PENDING') return 'UNPAID'
    return n
  }

  // Build UPI QR if configured
  const upiId = tenant.upiId
  const upiQrCode = upiId
    ? 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent('upi://pay?pa=' + upiId + '&pn=' + (tenant.name || 'Business') + '&am=' + (sale.upiAmount || 0) + '&cu=INR&tn=Invoice ' + sale.invoiceNumber)
    : null

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice - ${sale.invoiceNumber}</title>
  <style>
    /* ====================================================================
       v4.186 — FLUID EDGE-TO-EDGE PRINT LAYOUT
       - body padding: 0  →  NO blank margins
       - all blocks width: 100%  →  NO compression in the middle
       - typography sharply upscaled for instant legibility
       ==================================================================== */
    * { margin: 0; padding: 0; box-sizing: border-box; }

    /* === DEFAULT: A4 PRINTER — full bleed, edge-to-edge === */
    @page { size: A4; margin: 0; }
    html, body {
      width: 210mm;
      min-height: 297mm;
      margin: 0;
      padding: 0;            /* <-- NO WHITESPACE MARGINS */
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #000;
      padding: 0;            /* <-- NO WHITESPACE MARGINS */
      display: flex;
      flex-direction: column;
      width: 100%;
    }

    /* --- HEADER: full-width banner, edge-to-edge --- */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      width: 100%;
      padding: 8mm 8mm 5mm 8mm;
      margin: 0;
      border-bottom: 4px solid #000;
    }
    .brand h1 {
      font-size: 46px;          /* was 30px  → +53% */
      font-weight: 900;
      line-height: 1.05;
      letter-spacing: -0.5px;
    }
    .brand p {
      font-size: 20px;          /* was 15px  → +33% */
      margin-top: 5px;
      line-height: 1.35;
      font-weight: 600;
    }
    .invoice-title { text-align: right; }
    .invoice-title h2 {
      font-size: 56px;          /* was 36px  → +55% */
      font-weight: 900;
      letter-spacing: 4px;
      line-height: 1;
    }
    .invoice-title p {
      font-size: 22px;          /* was 16px  → +37% */
      margin-top: 5px;
      font-weight: 800;
    }
    .badge {
      display: inline-block;
      padding: 6px 18px;
      border: 3px solid #000;
      font-size: 20px;          /* was 15px  → +33% */
      font-weight: 900;
      margin-top: 6px;
    }

    /* --- PARTIES: two equal full-width halves, edge-to-edge --- */
    .parties {
      display: flex;
      width: 100%;
      margin: 0;
      padding: 0;
      gap: 0;                   /* edge-to-edge, no gutter */
    }
    .party-box {
      width: 50%;
      padding: 6mm 8mm;
      border: 0;
      border-right: 4px solid #000;
      border-bottom: 4px solid #000;
    }
    .party-box:last-child {
      border-right: 0;
    }
    .party-box h3 {
      font-size: 18px;          /* was 13px  → +38% */
      text-transform: uppercase;
      margin-bottom: 6px;
      font-weight: 900;
      border-bottom: 3px solid #000;
      padding-bottom: 4px;
      letter-spacing: 1px;
    }
    .party-box .name {
      font-size: 28px;          /* was 20px  → +40% */
      font-weight: 900;
      margin-bottom: 4px;
    }
    .party-box .detail {
      font-size: 20px;          /* was 15px  → +33% */
      margin-top: 4px;
      font-weight: 600;
      line-height: 1.35;
    }

    /* --- LINE-ITEM TABLE: edge-to-edge, big fonts --- */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0;
      flex-grow: 1;
    }
    thead th {
      background: #000;
      color: #fff;
      padding: 12px 10px;       /* was 6px 5px   → +100% */
      text-align: left;
      font-size: 20px;          /* was 15px      → +33% */
      text-transform: uppercase;
      font-weight: 900;
      border: 2px solid #000;
      letter-spacing: 0.5px;
    }
    thead th.right { text-align: right; }
    tbody td {
      padding: 10px 10px;       /* was 5px 5px   → +100% */
      font-size: 22px;          /* was 16px      → +37% */
      border: 2px solid #000;
      vertical-align: top;
    }
    tbody td.right {
      text-align: right;
      font-weight: 800;
    }

    /* --- BILLING BLOCK: FULL WIDTH — no longer 45% compressed on the side --- */
    .summary {
      display: block;
      width: 100%;
      margin: 0;
      padding: 0;
    }
    .summary-box {
      width: 100%;              /* was 45% → now FULL PAGE WIDTH */
      padding: 6mm 8mm;
      border-top: 4px solid #000;
      border-bottom: 4px solid #000;
      background: #f5f5f5;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;           /* was 4px       → +100% */
      font-size: 24px;          /* was 17px      → +41% */
      border-bottom: 2px dashed #000;
      font-weight: 700;
    }
    .summary-row span:first-child { letter-spacing: 0.3px; }
    .summary-row span:last-child  { font-weight: 900; font-variant-numeric: tabular-nums; }
    .summary-row.total {
      font-size: 36px;          /* was 24px      → +50% */
      font-weight: 900;
      border-top: 5px solid #000;
      border-bottom: 5px solid #000;
      padding: 14px 0;          /* was 6px       → +133% */
      margin-top: 8px;
      background: #000;
      color: #fff;
    }
    .summary-row.due {
      font-weight: 900;
      border-bottom: none;
      color: #b91c1c;
    }

    /* --- TERMS / NOTES: full-width banner --- */
    .terms {
      width: 100%;
      padding: 6mm 8mm;
      border: 0;
      border-bottom: 4px solid #000;
      font-size: 20px;          /* was 15px      → +33% */
      line-height: 1.4;
      font-weight: 600;
    }
    .terms strong { font-size: 22px; }

    /* --- E-INVOICE BLOCK: full-width --- */
    .einvoice-block {
      width: 100%;
      padding: 6mm 8mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 4px solid #000;
      background: #f0fdf4;
    }
    .einvoice-block h4 {
      font-size: 22px;
      margin-bottom: 6px;
      font-weight: 900;
    }
    .einvoice-block .meta {
      font-size: 18px;
      line-height: 1.4;
    }

    /* --- UPI QR: centered, full-width band --- */
    .upi-band {
      width: 100%;
      padding: 6mm 8mm;
      text-align: center;
      border-bottom: 4px solid #000;
    }
    .upi-band img { width: 180px; height: 180px; }
    .upi-band .label {
      font-size: 22px;
      margin-top: 8px;
      font-weight: 900;
    }

    /* --- SIGNATURE: full-width, right-aligned inside its row --- */
    .signature {
      width: 100%;
      padding: 10mm 8mm 6mm 8mm;
      display: flex;
      justify-content: flex-end;
    }
    .signature-box {
      text-align: center;
      border-top: 4px solid #000;
      padding-top: 5mm;
      width: 80mm;
    }
    .signature-box p {
      font-size: 22px;          /* was 17px → +29% */
      font-weight: 900;
    }
    .signature-box small {
      font-size: 18px;          /* was 13px → +38% */
      font-weight: 600;
    }

    /* --- FOOTER: edge-to-edge --- */
    .footer {
      width: 100%;
      margin-top: auto;
      padding: 5mm 8mm;
      border-top: 4px solid #000;
      font-size: 18px;          /* was 13px → +38% */
      text-align: center;
      font-weight: 800;
      background: #fafafa;
    }

    @media print {
      body { padding: 0; }
      thead th {
        background: #000 !important;
        color: #fff !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .summary-box,
      .summary-row.total,
      .footer,
      .einvoice-block { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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

      .header {
        display: block;
        text-align: center;
        padding: 2mm;
        margin: 0;
        border-bottom: 2px solid #000;
      }
      .brand h1 { font-size: 18px; letter-spacing: 0; }
      .brand p { font-size: 10px; margin-top: 1px; font-weight: 600; }
      .invoice-title { text-align: center; margin-top: 2mm; }
      .invoice-title h2 { font-size: 20px; letter-spacing: 1px; }
      .invoice-title p { font-size: 11px; margin-top: 1px; }
      .badge { font-size: 11px; padding: 1px 6px; border: 2px solid #000; margin-top: 4px; }

      .parties { display: block; gap: 0; }
      .party-box {
        width: 100%;
        padding: 1mm 2mm;
        border: 1px solid #000;
        border-bottom: 1px solid #000;
        margin-bottom: 1mm;
      }
      .party-box h3 { font-size: 10px; margin-bottom: 1px; padding-bottom: 1px; border-bottom: 1px solid #000; }
      .party-box .name { font-size: 13px; margin-bottom: 1px; }
      .party-box .detail { font-size: 10px; margin-top: 1px; }

      table { margin: 0; flex-grow: 0; }
      thead th {
        padding: 2px 2px;
        font-size: 9px;
        border: 1px solid #000;
      }
      tbody td {
        padding: 2px 2px;
        font-size: 11px;
        border: 1px solid #000;
      }

      .summary-box {
        width: 100%;
        padding: 2mm;
        border-top: 2px solid #000;
        border-bottom: 2px solid #000;
        background: #fff;
      }
      .summary-row {
        font-size: 12px;
        padding: 1px 0;
        border-bottom: 1px dashed #000;
      }
      .summary-row.total {
        font-size: 15px;
        padding: 3px 0;
        border-top: 2px solid #000;
        border-bottom: 2px solid #000;
        background: #000;
        color: #fff;
      }

      .terms { font-size: 10px; padding: 2mm; border-bottom: 2px solid #000; }
      .terms strong { font-size: 11px; }
      .einvoice-block { padding: 2mm; display: block; text-align: center; }
      .einvoice-block h4 { font-size: 12px; }
      .einvoice-block .meta { font-size: 10px; }
      .upi-band { padding: 2mm; }
      .upi-band img { width: 110px; height: 110px; }
      .upi-band .label { font-size: 12px; margin-top: 4px; }

      .signature { padding: 2mm; display: block; text-align: center; }
      .signature-box { width: 100%; padding-top: 2mm; border-top: 1px solid #000; }
      .signature-box p { font-size: 12px; }
      .signature-box small { font-size: 10px; }

      .footer { font-size: 9px; padding: 2mm; border-top: 2px solid #000; background: #fff; }
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
  <div class="header">
    <div class="brand">
      <h1>${tenant.name || 'BizBook Pro'}</h1>
      ${tenant.address ? '<p>' + tenant.address + '</p>' : ''}
      ${tenant.phone ? '<p>Phone: ' + tenant.phone + '</p>' : ''}
      ${tenant.email ? '<p>Email: ' + tenant.email + '</p>' : ''}
      ${tenant.gstNumber ? '<p>GSTIN: ' + tenant.gstNumber + '</p>' : ''}
    </div>
    <div class="invoice-title">
      <h2>INVOICE</h2>
      <p>#${sale.invoiceNumber}</p>
      <p>${fmtDate(sale.date)}</p>
      <p><span class="badge">${statusLabel(sale.paymentStatus)}</span></p>
    </div>
  </div>

  <div class="parties">
    <div class="party-box">
      <h3>From</h3>
      <div class="name">${tenant.name || 'Business'}</div>
      ${tenant.address ? '<div class="detail">' + tenant.address + '</div>' : ''}
      ${tenant.gstNumber ? '<div class="detail">GSTIN: ' + tenant.gstNumber + '</div>' : ''}
    </div>
    <div class="party-box">
      <h3>Bill To</h3>
      <div class="name">${sale.partyName}</div>
      ${sale.partyAddress ? '<div class="detail">' + sale.partyAddress + '</div>' : ''}
      ${sale.partyGst ? '<div class="detail">GSTIN: ' + sale.partyGst + '</div>' : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Item</th>
        <th>HSN</th>
        <th class="right">Qty</th>
        <th class="right">Rate</th>
        <th class="right">Discount</th>
        <th class="right">Amount</th>
        <th class="right">Tax</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${parsedItems.map((item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${item.name}${item.saleItemType === 'SERVICE' ? ' [SERVICE]' : ''}</td>
        <td>${item.hsn || '-'}</td>
        <td class="right">${item.qty} ${item.unit || ''}</td>
        <td class="right">${fmtCurrency(item.rate)}</td>
        <td class="right">${item.discount > 0 ? fmtCurrency(item.discount) : '-'}</td>
        <td class="right">${fmtCurrency(item.amount)}</td>
        <td class="right">${fmtCurrency(item.totalTax)}</td>
        <td class="right">${fmtCurrency(item.total)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="summary">
    <div class="summary-box">
      <div class="summary-row"><span>Subtotal</span><span>${fmtCurrency(sale.subtotal)}</span></div>
      <div class="summary-row"><span>Tax / Duties</span><span>${fmtCurrency(sale.gstAmount)}</span></div>
      <div class="summary-row total"><span>GRAND TOTAL</span><span>${fmtCurrency(sale.totalAmount)}</span></div>
      <div class="summary-row"><span>Amount Received</span><span>${fmtCurrency(sale.amountReceived || sale.amountPaid)}</span></div>
      <div class="summary-row due"><span>Balance Due</span><span>${fmtCurrency(sale.totalAmount - (sale.amountReceived || sale.amountPaid))}</span></div>
    </div>
  </div>

  ${sale.notes ? '<div class="terms"><strong>Notes:</strong> ' + sale.notes + '</div>' : ''}

  ${sale.einvoiceStatus === 'GENERATED' ? `
  <div class="einvoice-block">
    <div>
      <h4>E-INVOICE VERIFIED</h4>
      <div class="meta">IRN: <span style="font-family:monospace;word-break:break-all;">${sale.einvoiceIrn || ''}</span></div>
      ${sale.einvoiceAckNo ? '<div class="meta" style="margin-top:4px;">Ack No: ' + sale.einvoiceAckNo + '</div>' : ''}
    </div>
    ${sale.einvoiceQrCodeText ? '<div style="text-align:center;"><img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=' + encodeURIComponent(sale.einvoiceQrCodeText) + '" alt="QR" style="width:110px;height:110px;border:1px solid #ccc;" /></div>' : ''}
  </div>
  ` : ''}

  ${upiQrCode ? '<div class="upi-band"><img src="' + upiQrCode + '" alt="UPI QR" /><div class="label">Scan to Pay ' + fmtCurrency(sale.upiAmount || 0) + '</div></div>' : ''}

  <div class="signature">
    <div class="signature-box">
      <p>Authorised Signatory</p>
      <small>For ${tenant.name || 'Business'}</small>
    </div>
  </div>

  <div class="footer">
    Computer-generated invoice from BizBook Pro by Tahigo International &middot; ${new Date().toLocaleString('en-IN')}
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
