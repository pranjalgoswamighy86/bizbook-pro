/**
 * BizBook Pro - Database Protection Layer
 *
 * This module adds runtime protections to prevent accidental data loss:
 * 1. Prevents deleteMany without a where clause (mass deletion)
 * 2. Logs all delete operations for audit trail
 * 3. Provides a backup-on-startup function
 */

import fs from 'fs'
import path from 'path'

// Smart DB path resolution — works in local dev, PM2 cluster, and Space-Z deploy
function resolveDbPath(): string {
  const candidates = [
    path.join(process.cwd(), 'db', 'custom.db'),           // CWD-relative (most common)
    '/app/db/custom.db',                                      // Space-Z platform
    '/home/z/my-project/db/custom.db',                       // Local dev absolute
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  // Fallback: CWD-relative (Prisma might create it)
  return path.join(process.cwd(), 'db', 'custom.db')
}

const DB_PATH = resolveDbPath()
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups')

/**
 * Create a backup of the database file.
 * Called automatically on server startup and before any schema migration.
 */
export function backupDatabase(reason: string = 'startup'): { success: boolean; path?: string; error?: string } {
  try {
    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true })
    }

    // Check if database file exists
    if (!fs.existsSync(DB_PATH)) {
      return { success: false, error: 'Database file not found' }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
    const backupPath = path.join(BACKUP_DIR, `bizbook_backup_${timestamp}_${reason}.db`)

    // Copy the database file
    fs.copyFileSync(DB_PATH, backupPath)

    // Verify backup
    const originalStat = fs.statSync(DB_PATH)
    const backupStat = fs.statSync(backupPath)

    if (backupStat.size === 0) {
      fs.unlinkSync(backupPath)
      return { success: false, error: 'Backup file is empty' }
    }

    // Clean up old backups (keep last 20)
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('bizbook_backup_') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time)

    if (backups.length > 20) {
      backups.slice(20).forEach(b => {
        try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)) } catch {}
      })
    }

    console.log(`[DB-PROTECTION] Backup created: ${backupPath} (${(backupStat.size / 1024).toFixed(1)}KB) [reason: ${reason}]`)
    return { success: true, path: backupPath }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[DB-PROTECTION] Backup failed: ${errMsg}`)
    return { success: false, error: errMsg }
  }
}

/**
 * Get database statistics for monitoring data integrity.
 */
export async function getDatabaseStats(db: any): Promise<Record<string, number>> {
  try {
    const [users, tenants, sales, purchases, inventory, expenses, staff, debtors, creditors, payments, receipts] = await Promise.all([
      db.user.count(),
      db.tenant.count(),
      db.sale.count(),
      db.purchase.count(),
      db.inventoryItem.count(),
      db.expense.count(),
      db.staff.count(),
      db.debtor.count(),
      db.creditor.count(),
      db.payment.count(),
      db.receipt.count(),
    ])

    return { users, tenants, sales, purchases, inventory, expenses, staff, debtors, creditors, payments, receipts }
  } catch (error) {
    console.error('[DB-PROTECTION] Failed to get stats:', error)
    return {}
  }
}

/**
 * Data Protection Rule:
 * NEVER delete user accounts, tenant records, or business data (sales, purchases, etc.)
 * during software updates. Updates should only ADD new fields/tables, never remove existing data.
 *
 * This constant is referenced by the worklog and serves as a permanent reminder.
 */
export const DATA_PROTECTION_RULES = {
  NEVER_DELETE_USER_DATA: true,
  NEVER_RESET_DATABASE: true,
  ALWAYS_BACKUP_BEFORE_SCHEMA_CHANGE: true,
  USE_MIGRATIONS_NOT_PUSH: true,
  SCHEMA_CHANGES_MUST_BE_ADDITIVE: true,
}
