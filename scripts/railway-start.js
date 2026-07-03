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

console.log('=== BizBook Pro Startup (v4.56 — PostgreSQL + PM2) ===');

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
console.log('DATABASE_URL:', process.env.DATABASE_URL.substring(0, 30) + '...');

// Step 1: Regenerate Prisma client
console.log('→ Regenerating Prisma client...');
try {
  execSync('npx prisma generate', { stdio: 'inherit', env: process.env, cwd: '/app' });
  console.log('✓ Prisma client regenerated');
} catch (e) {
  console.log('⚠️ Prisma generate failed:', e.message);
}

// Step 2: Push Prisma schema to PostgreSQL (creates tables if missing)
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
    runStartupBackup(); // v4.115: auto-backup all tenants on every startup
    startServer();
  }).catch((err) => {
    console.log('⚠️ Seed check failed:', err.message);
    runTenantProtectionCheck();
    runStartupBackup();
    startServer();
  });
} catch (e) {
  console.log('⚠️ Prisma error:', e.message);
  runTenantProtectionCheck();
  runStartupBackup();
  startServer();
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
  console.log('→ Starting Next.js server via PM2 cluster...');

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

  // v4.57: Fixed PM2 startup — use require('pm2') API directly instead of execSync
  // This avoids the "pm2 binary not found" issue in standalone mode
  const pm2ConfigPath = path.join(standaloneDir, 'ecosystem.config.js');

  const usePM2 = process.env.USE_PM2 !== 'false';
  if (usePM2 && fs.existsSync(pm2ConfigPath)) {
    console.log('→ Starting PM2 cluster (2 instances)...');
    try {
      // Use PM2 programmatic API instead of CLI
      const PM2 = require('pm2');
      PM2.connect(true, (err) => {
        if (err) {
          console.warn('PM2 connect failed, falling back to direct server.js:', err.message);
          require(path.join(standaloneDir, 'server.js'));
          return;
        }
        PM2.start(pm2ConfigPath, (err) => {
          if (err) {
            console.warn('PM2 start failed, falling back to direct server.js:', err.message);
            PM2.disconnect();
            require(path.join(standaloneDir, 'server.js'));
            return;
          }
          console.log('✓ PM2 cluster started — 2 instances running');
          PM2.disconnect();
          // Keep the process alive — PM2 manages the workers
          // The workers will serve requests on the shared port
        });
      });
      return; // Don't fall through to direct server.js
    } catch (e) {
      console.warn('PM2 module not available, starting direct server.js:', e.message);
    }
  } else {
    console.log('→ PM2 config not found at', pm2ConfigPath, '— using direct server.js');
  }

  // Direct server.js (fallback when PM2 is not available or disabled)
  console.log('→ Starting direct server.js...');
  require(path.join(standaloneDir, 'server.js'));
}
