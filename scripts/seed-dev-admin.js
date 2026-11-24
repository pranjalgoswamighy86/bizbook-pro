const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

async function main() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD || ''
  if (!email || password.length < 12) {
    throw new Error('Set ADMIN_EMAIL and a unique ADMIN_PASSWORD (at least 12 characters) before running this seed script.')
  }

  const prisma = new PrismaClient()
  try {
    const tenant = await prisma.tenant.create({
      data: { name: 'BizBook Pro Demo', phone: '9999999999', email, plan: 'free' }
    })
    const user = await prisma.user.create({
      data: { name: 'Admin', email, password: hashPassword(password), role: 'MAIN_ADMIN', tenantId: tenant.id }
    })
    await prisma.userTenant.create({
      data: { userId: user.id, tenantId: tenant.id, role: 'MAIN_ADMIN', isOwner: true }
    })
    console.log('✓ Admin seeded')
    console.log('  Email:', email)
    console.log('  Password: [set from ADMIN_PASSWORD]')
    console.log('  Tenant ID:', tenant.id)
  } finally {
    await prisma.$disconnect()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
