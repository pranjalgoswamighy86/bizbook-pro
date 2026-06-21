/**
 * Tenant Persistence Safeguard — v4.56 (PostgreSQL)
 * ===================================================
 * Verifies protected tenant accounts exist in PostgreSQL.
 * No more file-based DB checks — PostgreSQL is network-based.
 */

const PROTECTED_TENANTS = [
  'kdhomesghy@gmail.com',
];

function log(level, msg) {
  const colors = { ERROR: '\x1b[31m', WARN: '\x1b[33m', INFO: '\x1b[36m', OK: '\x1b[32m', reset: '\x1b[0m' };
  console.log(`${colors[level] || ''}[TENANT-PROTECT] [${level}]${colors.reset} ${msg}`);
}

async function loadPrisma() {
  try {
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  } catch (err) {
    log('ERROR', `Failed to load Prisma: ${err.message}`);
    return null;
  }
}

async function main() {
  log('INFO', '=== Tenant Persistence Safeguard (PostgreSQL) ===');
  log('INFO', `Protected accounts: ${PROTECTED_TENANTS.join(', ')}`);

  if (!process.env.DATABASE_URL) {
    log('ERROR', 'DATABASE_URL is not set — cannot check protected tenants');
    log('ERROR', 'Set DATABASE_URL to your PostgreSQL connection string');
    process.exit(1);
  }

  if (process.env.SKIP_TENANT_PROTECTION === 'true') {
    log('WARN', 'SKIP_TENANT_PROTECTION=true — skipping check (first deploy with empty PostgreSQL)');
    process.exit(0);
  }

  const prisma = await loadPrisma();
  if (!prisma) {
    log('ERROR', 'Could not initialize Prisma — skipping check');
    process.exit(0);
  }

  try {
    log('INFO', 'Querying protected tenants...');
    const tenants = await prisma.tenant.findMany({
      where: { email: { in: PROTECTED_TENANTS } },
      select: { id: true, name: true, email: true, plan: true },
    });

    const foundEmails = tenants.map(t => t.email);
    const missingEmails = PROTECTED_TENANTS.filter(e => !foundEmails.includes(e));

    if (missingEmails.length === 0) {
      log('OK', `✓ All ${PROTECTED_TENANTS.length} protected tenants verified present.`);
      tenants.forEach(t => log('OK', `  - ${t.email} (tenant: ${t.name}, plan: ${t.plan})`));
    } else {
      log('ERROR', `⚠️  ${missingEmails.length} protected tenant(s) MISSING:`);
      missingEmails.forEach(e => log('ERROR', `   - ${e}`));
      log('WARN', 'Register them via the app, OR set SKIP_TENANT_PROTECTION=true');
      log('WARN', 'to bypass this check on first deploy with empty PostgreSQL.');
      // v4.56: Don't abort — just warn. PostgreSQL is new, tenants need to be re-registered.
      log('WARN', 'Continuing startup (non-blocking mode for PostgreSQL migration)...');
    }
  } catch (err) {
    log('ERROR', `Query failed: ${err.message}`);
    log('WARN', 'Continuing startup (non-blocking mode)...');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  log('ERROR', `Fatal: ${err.message}`);
  process.exit(0); // Don't block startup — just warn
});
