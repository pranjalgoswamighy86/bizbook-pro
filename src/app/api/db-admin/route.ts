import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { getDatabaseStats } from '@/lib/db-protection'
import { requireAuth } from '@/lib/api-helpers'

const SYSTEM_ADMIN_EMAILS = new Set([
  process.env.ADMIN_EMAIL || '',
  process.env.INFRA_OWNER_EMAIL || '',
  process.env.INFRASTRUCTURE_OWNER_EMAIL || '',
].map(value => value.toLowerCase().trim()).filter(Boolean))

async function requireSystemAdmin(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  if (!SYSTEM_ADMIN_EMAILS.has(auth.email.toLowerCase().trim())) {
    return NextResponse.json(
      { error: 'System administrator access is required for server-wide database backups.' },
      { status: 403 }
    )
  }

  return auth
}

/**
 * Database Administration API
 *
 * Actions:
 * - stats: Get database record counts (for monitoring data integrity)
 * - backup: Create a manual backup
 * - list-backups: List all backup files with metadata
 * - delete-backup: Delete a specific backup file
 *
 * SECURITY: This endpoint does NOT support any destructive operations.
 * Database restore must be done manually via scripts/db-backup.sh restore
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'stats') {
      // This reports database-wide counts, not just the requested tenant.
      // Treat it as a system-admin operation to avoid leaking cross-tenant metadata.
      const auth = await requireSystemAdmin(req)
      if (auth instanceof NextResponse) return auth

      const stats = await getDatabaseStats(db)
      return NextResponse.json({ stats, timestamp: new Date().toISOString() })
    }

    if (action === 'backup') {
      const auth = await requireSystemAdmin(req)
      if (auth instanceof NextResponse) return auth

      // PostgreSQL backups are managed by Railway. This legacy action does
      // not create a snapshot and must not report a false successful backup.
      return NextResponse.json(
        {
          success: false,
          managedBy: 'Railway',
          error: 'This endpoint cannot create a manual PostgreSQL snapshot. Use Railway database backups or the tenant-scoped Company Backup export.',
        },
        { status: 409 }
      )
    }

    if (action === 'list-backups') {
      const auth = await requireSystemAdmin(req)
      if (auth instanceof NextResponse) return auth
      return NextResponse.json({
        backups: [],
        managedBy: 'Railway',
        message: 'PostgreSQL backup retention is managed by Railway. This endpoint does not maintain local SQLite backup files.',
      })
    }

    if (action === 'delete-backup') {
      const auth = await requireSystemAdmin(req)
      if (auth instanceof NextResponse) return auth

      return NextResponse.json(
        { error: 'Local SQLite backup files are not used by this PostgreSQL deployment. Manage database backups through Railway.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ error: 'Invalid action. Use: stats, backup, list-backups, delete-backup' }, { status: 400 })
  } catch (error) {
    console.error('DB admin error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
