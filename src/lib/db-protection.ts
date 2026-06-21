/**
 * BizBook Pro - Database Protection Layer (v4.56 — PostgreSQL)
 *
 * v4.56: Removed SQLite file backup logic — PostgreSQL manages its own
 * persistence and backups. This module now only provides stats + rules.
 */

/**
 * v4.56: PostgreSQL backup is managed by Railway (automated daily backups).
 * This function is kept for backward compatibility but is a no-op.
 */
export function backupDatabase(reason: string = 'startup'): { success: boolean; path?: string; error?: string } {
  // PostgreSQL backups are managed by Railway automatically
  // No file-based backup needed
  console.log(`[DB-PROTECTION] PostgreSQL backup managed by Railway (reason: ${reason})`)
  return { success: true, path: 'railway-managed' }
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
 */
export const DATA_PROTECTION_RULES = {
  NEVER_DELETE_USER_DATA: true,
  NEVER_RESET_DATABASE: true,
  ALWAYS_BACKUP_BEFORE_SCHEMA_CHANGE: true,
  USE_MIGRATIONS_NOT_PUSH: true,
  SCHEMA_CHANGES_MUST_BE_ADDITIVE: true,
}
