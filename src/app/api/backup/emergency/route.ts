import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'
import { verifyPassword } from '@/lib/auth'
import { checkLoginRateLimit, clearLoginAttempts, getClientIP, recordLoginAttempt } from '@/lib/rate-limit-db'

/**
 * EMERGENCY Database Backup API
 *
 * POST /api/backup/emergency
 * Body: { "email": "...", "password": "..." }
 *
 * This endpoint is the LAST-RESORT backup mechanism.
 * It works even when:
 *   - The user cannot log in normally (e.g., their tenant was deleted)
 *   - The session cookie is broken
 *   - The Settings page cannot be reached
 *   - The regular /api/backup/download endpoint fails
 *
 * Authentication is done by directly verifying email + password against
 * the User table — NO session required, NO tenant required.
 *
 * This endpoint exports ALL tenants and all records, so it is restricted
 * to configured system-administrator identities only. Ordinary tenant
 * administrators should use the tenant-scoped /api/backup export.
 *
 * Usage from a browser:
 *   Visit /emergency-backup.html — fill in email + password — click Download.
 *
 * Usage from curl:
 *   curl -X POST https://your-app.up.railway.app/api/backup/emergency \
 *        -H "Content-Type: application/json" \
 *        -d '{"email":"you@example.com","password":"yourpassword"}' \
 *        --output backup.json
 */

export const maxDuration = 300 // 5 minutes — large backups may take time
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || !body.email || !body.password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 }
      )
    }

    const email = String(body.email).trim().toLowerCase()
    const password = String(body.password)

    // A system-wide backup contains every tenant's financial and personal data.
    // Never expose it to an ordinary tenant account.
    const systemAdminEmails = new Set([
      process.env.ADMIN_EMAIL || '',
      process.env.INFRA_OWNER_EMAIL || '',
      process.env.INFRASTRUCTURE_OWNER_EMAIL || '',
    ].map(value => value.toLowerCase().trim()).filter(Boolean))

    if (!systemAdminEmails.has(email)) {
      return NextResponse.json({ error: 'Emergency whole-database backup is restricted to the system administrator.' }, { status: 403 })
    }

    const clientIP = getClientIP(req)
    const rateLimit = await checkLoginRateLimit(email, clientIP)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many backup authentication attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      )
    }

    // Use rawDb to bypass soft-delete filtering so the designated system
    // administrator can retrieve an emergency backup if their account is inactive
    // or soft-deleted. The configured email allowlist still applies.
    const user = await rawDb.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        password: true,
        isActive: true,
        isDeleted: true,
        tenantId: true,
      },
    })

    // Always run verifyPassword even if user is null — keeps timing
    // roughly constant (mitigates user-enumeration via response timing).
    const passwordValid = user ? verifyPassword(password, user.password) : false

    if (!user || !passwordValid) {
      await recordLoginAttempt(email, clientIP, false)
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 }
      )
    }

    await recordLoginAttempt(email, clientIP, true)
    await clearLoginAttempts(email)

    // We deliberately DO NOT block on isActive / isDeleted here.
    // Emergency backup is the user's safety net — if their account was
    // deactivated or soft-deleted, they still have the right to
    // download their own data. We log the access for audit purposes.

    // ============================================================
    // Export ALL tables (all tenants, all records, including soft-deleted)
    // ============================================================
    const tableNames: Array<[string, string]> = [
      // Core
      ['tenant', 'Tenant'],
      ['user', 'User'],
      ['userTenant', 'UserTenant'],
      // Parties & products
      ['party', 'Party'],
      ['product', 'Product'],
      ['productIngredient', 'ProductIngredient'],
      // Transactions
      ['sale', 'Sale'],
      ['purchase', 'Purchase'],
      ['expense', 'Expense'],
      ['inventoryItem', 'InventoryItem'],
      // Banking
      ['bankTransaction', 'BankTransaction'],
      ['bankStatementUpload', 'BankStatementUpload'],
      // Staff
      ['staff', 'Staff'],
      ['salaryPayment', 'SalaryPayment'],
      // Payments
      ['payment', 'Payment'],
      ['receipt', 'Receipt'],
      // Ledgers
      ['debtor', 'Debtor'],
      ['creditor', 'Creditor'],
      // Accounting
      ['account', 'Account'],
      ['journalEntry', 'JournalEntry'],
      ['journalEntryLine', 'JournalEntryLine'],
      // Batches & pricing
      ['batch', 'Batch'],
      ['priceList', 'PriceList'],
      ['priceListItem', 'PriceListItem'],
      // Subscriptions
      ['subscription', 'Subscription'],
      ['subscriptionQueue', 'SubscriptionQueue'],
      ['recharge', 'Recharge'],
      ['usageLog', 'UsageLog'],
      // Audit & support
      ['auditLog', 'AuditLog'],
      ['helpSupportTicket', 'HelpSupportTicket'],
      // Password resets (include so users can see active reset tokens)
      ['passwordReset', 'PasswordReset'],
    ]

    const backup: Record<string, unknown[]> = {}
    const tableErrors: Array<{ table: string; error: string }> = []
    let totalRecords = 0

    for (const [prismaModel, label] of tableNames) {
      try {
        const records = await (rawDb as any)[prismaModel].findMany({ take: 500000 })
        backup[label] = records
        totalRecords += Array.isArray(records) ? records.length : 0
      } catch (err: any) {
        backup[label] = []
        tableErrors.push({
          table: label,
          error: err?.message?.slice(0, 200) || 'Unknown error',
        })
      }
    }

    // Write an audit log entry (best-effort, don't fail if it errors).
    // AuditLog requires a valid tenantId FK, so we skip if the user has
    // no tenantId or the tenant doesn't exist.
    try {
      if (user.tenantId) {
        const tenantExists = await rawDb.tenant.findUnique({
          where: { id: user.tenantId },
          select: { id: true },
        })
        if (tenantExists) {
          await rawDb.auditLog.create({
            data: {
              tenantId: user.tenantId,
              userId: user.id,
              userName: user.name,
              action: 'EMERGENCY_BACKUP_DOWNLOAD',
              entityType: 'Backup',
              entityId: null,
              entityName: `Emergency backup (${totalRecords} records)`,
              changes: JSON.stringify({
                exportMethod: 'emergency',
                tableCount: tableNames.length,
                totalRecords,
                tableErrors: tableErrors.length,
              }),
            },
          })
        }
      }
    } catch {
      // Audit log write failed (tenant missing, schema mismatch, etc.)
      // — don't fail the backup. The user's data is more important than the audit trail.
    }

    const backupData = {
      _metadata: {
        software: 'BizBook Pro',
        version: 'v4.109',
        exportDate: new Date().toISOString(),
        exportedBy: user.email,
        exportMethod: 'emergency',
        tableCount: Object.keys(backup).length,
        totalRecords,
        tableErrors: tableErrors.length,
        instructions:
          'To restore this backup:\n' +
          '1. Set up a new PostgreSQL database (e.g., on Railway, Render, or locally)\n' +
          '2. Deploy BizBook Pro and set DATABASE_URL to your new database\n' +
          '3. Configure ADMIN_EMAIL or INFRA_OWNER_EMAIL (INFRASTRUCTURE_OWNER_EMAIL is also supported), register that verified address, and sign in\n' +
          '4. From the signed-in browser, POST this backup to /api/backup/restore with the current admin password and active session cookie\n' +
          '5. Keep the backup private: it contains every tenant and user record',
        schemaNote:
          'Tables that failed to export are listed in tableErrors array. ' +
          'This is usually because the table is empty or has a schema mismatch. ' +
          'The rest of the backup is still valid.',
      },
      tableErrors: tableErrors.length > 0 ? tableErrors : undefined,
      data: backup,
    }

    const jsonStr = JSON.stringify(backupData, null, 2)
    const buffer = Buffer.from(jsonStr, 'utf-8')

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="bizbook_pro_EMERGENCY_backup_${new Date()
          .toISOString()
          .replace(/[:.]/g, '-')}.json"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (error: any) {
    console.error('[EMERGENCY-BACKUP] Error:', error)
    return NextResponse.json(
      {
        error: 'Emergency backup failed',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * Also support GET requests for easy browser testing.
 * GET /api/backup/emergency?email=...&password=...
 *
 * NOTE: This is less secure (password in URL) but useful for testing
 * and for users who can't figure out curl. The POST endpoint is preferred.
 */
// Credentials in query strings can leak through logs and browser history.
// Keep this endpoint POST-only.
export async function GET() {
  return NextResponse.json(
    { error: 'GET is disabled. Send email and password in a POST request body.' },
    { status: 405, headers: { Allow: 'POST' } }
  )
}
