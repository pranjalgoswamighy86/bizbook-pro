#!/bin/bash
set -e

echo "=== BizBook Pro Startup ==="

# Create database directory
mkdir -p db

# Apply only non-destructive schema changes. Destructive diffs require a
# reviewed migration and must never be auto-accepted during startup.
echo "→ Syncing database schema in safe mode..."
npx prisma db push --skip-generate 2>/dev/null || echo "⚠️ Safe schema sync was not applied; review the Prisma diff before changing data."

# Never create a publicly-known administrator password on an empty database.
# The first administrator must register through the verified account flow.
echo "→ Checking for existing accounts..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.user.count();
  if (count === 0) {
    console.warn('[SECURITY] No users found. No default administrator is created. Register using a verified email configured as ADMIN_EMAIL or INFRASTRUCTURE_OWNER_EMAIL.');
  } else {
    console.log('✓ Existing users found (' + count + ')');
  }
}
main().catch(console.error).finally(() => prisma.\$disconnect());
"

echo "→ Starting Next.js server..."
exec node .next/standalone/server.js
