const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== BizBook Pro Startup ===');

// CRITICAL: Delete HOSTNAME so Next.js binds to 0.0.0.0 (fixes Railway 502)
delete process.env.HOSTNAME;

// Set DATABASE_URL — use ABSOLUTE path so it works regardless of cwd
const DB_DIR = '/app/db';
const DB_FILE = DB_DIR + '/custom.db';
process.env.DATABASE_URL = 'file:' + DB_FILE;

// Set env var defaults
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
process.env.SMTP_PORT = process.env.SMTP_PORT || '465';
process.env.SMTP_SECURE = process.env.SMTP_SECURE || 'true';
process.env.SMTP_USER = process.env.SMTP_USER || '';
process.env.SMTP_PASS = process.env.SMTP_PASS || '';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'bizbook-pro-stable-dev-secret-9f3a2c7b8d1e';
process.env.MASTER_MOBILE_NUMBER = process.env.MASTER_MOBILE_NUMBER || '9101555075';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@bizbook.pro';
process.env.NEXT_TELEMETRY_DISABLED = '1';

console.log('CWD:', process.cwd());
console.log('PORT:', process.env.PORT || '3000');
console.log('DATABASE_URL:', process.env.DATABASE_URL);

// Step 1: Create db directory
fs.mkdirSync(DB_DIR, { recursive: true });

// Step 2: Push Prisma schema (non-destructive — no --accept-data-loss)
console.log('→ Syncing database schema (safe, no data loss)...');
try {
  execSync('npx prisma db push --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }
  });
  console.log('✓ Database schema synced');
} catch (e) {
  console.log('⚠️ Prisma db push failed:', e.message);
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

      // Check if admin tenant already exists
      let tenant = await prisma.tenant.findFirst({ where: { email: 'admin@bizbook.pro' } }).catch(() => null);
      if (!tenant) {
        tenant = await prisma.tenant.create({
          data: { name: 'BizBook Pro Demo', phone: '9999999999', email: 'admin@bizbook.pro', plan: 'free' }
        });
      }

      // Check if admin user already exists
      const existingUser = await prisma.user.findFirst({ where: { email: 'admin@bizbook.pro' } }).catch(() => null);
      if (!existingUser) {
        const user = await prisma.user.create({
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
        // Check if link exists
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
    startServer();
  }).catch((err) => {
    console.log('⚠️ Seed check failed:', err.message);
    startServer();
  });
} catch (e) {
  console.log('⚠️ Prisma error:', e.message);
  startServer();
}

function startServer() {
  console.log('→ Starting Next.js server...');

  const standaloneDir = path.join(process.cwd(), '.next', 'standalone');

  // Check if standalone exists
  if (!fs.existsSync(path.join(standaloneDir, 'server.js'))) {
    console.log('⚠️ Standalone server.js not found at', path.join(standaloneDir, 'server.js'));
    console.log('→ Trying non-standalone Next.js start...');
    try {
      execSync('npx next start -p ' + (process.env.PORT || '3000') + ' -H 0.0.0.0', {
        stdio: 'inherit',
        env: process.env,
      });
    } catch (e) {
      console.error('Failed to start server:', e.message);
      process.exit(1);
    }
    return;
  }

  // Create Prisma symlinks for standalone
  const prismaDir = path.join(standaloneDir, 'node_modules', '@prisma');
  if (fs.existsSync(prismaDir)) {
    const clientDir = path.join(prismaDir, 'client');
    if (fs.existsSync(clientDir)) {
      // Find hash-based symlinks needed
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
        // Known hash fallback
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

  // Copy db directory (for existing database)
  const dbSrc = DB_DIR;
  const dbDst = path.join(standaloneDir, 'db');
  if (fs.existsSync(dbSrc) && !fs.existsSync(dbDst)) {
    try { execSync('cp -r ' + dbSrc + ' ' + dbDst); } catch {}
  }

  // Change to standalone dir and start
  process.chdir(standaloneDir);
  console.log('→ Working directory:', process.cwd());

  // Start the standalone server (HOSTNAME deleted → binds to 0.0.0.0)
  require(path.join(standaloneDir, 'server.js'));
}
