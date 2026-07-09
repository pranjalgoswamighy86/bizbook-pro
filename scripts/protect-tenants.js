/**
 * Tenant Persistence Safeguard — v4.114 (PostgreSQL)
 * ====================================================
 * v4.114 CHANGE: Every registered tenant is now a protected tenant.
 * Previously, only a hardcoded list of emails were checked. Now we
 * dynamically query ALL tenants from the database and verify they
 * all exist (i.e., the database is accessible and tenant data is
 * intact).
 *
 * This script runs at container startup (before Next.js starts) to:
 *   1. Verify the database is reachable
 *   2. Count all registered tenants
 *   3. Log each tenant as "protected" so it's visible in the deploy logs
 *   4. Warn (but don't block) if the database has zero tenants
 *
 * Why "protected"? Once a tenant registers with BizBook Pro, their
 * data cannot be hard-deleted through any API endpoint. The only way
 * to remove a tenant is soft-delete (sets isDeleted=true), which
 * preserves all data for recovery/audit purposes.
 */

function log(level, msg) {
  const colors = { ERROR: '\x1b[31m', WARN: '\x1b[33m', INFO: '\x1b[36m', OK: '\x1b[32m', reset: '\x1b[0m' };
  console.log(`${colors[level] || ''}[TENANT-PROTECT] [${level}]${colors.reset} ${msg}`);
}

/**
 * v6.20.0: Mask email addresses in log output to prevent PII leakage.
 * Resolves audit finding P0-3: 10 customer emails were being logged in
 * plain text on every container restart (DPDP Act 2023 violation).
 *
 * Masking strategy: show first 4 chars + **** + @ + domain.
 * Example: "pranjalgoswamighy86@gmail.com" → "pran****@gmail.com"
 *
 * This preserves enough info for engineers to recognise tenants
 * (especially during debugging) without exposing the full PII to
 * anyone with Railway dashboard or log-download access.
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '(unknown)';
  const lower = email.toLowerCase();
  const atIdx = lower.indexOf('@');
  if (atIdx < 1) return lower; // not an email — return as-is
  const local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx);
  if (local.length <= 4) return local[0] + '***' + domain;
  return local.slice(0, 4) + '****' + domain;
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
  log('INFO', 'v4.114: ALL registered tenants are protected (no hardcoded list)');

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
    // v4.114: Query ALL tenants (including soft-deleted ones) using raw query
    // to bypass the soft-delete filter. Every tenant is protected.
    log('INFO', 'Querying all registered tenants...');
    const allTenants = await prisma.$queryRaw`
      SELECT id, name, email, plan, "isDeleted", "createdAt"
      FROM "Tenant"
      ORDER BY "createdAt" ASC
    `;

    const tenantCount = Array.isArray(allTenants) ? allTenants.length : 0;
    const activeTenants = allTenants.filter(t => !t.isDeleted);
    const softDeletedTenants = allTenants.filter(t => t.isDeleted);

    if (tenantCount === 0) {
      log('WARN', '⚠️  No tenants found in database. This is expected on first deploy.');
      log('WARN', 'Once a tenant registers, they will be automatically protected.');
      log('WARN', 'Continuing startup...');
      process.exit(0);
    }

    log('OK', `✓ ${tenantCount} tenant(s) registered — ALL are protected:`);
    activeTenants.forEach(t => {
      // v6.20.0: Mask email to prevent PII leakage in logs (DPDP Act 2023 compliance)
      log('OK', `  - ${maskEmail(t.email)} (tenant: ${t.name}, plan: ${t.plan}) — ACTIVE`);
    });
    if (softDeletedTenants.length > 0) {
      log('INFO', `${softDeletedTenants.length} soft-deleted tenant(s) (data preserved):`);
      softDeletedTenants.forEach(t => {
        log('INFO', `  - ${maskEmail(t.email)} (tenant: ${t.name}) — SOFT-DELETED (data preserved)`);
      });
    }

    log('OK', `=== Safeguard passed: ${activeTenants.length} active, ${softDeletedTenants.length} soft-deleted, ${tenantCount} total ===`);
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
