import { NextRequest, NextResponse } from 'next/server'
import { rawDb, db } from '@/lib/db-soft-delete'
import { verifyPassword } from '@/lib/auth'

/**
 * Database Restore API — v4.120
 *
 * POST /api/backup/restore
 * Body: { "email": "...", "password": "...", "backupData": {...} }
 *
 * v4.120 CHANGES:
 *   1. Authentication now accepts EITHER:
 *      - The password from the BACKUP file (original behavior), OR
 *      - The password from the CURRENT database (new — lets admin restore
 *        even when they don't remember the old password)
 *   2. Uses upsert instead of create — existing records are UPDATED, not skipped.
 *      This fixes the "duplicate key" error when admin@bizbook.pro already exists.
 *   3. Handles the seeded admin user: updates its password hash, role, and tenantId
 *      to match the backup, so the admin can log in with their original password
 *      after restore.
 *
 * The restore process:
 *   1. Verifies the user's credentials (backup OR current DB)
 *   2. Validates the backup structure
 *   3. Imports all tables in dependency order using upsert
 *   4. Returns a summary of what was restored
 */

export const maxDuration = 600 // 10 minutes
export const dynamic = 'force-dynamic'

const TABLE_ORDER: Array<[string, string]> = [
  ['Tenant', 'tenant'],
  ['User', 'user'],
  ['UserTenant', 'userTenant'],
  ['Party', 'party'],
  ['Product', 'product'],
  ['ProductIngredient', 'productIngredient'],
  ['InventoryItem', 'inventoryItem'],
  ['Sale', 'sale'],
  ['Purchase', 'purchase'],
  ['Expense', 'expense'],
  ['BankTransaction', 'bankTransaction'],
  ['BankStatementUpload', 'bankStatementUpload'],
  ['Staff', 'staff'],
  ['SalaryPayment', 'salaryPayment'],
  ['Payment', 'payment'],
  ['Receipt', 'receipt'],
  ['Debtor', 'debtor'],
  ['Creditor', 'creditor'],
  ['Account', 'account'],
  ['JournalEntry', 'journalEntry'],
  ['JournalEntryLine', 'journalEntryLine'],
  ['Batch', 'batch'],
  ['PriceList', 'priceList'],
  ['PriceListItem', 'priceListItem'],
  ['Subscription', 'subscription'],
  ['SubscriptionQueue', 'subscriptionQueue'],
  ['Recharge', 'recharge'],
  ['UsageLog', 'usageLog'],
  ['AuditLog', 'auditLog'],
  ['HelpSupportTicket', 'helpSupportTicket'],
  ['PasswordReset', 'passwordReset'],
]

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || !body.email || !body.password || !body.backupData) {
      return NextResponse.json(
        {
          error: 'Email, password, and backupData are required.',
          usage: 'POST /api/backup/restore with { email, password, backupData }',
        },
        { status: 400 }
      )
    }

    const email = String(body.email).trim().toLowerCase()
    const password = String(body.password)
    const backupData = body.backupData

    // Validate backup structure
    if (!backupData._metadata || !backupData.data) {
      return NextResponse.json(
        { error: 'Invalid backup file. The backup must have _metadata and data fields.' },
        { status: 400 }
      )
    }

    if (backupData._metadata.software !== 'BizBook Pro') {
      return NextResponse.json(
        { error: 'This backup file was not created by BizBook Pro.' },
        { status: 400 }
      )
    }

    // v4.120: Authenticate against EITHER the backup OR the current database
    const backupUsers = backupData.data.User || []
    const backupUser = backupUsers.find(
      (u: any) => u.email && u.email.toLowerCase() === email
    )

    let authenticated = false
    let authMethod = ''

    // Try backup credentials first
    if (backupUser) {
      const backupPasswordValid = verifyPassword(password, backupUser.password)
      if (backupPasswordValid) {
        authenticated = true
        authMethod = 'backup'
      }
    }

    // If backup auth failed, try current database credentials
    if (!authenticated) {
      try {
        const currentUser = await db.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true, email: true, password: true, role: true, tenantId: true },
        })
        if (currentUser) {
          const currentPasswordValid = verifyPassword(password, currentUser.password)
          if (currentPasswordValid) {
            authenticated = true
            authMethod = 'current-db'
          }
        }
      } catch {
        // Current DB lookup failed — continue
      }
    }

    // v4.120: SPECIAL BYPASS — if the email is admin@bizbook.pro and the
    // password is the default seeded password (admin123), allow restore.
    // This is for emergency recovery when the database was just reset.
    if (!authenticated && email === 'admin@bizbook.pro' && password === 'admin123') {
      // Verify that admin@bizbook.pro exists in the current DB with the seeded password
      try {
        const seededAdmin = await db.user.findFirst({
          where: { email: 'admin@bizbook.pro' },
          select: { id: true, password: true },
        })
        if (seededAdmin && verifyPassword('admin123', seededAdmin.password)) {
          authenticated = true
          authMethod = 'seeded-admin-bypass'
        }
      } catch {
        // Continue
      }
    }

    if (!authenticated) {
      const errorMsg = backupUser
        ? `Invalid password. The password must match either:\n1. The user account in the backup file, OR\n2. The current database's admin password (try "admin123" if the database was just reset)`
        : `Email "${email}" not found in the backup file or current database. The backup contains ${backupUsers.length} user(s).`
      return NextResponse.json(
        {
          error: errorMsg,
          backupUsers: backupUsers.map((u: any) => u.email),
        },
        { status: 401 }
      )
    }

    console.log(`[RESTORE] Authenticated via ${authMethod}. Starting restore...`)

    // Begin restore process
    const results: Array<{ table: string; imported: number; updated: number; skipped: number; error?: string }> = []
    let totalImported = 0
    let totalUpdated = 0
    let totalSkipped = 0

    for (const [modelName, label] of TABLE_ORDER) {
      const records = backupData.data[modelName] || []
      if (records.length === 0) {
        results.push({ table: modelName, imported: 0, updated: 0, skipped: 0 })
        continue
      }

      let imported = 0
      let updated = 0
      let skipped = 0
      let errorMsg: string | undefined

      for (const record of records) {
        try {
          // Clean the record — remove any relation fields that Prisma doesn't accept
          const cleanRecord = { ...record }
          delete cleanRecord._count
          delete cleanRecord.tenant
          delete cleanRecord.user
          delete cleanRecord.userTenants
          delete cleanRecord.sales
          delete cleanRecord.purchases
          delete cleanRecord.expenses
          delete cleanRecord.inventory
          delete cleanRecord.items
          delete cleanRecord.ingredients
          delete cleanRecord.subscription
          delete cleanRecord.subscriptions

          // v4.120: Use upsert — creates if not exists, updates if exists
          // This fixes the "duplicate key" error when admin@bizbook.pro already exists
          await (rawDb as any)[label].upsert({
            where: { id: record.id },
            create: cleanRecord,
            update: cleanRecord,
          })

          // Check if it was an update or create
          const existedBefore = await (rawDb as any)[label].findUnique({
            where: { id: record.id },
            select: { id: true, createdAt: true },
          })

          // If the record's createdAt matches the backup's createdAt, it was likely
          // just created (imported). If different, it was updated.
          if (existedBefore && record.createdAt &&
              new Date(existedBefore.createdAt).getTime() === new Date(record.createdAt).getTime()) {
            // Could be either — count as imported to be safe
            imported++
            totalImported++
          } else {
            updated++
            totalUpdated++
          }
        } catch (err: any) {
          skipped++
          totalSkipped++
          if (!errorMsg) {
            errorMsg = err?.message?.slice(0, 200) || 'Unknown error'
          }
        }
      }

      results.push({
        table: modelName,
        imported,
        updated,
        skipped,
        error: errorMsg,
      })
    }

    // Write audit log (best-effort)
    try {
      // Find the admin's tenant from the backup
      const adminUser = backupUsers.find((u: any) =>
        u.email && u.email.toLowerCase() === 'admin@bizbook.pro'
      )
      const userTenantId = backupUser?.tenantId || adminUser?.tenantId
      if (userTenantId) {
        const tenantExists = await rawDb.tenant.findUnique({
          where: { id: userTenantId },
          select: { id: true },
        })
        if (tenantExists) {
          await rawDb.auditLog.create({
            data: {
              tenantId: userTenantId,
              userId: backupUser?.id || adminUser?.id || 'restore',
              userName: backupUser?.name || 'Admin',
              action: 'DATABASE_RESTORE',
              entityType: 'Backup',
              entityId: null,
              entityName: `Restored ${totalImported + totalUpdated} records via ${authMethod}`,
              changes: JSON.stringify({
                exportDate: backupData._metadata.exportDate,
                exportMethod: backupData._metadata.exportMethod,
                totalRecords: backupData._metadata.totalRecords,
                imported: totalImported,
                updated: totalUpdated,
                skipped: totalSkipped,
                authMethod,
              }),
            },
          })
        }
      }
    } catch {
      // Audit log write failed — don't fail the restore
    }

    return NextResponse.json({
      success: true,
      message: `Restore complete. ${totalImported} records imported, ${totalUpdated} updated, ${totalSkipped} skipped.`,
      summary: {
        backupDate: backupData._metadata.exportDate,
        backupMethod: backupData._metadata.exportMethod,
        totalRecordsInBackup: backupData._metadata.totalRecords,
        recordsImported: totalImported,
        recordsUpdated: totalUpdated,
        recordsSkipped: totalSkipped,
        authMethod,
      },
      details: results.filter(r => r.imported > 0 || r.updated > 0 || r.error),
    })
  } catch (error: any) {
    console.error('[RESTORE] Error:', error)
    return NextResponse.json(
      {
        error: 'Restore failed',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    )
  }
}
