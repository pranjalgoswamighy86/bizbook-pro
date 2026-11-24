import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'
import { verifyPassword } from '@/lib/auth'
import { isSuperAdminEmail, isInfrastructureOwnerEmail } from '@/lib/rbac/enforce-v2'
import { buildBackupRecords } from '@/lib/backup-utils'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email.trim() || !body.password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
    }

    const email = body.email.trim().toLowerCase()
    const password = body.password
    const user = await rawDb.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        role: true,
        isActive: true,
        isDeleted: true,
        tenantId: true,
      },
    })

    // Authenticate only against the current database. Never trust credentials
    // embedded in an uploaded backup file.
    const passwordValid = user ? verifyPassword(password, user.password) : false
    if (!user || !passwordValid || !user.isActive || user.isDeleted) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
    }

    const isPlatformAdmin = (
      isSuperAdminEmail(user.email) && user.role === 'SUPER_ADMIN'
    ) || (
      isInfrastructureOwnerEmail(user.email) && user.role === 'INFRASTRUCTURE_OWNER_ADMIN'
    )
    if (isPlatformAdmin && password === 'admin123') {
      return NextResponse.json({
        error: 'Change the default seeded password before creating a system-wide backup.',
      }, { status: 403 })
    }

    if (!isPlatformAdmin) {
      if (!user.tenantId) {
        return NextResponse.json({ error: 'This account is not linked to a business.' }, { status: 403 })
      }
      const membership = await rawDb.userTenant.findFirst({
        where: { userId: user.id, tenantId: user.tenantId },
        select: { role: true, isOwner: true },
      })
      if (!membership || (membership.role !== 'MAIN_ADMIN' && !membership.isOwner)) {
        return NextResponse.json({ error: 'Emergency backup is available only to the business administrator.' }, { status: 403 })
      }
    }

    // Emergency export is still subject to the account's active-state controls.
    const tenantId = isPlatformAdmin ? null : user.tenantId
    const { data, tableErrors, totalRecords } = await buildBackupRecords(tenantId, 500000)

    try {
      if (user.tenantId) {
        await rawDb.auditLog.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            userName: user.name,
            action: 'EMERGENCY_BACKUP_DOWNLOAD',
            entityType: 'Backup',
            entityId: null,
            entityName: `Emergency ${isPlatformAdmin ? 'system' : 'business'} backup (${totalRecords} records)`,
            changes: JSON.stringify({
              scope: isPlatformAdmin ? 'global' : 'tenant',
              totalRecords,
              tableErrors: tableErrors.length,
            }),
          },
        })
      }
    } catch {
      // An audit-log failure must not prevent a legitimate emergency backup.
    }

    const backupData = {
      _metadata: {
        software: 'BizBook Pro',
        version: 'v6.31.0',
        exportDate: new Date().toISOString(),
        exportedBy: user.email,
        exportMethod: 'emergency',
        scope: isPlatformAdmin ? 'global' : 'tenant',
        tenantId: tenantId || undefined,
        tableCount: Object.keys(data).length,
        totalRecords,
        tableErrors: tableErrors.length,
        instructions:
          'Restore using the BizBook Pro restore workflow. Credentials must belong to an active account in the destination database. Business administrators can restore only their own business data; platform administrators can restore a system backup.',
        schemaNote: 'Password reset OTPs are intentionally excluded from backups.',
      },
      tableErrors: tableErrors.length > 0 ? tableErrors : undefined,
      data,
    }

    const buffer = Buffer.from(JSON.stringify(backupData), 'utf-8')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const scopeName = isPlatformAdmin ? 'SYSTEM' : 'BUSINESS'
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="bizbook_pro_${scopeName}_backup_${timestamp}.json"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    })
  } catch (error) {
    console.error('[EMERGENCY-BACKUP] Error:', error)
    return NextResponse.json({ error: 'Emergency backup failed. Please try again or contact support.' }, { status: 500 })
  }
}

// Credentials in a URL can leak through browser history, proxy logs and referrers.
// Emergency backup therefore accepts POST only.
export async function GET() {
  return NextResponse.json({
    error: 'GET is disabled. Submit credentials in a POST request body; never place passwords in a URL.',
  }, { status: 405, headers: { Allow: 'POST' } })
}
