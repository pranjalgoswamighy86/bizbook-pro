// scripts/final-import-v2.js
// Fixed version: properly convert all types, ensure items is string, dates are ISO

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
  // Already ISO format
  if (s.includes('T')) return s
  // Try YYYY-MM-DD
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

  // Build properly-typed records
  const inventoryItems = inventoryRows.map(r => ({
    id: str(r.id),
    name: str(r.name),
    sku: str(r.sku) || null,
    barcode: str(r.barcode) || null,
    hsnCode: str(r.hsnCode) || null,
    unit: str(r.unit) || 'PCS',
    category: str(r.category) || null,
    brand: str(r.brand) || null,
    itemType: str(r.itemType) || 'RAW_MATERIAL',
    purchasePrice: num(r.purchasePrice),
    salePrice: num(r.salePrice),
    mrp: num(r.mrp),
    openingStock: num(r.openingStock),
    currentStock: num(r.currentStock),
    minStock: num(r.minStock),
    gstRate: num(r.gstRate),
    value: num(r.value),
    tenantId: TENANT_ID,
    isDeleted: false,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }))

  const sales = salesRows.map(r => ({
    id: str(r.id),
    invoiceNumber: str(r.invoiceNumber),
    date: dateISO(r.date),
    partyName: str(r.partyName) || 'Cash Customer',
    partyAddress: str(r.partyAddress) || null,
    partyGst: str(r.partyGst) || null,
    items: ensureItems(r.items),
    subtotal: num(r.subtotal),
    gstAmount: num(r.gstAmount),
    totalAmount: num(r.totalAmount),
    invoiceType: str(r.invoiceType) || 'TAX_INVOICE',
    invoiceStatus: str(r.invoiceStatus) || 'CONFIRMED',
    paymentStatus: str(r.paymentStatus) || 'RECEIVED',
    amountReceived: num(r.amountReceived),
    amountPaid: num(r.amountPaid),
    notes: str(r.notes) || null,
    invoiceFile: null,
    einvoiceIrn: null,
    einvoiceAckNo: null,
    einvoiceAckDate: null,
    einvoiceStatus: 'PENDING',
    createdBy: null,
    tenantId: TENANT_ID,
    isDeleted: false,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }))

  const purchases = purchaseRows.map(r => ({
    id: str(r.id),
    invoiceNumber: str(r.invoiceNumber),
    date: dateISO(r.date),
    partyName: str(r.partyName) || 'Unknown Supplier',
    partyAddress: str(r.partyAddress) || null,
    partyGst: str(r.partyGst) || null,
    items: ensureItems(r.items),
    subtotal: num(r.subtotal),
    gstAmount: num(r.gstAmount),
    totalAmount: num(r.totalAmount),
    paymentStatus: str(r.paymentStatus) || 'PAID',
    amountPaid: num(r.amountPaid),
    notes: str(r.notes) || null,
    invoiceFile: null,
    einvoiceIrn: null,
    einvoiceAckNo: null,
    einvoiceAckDate: null,
    einvoiceStatus: 'PENDING',
    createdBy: null,
    tenantId: TENANT_ID,
    isDeleted: false,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }))

  console.log(`First inventory item sample:`, JSON.stringify(inventoryItems[0], null, 2).slice(0, 500))
  console.log(`First sale sample:`, JSON.stringify(sales[0], null, 2).slice(0, 500))
  console.log()

  const payload = {
    email: 'admin@bizbook.pro',
    password: 'admin123',
    backupData: {
      _metadata: {
        software: 'BizBook Pro',
        version: '2.0.0',
        exportedAt: NOW,
      },
      data: {
        User: [{
          id: 'temp_auth_' + Date.now(),
          email: 'admin@bizbook.pro',
          password: passwordHash,
          role: 'SUPER_ADMIN',
          tenantId: TENANT_ID,
          isActive: true,
          isDeleted: false,
          createdAt: NOW,
          updatedAt: NOW,
        }],
        InventoryItem: inventoryItems,
        Sale: sales,
        Purchase: purchases,
      },
    },
  }

  console.log(`Sending ${inventoryItems.length + sales.length + purchases.length} records to /api/backup/restore...`)

  const res = await fetch(`${API_URL}/api/backup/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const result = await res.json()
  console.log(`\nStatus: ${res.status}`)
  console.log(`Auth: ${result.summary?.authMethod || 'N/A'}`)
  console.log(`Imported: ${result.summary?.recordsImported || 0}`)
  console.log(`Updated: ${result.summary?.recordsUpdated || 0}`)
  console.log(`Skipped: ${result.summary?.recordsSkipped || 0}`)
  console.log()

  if (result.details) {
    for (const d of result.details) {
      if (['User', 'InventoryItem', 'Sale', 'Purchase'].includes(d.table)) {
        if (d.imported > 0 || d.updated > 0) {
          console.log(`  ✓ ${d.table}: ${d.imported} imported, ${d.updated} updated`)
        } else if (d.skipped > 0) {
          console.log(`  ✗ ${d.table}: ${d.skipped} skipped`)
          if (d.error) {
            // Show full error for first record
            console.log(`    First error: ${d.error.slice(0, 500)}`)
          }
        }
      }
    }
  }
}

main().catch(console.error)
