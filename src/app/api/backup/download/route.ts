import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'
import { requireAuth } from '@/lib/api-helpers'
import { isSuperAdminEmail } from '@/lib/rbac/enforce-v2'
import { buildBackupRecords } from '@/lib/backup-utils'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    const isPlatformAdmin = isSuperAdminEmail(auth.email)
    const tenantId = isPlatformAdmin ? null : auth.user.tenantId

    if (!isPlatformAdmin) {
      if (!tenantId) {
        return NextResponse.json({ error: 'No business is linked to this account.' }, { status: 403 })
      }

      const membership = await rawDb.userTenant.findFirst({
        where: { userId: auth.userId, tenantId },
        select: { role: true, isOwner: true },
      })
      if (!membership || (membership.role !== 'MAIN_ADMIN' && !membership.isOwner)) {
        return NextResponse.json({ error: 'A business administrator role is required to download a backup.' }, { status: 403 })
      }
    }

    const { data, tableErrors, totalRecords } = await buildBackupRecords(tenantId, 100000)
    const backupData = {
      _metadata: {
        software: 'BizBook Pro',
        version: 'v6.31.0',
        exportDate: new Date().toISOString(),
        exportedBy: auth.email,
        exportMethod: 'authenticated',
        scope: isPlatformAdmin ? 'global' : 'tenant',
        tenantId: tenantId || undefined,
        tableCount: Object.keys(data).length,
        totalRecords,
        tableErrors: tableErrors.length,
        instructions: 'Restore this backup using a current BizBook Pro administrator account. Business administrators can restore only their own business data. Platform administrators can restore system backups.',
        schemaNote: 'Password reset OTPs are intentionally excluded from backups.',
      },
      tableErrors: tableErrors.length > 0 ? tableErrors : undefined,
      data,
    }

    const buffer = Buffer.from(JSON.stringify(backupData), 'utf-8')
    const date = new Date().toISOString().split('T')[0]
    const scopeName = isPlatformAdmin ? 'system' : 'business'
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="bizbook_pro_${scopeName}_backup_${date}.json"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    })
  } catch (error) {
    console.error('[BACKUP-DOWNLOAD] Error:', error)
    return NextResponse.json({ error: 'Backup failed. Please try again or contact support.' }, { status: 500 })
  }
}
