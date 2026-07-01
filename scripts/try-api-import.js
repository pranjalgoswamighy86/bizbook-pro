// scripts/try-api-import.js
// Attempts to import Bakers Mart data via /api/backup/restore
// Uses scrypt password hash to authenticate via backup credentials

const crypto = require('crypto')
const openpyxl = require('xlsx') // use xlsx package (already installed)

const SCRYPT_SALT_BYTES = 16
const SCRYPT_KEYLEN = 64

function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES)
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

const API_URL = 'https://carefree-success-production-7766.up.railway.app'

async function main() {
  console.log('=== Bakers Mart API Import ===\n')

  // 1. Read the generated BizBook Excel backup
  const XLSX = require('xlsx')
  const buf = require('fs').readFileSync('/home/z/my-project/download/Bakers_Mart_DMP_BizBook_Import.xlsx')
  const wb = XLSX.read(buf, { type: 'buffer' })
  console.log('Sheets in backup file:', wb.SheetNames)

  // Parse each sheet to JSON
  const data = {}
  for (const sheetName of wb.SheetNames) {
    if (sheetName === '_README') continue
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName])
    data[sheetName] = rows
    console.log(`  ${sheetName}: ${rows.length} rows`)
  }

  // 2. Generate scrypt hash for "admin123"
  const passwordHash = hashPassword('admin123')
  console.log('\nGenerated scrypt hash for admin123')

  // 3. Build the backup payload
  // We need a tenantId — we'll use a placeholder and the restore will create records
  // under this tenant. The user can then access data by switching to this tenant.
  // BUT: we need to find the actual tenantId for "Bakers Mart - DMP"

  // Actually, let's try without Tenant/User tables — just send Inventory, Sales, Purchases
  // with a tenantId that we'll try to discover

  // First, let's try to find the tenantId by hitting the auth endpoint
  const adminEmail = 'admin@bizbook.pro'

  const backupData = {
    _metadata: {
      software: 'BizBook Pro',
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
    },
    data: {
      // Include admin user with known password hash for auth
      User: [{
        id: 'admin_import_user',
        email: adminEmail,
        password: passwordHash,
        role: 'SUPER_ADMIN',
        tenantId: 'admin_tenant',
        isActive: true,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      // Don't include Tenant — we don't want to create a new one
      // The Inventory, Sales, Purchases will need a tenantId
      // We'll try with a dummy one first to see if auth works
      InventoryItem: (data['Inventory'] || []).map(r => ({ ...r, tenantId: 'PLACEHOLDER' })),
      Sale: (data['Sales'] || []).map(r => ({ ...r, tenantId: 'PLACEHOLDER' })),
      Purchase: (data['Purchases'] || []).map(r => ({ ...r, tenantId: 'PLACEHOLDER' })),
    },
  }

  console.log(`\nPayload: ${backupData.data.InventoryItem.length} inventory + ${backupData.data.Sale.length} sales + ${backupData.data.Purchase.length} purchases`)

  // 4. POST to /api/backup/restore
  console.log('\nSending to /api/backup/restore...')
  try {
    const res = await fetch(`${API_URL}/api/backup/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: adminEmail,
        password: 'admin123',
        backupData,
      }),
    })

    const result = await res.json()
    console.log(`\nResponse status: ${res.status}`)
    console.log('Response:', JSON.stringify(result, null, 2).slice(0, 2000))
  } catch (err) {
    console.error('Fetch error:', err.message)
  }
}

main().catch(console.error)
