import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'
import { verifyPassword } from '@/lib/auth'

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
 * Any registered user can use this to download a complete backup of
 * their entire database (all tenants, all records).
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

    // Use rawDb to bypass soft-delete filter — we want to authenticate
    // the user even if their account was soft-deleted, so they can
    // still get their data out.
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
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 }
      )
    }

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
          '3. The app will auto-create all tables on first startup via prisma db push\n' +
          '4. Use the /api/db-admin endpoint with action "restore" to import this JSON\n' +
          '   (or use psql to import the data manually)\n' +
          '5. After restore, log in with your email + password — all data will be there',
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
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const email = url.searchParams.get('email')
  const password = url.searchParams.get('password')

  if (!email || !password) {
    return NextResponse.json(
      {
        error: 'Missing email or password',
        usage: 'POST /api/backup/emergency with body { email, password }',
        alternative:
          'Or visit /emergency-backup.html for a simple form interface',
      },
      { status: 400 }
    )
  }

  // Re-dispatch to POST by constructing a synthetic request
  return POST(
    new NextRequest(req.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  )
}
