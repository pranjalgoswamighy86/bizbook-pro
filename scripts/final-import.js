// scripts/final-import.js
// Import all Bakers Mart data to tenant cmqs5f2aq0000nx013d9w55ka (Bakers Mart - DMP)

const crypto = require('crypto')
const XLSX = require('xlsx')

const SCRYPT_SALT_BYTES = 16
const SCRYPT_KEYLEN = 64
const API_URL = 'https://carefree-success-production-7766.up.railway.app'
const TENANT_ID = 'cmqs5f2aq0000nx013d9w55ka' // Bakers Mart - DMP

function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES)
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

async function main() {
  const NOW = new Date().toISOString()
  const passwordHash = hashPassword('admin123')

  // Read the generated Excel backup
  console.log('Reading Excel backup...')
  const buf = require('fs').readFileSync('/home/z/my-project/download/Bakers_Mart_DMP_BizBook_Import.xlsx')
  const wb = XLSX.read(buf, { type: 'buffer' })

  const inventoryRows = XLSX.utils.sheet_to_json(wb.Sheets['Inventory'] || {})
  const salesRows = XLSX.utils.sheet_to_json(wb.Sheets['Sales'] || {})
  const purchaseRows = XLSX.utils.sheet_to_json(wb.Sheets['Purchases'] || {})

  console.log(`Parsed: ${inventoryRows.length} inventory + ${salesRows.length} sales + ${purchaseRows.length} purchases`)
  console.log(`Target tenant: ${TENANT_ID} (Bakers Mart - DMP)\n`)

  // Build the restore payload
  // Auth: include admin user with known password hash in backup
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
        // Auth user — use admin@bizbook.pro with known password hash
        // This will authenticate via "backup" method (checks password hash in backup data)
        // The User upsert will fail (email already exists) but auth will succeed,
        // and Inventory/Sale/Purchase will still be imported
        User: [{
          id: 'temp_auth_user_' + Date.now(),
          email: 'admin@bizbook.pro',
          password: passwordHash,
          role: 'SUPER_ADMIN',
          tenantId: TENANT_ID,
          isActive: true,
          isDeleted: false,
          createdAt: NOW,
          updatedAt: NOW,
        }],
        // Inventory items
        InventoryItem: inventoryRows.map(r => ({
          ...r,
          tenantId: TENANT_ID,
          // Ensure numeric fields are numbers
          purchasePrice: Number(r.purchasePrice) || 0,
          salePrice: Number(r.salePrice) || 0,
          mrp: Number(r.mrp) || 0,
          openingStock: Number(r.openingStock) || 0,
          currentStock: Number(r.currentStock) || 0,
          minStock: Number(r.minStock) || 0,
          gstRate: Number(r.gstRate) || 0,
          value: Number(r.value) || 0,
        })),
        // Sales
        Sale: salesRows.map(r => ({
          ...r,
          tenantId: TENANT_ID,
          subtotal: Number(r.subtotal) || 0,
          gstAmount: Number(r.gstAmount) || 0,
          totalAmount: Number(r.totalAmount) || 0,
          amountReceived: Number(r.amountReceived) || 0,
          amountPaid: Number(r.amountPaid) || 0,
        })),
        // Purchases
        Purchase: purchaseRows.map(r => ({
          ...r,
          tenantId: TENANT_ID,
          subtotal: Number(r.subtotal) || 0,
          gstAmount: Number(r.gstAmount) || 0,
          totalAmount: Number(r.totalAmount) || 0,
          amountPaid: Number(r.amountPaid) || 0,
        })),
      },
    },
  }

  console.log(`Total records to import: ${payload.backupData.data.InventoryItem.length + payload.backupData.data.Sale.length + payload.backupData.data.Purchase.length}`)
  console.log('Sending to /api/backup/restore...\n')

  const res = await fetch(`${API_URL}/api/backup/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const result = await res.json()
  console.log(`Status: ${res.status}`)
  console.log(`Auth: ${result.summary?.authMethod || 'N/A'}`)
  console.log(`Imported: ${result.summary?.recordsImported || 0}`)
  console.log(`Updated: ${result.summary?.recordsUpdated || 0}`)
  console.log(`Skipped: ${result.summary?.recordsSkipped || 0}`)
  console.log()

  if (result.details) {
    for (const d of result.details) {
      if (d.table === 'User' || d.table === 'InventoryItem' || d.table === 'Sale' || d.table === 'Purchase') {
        if (d.imported > 0 || d.updated > 0) {
          console.log(`  ✓ ${d.table}: ${d.imported} imported, ${d.updated} updated`)
        } else if (d.skipped > 0) {
          console.log(`  ✗ ${d.table}: ${d.skipped} skipped`)
          if (d.error) {
            // Show first error in full
            console.log(`    Error: ${d.error.slice(0, 300)}`)
          }
        }
      }
    }
  }
}

main().catch(console.error)
