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
        email: 'admin@bizbook.pro',
        gstNumber: '',
        plan: 'free',
      },
    })
    console.log('✓ Created tenant:', tenant.name)

    // Create admin user with hashed password
    const user = await prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@bizbook.pro',
        password: hashPassword('admin123'),
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
    console.log('  Email:    admin@bizbook.pro')
    console.log('  Password: admin123')
    console.log('============================================')
    console.log('  Tenant ID:', tenant.id)
    console.log('============================================')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
