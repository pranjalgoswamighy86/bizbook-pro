import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuth } from '@/lib/api-helpers'

// This route returns a STANDALONE HTML page for printing
// It bypasses the Service Worker entirely — the browser loads it fresh every time
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Verify auth via cookie or token
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  const params = await context.params
  const saleId = params.id
  if (!saleId) {
    return new NextResponse('Sale ID required', { status: 400 })
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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: A4; margin: 0; }
    html, body { width: 210mm; min-height: 297mm; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; padding: 10mm; display: flex; flex-direction: column; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5mm; border-bottom: 3px solid #000; padding-bottom: 4mm; }
    .brand h1 { font-size: 30px; font-weight: 900; line-height: 1; }
    .brand p { font-size: 15px; margin-top: 3px; line-height: 1.3; }
    .invoice-title { text-align: right; }
    .invoice-title h2 { font-size: 36px; font-weight: 900; letter-spacing: 3px; line-height: 1; }
    .invoice-title p { font-size: 16px; margin-top: 3px; font-weight: 700; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 5mm; gap: 5mm; }
    .party-box { width: 48%; padding: 4mm; border: 3px solid #000; }
    .party-box h3 { font-size: 13px; text-transform: uppercase; margin-bottom: 3px; font-weight: 800; border-bottom: 2px solid #000; padding-bottom: 2px; }
    .party-box .name { font-size: 20px; font-weight: 800; }
    .party-box .detail { font-size: 15px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; flex-grow: 1; }
    thead th { background: #000; color: #fff; padding: 6px 5px; text-align: left; font-size: 15px; text-transform: uppercase; font-weight: 800; border: 2px solid #000; }
    thead th.right { text-align: right; }
    tbody td { padding: 5px 5px; font-size: 16px; border: 2px solid #000; }
    tbody td.right { text-align: right; font-weight: 700; }
    .summary { display: flex; justify-content: flex-end; margin-bottom: 4mm; }
    .summary-box { width: 45%; }
    .summary-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 17px; border-bottom: 2px dashed #000; }
    .summary-row.total { font-size: 24px; font-weight: 900; border-top: 3px solid #000; border-bottom: 3px solid #000; padding: 6px 0; margin-top: 4px; }
    .summary-row.due { font-weight: 800; border-bottom: none; }
    .footer { margin-top: auto; padding-top: 4mm; border-top: 3px solid #000; font-size: 13px; text-align: center; font-weight: 700; }
    .badge { display: inline-block; padding: 3px 12px; border: 3px solid #000; font-size: 15px; font-weight: 800; }
    .terms { margin-top: 3mm; padding: 4mm; border: 3px solid #000; font-size: 15px; }
    .signature { margin-top: auto; display: flex; justify-content: flex-end; padding-top: 8mm; }
    .signature-box { text-align: center; border-top: 3px solid #000; padding-top: 3mm; width: 60mm; }
    .signature-box p { font-size: 17px; font-weight: 800; }
    .signature-box small { font-size: 13px; }
    @media print {
      body { padding: 10mm; }
      thead th { background: #000 !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    @media print and (max-width: 90mm) {
      @page { size: 80mm auto; margin: 2mm; }
      html, body { width: 80mm; min-height: auto; padding: 2mm; }
      .header { flex-direction: column; margin-bottom: 2mm; padding-bottom: 2mm; border-bottom: 2px solid #000; }
      .brand h1 { font-size: 18px; }
      .brand p { font-size: 10px; margin-top: 1px; }
      .invoice-title { text-align: left; margin-top: 2mm; }
      .invoice-title h2 { font-size: 22px; letter-spacing: 1px; }
      .invoice-title p { font-size: 11px; margin-top: 1px; }
      .parties { flex-direction: column; gap: 2mm; margin-bottom: 2mm; }
      .party-box { width: 100%; padding: 2mm; border: 2px solid #000; }
      .party-box h3 { font-size: 9px; margin-bottom: 1px; padding-bottom: 1px; border-bottom: 1px solid #000; }
      .party-box .name { font-size: 12px; }
      .party-box .detail { font-size: 10px; margin-top: 1px; }
      table { margin-bottom: 2mm; }
      thead th { padding: 2px 1px; font-size: 9px; border: 1px solid #000; }
      tbody td { padding: 2px 1px; font-size: 10px; border: 1px solid #000; }
      .summary-box { width: 100%; }
      .summary-row { font-size: 11px; padding: 1px 0; border-bottom: 1px dashed #000; }
      .summary-row.total { font-size: 14px; padding: 2px 0; border-top: 2px solid #000; border-bottom: 2px solid #000; }
      .footer { font-size: 9px; margin-top: 2mm; padding-top: 1mm; border-top: 2px solid #000; }
      .badge { font-size: 10px; padding: 1px 5px; border: 2px solid #000; }
      .terms { font-size: 10px; padding: 2mm; border: 2px solid #000; margin-top: 2mm; }
      .signature { margin-top: 3mm; padding-top: 3mm; }
      .signature-box { width: 40mm; padding-top: 1mm; border-top: 2px solid #000; }
      .signature-box p { font-size: 11px; }
      .signature-box small { font-size: 9px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <h1>${tenant.name || 'BizBook Pro'}</h1>
      <p>${tenant.address || ''}</p>
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
        <td class="right" style="font-weight:700">${fmtCurrency(item.total)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="summary">
    <div class="summary-box">
      <div class="summary-row"><span>Subtotal</span><span>${fmtCurrency(sale.subtotal)}</span></div>
      <div class="summary-row"><span>Tax / Duties</span><span>${fmtCurrency(sale.gstAmount)}</span></div>
      <div class="summary-row total"><span>Grand Total</span><span>${fmtCurrency(sale.totalAmount)}</span></div>
      <div class="summary-row"><span>Amount Received</span><span>${fmtCurrency(sale.amountReceived || sale.amountPaid)}</span></div>
      <div class="summary-row due"><span>Balance Due</span><span>${fmtCurrency(sale.totalAmount - (sale.amountReceived || sale.amountPaid))}</span></div>
    </div>
  </div>

  ${sale.notes ? '<div class="terms"><strong>Notes:</strong> ' + sale.notes + '</div>' : ''}

  ${sale.einvoiceStatus === 'GENERATED' ? `
  <div style="margin-top:4mm;padding:4mm;border:2px solid #000;border-radius:4px;background:#f0fdf4;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <h4 style="font-size:14px;margin-bottom:4px;">E-INVOICE VERIFIED</h4>
        <div style="font-size:13px;">IRN: <span style="font-family:monospace;word-break:break-all;">${sale.einvoiceIrn || ''}</span></div>
        ${sale.einvoiceAckNo ? '<div style="font-size:13px;margin-top:3px;">Ack No: ' + sale.einvoiceAckNo + '</div>' : ''}
      </div>
      ${sale.einvoiceQrCodeText ? '<div style="text-align:center;"><img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=' + encodeURIComponent(sale.einvoiceQrCodeText) + '" alt="QR" style="width:100px;height:100px;border:1px solid #ccc;" /></div>' : ''}
    </div>
  </div>
  ` : ''}

  ${upiQrCode ? '<div style="margin:4mm 0;text-align:center;"><img src="' + upiQrCode + '" alt="UPI QR" style="width:150px;height:150px;border:1px solid #ccc;border-radius:4px;" /><div style="font-size:14px;margin-top:5px;font-weight:600;">Scan to Pay ' + fmtCurrency(sale.upiAmount || 0) + '</div></div>' : ''}

  <div class="signature">
    <div class="signature-box">
      <p>Authorised Signatory</p>
      <small>For ${tenant.name || 'Business'}</small>
    </div>
  </div>

  <div class="footer">
    Computer-generated invoice from BizBook Pro by Tahigo International · ${new Date().toLocaleString('en-IN')}
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
