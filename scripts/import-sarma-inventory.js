// scripts/import-sarma-inventory.js
// Parse invantory.xlsx and import 221 inventory items to Sarma store tenant

const XLSX = require('xlsx')
const API_URL = 'https://carefree-success-production-7766.up.railway.app'
const TENANT_ID = 'cmr1kc00x0001qz01nw7pluu1' // Sarma store

function num(v) { const n = Number(v); return isNaN(n) ? 0 : n }
function str(v) { return v == null ? '' : String(v).trim() }

async function main() {
  console.log('=== Sarma Store Inventory Import ===\n')

  // Read the Excel file
  const buf = require('fs').readFileSync('/home/z/my-project/upload/invantory.xlsx')
  const wb = XLSX.read(buf, { type: 'buffer' })
  console.log(`Sheets: ${wb.SheetNames}`)

  // Parse Sheet1 — header at row 4, data from row 5
  const sheet = wb.Sheets['Sheet1']
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 }) // start from row 4 (0-indexed 3)

  // First row is the header
  const headers = rows[0]
  console.log(`Headers: ${JSON.stringify(headers)}`)
  console.log(`Total data rows: ${rows.length - 1}`)

  // Build inventory items
  const items = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row[0]) continue // skip empty rows

    const name = str(row[0])
    const qty = num(row[1])
    const mrp = num(row[2])
    const costingPrice = num(row[3])
    const sellingPrice = num(row[4])
    const totalAmount = num(row[5])

    // Calculate values
    // - purchasePrice = costingPrice
    // - salePrice = sellingPrice (if available, else mrp)
    // - currentStock = qty
    // - openingStock = qty (same as current since this is a snapshot)
    // - value = totalAmount (qty * costingPrice)
    // - mrp = mrp

    items.push({
      id: `sarma_inv_${String(i).padStart(4, '0')}`,
      name: name,
      sku: null,
      barcode: null,
      hsnCode: null,
      unit: 'PCS',
      category: 'Grocery',
      brand: null,
      itemType: 'FINISHED_PRODUCT',
      purchasePrice: costingPrice,
      salePrice: sellingPrice > 0 ? sellingPrice : mrp,
      mrp: mrp,
      openingStock: qty,
      currentStock: qty,
      minStock: 0,
      gstRate: 0,
      value: totalAmount > 0 ? totalAmount : qty * costingPrice,
    })
  }

  console.log(`\nParsed ${items.length} inventory items`)
  console.log(`\nSample item:`, JSON.stringify(items[0], null, 2))
  console.log(`Last item:`, JSON.stringify(items[items.length - 1], null, 2))

  // Calculate totals
  const totalQty = items.reduce((s, i) => s + i.currentStock, 0)
  const totalValue = items.reduce((s, i) => s + i.value, 0)
  const totalMrp = items.reduce((s, i) => s + (i.mrp * i.currentStock), 0)
  console.log(`\n--- Summary ---`)
  console.log(`Total items: ${items.length}`)
  console.log(`Total quantity: ${totalQty}`)
  console.log(`Total stock value (at cost): ₹${totalValue.toLocaleString('en-IN')}`)
  console.log(`Total stock value (at MRP): ₹${totalMrp.toLocaleString('en-IN')}`)

  // Import via temp endpoint
  console.log(`\n--- Importing to Sarma store (${TENANT_ID}) ---`)
  const res = await fetch(`${API_URL}/api/temp-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'import-inventory',
      tenantId: TENANT_ID,
      items: items,
    }),
  })

  const result = await res.json()
  console.log(`\nStatus: ${res.status}`)
  console.log(`Imported: ${result.imported}/${result.total}`)
  if (result.errors?.length > 0) {
    console.log('Errors:')
    for (const e of result.errors) {
      console.log(`  ✗ ${e}`)
    }
  }

  // Verify
  console.log('\n--- Verification ---')
  const verifyRes = await fetch(`${API_URL}/api/temp-import?action=verify&tenantId=${TENANT_ID}`)
  const verify = await verifyRes.json()
  console.log(`Inventory count: ${verify.inventory}`)
  console.log(`Sales count: ${verify.sales}`)
  console.log(`Purchases count: ${verify.purchases}`)

  if (verify.inventory === items.length) {
    console.log(`\n✅ SUCCESS — all ${items.length} items imported!`)
  } else {
    console.log(`\n⚠ Mismatch — expected ${items.length}, got ${verify.inventory}`)
  }
}

main().catch(console.error)
