import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { backupDatabase, getDatabaseStats } from '@/lib/db-protection'
import fs from 'fs'
import path from 'path'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

const BACKUP_DIR = path.join(process.cwd(), 'db', 'backups')

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
    const { action, tenantId } = body // v4.50: Fix — tenantId was not destructured (caused ReferenceError)

    if (action === 'stats') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const stats = await getDatabaseStats(db)
      return NextResponse.json({ stats, timestamp: new Date().toISOString() })
    }

    if (action === 'backup') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const result = backupDatabase('manual')
      return NextResponse.json(result)
    }

    if (action === 'list-backups') {
      if (!fs.existsSync(BACKUP_DIR)) {
        return NextResponse.json({ backups: [], autoConfig: { enabled: true, frequency: 'startup', lastRun: null } })
      }

      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('bizbook_backup_') && f.endsWith('.db'))
        .map(f => {
          const filePath = path.join(BACKUP_DIR, f)
          const stat = fs.statSync(filePath)
          // Parse reason from filename: bizbook_backup_2024-01-01_12-00-00_reason.db
          const parts = f.replace('bizbook_backup_', '').replace('.db', '').split('_')
          const reason = parts.length >= 3 ? parts.slice(2).join('_') : 'unknown'
          return {
            name: f,
            size: stat.size,
            created: stat.mtime.toISOString(),
            reason,
          }
        })
        .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())

      return NextResponse.json({
        backups: files,
        autoConfig: {
          enabled: true,
          frequency: 'startup',
          lastRun: files.length > 0 ? files[0].created : null,
        },
      })
    }

    if (action === 'delete-backup') {
      const { filename } = body
      if (!filename) {
        return NextResponse.json({ error: 'Filename is required' }, { status: 400 })
      }
      // Security: only allow deleting backup files
      if (!filename.startsWith('bizbook_backup_') || !filename.endsWith('.db')) {
        return NextResponse.json({ error: 'Invalid backup filename' }, { status: 400 })
      }
      const filePath = path.join(BACKUP_DIR, filename)
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'Backup file not found' }, { status: 404 })
      }
      fs.unlinkSync(filePath)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action. Use: stats, backup, list-backups, delete-backup' }, { status: 400 })
  } catch (error) {
    console.error('DB admin error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
