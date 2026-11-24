import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { requireAuth } from '@/lib/api-helpers'
import { isSuperAdminEmail, isInfrastructureOwnerEmail } from '@/lib/rbac/enforce-v2'

const BACKUP_DIR = path.join(process.cwd(), 'db', 'backups')

/**
 * Legacy platform database administration endpoint. The stats and legacy
 * backup-file operations are global, so they are restricted to an
 * allowlisted platform administrator rather than trusting a tenantId field.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth
  const isPlatformAdmin = (
    isSuperAdminEmail(auth.email) && auth.user.role === 'SUPER_ADMIN'
  ) || (
    isInfrastructureOwnerEmail(auth.email) && auth.user.role === 'INFRASTRUCTURE_OWNER_ADMIN'
  )
  if (!isPlatformAdmin) {
    return NextResponse.json({ error: 'Platform administrator access is required.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body.action !== 'string') {
    return NextResponse.json({ error: 'A valid database admin action is required.' }, { status: 400 })
  }

  try {
    switch (body.action) {
      case 'stats': {
        const counts = await Promise.all([
          import('@/lib/db-soft-delete').then(({ rawDb }) => Promise.all([
            rawDb.user.count(),
            rawDb.tenant.count(),
            rawDb.sale.count(),
            rawDb.purchase.count(),
            rawDb.inventoryItem.count(),
            rawDb.expense.count(),
            rawDb.staff.count(),
            rawDb.debtor.count(),
            rawDb.creditor.count(),
            rawDb.payment.count(),
            rawDb.receipt.count(),
          ])),
        ])
        const [users, tenants, sales, purchases, inventory, expenses, staff, debtors, creditors, payments, receipts] = counts[0]
        return NextResponse.json({
          stats: { users, tenants, sales, purchases, inventory, expenses, staff, debtors, creditors, payments, receipts },
          timestamp: new Date().toISOString(),
        }, { headers: { 'Cache-Control': 'no-store' } })
      }

      case 'backup':
        return NextResponse.json({
          error: 'PostgreSQL backups are managed by Railway. Use the authorized business backup export for portable JSON or Excel files.',
          backupProvider: 'Railway-managed PostgreSQL backups',
        }, { status: 409 })

      case 'list-backups': {
        if (!fs.existsSync(BACKUP_DIR)) {
          return NextResponse.json({ backups: [], autoConfig: { enabled: false, frequency: 'managed', lastRun: null } })
        }

        const files = fs.readdirSync(BACKUP_DIR)
          .filter(file => /^bizbook_backup_[A-Za-z0-9_-]+\.db$/.test(file))
          .map(file => {
            const filePath = path.join(BACKUP_DIR, file)
            const stat = fs.statSync(filePath)
            const reason = file.replace(/^bizbook_backup_/, '').replace(/\.db$/, '').split('_').slice(2).join('_') || 'unknown'
            return { name: file, size: stat.size, created: stat.mtime.toISOString(), reason }
          })
          .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())

        return NextResponse.json({
          backups: files,
          autoConfig: { enabled: false, frequency: 'managed', lastRun: files[0]?.created || null },
        }, { headers: { 'Cache-Control': 'no-store' } })
      }

      case 'delete-backup': {
        const filename = body.filename
        if (typeof filename !== 'string' || !/^bizbook_backup_[A-Za-z0-9_-]+\.db$/.test(filename)) {
          return NextResponse.json({ error: 'Invalid backup filename.' }, { status: 400 })
        }
        const filePath = path.join(BACKUP_DIR, filename)
        if (!fs.existsSync(filePath)) return NextResponse.json({ error: 'Backup file not found.' }, { status: 404 })
        fs.unlinkSync(filePath)
        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json({ error: 'Invalid database admin action.' }, { status: 400 })
    }
  } catch (error) {
    console.error('[DB-ADMIN] Operation failed:', error)
    return NextResponse.json({ error: 'Database admin operation failed.' }, { status: 500 })
  }
}
