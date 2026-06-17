/**
 * BizBook Pro — API Authorization Helpers (Security Patch v1)
 *
 * Fixes:
 *   C2 — requireAuth() enforces a valid session on every API route
 *   C3 — requireTenantAccess() enforces user-tenant membership (IDOR fix)
 *
 * Usage in any API route:
 *
 *   export async function POST(req: NextRequest) {
 *     const auth = await requireAuth(req)
 *     if (auth instanceof NextResponse) return auth        // 401
 *
 *     const body = await req.json()
 *     const access = await requireTenantAccess(auth.userId, body.tenantId)
 *     if (access instanceof NextResponse) return access    // 403
 *
 *     // auth.user            — the authenticated User row
 *     // access.userTenant    — the UserTenant row (has role, isOwner)
 *     // access.role          — convenience: access.userTenant.role
 *
 *     // ...route logic...
 *   }
 *
 * For role-restricted routes (e.g. settings, audit log):
 *
 *     const access = await requireTenantRole(auth.userId, body.tenantId, ['MAIN_ADMIN'])
 *     if (access instanceof NextResponse) return access
 *
 * All helpers return either the data you need OR a NextResponse that the
 * route should return immediately. This pattern keeps route code clean.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import {
  verifySessionToken,
  getSessionTokenFromRequest,
} from '@/lib/auth'

// ============================================================
// Types
// ============================================================

export interface AuthResult {
  userId: string
  email: string
  user: {
    id: string
    email: string
    name: string
    role: string
    tenantId: string
    isActive: boolean
    isDeleted: boolean
  }
}

export interface TenantAccessResult extends AuthResult {
  tenantId: string
  role: string
  isOwner: boolean
  userTenant: {
    id: string
    userId: string
    tenantId: string
    role: string
    isOwner: boolean
  }
}

// ============================================================
// requireAuth — verifies the session cookie OR Bearer token
// ============================================================

/**
 * Verify the request has a valid session.
 *
 * Checks TWO sources for the session token (in order):
 *   1. `bizbook_session` cookie (preferred — works for normal browser flows)
 *   2. `Authorization: Bearer <token>` header (fallback — works in cross-site
 *      iframes where SameSite cookies are blocked)
 *
 * The Bearer token fallback is essential for the platform's preview panel,
 * which embeds the app in an iframe at preview-chat-{id}.space-z.ai.
 * In that cross-site iframe context, browsers may block SameSite cookies
 * on fetch/XHR requests even though the login cookie was set successfully.
 *
 * Returns:
 *   - AuthResult (with user row from DB) on success
 *   - NextResponse (401) on missing/invalid/expired session
 *     OR if the user has been deactivated / soft-deleted
 */
export async function requireAuth(req: NextRequest): Promise<AuthResult | NextResponse> {
  // Try cookie first
  let token = getSessionTokenFromRequest(req)

  // Fallback: check Authorization: Bearer header
  if (!token) {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim()
    }
  }

  if (!token) {
    return NextResponse.json(
      { error: 'Authentication required. Please log in.' },
      { status: 401 }
    )
  }

  const payload = verifySessionToken(token)
  if (!payload) {
    return NextResponse.json(
      { error: 'Session expired or invalid. Please log in again.' },
      { status: 401 }
    )
  }

  // Re-fetch the user from DB to check isActive / isDeleted
  // (the session token is stateless, but the user's account state can change)
  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
      isActive: true,
      isDeleted: true,
    },
  })

  if (!user || user.isDeleted) {
    return NextResponse.json(
      { error: 'Account not found. Please log in again.' },
      { status: 401 }
    )
  }

  if (!user.isActive) {
    return NextResponse.json(
      { error: 'Account is deactivated. Contact your administrator.' },
      { status: 403 }
    )
  }

  return {
    userId: user.id,
    email: user.email,
    user,
  }
}

// ============================================================
// requireTenantAccess — verifies user has access to tenantId
// ============================================================

/**
 * Verify the authenticated user has access to the requested tenant.
 *
 * Returns:
 *   - TenantAccessResult (extends AuthResult with role info) on success
 *   - NextResponse (400) if tenantId is missing
 *   - NextResponse (401) if not authenticated
 *   - NextResponse (403) if user does not belong to this tenant
 *     OR tenant has been soft-deleted
 */
export async function requireTenantAccess(
  userId: string,
  tenantId: string | undefined
): Promise<TenantAccessResult | NextResponse> {
  if (!tenantId) {
    return NextResponse.json(
      { error: 'No business selected. Please refresh the page and log in again.' },
      { status: 400 }
    )
  }

  // Single query: get the UserTenant row + tenant in one shot.
  // Checks BOTH that the user belongs to this tenant AND that the tenant isn't soft-deleted.
  const userTenant = await db.userTenant.findFirst({
    where: {
      userId,
      tenantId,
      tenant: { isDeleted: false },
    },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          isDeleted: true,
        },
      },
    },
  })

  if (!userTenant) {
    return NextResponse.json(
      { error: 'You do not have access to this business. Please switch companies or log in again.' },
      { status: 403 }
    )
  }

  return {
    userId,
    email: '', // populated by caller via requireAuth
    user: {} as AuthResult['user'], // populated by caller
    tenantId,
    role: userTenant.role,
    isOwner: userTenant.isOwner,
    userTenant: {
      id: userTenant.id,
      userId: userTenant.userId,
      tenantId: userTenant.tenantId,
      role: userTenant.role,
      isOwner: userTenant.isOwner,
    },
  }
}

// ============================================================
// requireTenantRole — verifies user has a specific role in the tenant
// ============================================================

/**
 * Verify the authenticated user has one of the allowed roles in the tenant.
 *
 * Example: restrict settings/audit-log/backup to MAIN_ADMIN only.
 *
 *   const access = await requireTenantRole(
 *     auth.userId, body.tenantId, ['MAIN_ADMIN']
 *   )
 *   if (access instanceof NextResponse) return access
 */
export async function requireTenantRole(
  userId: string,
  tenantId: string | undefined,
  allowedRoles: string[]
): Promise<TenantAccessResult | NextResponse> {
  const access = await requireTenantAccess(userId, tenantId)
  if (access instanceof NextResponse) return access

  if (!allowedRoles.includes(access.role)) {
    return NextResponse.json(
      { error: `This action requires one of: ${allowedRoles.join(', ')}. Your role: ${access.role}` },
      { status: 403 }
    )
  }

  return access
}

// ============================================================
// Convenience: full auth + tenant check in one call
// ============================================================

/**
 * All-in-one helper that does both auth and tenant access check.
 * Use this at the top of every business route:
 *
 *   const ctx = await requireAuthAndTenant(req, body.tenantId)
 *   if (ctx instanceof NextResponse) return ctx
 *   // ctx.user, ctx.tenantId, ctx.role, ctx.isOwner are all set
 */
export async function requireAuthAndTenant(
  req: NextRequest,
  tenantId: string | undefined
): Promise<TenantAccessResult | NextResponse> {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  const access = await requireTenantAccess(auth.userId, tenantId)
  if (access instanceof NextResponse) return access

  // Merge the user info from auth into the access result
  return {
    ...access,
    email: auth.email,
    user: auth.user,
  }
}

/**
 * All-in-one helper with role restriction:
 *
 *   const ctx = await requireAuthAndRole(req, body.tenantId, ['MAIN_ADMIN'])
 *   if (ctx instanceof NextResponse) return ctx
 */
export async function requireAuthAndRole(
  req: NextRequest,
  tenantId: string | undefined,
  allowedRoles: string[]
): Promise<TenantAccessResult | NextResponse> {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  const access = await requireTenantRole(auth.userId, tenantId, allowedRoles)
  if (access instanceof NextResponse) return access

  return {
    ...access,
    email: auth.email,
    user: auth.user,
  }
}

// ============================================================
// Audit logging helper — call after every write operation
// ============================================================

/**
 * Write an audit log entry. Best called inside the same `db.$transaction`
 * as the business operation so it commits/rolls back atomically.
 */
export async function writeAuditLog(params: {
  tenantId: string
  userId: string
  userName?: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  entityType: string
  entityId?: string
  entityName?: string
  changes?: Record<string, unknown>
  ipAddress?: string
}) {
  await db.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      userName: params.userName || null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId || null,
      entityName: params.entityName || null,
      changes: params.changes ? JSON.stringify(params.changes) : null,
      ipAddress: params.ipAddress || null,
    },
  })
}
