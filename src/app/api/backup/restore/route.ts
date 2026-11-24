import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'
import { verifyPassword } from '@/lib/auth'
import { requireAuth } from '@/lib/api-helpers'
import { checkLoginRateLimit, clearLoginAttempts, getClientIP, recordLoginAttempt } from '@/lib/rate-limit-db'

/**
 * Database Restore API — v4.120
 *
 * POST /api/backup/restore
 * Body: { "email": "...", "password": "...", "backupData": {...} }
 *
 * Security requirements:
 *   - A live BizBook Pro session is required.
 *   - The session email must be a configured system administrator.
 *   - The password is verified against that account in the current database.
 *   - The backup must contain the same administrator identity.
 *
 * Restore upserts all supported tables by ID and can overwrite records
 * across every tenant. Only use a trusted backup after taking a fresh copy.
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
    // A whole-database restore can overwrite records across every tenant.
    // Authenticate against the live application session and current DB password.
    // Never trust a password hash embedded in the uploaded backup: that file is untrusted input.
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

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
    const sessionEmail = auth.email.toLowerCase().trim()

    const clientIP = getClientIP(req)
    const rateLimit = await checkLoginRateLimit(sessionEmail, clientIP)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many restore authentication attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      )
    }

    if (email !== sessionEmail) {
      return NextResponse.json({ error: 'The restore email must match the signed-in administrator.' }, { status: 403 })
    }

    // This route restores all tenants, not one tenant. Only the system
    // administrator identities used by the platform RBAC may run it.
    const systemAdminEmails = new Set([
      'admin@bizbook.pro',
      'pranjalgoswamighy86@gmail.com',
      process.env.ADMIN_EMAIL || '',
      process.env.INFRASTRUCTURE_OWNER_EMAIL || '',
    ].map(value => value.toLowerCase().trim()).filter(Boolean))

    if (!systemAdminEmails.has(sessionEmail)) {
      return NextResponse.json({ error: 'A system administrator account is required for whole-database restore.' }, { status: 403 })
    }

    const currentUser = await rawDb.user.findUnique({
      where: { id: auth.userId },
      select: { password: true },
    })
    if (!currentUser || !verifyPassword(password, currentUser.password)) {
      await recordLoginAttempt(sessionEmail, clientIP, false)
      return NextResponse.json({ error: 'Invalid administrator password.' }, { status: 401 })
    }

    await clearLoginAttempts(sessionEmail)

    // The backup must contain the same administrator identity. Its password
    // hash is not used for authentication; only the current DB password is trusted.
    if (!backupData._metadata || !backupData.data || backupData._metadata.software !== 'BizBook Pro') {
      return NextResponse.json({ error: 'Invalid BizBook Pro backup file.' }, { status: 400 })
    }

    const backupUsers = Array.isArray(backupData.data.User) ? backupData.data.User : []
    const backupUser = backupUsers.find(
      (u: any) => typeof u?.email === 'string' && u.email.toLowerCase() === sessionEmail
    )
    if (!backupUser) {
      return NextResponse.json({ error: 'The backup does not contain the signed-in administrator account.' }, { status: 400 })
    }

    console.log(`[RESTORE] Authenticated system administrator session for ${sessionEmail}. Starting restore...`)

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
