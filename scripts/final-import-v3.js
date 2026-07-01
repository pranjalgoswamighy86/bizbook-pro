// scripts/final-import-v3.js
// Fixed: removed invoiceType (not in schema), use temp endpoint for direct DB import

const crypto = require('crypto')
const XLSX = require('xlsx')

const SCRYPT_SALT_BYTES = 16
const SCRYPT_KEYLEN = 64
const API_URL = 'https://carefree-success-production-7766.up.railway.app'
const TENANT_ID = 'cmqs5f2aq0000nx013d9w55ka'

function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES)
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

function num(v) { const n = Number(v); return isNaN(n) ? 0 : n }
function str(v) { return v == null ? '' : String(v) }
function dateISO(v) {
  if (!v) return new Date().toISOString()
  if (v instanceof Date) return v.toISOString()
  const s = String(v)
  if (s.includes('T')) return s
  // Try DD-Mon-YYYY format (e.g., "01-May-2026")
  const months = {'jan':'01','feb':'02','mar':'03','apr':'04','may':'05','jun':'06','jul':'07','aug':'08','sep':'09','oct':'10','nov':'11','dec':'12'}
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/)
  if (m) {
    const day = m[1].padStart(2,'0')
    const mon = months[m[2].toLowerCase()] || '01'
    return `${m[3]}-${mon}-${day}T00:00:00.000Z`
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}
function ensureItems(v) {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return JSON.stringify(v)
  if (v && typeof v === 'object') return JSON.stringify([v])
  return '[]'
}

async function main() {
  const NOW = new Date().toISOString()
  const passwordHash = hashPassword('admin123')

  console.log('Reading Excel backup...')
  const buf = require('fs').readFileSync('/home/z/my-project/download/Bakers_Mart_DMP_BizBook_Import.xlsx')
  const wb = XLSX.read(buf, { type: 'buffer' })

  const inventoryRows = XLSX.utils.sheet_to_json(wb.Sheets['Inventory'] || {})
  const salesRows = XLSX.utils.sheet_to_json(wb.Sheets['Sales'] || {})
  const purchaseRows = XLSX.utils.sheet_to_json(wb.Sheets['Purchases'] || {})

  console.log(`Parsed: ${inventoryRows.length} inventory + ${salesRows.length} sales + ${purchaseRows.length} purchases\n`)

  // Build properly-typed records — NO invoiceType (not in Sale schema)
  const inventoryItems = inventoryRows.map(r => ({
    id: str(r.id), name: str(r.name), sku: str(r.sku) || null, barcode: str(r.barcode) || null,
    hsnCode: str(r.hsnCode) || null, unit: str(r.unit) || 'PCS', category: str(r.category) || null,
    brand: str(r.brand) || null, itemType: str(r.itemType) || 'RAW_MATERIAL',
    purchasePrice: num(r.purchasePrice), salePrice: num(r.salePrice), mrp: num(r.mrp),
    openingStock: num(r.openingStock), currentStock: num(r.currentStock), minStock: num(r.minStock),
    gstRate: num(r.gstRate), value: num(r.value), tenantId: TENANT_ID,
    isDeleted: false, deletedAt: null, createdAt: NOW, updatedAt: NOW,
  }))

  // Sale records — NO invoiceType field (removed, not in Prisma schema)
  const sales = salesRows.map(r => ({
    id: str(r.id),
    invoiceNumber: str(r.invoiceNumber),
    date: dateISO(r.date),
    partyName: str(r.partyName) || 'Cash Customer',
    partyAddress: null,
    partyGst: null,
    items: ensureItems(r.items),
    subtotal: num(r.subtotal),
    gstAmount: num(r.gstAmount),
    totalAmount: num(r.totalAmount),
    paymentStatus: str(r.paymentStatus) || 'RECEIVED',
    paymentMode: null,
    invoiceStatus: str(r.invoiceStatus) || 'CONFIRMED',
    upiAmount: 0,
    amountReceived: num(r.amountReceived),
    amountPaid: num(r.amountPaid),
    notes: null,
    invoiceFile: null,
    einvoiceIrn: null, einvoiceAckNo: null, einvoiceAckDate: null, einvoiceQrCodeText: null,
    einvoiceStatus: 'PENDING',
    createdBy: null,
    tenantId: TENANT_ID,
    isDeleted: false, deletedAt: null, createdAt: NOW, updatedAt: NOW,
  }))

  const purchases = purchaseRows.map(r => ({
    id: str(r.id),
    invoiceNumber: str(r.invoiceNumber),
    date: dateISO(r.date),
    partyName: str(r.partyName) || 'Unknown Supplier',
    partyAddress: null,
    partyGst: null,
    items: ensureItems(r.items),
    subtotal: num(r.subtotal),
    gstAmount: num(r.gstAmount),
    totalAmount: num(r.totalAmount),
    paymentStatus: str(r.paymentStatus) || 'PAID',
    paymentMode: null,
    amountPaid: num(r.amountPaid),
    notes: str(r.notes) || null,
    invoiceFile: null,
    einvoiceIrn: null, einvoiceAckNo: null, einvoiceAckDate: null, einvoiceQrCodeText: null,
    einvoiceStatus: 'PENDING',
    createdBy: null,
    tenantId: TENANT_ID,
    isDeleted: false, deletedAt: null, createdAt: NOW, updatedAt: NOW,
  }))

  console.log(`First sale (no invoiceType):`, JSON.stringify(sales[0]).slice(0, 300))
  console.log(`First purchase:`, JSON.stringify(purchases[0]).slice(0, 300))
  console.log()

  const payload = {
    email: 'admin@bizbook.pro',
    password: 'admin123',
    backupData: {
      _metadata: { software: 'BizBook Pro', version: '2.0.0', exportedAt: NOW },
      data: {
        User: [{
          id: 'temp_auth_' + Date.now(),
          email: 'admin@bizbook.pro',
          password: passwordHash,
          role: 'SUPER_ADMIN', tenantId: TENANT_ID,
          isActive: true, isDeleted: false, createdAt: NOW, updatedAt: NOW,
        }],
        InventoryItem: inventoryItems,
        Sale: sales,
        Purchase: purchases,
      },
    },
  }

  console.log(`Sending ${inventoryItems.length + sales.length + purchases.length} records...`)

  const res = await fetch(`${API_URL}/api/backup/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const result = await res.json()
  console.log(`\nStatus: ${res.status}`)
  console.log(`Imported: ${result.summary?.recordsImported || 0}`)
  console.log(`Updated: ${result.summary?.recordsUpdated || 0}`)
  console.log(`Skipped: ${result.summary?.recordsSkipped || 0}`)
  console.log()

  if (result.details) {
    for (const d of result.details) {
      if (['InventoryItem', 'Sale', 'Purchase'].includes(d.table)) {
        console.log(`  ${d.imported > 0 ? '✓' : '✗'} ${d.table}: ${d.imported} imported, ${d.updated} updated, ${d.skipped} skipped`)
        if (d.skipped > 0 && d.error) {
          console.log(`    Error: ${d.error.slice(0, 400)}`)
        }
      }
    }
  }
}

main().catch(console.error)
