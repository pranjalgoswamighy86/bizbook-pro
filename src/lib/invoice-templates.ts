/**
 * v6.27.1: Invoice Template Engine — 5 Polished Templates
 * ========================================================
 * Refined based on sample PDF analysis:
 *   1. classic    → "Executive" — Monospace, black & white, bordered
 *   2. modern     → "Luxury Tech" — Sans-serif, accent bar top, side-by-side
 *   3. minimal    → "Minimalist" — Ultra-clean, whitespace, light gray
 *   4. corporate  → "Corporate" — Dark navy header bar, full-bleed
 *   5. elegant    → "Creative Studio" — Serif, warm accent, centered
 *
 * Print reliability fixes:
 *   - All templates use @page { margin: 0 } + body padding (no clipping)
 *   - Totals box uses float:right + clear:both (no overflow)
 *   - Table uses table-layout:fixed + word-break (no column overflow)
 *   - All fonts have fallbacks (sans-serif / serif / monospace)
 *   - Print color adjust forced (-webkit-print-color-adjust: exact)
 */

export interface InvoiceData {
  invoiceNumber: string
  date: string
  partyName: string
  partyAddress: string | null
  partyGst: string | null
  items: Array<{
    name: string
    category?: string
    hsn?: string
    unit?: string
    qty: number
    rate: number
    discount: number
    amount: number
    totalTax: number
    total: number
    saleItemType?: string
  }>
  subtotal: number
  gstAmount: number
  totalAmount: number
  amountReceived: number
  amountPaid: number
  discountPercent: number
  paymentStatus: string
  invoiceStatus: string
  notes: string | null
  upiAmount: number
}

export interface TenantData {
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
  gstNumber?: string | null
  upiId?: string | null
  logoUrl?: string | null
  // v6.27.2: added `invoiceTemplate` to the interface so the selector at
  // the bottom of this file type-checks. The value is one of:
  //   'classic' | 'modern' | 'minimal' | 'corporate' | 'elegant'
  invoiceTemplate?: string | null
  invoiceColor?: string | null
  showLogoInInvoice?: boolean
  showSignatureInInvoice?: boolean
  showQrCode?: boolean
  invoiceFooterText?: string | null
}

// ── Helpers ──
function fmtCurrency(amt: number): string {
  return '₹' + Number(amt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(dt: Date): string {
  return new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
function normalizeStatus(s: string): string {
  const u = (s || '').toUpperCase()
  if (u === 'PAID' || u === 'RECEIVED') return 'RECEIVED'
  if (u === 'UNPAID' || u === 'PENDING') return 'PENDING'
  if (u === 'PARTIAL') return 'PARTIAL'
  return u
}
function statusLabel(s: string): string {
  const n = normalizeStatus(s)
  if (n === 'RECEIVED') return 'PAID'
  if (n === 'PENDING') return 'UNPAID'
  return n
}
function getDiscountInfo(sale: InvoiceData) {
  const discPercent = sale.discountPercent || 0
  const effectiveDiscount = sale.subtotal - (sale.totalAmount - sale.gstAmount)
  if (discPercent > 0) {
    const discAmt = Math.round(sale.subtotal * discPercent / 100 * 100) / 100
    return { percent: discPercent, amount: discAmt, taxable: sale.subtotal - discAmt }
  } else if (effectiveDiscount > 0.01) {
    const computedPercent = Math.round(effectiveDiscount / sale.subtotal * 100 * 10) / 10
    return { percent: computedPercent, amount: effectiveDiscount, taxable: sale.subtotal - effectiveDiscount }
  }
  return null
}
function getQrInfo(sale: InvoiceData, tenant: TenantData) {
  const upiId = tenant.upiId
  if (!upiId || tenant.showQrCode === false) return null
  const isQuotation = sale.invoiceStatus === 'QUOTATION'
  const balanceDue = sale.totalAmount - (sale.amountReceived || sale.amountPaid)
  const qrPayAmount = isQuotation ? (sale.upiAmount > 0 ? sale.upiAmount : sale.totalAmount) : balanceDue
  if (qrPayAmount <= 0) return null
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=' +
    encodeURIComponent('upi://pay?pa=' + upiId + '&pn=' + (tenant.name || 'Business') + '&am=' + qrPayAmount + '&cu=INR&tn=Invoice ' + sale.invoiceNumber)
  return { url: qrUrl, amount: qrPayAmount }
}

// ── Shared item rows generator ──
function itemRows(sale: InvoiceData, style: 'classic' | 'modern' | 'minimal' | 'corporate' | 'elegant'): string {
  return sale.items.map((item, i) => {
    const catHtml = item.category ? ` <span style="font-size:9px;font-style:italic;opacity:0.7;">(${item.category})</span>` : ''
    const svcHtml = item.saleItemType === 'SERVICE' ? ' [SVC]' : ''
    const subStyle = style === 'classic' ? 'font-size:10px;font-weight:700;' : 'font-size:9px;color:#aaa;'
    const nameStyle = style === 'classic' ? 'font-weight:900;' : 'font-weight:600;'
    const totalBold = style === 'classic' ? 'font-weight:900;' : 'font-weight:600;'
    return `<tr>
      <td class="c">${i + 1}</td>
      <td><div class="item-name" style="${nameStyle}">${item.name}${svcHtml}${catHtml}</div>
        <div class="item-sub" style="${subStyle}">Rate: ${fmtCurrency(item.rate)} · Disc: ${item.discount > 0 ? fmtCurrency(item.discount) : '-'} · Amt: ${fmtCurrency(item.amount)} · Tax: ${fmtCurrency(item.totalTax)}</div></td>
      <td class="c">${item.hsn || '-'}</td>
      <td class="r">${item.qty} ${item.unit || ''}</td>
      <td class="r">${fmtCurrency(item.rate)}</td>
      <td class="r" style="${totalBold}">${fmtCurrency(item.total)}</td>
    </tr>`
  }).join('')
}

// ── Shared totals generator ──
function totalsBlock(sale: InvoiceData, accent: string, style: string): string {
  const disc = getDiscountInfo(sale)
  const grandClass = style === 'classic' ? 'grand-classic' : 'grand-modern'
  return `<div class="trow"><span>Subtotal</span><span>${fmtCurrency(sale.subtotal)}</span></div>
    ${disc ? `<div class="trow"><span>Discount (${disc.percent}%)</span><span>-${fmtCurrency(disc.amount)}</span></div><div class="trow"><span>Taxable Amount</span><span>${fmtCurrency(disc.taxable)}</span></div>` : ''}
    <div class="trow"><span>Tax</span><span>${fmtCurrency(sale.gstAmount)}</span></div>
    <div class="trow ${grandClass}"><span>GRAND TOTAL</span><span>${fmtCurrency(sale.totalAmount)}</span></div>
    <div class="trow"><span>Received</span><span>${fmtCurrency(sale.amountReceived || sale.amountPaid)}</span></div>
    <div class="trow due"><span>Balance Due</span><span>${fmtCurrency(sale.totalAmount - (sale.amountReceived || sale.amountPaid))}</span></div>`
}

// ══════════════════════════════════════════════════════════════
// TEMPLATE 1: CLASSIC / EXECUTIVE (Monospace — black & white)
// v6.27.3: Now honors `tenant.invoiceColor` for accent borders / grand
// total row. Defaults to #000000 (true black) when no color is set,
// preserving the original monospace aesthetic.
// ══════════════════════════════════════════════════════════════
function templateClassic(sale: InvoiceData, tenant: TenantData): string {
  const disc = getDiscountInfo(sale)
  const qr = getQrInfo(sale, tenant)
  // v6.27.3: honor invoiceColor (defaults to #000 for the classic look)
  const accent = tenant.invoiceColor || '#000000'
  const logoHtml = tenant.logoUrl && tenant.showLogoInInvoice !== false ? `<img src="${tenant.logoUrl}" alt="Logo" style="max-height:70px;max-width:180px;margin-bottom:5px;object-fit:contain;"/>` : ''
  const sigHtml = tenant.showSignatureInInvoice !== false ? `<div class="sig"><div class="sig-line"></div><p>Authorised Signatory</p><small>For ${tenant.name || 'Business'}</small></div>` : ''
  const footerText = tenant.invoiceFooterText || `Computer-generated by BizBook Pro · Tahigo International · ${new Date().toLocaleString('en-IN')}`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice - ${sale.invoiceNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{margin:10mm}body{font-family:'Courier New',monospace;color:#000;width:100%;padding:5mm;font-weight:900}
.header{text-align:center;margin-bottom:4mm;border-bottom:3px solid ${accent};padding-bottom:3mm}
.header h1{font-size:20px;font-weight:900;color:${accent}}.header p{font-size:11px;margin-top:2px;font-weight:900}
.inv-meta{text-align:center;margin-bottom:4mm}.inv-meta .inv-no{font-size:16px;font-weight:900}
.inv-meta .inv-date{font-size:12px;font-weight:700}.inv-meta .badge{display:inline-block;padding:3px 10px;border:2px solid ${accent};font-size:11px;font-weight:900;margin-top:3px;color:${accent}}
.parties{margin-bottom:4mm}.party .lbl{font-size:10px;text-transform:uppercase;font-weight:900;border-bottom:1px solid ${accent};padding-bottom:1px;margin-bottom:2px;color:${accent}}
.party .name{font-size:14px;font-weight:900}.party .detail{font-size:11px;font-weight:700}
.items-tbl{width:100%;border-collapse:collapse;margin-bottom:4mm;table-layout:fixed}
.items-tbl th{border-bottom:2px solid ${accent};padding:4px 3px;font-size:10px;font-weight:900;text-transform:uppercase;text-align:left;color:${accent}}
.items-tbl th.c{text-align:center}th.r{text-align:right}
.items-tbl td{border-bottom:1px solid #000;padding:4px 3px;font-size:11px;font-weight:700;vertical-align:top;word-break:break-word}
.items-tbl td.c{text-align:center}.items-tbl td.r{text-align:right}
.items-tbl .col-no{width:5%}.items-tbl .col-item{width:50%}.items-tbl .col-hsn{width:15%}.items-tbl .col-qty{width:12%}.items-tbl .col-rate{width:9%}.items-tbl .col-amt{width:9%}
.item-name{font-weight:900}.item-sub{font-size:10px;margin-top:1px;font-weight:700}
.totals{width:50%;margin-left:50%;margin-bottom:4mm}
.trow{display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #000;font-weight:700}
.grand-classic{font-size:15px;font-weight:900;border-top:3px solid ${accent};border-bottom:3px solid ${accent};padding:5px 0;margin-top:2px;color:${accent}}
.due{font-weight:900}
.notes{margin:3mm 0;padding:3mm;border:2px solid ${accent};font-size:11px;font-weight:700;word-break:break-word}
.qr{text-align:center;margin:3mm 0}.qr img{width:75px;height:75px;border:2px solid #000}.qr .lbl{font-size:11px;font-weight:900;margin-top:2px;color:${accent}}
.sig{margin-top:5mm;text-align:center}.sig-line{border-top:2px solid #000;width:60%;margin:0 auto 2px}.sig p{font-size:11px;font-weight:900}.sig small{font-size:10px;font-weight:700}
.footer{margin-top:5mm;padding-top:2mm;border-top:2px solid ${accent};text-align:center;font-size:10px;font-weight:700}
@media print{@page{margin:10mm}body{padding:0}}
</style></head><body>
<div class="header">${logoHtml}<h1>${tenant.name || 'BizBook Pro'}</h1>${tenant.address ? `<p>${tenant.address}</p>` : ''}${tenant.phone ? `<p>Ph: ${tenant.phone}</p>` : ''}${tenant.email ? `<p>Email: ${tenant.email}</p>` : ''}${tenant.gstNumber ? `<p>GSTIN: ${tenant.gstNumber}</p>` : ''}</div>
<div class="inv-meta"><div class="inv-no">#${sale.invoiceNumber}</div><div class="inv-date">${fmtDate(new Date(sale.date))}</div><div class="badge">${statusLabel(sale.paymentStatus)}</div></div>
<div class="parties"><div class="party"><div class="lbl">Bill To</div><div class="name">${sale.partyName}</div>${sale.partyAddress ? `<div class="detail">${sale.partyAddress}</div>` : ''}${sale.partyGst ? `<div class="detail">GSTIN: ${sale.partyGst}</div>` : ''}</div></div>
<table class="items-tbl"><thead><tr><th class="col-no">#</th><th class="col-item">Item</th><th class="col-hsn c">HSN</th><th class="col-qty r">Qty</th><th class="col-rate r">Rate</th><th class="col-amt r">Total</th></tr></thead><tbody>
${sale.items.map((item,i)=>`<tr><td class="c">${i+1}</td><td><div class="item-name">${item.name}${item.saleItemType==='SERVICE'?' [SVC]':''}${item.category?` <span style="font-size:10px;font-style:italic;font-weight:700;">(${item.category})</span>`:''}</div><div class="item-sub">Rate: ${fmtCurrency(item.rate)} | Disc: ${item.discount>0?fmtCurrency(item.discount):'-'} | Amt: ${fmtCurrency(item.amount)} | Tax: ${fmtCurrency(item.totalTax)}</div></td><td class="c">${item.hsn||'-'}</td><td class="r">${item.qty} ${item.unit||''}</td><td class="r">${fmtCurrency(item.rate)}</td><td class="r"><strong>${fmtCurrency(item.total)}</strong></td></tr>`).join('')}
</tbody></table>
<div class="totals">${totalsBlock(sale,accent,'classic')}</div>
${sale.notes ? `<div class="notes"><strong>Notes:</strong> ${sale.notes}</div>` : ''}
${qr ? `<div class="qr"><img src="${qr.url}" alt="UPI QR"/><div class="lbl">Scan to Pay ${fmtCurrency(qr.amount)}</div></div>` : ''}
${sigHtml}
<div class="footer">${footerText}</div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`
}

// ══════════════════════════════════════════════════════════════
// TEMPLATE 2: MODERN / LUXURY TECH (Sans-serif, accent top bar)
// ══════════════════════════════════════════════════════════════
function templateModern(sale: InvoiceData, tenant: TenantData): string {
  const disc = getDiscountInfo(sale)
  const qr = getQrInfo(sale, tenant)
  const accent = tenant.invoiceColor || '#3B82F6'
  const logoHtml = tenant.logoUrl && tenant.showLogoInInvoice !== false ? `<img src="${tenant.logoUrl}" alt="Logo" style="max-height:50px;max-width:160px;object-fit:contain;"/>` : ''
  const sigHtml = tenant.showSignatureInInvoice !== false ? `<div style="margin-top:35px;display:flex;justify-content:flex-end;"><div style="text-align:center;"><div style="border-top:1px solid ${accent};width:180px;margin-bottom:4px;"></div><div style="font-size:10px;color:#999;">Authorised Signatory</div></div></div>` : ''
  const footerText = tenant.invoiceFooterText || `BizBook Pro · ${new Date().toLocaleString('en-IN')}`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice - ${sale.invoiceNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{margin:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a}
.accent-bar{height:6px;background:${accent};width:100%}
.content{padding:20mm 15mm}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:25px;padding-bottom:12px;border-bottom:1px solid #eee}
.hdr-left h1{font-size:20px;color:${accent};margin-bottom:2px}.hdr-left p{font-size:10px;color:#888;line-height:1.5}
.hdr-right{text-align:right}.hdr-right .title{font-size:26px;font-weight:300;color:${accent};letter-spacing:1px}
.hdr-right .no{font-size:13px;color:#333;font-weight:600;margin-top:2px}.hdr-right .date{font-size:10px;color:#888;margin-top:2px}
.hdr-right .badge{display:inline-block;padding:3px 12px;border-radius:3px;font-size:9px;font-weight:600;margin-top:4px;color:#fff;background:${accent}}
.parties{display:flex;gap:30px;margin-bottom:20px}
.p-box{flex:1}.p-box .lbl{font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:4px;font-weight:600}
.p-box .name{font-size:13px;font-weight:600;color:#333;margin-bottom:2px}.p-box .detail{font-size:10px;color:#888;line-height:1.5}
.items-tbl{width:100%;border-collapse:collapse;margin-bottom:18px;table-layout:fixed}
.items-tbl th{background:${accent};color:#fff;font-size:9px;text-transform:uppercase;padding:7px 6px;text-align:left;font-weight:600}
.items-tbl th.c{text-align:center}th.r{text-align:right}
.items-tbl td{padding:7px 6px;font-size:10px;border-bottom:1px solid #f0f0f0;color:#444;vertical-align:top;word-break:break-word}
.items-tbl td.c{text-align:center}.items-tbl td.r{text-align:right}
.items-tbl tr:nth-child(even){background:#fafafa}
.items-tbl .col-no{width:5%}.items-tbl .col-item{width:42%}.items-tbl .col-hsn{width:12%}.items-tbl .col-qty{width:12%}.items-tbl .col-rate{width:14%}.items-tbl .col-amt{width:15%}
.item-name{font-weight:600;color:#333;font-size:11px}.item-sub{font-size:9px;color:#bbb;margin-top:1px}
.totals-box{float:right;width:260px;margin-bottom:15px}
.trow{display:flex;justify-content:space-between;padding:5px 0;font-size:11px;border-bottom:1px solid #f0f0f0;color:#666}
.grand-modern{font-size:13px;font-weight:700;border-top:2px solid ${accent};border-bottom:2px solid ${accent};padding:7px 0;margin-top:3px;color:${accent}}
.due{color:#c0392b;font-weight:600}
.notes{clear:both;margin:12px 0;padding:8px 10px;border:1px solid #eee;border-radius:4px;font-size:10px;color:#888}
.qr{text-align:center;margin:12px 0}.qr img{width:70px;height:70px}.qr .lbl{font-size:9px;color:${accent};font-weight:600;margin-top:2px}
.footer{margin-top:25px;padding-top:8px;border-top:1px solid #eee;text-align:center;font-size:8px;color:#ccc}
@media print{.accent-bar,.items-tbl th,.hdr-right .badge,.grand-modern{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;background:${accent}!important;color:#fff!important}.grand-modern{background:transparent!important;color:${accent}!important;border-color:${accent}!important}.items-tbl tr:nth-child(even){background:#fafafa!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}img{max-width:100%!important}}
</style></head><body>
<div class="accent-bar"></div>
<div class="content">
<div class="hdr"><div class="hdr-left">${logoHtml}<h1>${tenant.name || 'BizBook Pro'}</h1><p>${tenant.address || ''}</p>${tenant.phone ? `<p>Ph: ${tenant.phone}</p>` : ''}${tenant.email ? `<p>${tenant.email}</p>` : ''}${tenant.gstNumber ? `<p>GSTIN: ${tenant.gstNumber}</p>` : ''}</div><div class="hdr-right"><div class="title">INVOICE</div><div class="no">#${sale.invoiceNumber}</div><div class="date">${fmtDate(new Date(sale.date))}</div><div class="badge">${statusLabel(sale.paymentStatus)}</div></div></div>
<div class="parties"><div class="p-box"><div class="lbl">Billed From</div><div class="name">${tenant.name || 'Business'}</div>${tenant.address ? `<div class="detail">${tenant.address}</div>` : ''}${tenant.gstNumber ? `<div class="detail">GSTIN: ${tenant.gstNumber}</div>` : ''}</div><div class="p-box"><div class="lbl">Billed To</div><div class="name">${sale.partyName}</div>${sale.partyAddress ? `<div class="detail">${sale.partyAddress}</div>` : ''}${sale.partyGst ? `<div class="detail">GSTIN: ${sale.partyGst}</div>` : ''}</div></div>
<table class="items-tbl"><thead><tr><th class="col-no">#</th><th class="col-item">Item Description</th><th class="col-hsn c">HSN</th><th class="col-qty r">Qty</th><th class="col-rate r">Rate</th><th class="col-amt r">Amount</th></tr></thead><tbody>
${itemRows(sale,'modern')}
</tbody></table>
<div class="totals-box">${totalsBlock(sale,accent,'modern')}</div>
${sale.notes ? `<div class="notes"><strong>Notes:</strong> ${sale.notes}</div>` : ''}
${qr ? `<div class="qr"><img src="${qr.url}" alt="UPI QR"/><div class="lbl">Scan to Pay ${fmtCurrency(qr.amount)}</div></div>` : ''}
${sigHtml}
<div style="clear:both"></div>
<div class="footer">${footerText}</div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`
}

// ══════════════════════════════════════════════════════════════
// TEMPLATE 3: MINIMAL / MINIMALIST (Ultra-clean, whitespace)
// ══════════════════════════════════════════════════════════════
function templateMinimal(sale: InvoiceData, tenant: TenantData): string {
  const disc = getDiscountInfo(sale)
  const qr = getQrInfo(sale, tenant)
  const accent = tenant.invoiceColor || '#999999'
  const logoHtml = tenant.logoUrl && tenant.showLogoInInvoice !== false ? `<img src="${tenant.logoUrl}" alt="Logo" style="max-height:45px;max-width:140px;object-fit:contain;margin-bottom:8px;"/>` : ''
  const sigHtml = tenant.showSignatureInInvoice !== false ? `<div style="margin-top:40px;text-align:right;"><div style="border-top:1px solid #ddd;width:170px;margin-left:auto;margin-bottom:4px;"></div><div style="font-size:9px;color:#bbb;">Authorised Signatory</div></div>` : ''
  const footerText = tenant.invoiceFooterText || `BizBook Pro · ${new Date().toLocaleString('en-IN')}`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice - ${sale.invoiceNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{margin:15mm}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#333;width:100%}
.top-bar{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:35px}
.brand h1{font-size:17px;font-weight:300;color:#333;letter-spacing:0.5px}.brand p{font-size:9px;color:#ccc;margin-top:2px;line-height:1.6}
.inv-meta{text-align:right}.inv-meta .title{font-size:13px;font-weight:300;color:#bbb;letter-spacing:2px;text-transform:uppercase}
.inv-meta .no{font-size:12px;color:#333;margin-top:4px;font-weight:500}.inv-meta .date{font-size:9px;color:#ccc;margin-top:2px}
.inv-meta .status{display:inline-block;padding:2px 10px;border:1px solid #eee;border-radius:20px;font-size:8px;color:#999;margin-top:4px}
.parties{display:flex;gap:45px;margin-bottom:30px}
.p-box .lbl{font-size:7px;text-transform:uppercase;letter-spacing:1.5px;color:#ddd;margin-bottom:5px}
.p-box .name{font-size:12px;font-weight:500;color:#333;margin-bottom:1px}.p-box .detail{font-size:9px;color:#aaa;line-height:1.5}
.items-tbl{width:100%;border-collapse:collapse;margin-bottom:22px;table-layout:fixed}
.items-tbl th{font-size:7px;text-transform:uppercase;letter-spacing:1px;color:#ccc;padding:6px 4px;text-align:left;font-weight:500;border-bottom:1px solid #eee}
.items-tbl th.c{text-align:center}th.r{text-align:right}
.items-tbl td{padding:9px 4px;font-size:10px;color:#666;border-bottom:1px solid #f7f7f7;vertical-align:top;word-break:break-word}
.items-tbl td.c{text-align:center}.items-tbl td.r{text-align:right}
.items-tbl .col-no{width:5%}.items-tbl .col-item{width:45%}.items-tbl .col-hsn{width:13%}.items-tbl .col-qty{width:12%}.items-tbl .col-rate{width:12%}.items-tbl .col-amt{width:13%}
.item-name{font-weight:500;color:#333;font-size:11px}.item-sub{font-size:8px;color:#ddd;margin-top:1px}
.totals-box{float:right;width:230px;margin-bottom:18px}
.trow{display:flex;justify-content:space-between;padding:4px 0;font-size:10px;color:#aaa}
.grand-modern{font-size:12px;font-weight:600;color:#333;border-top:1px solid #333;border-bottom:1px solid #333;padding:6px 0;margin-top:3px}
.due{color:#e74c3c;font-weight:500}
.notes{clear:both;margin:12px 0;font-size:9px;color:#ccc;padding:6px 0;border-top:1px solid #f7f7f7}
.qr{text-align:center;margin:12px 0}.qr img{width:65px;height:65px}.qr .lbl{font-size:8px;color:#bbb;margin-top:2px}
.footer{margin-top:30px;padding-top:8px;border-top:1px solid #f7f7f7;text-align:center;font-size:7px;color:#eee}
@media print{.grand-modern{color:#333!important;border-color:#333!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}img{max-width:100%!important}}
</style></head><body>
<div class="top-bar"><div class="brand">${logoHtml}<h1>${tenant.name || 'BizBook Pro'}</h1><p>${tenant.address || ''}</p>${tenant.phone ? `<p>${tenant.phone}</p>` : ''}${tenant.email ? `<p>${tenant.email}</p>` : ''}${tenant.gstNumber ? `<p>GSTIN: ${tenant.gstNumber}</p>` : ''}</div><div class="inv-meta"><div class="title">Invoice</div><div class="no">#${sale.invoiceNumber}</div><div class="date">${fmtDate(new Date(sale.date))}</div><div class="status">${statusLabel(sale.paymentStatus)}</div></div></div>
<div class="parties"><div class="p-box"><div class="lbl">From</div><div class="name">${tenant.name || 'Business'}</div>${tenant.address ? `<div class="detail">${tenant.address}</div>` : ''}${tenant.gstNumber ? `<div class="detail">GSTIN: ${tenant.gstNumber}</div>` : ''}</div><div class="p-box"><div class="lbl">To</div><div class="name">${sale.partyName}</div>${sale.partyAddress ? `<div class="detail">${sale.partyAddress}</div>` : ''}${sale.partyGst ? `<div class="detail">GSTIN: ${sale.partyGst}</div>` : ''}</div></div>
<table class="items-tbl"><thead><tr><th class="col-no">#</th><th class="col-item">Description</th><th class="col-hsn c">HSN</th><th class="col-qty r">Qty</th><th class="col-rate r">Rate</th><th class="col-amt r">Total</th></tr></thead><tbody>
${itemRows(sale,'minimal')}
</tbody></table>
<div class="totals-box">${totalsBlock(sale,accent,'minimal')}</div>
${sale.notes ? `<div class="notes"><strong>Notes:</strong> ${sale.notes}</div>` : ''}
${qr ? `<div class="qr"><img src="${qr.url}" alt="UPI QR"/><div class="lbl">Scan to Pay ${fmtCurrency(qr.amount)}</div></div>` : ''}
${sigHtml}
<div style="clear:both"></div>
<div class="footer">${footerText}</div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`
}

// ══════════════════════════════════════════════════════════════
// TEMPLATE 4: CORPORATE (Dark navy header bar, full-bleed)
// ══════════════════════════════════════════════════════════════
function templateCorporate(sale: InvoiceData, tenant: TenantData): string {
  const disc = getDiscountInfo(sale)
  const qr = getQrInfo(sale, tenant)
  const accent = tenant.invoiceColor || '#1e293b'
  const logoHtml = tenant.logoUrl && tenant.showLogoInInvoice !== false ? `<img src="${tenant.logoUrl}" alt="Logo" style="max-height:45px;max-width:150px;object-fit:contain;"/>` : ''
  const sigHtml = tenant.showSignatureInInvoice !== false ? `<div style="margin-top:30px;display:flex;justify-content:flex-end;"><div style="text-align:center;"><div style="border-top:2px solid ${accent};width:170px;margin-bottom:4px;"></div><div style="font-size:9px;color:#666;font-weight:600;">Authorised Signatory</div></div></div>` : ''
  const footerText = tenant.invoiceFooterText || `Computer-generated by BizBook Pro · ${new Date().toLocaleString('en-IN')}`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice - ${sale.invoiceNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{margin:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#333}
.hdr-bar{background:${accent};color:#fff;padding:20px 15mm;display:flex;justify-content:space-between;align-items:center}
.hdr-bar .brand h1{font-size:18px;font-weight:700;margin-bottom:1px}.hdr-bar .brand p{font-size:9px;opacity:0.8;line-height:1.5}
.hdr-bar .inv-info{text-align:right}.hdr-bar .inv-info .title{font-size:22px;font-weight:300;letter-spacing:2px}
.hdr-bar .inv-info .no{font-size:13px;margin-top:2px;font-weight:600}.hdr-bar .inv-info .date{font-size:9px;opacity:0.7;margin-top:1px}
.hdr-bar .inv-info .status{display:inline-block;padding:2px 10px;border:1px solid rgba(255,255,255,0.3);border-radius:3px;font-size:8px;margin-top:3px}
.content{padding:20px 15mm}
.parties{display:flex;gap:25px;margin-bottom:18px}
.p-box{flex:1;padding:10px;border:1px solid #eee;border-left:3px solid ${accent};border-radius:0 4px 4px 0}
.p-box .lbl{font-size:7px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:4px;font-weight:700}
.p-box .name{font-size:12px;font-weight:700;color:#333;margin-bottom:1px}.p-box .detail{font-size:9px;color:#777;line-height:1.5}
.items-tbl{width:100%;border-collapse:collapse;margin-bottom:18px;table-layout:fixed}
.items-tbl th{background:#f5f5f5;font-size:8px;text-transform:uppercase;padding:7px 5px;font-weight:700;color:#555;text-align:left;border-bottom:2px solid ${accent}}
.items-tbl th.c{text-align:center}th.r{text-align:right}
.items-tbl td{padding:7px 5px;font-size:10px;border-bottom:1px solid #eee;vertical-align:top;word-break:break-word}
.items-tbl td.c{text-align:center}.items-tbl td.r{text-align:right}
.items-tbl .col-no{width:5%}.items-tbl .col-item{width:42%}.items-tbl .col-hsn{width:13%}.items-tbl .col-qty{width:12%}.items-tbl .col-rate{width:14%}.items-tbl .col-amt{width:14%}
.item-name{font-weight:600;color:#333;font-size:11px}.item-sub{font-size:8px;color:#bbb;margin-top:1px}
.totals-box{float:right;width:260px;margin-bottom:12px}
.trow{display:flex;justify-content:space-between;padding:4px 0;font-size:10px;color:#666;border-bottom:1px solid #f0f0f0}
.grand-modern{font-size:13px;font-weight:700;color:${accent};border-top:2px solid ${accent};border-bottom:2px solid ${accent};padding:6px 0;margin-top:3px}
.due{color:#c0392b;font-weight:600}
.notes{clear:both;margin:10px 0;padding:8px;border:1px solid #eee;border-radius:4px;font-size:9px;color:#888}
.qr{text-align:center;margin:10px 0}.qr img{width:68px;height:68px}.qr .lbl{font-size:9px;color:${accent};font-weight:600;margin-top:2px}
.footer-bar{background:#f5f5f5;padding:10px 15mm;text-align:center;font-size:8px;color:#999;border-top:1px solid #eee}
@media print{.hdr-bar,.items-tbl th{background:${accent}!important;color:#fff!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.grand-modern{color:${accent}!important;border-color:${accent}!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.p-box{border-left:3px solid ${accent}!important}.footer-bar{background:#f5f5f5!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}img{max-width:100%!important}}
</style></head><body>
<div class="hdr-bar"><div class="brand">${logoHtml}<h1>${tenant.name || 'BizBook Pro'}</h1><p>${tenant.address || ''}</p>${tenant.phone ? `<p>Ph: ${tenant.phone}</p>` : ''}${tenant.email ? `<p>${tenant.email}</p>` : ''}${tenant.gstNumber ? `<p>GSTIN: ${tenant.gstNumber}</p>` : ''}</div><div class="inv-info"><div class="title">TAX INVOICE</div><div class="no">#${sale.invoiceNumber}</div><div class="date">${fmtDate(new Date(sale.date))}</div><div class="status">${statusLabel(sale.paymentStatus)}</div></div></div>
<div class="content">
<div class="parties"><div class="p-box"><div class="lbl">Service Provider</div><div class="name">${tenant.name || 'Business'}</div>${tenant.address ? `<div class="detail">${tenant.address}</div>` : ''}${tenant.gstNumber ? `<div class="detail">GSTIN: ${tenant.gstNumber}</div>` : ''}</div><div class="p-box"><div class="lbl">Customer Details</div><div class="name">${sale.partyName}</div>${sale.partyAddress ? `<div class="detail">${sale.partyAddress}</div>` : ''}${sale.partyGst ? `<div class="detail">GSTIN: ${sale.partyGst}</div>` : ''}</div></div>
<table class="items-tbl"><thead><tr><th class="col-no">#</th><th class="col-item">Item Description</th><th class="col-hsn c">HSN</th><th class="col-qty c">Qty</th><th class="col-rate r">Rate (₹)</th><th class="col-amt r">Amount (₹)</th></tr></thead><tbody>
${itemRows(sale,'corporate')}
</tbody></table>
<div class="totals-box">${totalsBlock(sale,accent,'corporate')}</div>
${sale.notes ? `<div class="notes"><strong>Notes:</strong> ${sale.notes}</div>` : ''}
${qr ? `<div class="qr"><img src="${qr.url}" alt="UPI QR"/><div class="lbl">Scan to Pay ${fmtCurrency(qr.amount)}</div></div>` : ''}
${sigHtml}
</div>
<div style="clear:both"></div>
<div class="footer-bar">${footerText}</div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`
}

// ══════════════════════════════════════════════════════════════
// TEMPLATE 5: ELEGANT / CREATIVE STUDIO (Serif, warm accent, centered)
// ══════════════════════════════════════════════════════════════
function templateElegant(sale: InvoiceData, tenant: TenantData): string {
  const disc = getDiscountInfo(sale)
  const qr = getQrInfo(sale, tenant)
  const accent = tenant.invoiceColor || '#8B7355'
  const logoHtml = tenant.logoUrl && tenant.showLogoInInvoice !== false ? `<img src="${tenant.logoUrl}" alt="Logo" style="max-height:50px;max-width:160px;object-fit:contain;margin-bottom:6px;"/>` : ''
  const sigHtml = tenant.showSignatureInInvoice !== false ? `<div style="margin-top:35px;text-align:right;"><div style="border-bottom:1px solid ${accent};width:190px;margin-left:auto;margin-bottom:4px;"></div><div style="font-size:10px;color:#999;font-family:Georgia,serif;font-style:italic;">Authorised Signatory</div></div>` : ''
  const footerText = tenant.invoiceFooterText || `Computer-generated by BizBook Pro · ${new Date().toLocaleString('en-IN')}`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice - ${sale.invoiceNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{margin:12mm}body{font-family:Georgia,'Times New Roman',serif;color:#2c2c2c;width:100%}
.hdr{text-align:center;margin-bottom:25px;padding-bottom:12px;border-bottom:2px double ${accent}}
.hdr h1{font-size:22px;font-weight:normal;color:${accent};letter-spacing:1px;margin-bottom:2px}
.hdr p{font-size:10px;color:#999;line-height:1.6}
.inv-center{text-align:center;margin-bottom:22px}
.inv-center .title{font-size:15px;text-transform:uppercase;letter-spacing:3px;color:${accent};margin-bottom:4px}
.inv-center .no{font-size:13px;color:#333;font-weight:bold}.inv-center .date{font-size:10px;color:#999;margin-top:2px}
.inv-center .status{display:inline-block;padding:3px 14px;border:1px solid ${accent};border-radius:15px;font-size:9px;color:${accent};margin-top:4px;font-style:italic}
.parties{display:flex;gap:35px;margin-bottom:22px;justify-content:center}
.p-box{text-align:center;flex:1}.p-box .lbl{font-size:8px;text-transform:uppercase;letter-spacing:2px;color:#ccc;margin-bottom:4px}
.p-box .name{font-size:13px;color:#333;font-weight:bold;margin-bottom:1px}.p-box .detail{font-size:9px;color:#999;line-height:1.5}
.items-tbl{width:100%;border-collapse:collapse;margin-bottom:18px;table-layout:fixed}
.items-tbl th{font-size:8px;text-transform:uppercase;letter-spacing:1px;color:${accent};padding:7px 5px;text-align:left;border-bottom:2px solid ${accent};font-weight:normal}
.items-tbl th.c{text-align:center}th.r{text-align:right}
.items-tbl td{padding:7px 5px;font-size:10px;border-bottom:1px solid #f0f0f0;color:#555;vertical-align:top;word-break:break-word}
.items-tbl td.c{text-align:center}.items-tbl td.r{text-align:right}
.items-tbl .col-no{width:5%}.items-tbl .col-item{width:42%}.items-tbl .col-hsn{width:13%}.items-tbl .col-qty{width:12%}.items-tbl .col-rate{width:14%}.items-tbl .col-amt{width:14%}
.item-name{font-weight:bold;color:#333;font-size:11px}.item-sub{font-size:8px;color:#bbb;margin-top:1px}
.totals-box{float:right;width:260px;margin-bottom:12px}
.trow{display:flex;justify-content:space-between;padding:4px 0;font-size:11px;color:#777;border-bottom:1px solid #f5f5f5}
.grand-modern{font-size:14px;font-weight:bold;color:${accent};border-top:2px solid ${accent};border-bottom:2px solid ${accent};padding:6px 0;margin-top:3px}
.due{color:#c0392b;font-weight:bold}
.notes{clear:both;margin:12px 0;padding:8px;border:1px dashed #ddd;font-size:10px;color:#999;font-style:italic}
.qr{text-align:center;margin:12px 0}.qr img{width:68px;height:68px}.qr .lbl{font-size:9px;color:${accent};font-style:italic;margin-top:2px}
.footer{margin-top:25px;padding-top:8px;border-top:1px solid #f0f0f0;text-align:center;font-size:8px;color:#ccc;font-style:italic}
@media print{.hdr,.inv-center .title,.items-tbl th,.grand-modern,.inv-center .status{color:${accent}!important;border-color:${accent}!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}img{max-width:100%!important}}
</style></head><body>
<div class="hdr">${logoHtml}<h1>${tenant.name || 'BizBook Pro'}</h1><p>${tenant.address || ''}</p>${tenant.phone ? `<p>Ph: ${tenant.phone}</p>` : ''}${tenant.email ? `<p>${tenant.email}</p>` : ''}${tenant.gstNumber ? `<p>GSTIN: ${tenant.gstNumber}</p>` : ''}</div>
<div class="inv-center"><div class="title">Invoice</div><div class="no">#${sale.invoiceNumber}</div><div class="date">${fmtDate(new Date(sale.date))}</div><div class="status">${statusLabel(sale.paymentStatus)}</div></div>
<div class="parties"><div class="p-box"><div class="lbl">From</div><div class="name">${tenant.name || 'Business'}</div>${tenant.address ? `<div class="detail">${tenant.address}</div>` : ''}${tenant.gstNumber ? `<div class="detail">GSTIN: ${tenant.gstNumber}</div>` : ''}</div><div class="p-box"><div class="lbl">To</div><div class="name">${sale.partyName}</div>${sale.partyAddress ? `<div class="detail">${sale.partyAddress}</div>` : ''}${sale.partyGst ? `<div class="detail">GSTIN: ${sale.partyGst}</div>` : ''}</div></div>
<table class="items-tbl"><thead><tr><th class="col-no">#</th><th class="col-item">Description</th><th class="col-hsn c">HSN</th><th class="col-qty c">Qty</th><th class="col-rate r">Rate</th><th class="col-amt r">Amount</th></tr></thead><tbody>
${itemRows(sale,'elegant')}
</tbody></table>
<div class="totals-box">${totalsBlock(sale,accent,'elegant')}</div>
${sale.notes ? `<div class="notes"><strong>Notes:</strong> ${sale.notes}</div>` : ''}
${qr ? `<div class="qr"><img src="${qr.url}" alt="UPI QR"/><div class="lbl">Scan to Pay ${fmtCurrency(qr.amount)}</div></div>` : ''}
${sigHtml}
<div style="clear:both"></div>
<div class="footer">${footerText}</div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`
}

// ── Main selector ──
export function generateInvoiceHtml(sale: InvoiceData, tenant: TenantData): string {
  const template = tenant.invoiceTemplate || 'classic'
  switch (template) {
    case 'modern': return templateModern(sale, tenant)
    case 'minimal': return templateMinimal(sale, tenant)
    case 'corporate': return templateCorporate(sale, tenant)
    case 'elegant': return templateElegant(sale, tenant)
    default: return templateClassic(sale, tenant)
  }
}

export const INVOICE_TEMPLATES = [
  { value: 'classic', label: 'Executive (Monospace — black & white)' },
  { value: 'modern', label: 'Luxury Tech (Sans-serif — accent top bar)' },
  { value: 'minimal', label: 'Minimalist (Ultra-clean — whitespace)' },
  { value: 'corporate', label: 'Corporate (Dark header bar — bold)' },
  { value: 'elegant', label: 'Creative Studio (Serif — warm accent, centered)' },
]
