const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

async function main() {
  const prisma = new PrismaClient()
  try {
    const tenant = await prisma.tenant.create({
      data: { name: 'BizBook Pro Demo', phone: '9999999999', email: 'admin@bizbook.pro', plan: 'free' }
    })
    const user = await prisma.user.create({
      data: { name: 'Admin', email: 'admin@bizbook.pro', password: hashPassword('admin123'), role: 'MAIN_ADMIN', tenantId: tenant.id }
    })
    await prisma.userTenant.create({
      data: { userId: user.id, tenantId: tenant.id, role: 'MAIN_ADMIN', isOwner: true }
    })
    console.log('✓ Admin seeded')
    console.log('  Email: admin@bizbook.pro')
    console.log('  Password: admin123')
    console.log('  Tenant ID:', tenant.id)
  } finally {
    await prisma.$disconnect()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
