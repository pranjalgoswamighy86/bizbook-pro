import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'
import { verifyPassword } from '@/lib/auth'

/**
 * Database Restore API — v4.115
 *
 * POST /api/backup/restore
 * Body: { "email": "...", "password": "...", "backupData": {...} }
 *
 * This endpoint restores the database from a previously-downloaded
 * emergency backup JSON file. It's the recovery path for when the
 * Railway database has been reset/wiped.
 *
 * Authentication: email + password (same as emergency backup download).
 * The user must be a registered user in the BACKUP file (not the current
 * database, which may be empty).
 *
 * The restore process:
 *   1. Verifies the user's credentials against the backup data
 *   2. Validates the backup structure
 *   3. Imports all tables in dependency order (tenants first, then users, etc.)
 *   4. Uses upsert to avoid duplicate key errors (if a record already exists, skip it)
 *   5. Returns a summary of what was restored
 *
 * IMPORTANT: This endpoint does NOT delete existing data. It only adds
 * records that don't exist yet (upsert with no update). This means:
 *   - If the DB is empty, all backup data is imported
 *   - If the DB has some data, only missing records are added
 *   - Existing records are NOT overwritten
 */

export const maxDuration = 600 // 10 minutes — large restores may take time
export const dynamic = 'force-dynamic'

// Table import order — matters for foreign key constraints
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

    // Verify user credentials against the BACKUP data (not current DB)
    const backupUsers = backupData.data.User || []
    const backupUser = backupUsers.find(
      (u: any) => u.email && u.email.toLowerCase() === email
    )

    if (!backupUser) {
      return NextResponse.json(
        {
          error: `Email "${email}" not found in the backup file. The backup contains ${backupUsers.length} user(s).`,
          backupUsers: backupUsers.map((u: any) => u.email),
        },
        { status: 401 }
      )
    }

    const passwordValid = verifyPassword(password, backupUser.password)
    if (!passwordValid) {
      return NextResponse.json(
        { error: 'Invalid password. The password must match the user account in the backup file.' },
        { status: 401 }
      )
    }

    // Begin restore process
    const results: Array<{ table: string; imported: number; skipped: number; error?: string }> = []
    let totalImported = 0
    let totalSkipped = 0

    for (const [modelName, label] of TABLE_ORDER) {
      const records = backupData.data[modelName] || []
      if (records.length === 0) {
        results.push({ table: modelName, imported: 0, skipped: 0 })
        continue
      }

      let imported = 0
      let skipped = 0
      let errorMsg: string | undefined

      try {
        for (const record of records) {
          try {
            // Check if record already exists (by id)
            const existing = await (rawDb as any)[label].findUnique({
              where: { id: record.id },
              select: { id: true },
            })

            if (existing) {
              skipped++
              continue
            }

            // Create the record
            // Remove any fields that don't exist in the current schema
            // (the backup may have been from an older version)
            const cleanRecord = { ...record }
            // Remove _count and other Prisma relation fields
            delete cleanRecord._count

            await (rawDb as any)[label].create({ data: cleanRecord })
            imported++
          } catch (err: any) {
            // Skip records that fail (e.g., FK constraint, duplicate, schema mismatch)
            skipped++
            if (!errorMsg) {
              errorMsg = err?.message?.slice(0, 200) || 'Unknown error'
            }
          }
        }
      } catch (err: any) {
        errorMsg = err?.message?.slice(0, 200) || 'Unknown error'
      }

      results.push({
        table: modelName,
        imported,
        skipped,
        error: errorMsg,
      })
      totalImported += imported
      totalSkipped += skipped
    }

    // Write audit log (best-effort)
    try {
      // Find the user's tenantId from the backup
      const userTenantId = backupUser.tenantId
      if (userTenantId) {
        // Check if the tenant exists now (it should, since we just restored it)
        const tenantExists = await rawDb.tenant.findUnique({
          where: { id: userTenantId },
          select: { id: true },
        })
        if (tenantExists) {
          await rawDb.auditLog.create({
            data: {
              tenantId: userTenantId,
              userId: backupUser.id,
              userName: backupUser.name,
              action: 'DATABASE_RESTORE',
              entityType: 'Backup',
              entityId: null,
              entityName: `Restored ${totalImported} records from backup`,
              changes: JSON.stringify({
                exportDate: backupData._metadata.exportDate,
                exportMethod: backupData._metadata.exportMethod,
                totalRecords: backupData._metadata.totalRecords,
                imported: totalImported,
                skipped: totalSkipped,
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
      message: `Restore complete. ${totalImported} records imported, ${totalSkipped} skipped (already existed or failed).`,
      summary: {
        backupDate: backupData._metadata.exportDate,
        backupMethod: backupData._metadata.exportMethod,
        totalRecordsInBackup: backupData._metadata.totalRecords,
        recordsImported: totalImported,
        recordsSkipped: totalSkipped,
      },
      details: results.filter(r => r.imported > 0 || r.error),
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
