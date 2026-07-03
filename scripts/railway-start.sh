#!/bin/bash
set -e

echo "=== BizBook Pro Startup ==="

# Create database directory
mkdir -p db

# Push schema to database (creates tables if they don't exist)
echo "→ Syncing database schema..."
npx prisma db push --skip-generate --accept-data-loss 2>/dev/null || true

# Seed admin user if no users exist
echo "→ Checking for admin user..."
node -e "
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.user.count();
  if (count === 0) {
    console.log('→ No users found. Seeding admin user...');
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync('admin123', salt, 64);
    const passwordHash = salt.toString('hex') + ':' + hash.toString('hex');
    
    const tenant = await prisma.tenant.create({
      data: { name: 'BizBook Pro Demo', phone: '9999999999', email: 'admin@bizbook.pro', plan: 'free' }
    });
    const user = await prisma.user.create({
      data: { name: 'Admin', email: 'admin@bizbook.pro', password: passwordHash, role: 'MAIN_ADMIN', tenantId: tenant.id }
    });
    await prisma.userTenant.create({
      data: { userId: user.id, tenantId: tenant.id, role: 'MAIN_ADMIN', isOwner: true }
    });
    console.log('✓ Admin user created: admin@bizbook.pro / admin123');
  } else {
    console.log('✓ Users already exist (' + count + ' users)');
  }
}
main().catch(console.error).finally(() => prisma.\$disconnect());
"

# Start the server
echo "→ Starting Next.js server..."
exec node .next/standalone/server.js
