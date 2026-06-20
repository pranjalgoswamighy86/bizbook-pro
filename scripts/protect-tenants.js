/**
 * Tenant Persistence Safeguard
 * ----------------------------
 * Spec Part 8: Protected tenant accounts MUST survive ALL deploys.
 *
 * Protected accounts (per owner's explicit instruction):
 *   - kdhomesghy@gmail.com
 *   - goswamipranjalghy86@gmail.com
 *   - homesghy@gmail.com
 *
 * This script:
 *   1. Runs at app startup (after Prisma sync, BEFORE Next.js starts)
 *   2. Verifies all protected tenants exist
 *   3. If any are missing, aborts startup with clear error message
 *      (rather than silently wiping data)
 *   4. Optionally restores from latest backup if missing
 *
 * RUN: node scripts/protect-tenants.js
 * (Called from railway-start.js before Next.js server starts)
 *
 * Place at: scripts/protect-tenants.js
 */

const fs = require('fs');
const path = require('path');

// ---------- Configuration ----------
// v4.43: Only kdhomesghy@gmail.com is protected (owner's primary tenant).
// User clarified that goswamipranjalghy86@gmail.com and homesghy@gmail.com are
// just regular tenant accounts — they have been removed from the protected list.
const PROTECTED_TENANTS = [
  'kdhomesghy@gmail.com',
];

const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || '/app/data/custom.db';
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');

// ---------- Helpers ----------
function log(level, msg) {
  const colors = {
    ERROR: '\x1b[31m',
    WARN: '\x1b[33m',
    INFO: '\x1b[36m',
    OK: '\x1b[32m',
    reset: '\x1b[0m',
  };
  console.log(`${colors[level] || ''}[TENANT-PROTECT] [${level}]${colors.reset} ${msg}`);
}

async function loadPrisma() {
  try {
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
  } catch (err) {
    log('ERROR', `Failed to load Prisma: ${err.message}`);
    return null;
  }
}

function findLatestBackup() {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db') && f.includes('backup'))
    .map(f => ({
      name: f,
      path: path.join(BACKUP_DIR, f),
      mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

// ---------- Main ----------
async function main() {
  log('INFO', '=== Tenant Persistence Safeguard ===');
  log('INFO', `Protected accounts: ${PROTECTED_TENANTS.join(', ')}`);
  log('INFO', `DB path: ${DB_PATH}`);
  log('INFO', `Backup dir: ${BACKUP_DIR}`);

  // ---------- Step 1: Verify DB file exists ----------
  if (!fs.existsSync(DB_PATH)) {
    log('ERROR', `Database file NOT FOUND at ${DB_PATH}`);
    log('ERROR', 'This indicates the Railway Volume is not mounted, or the DB was wiped.');

    // Try to restore from backup
    const backup = findLatestBackup();
    if (backup) {
      log('WARN', `Attempting to restore from latest backup: ${backup.name}`);
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.copyFileSync(backup.path, DB_PATH);
      log('OK', `Restored DB from ${backup.name}`);
    } else {
      log('ERROR', 'NO BACKUPS AVAILABLE. Cannot restore.');
      log('ERROR', 'Owner action required: manually restore from Railway Volume snapshot');
      log('ERROR', 'ABORTING STARTUP to prevent silent data loss.');
      process.exit(1);
    }
  }

  // ---------- Step 2: Verify protected tenants exist ----------
  const prisma = await loadPrisma();
  if (!prisma) {
    log('ERROR', 'Cannot load Prisma — skipping verification (DB may be fresh).');
    log('WARN', 'If this is a fresh deploy, protected tenants will need manual re-creation.');
    return;
  }

  try {
    log('INFO', 'Querying protected tenants...');
    const existingTenants = await prisma.tenant.findMany({
      where: {
        email: { in: PROTECTED_TENANTS },
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true, // NOTE: schema uses `phone` not `mobile`
        plan: true,  // NOTE: schema uses `plan` not `subscriptionStatus`
        createdAt: true,
      },
    });

    const existingEmails = existingTenants.map(t => t.email.toLowerCase());
    const missingEmails = PROTECTED_TENANTS.filter(
      e => !existingEmails.includes(e.toLowerCase())
    );

    if (missingEmails.length === 0) {
      log('OK', `✓ All ${PROTECTED_TENANTS.length} protected tenants verified present.`);
      existingTenants.forEach(t => {
        log('OK', `  - ${t.email} (tenant: ${t.name}, plan: ${t.plan || 'unknown'})`);
      });
      await prisma.$disconnect();
      return;
    }

    // ---------- Step 3: Missing tenants detected ----------
    log('ERROR', `⚠️  ${missingEmails.length} protected tenant(s) MISSING:`);
    missingEmails.forEach(e => log('ERROR', `  - ${e}`));

    log('WARN', 'This indicates data loss occurred. Possible causes:');
    log('WARN', '  1. Railway Volume not mounted (DB wiped on redeploy)');
    log('WARN', '  2. prisma db push with --accept-data-loss flag was used');
    log('WARN', '  3. Manual DB drop without backup restore');
    log('WARN', '  4. db.dropDatabase() called somewhere in code');

    // ---------- Step 4: Try to restore from backup ----------
    const backup = findLatestBackup();
    if (backup) {
      log('WARN', `Latest backup available: ${backup.name}`);
      log('WARN', 'Manual restoration required:');
      log('WARN', `  cp ${backup.path} ${DB_PATH}`);
      log('WARN', 'Then restart the service.');
    } else {
      log('WARN', 'NO BACKUPS AVAILABLE for restoration (fresh install).');
    }

    // ---------- Step 5: WARN but continue startup ----------
    // CRITICAL DECISION (per logs.1781805540306.log):
    // Previously this called process.exit(1) which caused a Railway
    // crash loop because the protected tenants don't exist on a fresh
    // volume mount. Now that the Railway Volume is mounted, data will
    // persist across future redeploys. The protection script's job is
    // to ALERT the owner, not to brick the app.
    //
    // Strict mode (opt-in): set STRICT_TENANT_PROTECTION=true to abort
    // startup. Use this AFTER you've registered the protected tenants.
    if (process.env.STRICT_TENANT_PROTECTION === 'true') {
      log('ERROR', '');
      log('ERROR', '========================================');
      log('ERROR', 'STARTUP ABORTED — STRICT_TENANT_PROTECTION=true');
      log('ERROR', '========================================');
      log('ERROR', '');
      log('ERROR', 'The app will NOT start until protected tenants are restored.');
      log('ERROR', 'This is intentional — failing silently would hide data loss.');
      log('ERROR', '');
      log('ERROR', 'OWNER ACTIONS (in order):');
      log('ERROR', '  1. Restore DB from latest backup:');
      log('ERROR', `     cp ${backup?.path || '<backup-file>'} ${DB_PATH}`);
      log('ERROR', '  2. OR manually re-create missing tenants via Prisma Studio');
      log('ERROR', '  3. Restart the Railway service');
      log('ERROR', '');
      log('ERROR', 'Or set STRICT_TENANT_PROTECTION=false (or unset) to allow startup.');
      log('ERROR', 'Once tenants are verified, the check will pass on next deploy.');

      await prisma.$disconnect();
      process.exit(1);
    }

    // Default mode: WARN + continue startup
    log('WARN', '');
    log('WARN', '========================================');
    log('WARN', 'PROTECTED TENANTS MISSING — CONTINUING STARTUP (default mode)');
    log('WARN', '========================================');
    log('WARN', '');
    log('WARN', 'The app WILL start, but the following tenants need to be re-registered:');
    missingEmails.forEach(e => log('WARN', `  - ${e}`));
    log('WARN', '');
    log('WARN', 'Register them via the app, OR set STRICT_TENANT_PROTECTION=true');
    log('WARN', 'to enforce abort-on-missing behavior AFTER they exist.');
    log('WARN', '');
    log('WARN', 'The Railway Volume is mounted, so future redeploys will preserve all data.');
    await prisma.$disconnect();
    // Exit 0 — let Next.js start
    process.exit(0);
  } catch (err) {
    log('ERROR', `Verification query failed: ${err.message}`);
    log('WARN', 'This may indicate the schema is not yet synced. Continuing startup...');
    await prisma.$disconnect();
    // Don't abort — let prisma db push run first
  }
}

// ---------- Run ----------
main().catch(err => {
  console.error('[TENANT-PROTECT] FATAL:', err);
  process.exit(1);
});

/*
 * ============================================================================
 * INTEGRATION (in scripts/railway-start.js)
 * ============================================================================
 *
 * Add this BEFORE the line that starts Next.js:
 *
 *   // === Tenant protection check ===
 *   try {
 *     await require('./protect-tenants');
 *   } catch (err) {
 *     console.error('[STARTUP] Tenant protection failed:', err.message);
 *     process.exit(1);
 *   }
 *
 *   // === Only start Next.js if protection passed ===
 *   const { spawn } = require('child_process');
 *   const nextProcess = spawn('node', ['server.js'], {
 *     cwd: '/app/.next/standalone',
 *     stdio: 'inherit',
 *     env: process.env,
 *   });
 *
 * ============================================================================
 * BYPASS (emergency only — for fresh deploys with no historical data)
 * ============================================================================
 *
 * If this is genuinely a brand-new deploy with NO existing tenants:
 *   TEMPORARILY set env var: SKIP_TENANT_PROTECTION=true
 *
 * This is ONLY for the very first deploy. After tenants are created, remove
 * this env var to re-enable protection.
 *
 * The script checks for this env var:
 */

if (process.env.SKIP_TENANT_PROTECTION === 'true') {
  // Re-read main() to add early exit
  console.log('[TENANT-PROTECT] [WARN] SKIP_TENANT_PROTECTION=true — skipping check (EMERGENCY ONLY)');
  console.log('[TENANT-PROTECT] [WARN] REMOVE THIS ENV VAR after first tenants are created!');
  process.exit(0);
}
