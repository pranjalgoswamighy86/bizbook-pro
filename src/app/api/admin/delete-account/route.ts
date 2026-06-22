import { NextRequest, NextResponse } from 'next/server'
import { db, rawDb } from '@/lib/db-soft-delete'
import { requireAuth } from '@/lib/api-helpers'

/**
 * SUPER_ADMIN Account Deletion API
 *
 * Special endpoint for the platform owner (admin@bizbook.pro or
 * pranjalgoswamighy86@gmail.com) to permanently delete a user account
 * and all data owned by that user — typically so they can re-register
 * from scratch.
 *
 * SECURITY:
 *   - Only SUPER_ADMIN emails (hardcoded below) can call this endpoint.
 *   - The target email cannot be a SUPER_ADMIN (cannot delete yourself).
 *   - All deletions happen inside a single transaction.
 *   - A full audit log is written BEFORE deletion (so it survives).
 *
 * Actions:
 *   - preview: Show what will be deleted (tenant count, sales, purchases, etc.)
 *   - confirm: Actually perform the deletion
 */

// Hardcoded super admin emails (must match rbac/enforce-v2.ts)
const SUPER_ADMIN_EMAILS = [
  'admin@bizbook.pro',
  'pranjalgoswamighy86@gmail.com',
  (process.env.ADMIN_EMAIL || '').toLowerCase(),
  (process.env.INFRASTRUCTURE_OWNER_EMAIL || '').toLowerCase(),
].filter(Boolean).map(e => e.toLowerCase())

function isSuperAdmin(email: string | undefined | null): boolean {
  if (!email) return false
  return SUPER_ADMIN_EMAILS.includes(email.toLowerCase())
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate the caller
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth
    if (!isSuperAdmin(auth.email)) {
      return NextResponse.json(
        { error: 'Forbidden. Only SUPER_ADMIN can delete accounts.' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const { action, email } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const targetEmail = email.toLowerCase().trim()
    if (!targetEmail || !targetEmail.includes('@')) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }

    // Cannot delete a SUPER_ADMIN account
    if (SUPER_ADMIN_EMAILS.includes(targetEmail)) {
      return NextResponse.json(
        { error: 'Cannot delete a SUPER_ADMIN account.' },
        { status: 400 }
      )
    }

    // 2. Find the target user (use rawDb to also find soft-deleted records —
    //    their email still blocks re-registration due to the @unique constraint)
    const targetUser = await rawDb.user.findFirst({
      where: {
        email: { equals: targetEmail, mode: 'insensitive' },
      },
      include: {
        userTenants: { include: { tenant: true } },
      },
    })

    if (!targetUser) {
      return NextResponse.json(
        { error: `No active user found with email: ${targetEmail}` },
        { status: 404 }
      )
    }

    // 3. Find tenants owned by this user
    const ownedTenants = targetUser.userTenants.filter(ut => ut.isOwner)
    const staffTenants = targetUser.userTenants.filter(ut => !ut.isOwner)

    // ============================================================
    // PREVIEW ACTION
    // ============================================================
    if (action === 'preview') {
      const tenantPreviews: Array<{
        tenantId: string
        tenantName: string
        role: string
        isOwner: boolean
        records: { sales: number; purchases: number; expenses: number; inventory: number; parties: number; payments: number; receipts: number }
      }> = []
      for (const ut of ownedTenants) {
        const [sales, purchases, expenses, inventory, parties, payments, receipts] = await Promise.all([
          rawDb.sale.count({ where: { tenantId: ut.tenantId, isDeleted: false } }),
          rawDb.purchase.count({ where: { tenantId: ut.tenantId, isDeleted: false } }),
          rawDb.expense.count({ where: { tenantId: ut.tenantId, isDeleted: false } }),
          rawDb.inventoryItem.count({ where: { tenantId: ut.tenantId, isDeleted: false } }),
          rawDb.party.count({ where: { tenantId: ut.tenantId, isDeleted: false } }),
          rawDb.payment.count({ where: { tenantId: ut.tenantId, isDeleted: false } }),
          rawDb.receipt.count({ where: { tenantId: ut.tenantId, isDeleted: false } }),
        ])
        tenantPreviews.push({
          tenantId: ut.tenantId,
          tenantName: ut.tenant.name,
          role: ut.role,
          isOwner: ut.isOwner,
          records: { sales, purchases, expenses, inventory, parties, payments, receipts },
        })
      }

      return NextResponse.json({
        targetUser: {
          id: targetUser.id,
          email: targetUser.email,
          name: targetUser.name,
          role: targetUser.role,
          isDeleted: targetUser.isDeleted,
          createdAt: targetUser.createdAt,
        },
        ownedTenants: tenantPreviews,
        staffTenants: staffTenants.map(ut => ({
          tenantId: ut.tenantId,
          tenantName: ut.tenant.name,
          role: ut.role,
        })),
        summary: {
          ownedTenantCount: ownedTenants.length,
          staffTenantCount: staffTenants.length,
          willDeleteUser: true,
          willDeleteOwnedTenants: ownedTenants.length,
          willRemoveStaffLinks: staffTenants.length,
        },
      })
    }

    // ============================================================
    // CONFIRM ACTION — perform the deletion
    // ============================================================
    if (action === 'confirm') {
      const result = await rawDb.$transaction(async (tx) => {
        const deletedTenants: string[] = []
        const removedStaffLinks: string[] = []

        // 1. Write audit log FIRST (before data is gone) — uses the SUPER_ADMIN's tenantId
        await tx.auditLog.create({
          data: {
            tenantId: auth.user.tenantId,
            userId: auth.userId,
            userName: auth.user.name,
            action: 'DELETE',
            entityType: 'User',
            entityId: targetUser.id,
            entityName: targetUser.email,
            changes: JSON.stringify({
              reason: 'SUPER_ADMIN special request — user wants to re-register',
              targetEmail: targetUser.email,
              targetName: targetUser.name,
              ownedTenants: ownedTenants.map(ut => ({ id: ut.tenantId, name: ut.tenant.name })),
              staffTenants: staffTenants.map(ut => ({ id: ut.tenantId, name: ut.tenant.name })),
              requestedBy: auth.email,
            }),
          },
        })

        // 2. Remove staff-tenant links (where user is NOT owner)
        for (const ut of staffTenants) {
          await tx.userTenant.delete({ where: { id: ut.id } })
          removedStaffLinks.push(ut.tenantId)
        }

        // 3. Delete owned tenants — cascades to ALL related data
        //    (sales, purchases, expenses, inventory, parties, debtors, creditors,
        //     payments, receipts, journal entries, accounts, subscriptions, batches,
        //     price lists, bank transactions, staff, audit logs, AND all users
        //     whose primary tenantId points to this tenant)
        for (const ut of ownedTenants) {
          // Also delete OTHER users whose primary tenantId is this tenant
          // (i.e., staff members of the tenant being deleted)
          await tx.user.deleteMany({
            where: { tenantId: ut.tenantId, id: { not: targetUser.id } },
          })

          // Now delete the tenant — cascades everything else
          await tx.tenant.delete({ where: { id: ut.tenantId } })
          deletedTenants.push(ut.tenantId)
        }

        // 4. Finally, delete the target user (if not already cascade-deleted)
        //    This handles the edge case where targetUser had only staff links (no owned tenants)
        try {
          await tx.user.delete({ where: { id: targetUser.id } })
        } catch {
          // Already cascade-deleted via tenant deletion — that's fine
        }

        return { deletedTenants, removedStaffLinks }
      })

      return NextResponse.json({
        success: true,
        message: `Account ${targetEmail} has been permanently deleted.`,
        details: {
          userId: targetUser.id,
          userEmail: targetUser.email,
          userName: targetUser.name,
          deletedTenants: result.deletedTenants,
          removedStaffLinks: result.removedStaffLinks,
        },
      })
    }

    return NextResponse.json(
      { error: 'Invalid action. Use: preview | confirm' },
      { status: 400 }
    )
  } catch (error: any) {
    console.error('Delete account error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
