import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
// ---- SECURITY PATCH v2 imports ----
import { requireAuthAndTenant, requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'
// -----------------------------------
// NOTE: `fs` and `path` imports REMOVED — we no longer leak filesystem paths.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    // ============================================================
    // VALIDATE — check a tenant exists (public-ish, used on login flow)
    // ============================================================
    if (action === 'validate') {
      const { tenantId } = body
      if (!tenantId) {
        return NextResponse.json({ error: 'No tenant ID provided' }, { status: 400 })
      }
      const tenant = await db.tenant.findFirst({ where: { id: tenantId, isDeleted: false } })
      if (!tenant) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
      }
      // Only return minimal info — no sensitive data
      return NextResponse.json({
        valid: true,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          currency: tenant.currency,
          plan: tenant.plan,
        },
      })
    }

    // ============================================================
    // UPDATE — requires auth + MAIN_ADMIN in the target tenant
    // ============================================================
    if (action === 'update') {
      // ---- SECURITY PATCH v2: auth + role check ----
      const access = await requireAuthAndRole(req, body.tenantId || body.id, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // ------------------------------------------------

      const { id, data } = body
      // Ensure the ID being updated matches the authenticated tenant
      if (id !== access.tenantId) {
        return NextResponse.json({ error: 'Cannot update another business' }, { status: 403 })
      }

      // Whitelist allowed fields — don't let callers change plan/planExpires
      // via this endpoint (use update-subscription for that, which is also admin-only)
      const allowedFields = ['name', 'address', 'phone', 'email', 'gstNumber', 'panNumber', 'currency', 'upiId']
      const cleanData: Record<string, unknown> = {}
      for (const field of allowedFields) {
        if (field in data) cleanData[field] = data[field]
      }

      const tenant = await db.tenant.findFirst({ where: { id, isDeleted: false } })
      if (!tenant) {
        return NextResponse.json({ error: 'Tenant not found or has been deleted' }, { status: 404 })
      }

      const updated = await db.tenant.update({ where: { id }, data: cleanData as any })

      await writeAuditLog({
        tenantId: access.tenantId,
        userId: access.userId,
        userName: access.user.name,
        action: 'UPDATE',
        entityType: 'Tenant',
        entityId: id,
        entityName: updated.name,
        changes: cleanData,
      })

      return NextResponse.json({ tenant: updated })
    }

    // ============================================================
    // GET — requires auth + membership in the target tenant
    // ============================================================
    if (action === 'get') {
      // ---- SECURITY PATCH v2: auth + tenant access ----
      const access = await requireAuthAndTenant(req, body.id)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      const tenant = await db.tenant.findFirst({ where: { id, isDeleted: false } })
      if (!tenant) {
        return NextResponse.json({ error: 'Tenant not found or has been deleted' }, { status: 404 })
      }
      return NextResponse.json({ tenant })
    }

    // ============================================================
    // UPDATE-SUBSCRIPTION — SUPER ADMIN ONLY (not just tenant admin)
    // For now, restrict to MAIN_ADMIN of the tenant. In a SaaS deployment,
    // you'd want a platform-level admin role for this.
    // ============================================================
    if (action === 'update-subscription') {
      // ---- SECURITY PATCH v2: auth + role check ----
      const access = await requireAuthAndRole(req, body.tenantId || body.id, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // ------------------------------------------------

      const { id, plan, planExpires } = body
      if (id !== access.tenantId) {
        return NextResponse.json({ error: 'Cannot update another business' }, { status: 403 })
      }

      const existing = await db.tenant.findFirst({ where: { id, isDeleted: false } })
      if (!existing) {
        return NextResponse.json({ error: 'Tenant not found or has been deleted' }, { status: 404 })
      }

      const tenant = await db.tenant.update({
        where: { id },
        data: { plan, planExpires: planExpires ? new Date(planExpires) : null },
      })

      await writeAuditLog({
        tenantId: access.tenantId,
        userId: access.userId,
        userName: access.user.name,
        action: 'UPDATE',
        entityType: 'Tenant',
        entityId: id,
        entityName: tenant.name,
        changes: { plan, planExpires },
      })

      return NextResponse.json({ tenant })
    }

    // ============================================================
    // GET-INFO — SECURITY FIX: dbPath removed from response
    // ============================================================
    if (action === 'get-info') {
      // ---- SECURITY PATCH v2: auth + tenant access ----
      const access = await requireAuthAndTenant(req, body.tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { tenantId } = body
      const tenant = await db.tenant.findFirst({ where: { id: tenantId, isDeleted: false } })
      if (!tenant) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
      }

      // ---- SECURITY FIX (C5): dbPath is NO LONGER returned ----
      // Previously this endpoint leaked the absolute filesystem path
      // of the SQLite database, which could be used for path-traversal
      // or backup-file-download attacks. Removed entirely.
      // ----------------------------------------------------------

      return NextResponse.json({
        createdAt: tenant.createdAt.toISOString(),
        tenantName: tenant.name,
        plan: tenant.plan,
        currency: tenant.currency,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Tenants error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
