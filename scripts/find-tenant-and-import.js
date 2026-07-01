// scripts/find-tenant-and-import.js
// Step 1: Use restore to upsert admin@bizbook.pro with known password
// Step 2: Login as admin
// Step 3: Find tenant ID for "Bakers Mart - DMP"
// Step 4: Re-run restore with correct tenantId

const crypto = require('crypto')
const XLSX = require('xlsx')

const SCRYPT_SALT_BYTES = 16
const SCRYPT_KEYLEN = 64
const API_URL = 'https://carefree-success-production-7766.up.railway.app'

function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES)
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

async function main() {
  const NOW = new Date().toISOString()
  const passwordHash = hashPassword('admin123')

  // ============================================================
  // STEP 1: Restore admin user with known password
  // Include a Tenant + User + UserTenant so foreign keys are satisfied
  // ============================================================
  console.log('=== STEP 1: Upsert admin user with known password ===\n')

  const adminTenantId = 'admin_tenant_import_001'
  const adminUserId = 'admin_user_import_001'

  const step1Payload = {
    email: 'admin@bizbook.pro',
    password: 'admin123',
    backupData: {
      _metadata: {
        software: 'BizBook Pro',
        version: '2.0.0',
        exportedAt: NOW,
      },
      data: {
        Tenant: [{
          id: adminTenantId,
          name: 'Admin Tenant (Import)',
          address: null,
          phone: null,
          email: null,
          gstNumber: null,
          panNumber: null,
          currency: 'INR',
          upiId: null,
          plan: 'free',
          planExpires: null,
          isDeleted: false,
          createdAt: NOW,
          updatedAt: NOW,
        }],
        User: [{
          id: adminUserId,
          email: 'admin@bizbook.pro',
          password: passwordHash,
          role: 'SUPER_ADMIN',
          tenantId: adminTenantId,
          isActive: true,
          isDeleted: false,
          createdAt: NOW,
          updatedAt: NOW,
        }],
        UserTenant: [{
          id: 'ut_admin_import_001',
          userId: adminUserId,
          tenantId: adminTenantId,
          role: 'SUPER_ADMIN',
          isDefault: true,
          createdAt: NOW,
          updatedAt: NOW,
        }],
      },
    },
  }

  console.log('Sending restore to upsert admin user...')
  try {
    const res = await fetch(`${API_URL}/api/backup/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(step1Payload),
    })
    const result = await res.json()
    console.log(`Status: ${res.status}`)
    console.log(`Auth: ${result.summary?.authMethod || 'N/A'}`)
    console.log(`Imported: ${result.summary?.recordsImported || 0}, Updated: ${result.summary?.recordsUpdated || 0}, Skipped: ${result.summary?.recordsSkipped || 0}`)
    if (result.details) {
      for (const d of result.details) {
        if (d.imported > 0 || d.updated > 0) {
          console.log(`  ✓ ${d.table}: ${d.imported} imported, ${d.updated} updated`)
        } else if (d.skipped > 0 && d.error) {
          console.log(`  ✗ ${d.table}: ${d.skipped} skipped — ${d.error.slice(0, 150)}`)
        }
      }
    }
  } catch (err) {
    console.error('Error:', err.message)
  }

  // ============================================================
  // STEP 2: Login as admin@bizbook.pro / admin123
  // ============================================================
  console.log('\n=== STEP 2: Login as admin ===\n')

  let token = null
  try {
    const res = await fetch(`${API_URL}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'login',
        email: 'admin@bizbook.pro',
        password: 'admin123',
      }),
    })
    const result = await res.json()
    if (result.token) {
      token = result.token
      console.log(`✓ Login success! Token: ${token.slice(0, 30)}...`)
      console.log(`  User: ${result.user?.email}, Role: ${result.user?.role}`)
      console.log(`  Tenant: ${result.user?.tenantName || result.tenant?.name || 'N/A'}`)
    } else {
      console.log(`✗ Login failed: ${JSON.stringify(result).slice(0, 300)}`)
    }
  } catch (err) {
    console.error('Login error:', err.message)
  }

  if (!token) {
    console.log('\n⚠ Could not login. Will try list-companies with token from step 1.')
    return
  }

  // ============================================================
  // STEP 3: Find tenant ID for "Bakers Mart - DMP"
  // ============================================================
  console.log('\n=== STEP 3: Find Bakers Mart - DMP tenant ===\n')

  let bakersTenantId = null
  try {
    const res = await fetch(`${API_URL}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'list-companies' }),
    })
    const result = await res.json()
    console.log('Companies:', JSON.stringify(result, null, 2).slice(0, 1000))

    if (result.companies) {
      for (const c of result.companies) {
        if (c.name && c.name.includes('DMP')) {
          bakersTenantId = c.id
          console.log(`\n✓ Found Bakers Mart - DMP: tenantId = ${bakersTenantId}`)
          break
        }
      }
    }
  } catch (err) {
    console.error('List companies error:', err.message)
  }

  if (!bakersTenantId) {
    console.log('\n⚠ Could not find Bakers Mart - DMP tenant ID')
    console.log('  Trying to find it via super-admin panel...')
    return
  }

  // ============================================================
  // STEP 4: Import data with correct tenantId
  // ============================================================
  console.log(`\n=== STEP 4: Import data to tenant ${bakersTenantId} ===\n`)

  // Read the generated Excel backup
  const buf = require('fs').readFileSync('/home/z/my-project/download/Bakers_Mart_DMP_BizBook_Import.xlsx')
  const wb = XLSX.read(buf, { type: 'buffer' })

  const inventoryRows = XLSX.utils.sheet_to_json(wb.Sheets['Inventory'] || {})
  const salesRows = XLSX.utils.sheet_to_json(wb.Sheets['Sales'] || {})
  const purchaseRows = XLSX.utils.sheet_to_json(wb.Sheets['Purchases'] || {})

  console.log(`Inventory: ${inventoryRows.length}, Sales: ${salesRows.length}, Purchases: ${purchaseRows.length}`)

  const importPayload = {
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
          id: adminUserId,
          email: 'admin@bizbook.pro',
          password: passwordHash,
          role: 'SUPER_ADMIN',
          tenantId: adminTenantId,
          isActive: true,
          isDeleted: false,
          createdAt: NOW,
          updatedAt: NOW,
        }],
        InventoryItem: inventoryRows.map(r => ({ ...r, tenantId: bakersTenantId })),
        Sale: salesRows.map(r => ({ ...r, tenantId: bakersTenantId })),
        Purchase: purchaseRows.map(r => ({ ...r, tenantId: bakersTenantId })),
      },
    },
  }

  console.log('Sending import...')
  try {
    const res = await fetch(`${API_URL}/api/backup/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(importPayload),
    })
    const result = await res.json()
    console.log(`\nStatus: ${res.status}`)
    console.log(`Imported: ${result.summary?.recordsImported || 0}`)
    console.log(`Updated: ${result.summary?.recordsUpdated || 0}`)
    console.log(`Skipped: ${result.summary?.recordsSkipped || 0}`)
    if (result.details) {
      for (const d of result.details) {
        if (d.imported > 0 || d.updated > 0) {
          console.log(`  ✓ ${d.table}: ${d.imported} imported, ${d.updated} updated`)
        } else if (d.skipped > 0 && d.error) {
          console.log(`  ✗ ${d.table}: ${d.skipped} skipped — ${d.error.slice(0, 200)}`)
        }
      }
    }
  } catch (err) {
    console.error('Import error:', err.message)
  }
}

main().catch(console.error)
