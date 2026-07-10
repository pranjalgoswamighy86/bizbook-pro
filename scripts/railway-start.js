/**
 * Railway Startup Script — v4.56 (PostgreSQL + PM2 Cluster)
 * =========================================================
 * v4.56: Complete rewrite for PostgreSQL + PM2 cluster mode
 *   - Removed: SQLite volume mount, symlink, periodic persist
 *   - Removed: file: URL resolution, DB file copy
 *   - Added: PM2 cluster mode startup (2 instances for 512MB RAM)
 *   - Kept: Prisma generate, db push, admin seed, tenant protection
 *
 * DATABASE_URL is now a PostgreSQL connection string set by Railway.
 * No volume mount needed — PostgreSQL manages its own persistence.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== BizBook Pro Startup (v6.24.0 — PostgreSQL + Direct Server + Rate-Limited) ===');

// CRITICAL: Delete HOSTNAME so Next.js binds to 0.0.0.0 (fixes Railway 502)
delete process.env.HOSTNAME;

// Set env var defaults
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'bizbook-pro-stable-dev-secret-9f3a2c7b8d1e';
process.env.MASTER_MOBILE_NUMBER = process.env.MASTER_MOBILE_NUMBER || '9101555075';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@bizbook.pro';
process.env.NEXT_TELEMETRY_DISABLED = '1';

// v4.56: Verify DATABASE_URL is set (PostgreSQL connection string)
if (!process.env.DATABASE_URL) {
  console.error('========================================');
  console.error('FATAL: DATABASE_URL is not set!');
  console.error('========================================');
  console.error('v4.56 requires PostgreSQL. Set DATABASE_URL to a PostgreSQL connection string:');
  console.error('  postgresql://user:password@host:port/dbname');
  console.error('');
  console.error('On Railway:');
  console.error('  1. Add a PostgreSQL database: + New → Database → PostgreSQL');
  console.error('  2. Link it to your web service');
  console.error('  3. Railway will auto-set DATABASE_URL');
  console.error('========================================');
  process.exit(1);
}

console.log('CWD:', process.cwd());
console.log('PORT:', process.env.PORT || '8080');
// v6.20.0: Removed DATABASE_URL echo — was leaking password's first 8 chars to Railway logs
// Audit finding P0-4: even truncated, "postgresql://postgres:ztiuIMNE..." reveals the
// DB username (postgres — the default superuser, itself a bad practice) and the first
// 8 characters of the password. Engineers who need to verify the DB connection should
// check the Railway dashboard Variables tab, NOT the deploy log.
// To verify DB connectivity at startup, the Prisma client init log line below already
// confirms whether the connection succeeded.

// Step 1: Regenerate Prisma client
console.log('→ Regenerating Prisma client...');
try {
  execSync('npx prisma generate', { stdio: 'inherit', env: process.env, cwd: '/app' });
  console.log('✓ Prisma client regenerated');
} catch (e) {
  console.log('⚠️ Prisma generate failed:', e.message);
}

// Step 2: Push Prisma schema to PostgreSQL (creates tables if missing)
// v4.182: Force --accept-data-loss to handle schema changes with existing data
console.log('→ Syncing database schema to PostgreSQL...');
try {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }
  });
  console.log('✓ Database schema synced');
} catch (e) {
  console.log('⚠️ Prisma db push failed:', e.message);
  console.log('⚠️ App will start anyway — queries may fail until schema is synced');
}

// Step 3: Seed admin user (idempotent — only creates if empty)
console.log('→ Checking for admin user...');
try {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  prisma.user.count().then(async (count) => {
    if (count === 0) {
      console.log('→ No users found, seeding admin...');
      const crypto = require('crypto');
      const salt = crypto.randomBytes(16);
      const hash = crypto.scryptSync('admin123', salt, 64);
      const passwordHash = salt.toString('hex') + ':' + hash.toString('hex');

      let tenant = await prisma.tenant.findFirst({ where: { email: 'admin@bizbook.pro' } }).catch(() => null);
      if (!tenant) {
        tenant = await prisma.tenant.create({
          data: { name: 'BizBook Pro Demo', phone: '9999999999', email: 'admin@bizbook.pro', plan: 'free' }
        });
      }

      const existingUser = await prisma.user.findFirst({ where: { email: 'admin@bizbook.pro' } }).catch(() => null);
      if (!existingUser) {
        let user;
        try {
          user = await prisma.user.create({
            data: {
              name: 'Admin',
              email: 'admin@bizbook.pro',
              password: passwordHash,
              role: 'MAIN_ADMIN',
              tenantId: tenant.id,
              lastLoginAt: new Date(),
              lastOtpVerifiedAt: new Date(),
              passwordChangedAt: new Date(),
            },
          });
        } catch (createErr) {
          user = await prisma.user.create({
            data: {
              name: 'Admin',
              email: 'admin@bizbook.pro',
              password: passwordHash,
              role: 'MAIN_ADMIN',
              tenantId: tenant.id,
            },
          });
        }
        const existingLink = await prisma.userTenant.findFirst({ where: { userId: user.id, tenantId: tenant.id } }).catch(() => null);
        if (!existingLink) {
          await prisma.userTenant.create({
            data: { userId: user.id, tenantId: tenant.id, role: 'MAIN_ADMIN', isOwner: true },
          });
        }
        console.log('✓ Admin user created');
      } else {
        console.log('✓ Admin user already exists');
      }
    } else {
      console.log('✓ Database has', count, 'users — skipping seed (data preserved)');
    }
    await prisma.$disconnect();
    runTenantProtectionCheck();
    runAutoRepair(); // v6.12: Auto-repair corrupted owner roles + consolidate wallets
    runStartupBackup();
    cleanupLoginAttempts(); // v6.21.0: Clean old login attempts for rate limiting
    runSubscriptionDedup(); // v6.24.0: One-time dedup of duplicate subscriptions
    startServer();
  }).catch((err) => {
    console.log('⚠️ Seed check failed:', err.message);
    runTenantProtectionCheck();
    runAutoRepair();
    runStartupBackup();
    cleanupLoginAttempts();
    runSubscriptionDedup();
    startServer();
  });
} catch (e) {
  console.log('⚠️ Prisma error:', e.message);
  runTenantProtectionCheck();
  runAutoRepair();
  runStartupBackup();
  cleanupLoginAttempts();
  runSubscriptionDedup();
  startServer();
}

// === v6.12: Auto-Repair Corrupted Data ===
// Runs on every startup. Fixes:
// 1. Owners (isOwner=true) with role != MAIN_ADMIN → restore to MAIN_ADMIN
// 2. Multiple subscription records for the same owner → consolidate into ONE wallet
// 3. Owner's User.role set to VIEW_ONLY when hours remain → restore to MAIN_ADMIN
function runAutoRepair() {
  console.log('[AUTO-REPAIR] Starting automatic data repair...');
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

    prisma.userTenant.findMany({
      where: { isOwner: true, role: { not: 'MAIN_ADMIN' } },
      include: { user: true, tenant: true },
    }).then(async (corruptedOwners) => {
      let fixedCount = 0;

      // 1. Fix corrupted owner roles
      for (const ut of corruptedOwners) {
        await prisma.userTenant.update({
          where: { id: ut.id },
          data: { role: 'MAIN_ADMIN' },
        });

        // Fix User.role too (if they have hours remaining)
        const sub = await prisma.subscription.findFirst({
          where: { tenantId: ut.tenantId },
        }).catch(() => null);
        const hasHours = sub && sub.remainingSeconds > 0;
        if (hasHours) {
          await prisma.user.update({
            where: { id: ut.userId },
            data: { role: 'MAIN_ADMIN' },
          });
        }
        console.log(`[AUTO-REPAIR] Fixed owner ${ut.user.email} in ${ut.tenant.name}: ${ut.role} → MAIN_ADMIN`);
        fixedCount++;
      }

      // 2. Consolidate wallets: for each owner with multiple subscriptions,
      // sum all hours into the FIRST subscription and zero out the rest
      const allOwners = await prisma.userTenant.findMany({
        where: { isOwner: true, role: 'MAIN_ADMIN' },
        select: { userId: true, tenantId: true },
      });

      // Group by userId
      const ownerMap = {};
      for (const o of allOwners) {
        if (!ownerMap[o.userId]) ownerMap[o.userId] = [];
        ownerMap[o.userId].push(o.tenantId);
      }

      let walletsConsolidated = 0;
      for (const [userId, tenantIds] of Object.entries(ownerMap)) {
        if (tenantIds.length < 2) continue; // Only one company, no consolidation needed

        const subs = await prisma.subscription.findMany({
          where: { tenantId: { in: tenantIds } },
          orderBy: { createdAt: 'asc' },
        });

        if (subs.length < 2) continue;

        const totalRemaining = subs.reduce((sum, s) => sum + s.remainingSeconds, 0);
        const totalSeconds = subs.reduce((sum, s) => sum + s.totalSeconds, 0);

        // Give ALL hours to the FIRST subscription (the wallet)
        await prisma.subscription.update({
          where: { id: subs[0].id },
          data: {
            remainingSeconds: totalRemaining,
            totalSeconds: totalSeconds,
            status: totalRemaining > 0 ? 'ACTIVE' : 'CONVERTED_TO_VIEW_ONLY',
          },
        });

        // Zero out the rest
        for (let i = 1; i < subs.length; i++) {
          await prisma.subscription.update({
            where: { id: subs[i].id },
            data: {
              remainingSeconds: 0,
              status: 'CONVERTED_TO_VIEW_ONLY',
            },
          });
        }

        console.log(`[AUTO-REPAIR] Consolidated ${subs.length} subscriptions for user ${userId}: ${totalRemaining}s → wallet (first sub)`);
        walletsConsolidated++;
      }

      // 3. Fix owners whose User.role is VIEW_ONLY but should be MAIN_ADMIN
      // (only if wallet has hours)
      for (const [userId, tenantIds] of Object.entries(ownerMap)) {
        const walletSub = await prisma.subscription.findFirst({
          where: { tenantId: { in: tenantIds } },
          orderBy: { createdAt: 'asc' },
        }).catch(() => null);

        if (walletSub && walletSub.remainingSeconds > 0) {
          const userRecord = await prisma.user.findUnique({ where: { id: userId } }).catch(() => null);
          if (userRecord && userRecord.role === 'VIEW_ONLY') {
            await prisma.user.update({
              where: { id: userId },
              data: { role: 'MAIN_ADMIN' },
            });
            console.log(`[AUTO-REPAIR] Restored owner ${userRecord.email}: User.role VIEW_ONLY → MAIN_ADMIN (hours available)`);
            fixedCount++;
          }
        }
      }

      console.log(`[AUTO-REPAIR] ✅ Complete. Fixed ${fixedCount} owner role(s), consolidated ${walletsConsolidated} wallet(s).`);
      await prisma.$disconnect();
    }).catch((err) => {
      console.log('[AUTO-REPAIR] ⚠️ Error:', err.message);
    });
  } catch (e) {
    console.log('[AUTO-REPAIR] ⚠️ Failed:', e.message);
  }
}

// === Tenant Protection Check ===
function runTenantProtectionCheck() {
  if (process.env.SKIP_TENANT_PROTECTION === 'true') {
    console.log('[TENANT-PROTECT] [WARN] SKIP_TENANT_PROTECTION=true — skipping check');
    return;
  }
  try {
    const protectScript = path.join(__dirname, 'protect-tenants.js');
    if (fs.existsSync(protectScript)) {
      console.log('→ Running tenant protection check...');
      execSync(`node "${protectScript}"`, {
        stdio: 'inherit',
        env: process.env,
      });
    } else {
      console.log('[TENANT-PROTECT] protect-tenants.js not found — skipping check');
    }
  } catch (e) {
    console.error('[TENANT-PROTECT] Error:', e.message);
    console.error('[TENANT-PROTECT] Set SKIP_TENANT_PROTECTION=true to bypass on first deploy');
  }
}

// === v6.21.0: LoginAttempt Cleanup ===
// Delete login attempts older than 24 hours to keep the table small.
// At ~100 attempts/day at current traffic, the table stays under 1000 rows.
// This runs on every container startup (before Next.js starts).
async function cleanupLoginAttempts() {
  try {
    console.log('→ Cleaning up old login attempts...');
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    const result = await prisma.loginAttempt.deleteMany({
      where: { attemptedAt: { lt: cutoff } },
    });

    console.log(`[CLEANUP] ✓ Deleted ${result.count} old login attempt(s) older than 24h`);
    await prisma.$disconnect();
  } catch (err) {
    // Non-blocking: if cleanup fails, old attempts will eventually age out
    // via the 15-minute window check in the rate limiter itself.
    console.warn('[CLEANUP] ⚠️ LoginAttempt cleanup failed (non-blocking):', err.message);
  }
}

// === v6.24.0: One-Time Subscription Dedup ===
// Runs the dedupe-subscriptions.js script to permanently remove duplicate
// subscription rows. After this runs once, the auto-repair should find
// 0 duplicates on all future startups.
function runSubscriptionDedup() {
  try {
    console.log('→ Running subscription dedup (one-time fix)...');
    execSync('node scripts/dedupe-subscriptions.js', {
      stdio: 'inherit',
      env: process.env,
      cwd: '/app',
    });
  } catch (err) {
    // Non-blocking: if dedup fails, the auto-repair will continue to handle it
    console.warn('[DEDUP] ⚠️ Subscription dedup failed (non-blocking):', err.message);
  }
}

// === v4.115: Automatic Startup Backup ===
// On every successful startup, export all tenant data to a JSON file.
// This protects against database resets — if Railway loses the DB volume,
// the backup file is still on the container's /tmp filesystem (persists
// across restarts within the same deployment, but NOT across new deploys).
// For true cross-deploy protection, users should use the Emergency Backup
// page (/emergency-backup.html) to download a copy to their own computer.
function runStartupBackup() {
  try {
    const backupScript = path.join(__dirname, 'startup-backup.js');
    if (fs.existsSync(backupScript)) {
      console.log('→ Creating automatic startup backup...');
      execSync(`node "${backupScript}"`, {
        stdio: 'inherit',
        env: process.env,
      });
    }
  } catch (e) {
    console.error('[STARTUP-BACKUP] Error:', e.message);
    // Non-blocking — don't fail startup if backup fails
  }
}

// === Start Server (v4.56: PM2 Cluster Mode) ===
function startServer() {
  console.log('→ Starting Next.js server (direct mode, no PM2)...');

  const standaloneDir = path.join(process.cwd(), '.next', 'standalone');

  if (!fs.existsSync(path.join(standaloneDir, 'server.js'))) {
    console.log('⚠️ Standalone server.js not found at', path.join(standaloneDir, 'server.js'));
    console.log('→ Trying non-standalone Next.js start...');
    try {
      execSync('npx next start -p ' + (process.env.PORT || '8080') + ' -H 0.0.0.0', {
        stdio: 'inherit',
        env: process.env,
      });
    } catch (e) {
      console.error('Failed to start server:', e.message);
      process.exit(1);
    }
    return;
  }

  // Create Prisma symlinks for standalone (same as before)
  const prismaDir = path.join(standaloneDir, 'node_modules', '@prisma');
  if (fs.existsSync(prismaDir)) {
    const clientDir = path.join(prismaDir, 'client');
    if (fs.existsSync(clientDir)) {
      const chunksDir = path.join(standaloneDir, '.next', 'server', 'chunks');
      if (fs.existsSync(chunksDir)) {
        const files = fs.readdirSync(chunksDir);
        const hashPattern = /@prisma\/client-([a-f0-9]+)/g;
        const hashes = new Set();
        for (const f of files) {
          try {
            const content = fs.readFileSync(path.join(chunksDir, f), 'utf-8');
            let match;
            while ((match = hashPattern.exec(content)) !== null) hashes.add(match[1]);
          } catch {}
        }
        for (const hash of hashes) {
          const linkPath = path.join(prismaDir, 'client-' + hash);
          if (!fs.existsSync(linkPath)) {
            try { fs.symlinkSync('client', linkPath, 'dir'); } catch {}
          }
        }
        const knownHash = '2c3a283f134fdcb6';
        const knownLink = path.join(prismaDir, 'client-' + knownHash);
        if (!fs.existsSync(knownLink) && fs.existsSync(clientDir)) {
          try { fs.symlinkSync('client', knownLink, 'dir'); } catch {}
        }
      }
    }
  }

  // Copy static files if missing
  const staticSrc = path.join(process.cwd(), '.next', 'static');
  const staticDst = path.join(standaloneDir, '.next', 'static');
  if (fs.existsSync(staticSrc) && !fs.existsSync(staticDst)) {
    fs.mkdirSync(path.dirname(staticDst), { recursive: true });
    try { execSync('cp -r ' + staticSrc + ' ' + staticDst); } catch {}
  }

  // Copy public files
  const publicSrc = path.join(process.cwd(), 'public');
  const publicDst = path.join(standaloneDir, 'public');
  if (fs.existsSync(publicSrc) && !fs.existsSync(publicDst)) {
    try { execSync('cp -r ' + publicSrc + ' ' + publicDst); } catch {}
  }

  // Copy prisma directory (for schema)
  const prismaSrc = path.join(process.cwd(), 'prisma');
  const prismaDst = path.join(standaloneDir, 'prisma');
  if (fs.existsSync(prismaSrc) && !fs.existsSync(prismaDst)) {
    try { execSync('cp -r ' + prismaSrc + ' ' + prismaDst); } catch {}
  }

  // v4.56: NO MORE DB FILE COPY — PostgreSQL is network-based, no files to copy

  // v4.121: Copy ecosystem.config.js BEFORE chdir (fixes PM2 not starting)
  const originalDir = process.cwd();
  const pm2ConfigSrc = path.join(originalDir, 'ecosystem.config.js');
  const pm2ConfigDst = path.join(standaloneDir, 'ecosystem.config.js');
  if (fs.existsSync(pm2ConfigSrc) && !fs.existsSync(pm2ConfigDst)) {
    try { fs.copyFileSync(pm2ConfigSrc, pm2ConfigDst); } catch {}
  }

  // Change to standalone dir
  process.chdir(standaloneDir);
  console.log('→ Working directory:', process.cwd());

  // v6.24.0: Removed PM2 entirely — it failed on every startup since v4.56.
  // PM2's daemon IPC mechanism doesn't work in Railway's container environment.
  // The fallback to direct server.js was always used anyway, so PM2 was just
  // adding ~200ms of startup overhead + error log noise on every restart.
  //
  // Railway provides container-level process management (auto-restart on crash,
  // health checks, multi-replica scaling), so PM2 is redundant.
  //
  // If you need more throughput: upgrade the Railway plan or add replicas
  // via Railway's service settings (not PM2 cluster mode).

  // Start Next.js standalone server directly
  console.log('→ Starting Next.js standalone server (direct mode, no PM2)...');
  require(path.join(standaloneDir, 'server.js'));
}
