// scripts/import-sales-purchases.js
// Import sales and purchases via the temp POST endpoint

const XLSX = require('xlsx')
const API_URL = 'https://carefree-success-production-7766.up.railway.app'
const TENANT_ID = 'cmqs5f2aq0000nx013d9w55ka'

function num(v) { const n = Number(v); return isNaN(n) ? 0 : n }
function str(v) { return v == null ? '' : String(v) }
function dateISO(v) {
  if (!v) return new Date().toISOString()
  if (v instanceof Date) return v.toISOString()
  const s = String(v)
  if (s.includes('T')) return s
  const months = {'jan':'01','feb':'02','mar':'03','apr':'04','may':'05','jun':'06','jul':'07','aug':'08','sep':'09','oct':'10','nov':'11','dec':'12'}
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/)
  if (m) {
    return `${m[3]}-${months[m[2].toLowerCase()]}-${m[1].padStart(2,'0')}T00:00:00.000Z`
  }
  return new Date(s).toISOString()
}
function ensureItems(v) {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return JSON.stringify(v)
  return '[]'
}

async function main() {
  console.log('Reading Excel backup...')
  const buf = require('fs').readFileSync('/home/z/my-project/download/Bakers_Mart_DMP_BizBook_Import.xlsx')
  const wb = XLSX.read(buf, { type: 'buffer' })

  const salesRows = XLSX.utils.sheet_to_json(wb.Sheets['Sales'] || {})
  const purchaseRows = XLSX.utils.sheet_to_json(wb.Sheets['Purchases'] || {})
  console.log(`Sales: ${salesRows.length}, Purchases: ${purchaseRows.length}\n`)

  // Build sale records
  const sales = salesRows.map(r => ({
    id: str(r.id),
    invoiceNumber: str(r.invoiceNumber),
    date: dateISO(r.date),
    partyName: str(r.partyName) || 'Cash Customer',
    items: ensureItems(r.items),
    subtotal: num(r.subtotal),
    gstAmount: num(r.gstAmount),
    totalAmount: num(r.totalAmount),
    paymentStatus: str(r.paymentStatus) || 'RECEIVED',
    invoiceStatus: str(r.invoiceStatus) || 'CONFIRMED',
    amountReceived: num(r.amountReceived),
    amountPaid: num(r.amountPaid),
  }))

  // Build purchase records
  const purchases = purchaseRows.map(r => ({
    id: str(r.id),
    invoiceNumber: str(r.invoiceNumber),
    date: dateISO(r.date),
    partyName: str(r.partyName) || 'Unknown Supplier',
    items: ensureItems(r.items),
    subtotal: num(r.subtotal),
    gstAmount: num(r.gstAmount),
    totalAmount: num(r.totalAmount),
    paymentStatus: str(r.paymentStatus) || 'PAID',
    amountPaid: num(r.amountPaid),
    notes: str(r.notes) || null,
  }))

  // Import sales
  console.log('=== Importing Sales ===')
  console.log(`Sending ${sales.length} sales...`)
  const saleRes = await fetch(`${API_URL}/api/import-bakers-mart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'import-sales', tenantId: TENANT_ID, sales }),
  })
  const saleResult = await saleRes.json()
  console.log(`Status: ${saleRes.status}`)
  console.log(`Imported: ${saleResult.imported}/${saleResult.total}`)
  if (saleResult.errors?.length > 0) {
    console.log('Errors:')
    for (const e of saleResult.errors) {
      console.log(`  ✗ ${e}`)
    }
  }

  // Import purchases
  console.log('\n=== Importing Purchases ===')
  console.log(`Sending ${purchases.length} purchases...`)
  const purRes = await fetch(`${API_URL}/api/import-bakers-mart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'import-purchases', tenantId: TENANT_ID, purchases }),
  })
  const purResult = await purRes.json()
  console.log(`Status: ${purRes.status}`)
  console.log(`Imported: ${purResult.imported}/${purResult.total}`)
  if (purResult.errors?.length > 0) {
    console.log('Errors:')
    for (const e of purResult.errors) {
      console.log(`  ✗ ${e}`)
    }
  }

  // Verify
  console.log('\n=== Verification ===')
  const verifyRes = await fetch(`${API_URL}/api/import-bakers-mart?action=verify-import&tenantId=${TENANT_ID}`)
  const verify = await verifyRes.json()
  console.log(`Inventory: ${verify.inventory}`)
  console.log(`Sales: ${verify.sales}`)
  console.log(`Purchases: ${verify.purchases}`)

  const totalSalesAmt = sales.reduce((s, r) => s + r.totalAmount, 0)
  const totalPurAmt = purchases.reduce((s, r) => s + r.totalAmount, 0)
  console.log(`\nExpected Sales Amount: ₹${totalSalesAmt.toLocaleString('en-IN')}`)
  console.log(`Expected Purchase Amount: ₹${totalPurAmt.toLocaleString('en-IN')}`)
}

main().catch(console.error)
