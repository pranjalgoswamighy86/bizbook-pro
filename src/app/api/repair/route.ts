import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'

// ============================================================
// v6.9.1: REPAIR ENDPOINT — fixes corrupted data from previous bugs
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (action === 'repair-owner-roles') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      // 1. Find ALL UserTenant records where isOwner = true but role != MAIN_ADMIN
      const corruptedOwners = await db.userTenant.findMany({
        where: { isOwner: true, role: { not: 'MAIN_ADMIN' } },
        include: { user: true, tenant: true },
      })

      let fixedCount = 0
      for (const ut of corruptedOwners) {
        await db.userTenant.update({
          where: { id: ut.id },
          data: { role: 'MAIN_ADMIN' },
        })
        await db.user.update({
          where: { id: ut.userId },
          data: { role: 'MAIN_ADMIN' },
        })
        console.log(`[REPAIR] Fixed owner ${ut.user.email} in ${ut.tenant.name}: ${ut.role} → MAIN_ADMIN`)
        fixedCount++
      }

      // 2. Pool hours across all companies owned by this user
      const allUserTenants = await db.userTenant.findMany({
        where: { userId: access.userId, role: 'MAIN_ADMIN', isOwner: true },
        select: { tenantId: true },
      })
      const allTenantIds = allUserTenants.map(ut => ut.tenantId)

      const allSubscriptions = await db.subscription.findMany({
        where: { tenantId: { in: allTenantIds } },
      })

      const totalRemaining = allSubscriptions.reduce((sum, sub) => sum + sub.remainingSeconds, 0)
      const totalHours = Math.floor(totalRemaining / 3600)

      // 3. Give ALL pooled hours to the FIRST subscription, set others to 0
      // The log-usage logic handles pooling going forward
      if (allSubscriptions.length > 0) {
        for (let i = 0; i < allSubscriptions.length; i++) {
          const sub = allSubscriptions[i]
          const newRemaining = i === 0 ? totalRemaining : 0
          const newStatus = newRemaining > 0 ? 'ACTIVE' : 'CONVERTED_TO_VIEW_ONLY'

          await db.subscription.update({
            where: { id: sub.id },
            data: {
              remainingSeconds: newRemaining,
              status: newStatus,
            },
          })
        }
      }

      await writeAuditLog({
        tenantId,
        userId: access.userId,
        userName: access.user.name,
        action: 'UPDATE',
        entityType: 'SystemRepair',
        entityId: 'owner-roles',
        entityName: `Repaired ${fixedCount} owner role(s). Pooled ${totalHours}h across ${allSubscriptions.length} companies.`,
      })

      return NextResponse.json({
        success: true,
        fixedOwners: fixedCount,
        pooledHours: totalHours,
        pooledSeconds: totalRemaining,
        companiesAffected: allSubscriptions.length,
        message: `Repaired ${fixedCount} owner role(s). Pooled ${totalHours}h across ${allSubscriptions.length} companies.`,
      })
    }

    return NextResponse.json({ error: 'Invalid action. Use: repair-owner-roles' }, { status: 400 })
  } catch (error) {
    console.error('Repair error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
