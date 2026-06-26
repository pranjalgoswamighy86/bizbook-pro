/**
 * v4.115: Automatic Startup Backup
 * =================================
 * Runs on every container startup AFTER the database is confirmed reachable.
 * Exports ALL tenant data to a JSON file in /tmp/bizbook-backups/.
 *
 * Why /tmp?
 *   - Persists across container restarts within the same Railway deployment
 *   - Survives Next.js server crashes (PM2 restarts)
 *   - Does NOT survive new deploys (Railway rebuilds the image)
 *
 * For true cross-deploy protection, users should download backups to their
 * own computer via /emergency-backup.html (v4.109) or /api/backup/download
 * (v4.108, requires login).
 *
 * This script is a SAFETY NET, not a primary backup strategy.
 */

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = '/tmp/bizbook-backups';
const MAX_BACKUPS = 10; // Keep last 10 startup backups

function log(level, msg) {
  const colors = { ERROR: '\x1b[31m', WARN: '\x1b[33m', INFO: '\x1b[36m', OK: '\x1b[32m', reset: '\x1b[0m' };
  console.log(`${colors[level] || ''}[STARTUP-BACKUP] [${level}]${colors.reset} ${msg}`);
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
  if (!process.env.DATABASE_URL) {
    log('WARN', 'DATABASE_URL not set — skipping startup backup');
    return;
  }

  const prisma = await loadPrisma();
  if (!prisma) {
    log('WARN', 'Could not initialize Prisma — skipping startup backup');
    return;
  }

  try {
    // Create backup directory if it doesn't exist
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    // Export all tables using raw queries (bypasses soft-delete filter)
    const tables = [
      'Tenant', 'User', 'UserTenant',
      'Party', 'Product', 'ProductIngredient',
      'Sale', 'Purchase', 'Expense', 'InventoryItem',
      'BankTransaction', 'BankStatementUpload',
      'Staff', 'SalaryPayment',
      'Payment', 'Receipt',
      'Debtor', 'Creditor',
      'Account', 'JournalEntry', 'JournalEntryLine',
      'Batch', 'PriceList', 'PriceListItem',
      'Subscription', 'SubscriptionQueue', 'Recharge', 'UsageLog',
      'AuditLog', 'HelpSupportTicket', 'PasswordReset',
    ];

    const backup = {};
    let totalRecords = 0;
    const tableErrors = [];

    for (const table of tables) {
      try {
        // Use raw query to bypass soft-delete filter and get ALL records
        const records = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
        backup[table] = records;
        totalRecords += Array.isArray(records) ? records.length : 0;
      } catch (err) {
        backup[table] = [];
        tableErrors.push({ table, error: err.message.slice(0, 100) });
      }
    }

    // Build backup object
    const backupData = {
      _metadata: {
        software: 'BizBook Pro',
        version: 'v4.115',
        exportDate: new Date().toISOString(),
        exportMethod: 'startup-automatic',
        tableCount: Object.keys(backup).length,
        totalRecords,
        tableErrors: tableErrors.length,
      },
      tableErrors: tableErrors.length > 0 ? tableErrors : undefined,
      data: backup,
    };

    // Write backup file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `bizbook_startup_${timestamp}.json`;
    const filepath = path.join(BACKUP_DIR, filename);

    const jsonStr = JSON.stringify(backupData, null, 2);
    fs.writeFileSync(filepath, jsonStr, 'utf-8');

    const sizeMB = (Buffer.byteLength(jsonStr, 'utf-8') / (1024 * 1024)).toFixed(2);
    log('OK', `✓ Startup backup created: ${filepath} (${sizeMB} MB, ${totalRecords} records)`);

    // Clean up old backups (keep only the last MAX_BACKUPS)
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('bizbook_startup_'))
      .sort()
      .reverse(); // newest first

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS);
      for (const f of toDelete) {
        try {
          fs.unlinkSync(path.join(BACKUP_DIR, f));
        } catch {}
      }
      log('INFO', `Cleaned up ${toDelete.length} old backup(s) — keeping last ${MAX_BACKUPS}`);
    }

    // List available backups
    log('INFO', `Available backups in ${BACKUP_DIR}:`);
    files.slice(0, MAX_BACKUPS).forEach((f, i) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      const sizeKB = (stat.size / 1024).toFixed(1);
      log('INFO', `  ${i + 1}. ${f} (${sizeKB} KB)`);
    });

  } catch (err) {
    log('ERROR', `Backup failed: ${err.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  log('ERROR', `Fatal: ${err.message}`);
  // Don't fail startup
});
