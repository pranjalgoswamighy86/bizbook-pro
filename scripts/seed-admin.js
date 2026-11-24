const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')

const SCRYPT_KEYLEN = 64
const SCRYPT_SALT_BYTES = 16

function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES)
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

async function main() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD || ''
  if (!email || password.length < 12) {
    throw new Error('Set ADMIN_EMAIL and a unique ADMIN_PASSWORD (at least 12 characters) before running this seed script.')
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } },
  })

  try {
    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'BizBook Pro Demo',
        address: 'Demo Address',
        phone: '9999999999',
        email,
        gstNumber: '',
        plan: 'free',
      },
    })
    console.log('✓ Created tenant:', tenant.name)

    // Create admin user with hashed password
    const user = await prisma.user.create({
      data: {
        name: 'Admin',
        email,
        password: hashPassword(password),
        role: 'MAIN_ADMIN',
        tenantId: tenant.id,
      },
    })
    console.log('✓ Created user:', user.email)

    // Link user to tenant
    await prisma.userTenant.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        role: 'MAIN_ADMIN',
        isOwner: true,
      },
    })
    console.log('✓ Linked user to tenant')
    console.log('')
    console.log('============================================')
    console.log('  Admin credentials:')
    console.log('  Email:', email)
    console.log('  Password: [set from ADMIN_PASSWORD]')
    console.log('============================================')
    console.log('  Tenant ID:', tenant.id)
    console.log('============================================')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
