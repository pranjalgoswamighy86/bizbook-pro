/**
 * BizBook Pro — 5-Tier RBAC Enforcement (v2)
 * ------------------------------------------
 * UPGRADE FROM v1: Adds SUPER_ADMIN tier above MAIN_ADMIN
 *
 * Hierarchy (per Spec Part 1):
 *   Tier 0: SUPER_ADMIN              — admin@bizbook.pro (system owner)
 *   Tier 1: INFRASTRUCTURE_OWNER     — PRANJALGOSWAMIGHY86@GMAIL.COM (external owner)
 *   Tier 2: MAIN_ADMIN / TENANT      — Business owner (full control within tenant)
 *   Tier 3: JUNIOR_ADMIN             — Sub-user (data mutation: edit/delete)
 *   Tier 4: DATA_ENTRY               — Sub-user (create only)
 *   Tier 5: VIEWER                   — Sub-user (read only)
 *
 * SPECIAL BYPASS (Rule 1.1):
 *   - SUPER_ADMIN bypasses ALL uniqueness checks (mobile can map to infinite tenants)
 *   - SUPER_ADMIN can access ANY tenant's data
 *   - SUPER_ADMIN NEVER needs OTP (per Task 29)
 *
 * SPECIAL BYPASS (Part 9):
 *   - INFRASTRUCTURE_OWNER_ADMIN accesses deployment logs, GitHub webhooks, backup toggles
 *   - Routes via /admin/* paths only — does NOT access tenant business data
 *
 * PLACE AT: lib/rbac/enforce.ts (REPLACES v1)
 */

import { NextRequest, NextResponse } from 'next/server';

// ---------- Types ----------
export type Role =
  | 'SUPER_ADMIN'
  | 'INFRASTRUCTURE_OWNER_ADMIN'
  | 'MAIN_ADMIN'
  | 'JUNIOR_ADMIN'
  | 'DATA_ENTRY'
  | 'VIEW_ONLY';

export type Action = 'read' | 'create' | 'update' | 'delete' | 'manage_users' | 'settings' | 'system_admin';

export interface PermissionResult {
  ok: boolean;
  response?: NextResponse;
  user?: any;
  tenantId?: string;
  role?: Role;
  isSuperAdmin?: boolean;
}

// ---------- Role Hierarchy ----------
const ROLE_LEVEL: Record<Role, number> = {
  SUPER_ADMIN: 100,
  INFRASTRUCTURE_OWNER_ADMIN: 90,
  MAIN_ADMIN: 4,
  JUNIOR_ADMIN: 3,
  DATA_ENTRY: 2,
  VIEW_ONLY: 1,
};

// ---------- Permission Matrix ----------
// Rows = roles, Columns = actions
const PERMISSION_MATRIX: Record<Role, Record<Action, boolean>> = {
  // SUPER_ADMIN: can do EVERYTHING (Rule 1.1 bypass)
  SUPER_ADMIN: {
    read: true, create: true, update: true, delete: true,
    manage_users: true, settings: true, system_admin: true,
  },
  // INFRASTRUCTURE_OWNER: system_admin only (no tenant data access)
  INFRASTRUCTURE_OWNER_ADMIN: {
    read: false, create: false, update: false, delete: false,
    manage_users: false, settings: false, system_admin: true,
  },
  // MAIN_ADMIN: full control within tenant
  MAIN_ADMIN: {
    read: true, create: true, update: true, delete: true,
    manage_users: true, settings: true, system_admin: false,
  },
  // JUNIOR_ADMIN: data mutation (edit/delete wrong entries)
  JUNIOR_ADMIN: {
    read: true, create: true, update: true, delete: true,
    manage_users: false, settings: false, system_admin: false,
  },
  // DATA_ENTRY: create only
  DATA_ENTRY: {
    read: true, create: true, update: false, delete: false,
    manage_users: false, settings: false, system_admin: false,
  },
  // VIEWER: read only
  VIEW_ONLY: {
    read: true, create: false, update: false, delete: false,
    manage_users: false, settings: false, system_admin: false,
  },
};

// ---------- Tier identification ----------
// SUPER_ADMIN: matched by email — both admin@bizbook.pro and pranjalgoswamighy86@gmail.com
const SUPER_ADMIN_EMAILS = [
  'admin@bizbook.pro',
  'pranjalgoswamighy86@gmail.com',
  (process.env.ADMIN_EMAIL || '').toLowerCase(),
  (process.env.INFRASTRUCTURE_OWNER_EMAIL || '').toLowerCase(),
].filter(Boolean);

// INFRASTRUCTURE_OWNER: matched by email — same as SUPER_ADMIN (both have full bypass)
const INFRA_OWNER_EMAILS = [
  'pranjalgoswamighy86@gmail.com',
  'admin@bizbook.pro',
  (process.env.INFRASTRUCTURE_OWNER_EMAIL || '').toLowerCase(),
  (process.env.ADMIN_EMAIL || '').toLowerCase(),
].filter(Boolean);

// ---------- Main permission checker ----------
export async function requirePermission(
  req: NextRequest,
  resource: string,
  action: Action
): Promise<PermissionResult> {
  // 1. Auth check (use your existing auth helper)
  let user: any;
  try {
    const { requireAuth } = await import('@/lib/auth');
    user = await requireAuth(req);
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      ),
    };
  }

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      ),
    };
  }

  // ---------- 2. SUPER_ADMIN bypass ----------
  if (user.email && SUPER_ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return {
      ok: true,
      user,
      tenantId: req.headers.get('x-tenant-id') || user.activeTenantId || 'GLOBAL',
      role: 'SUPER_ADMIN',
      isSuperAdmin: true,
    };
  }

  // ---------- 3. INFRASTRUCTURE_OWNER_ADMIN ----------
  if (user.email && INFRA_OWNER_EMAILS.includes(user.email.toLowerCase())) {
    // Can ONLY access system_admin actions (not tenant data)
    if (action !== 'system_admin') {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: 'FORBIDDEN',
            message: 'Infrastructure Owner can only access system administration endpoints, not tenant data',
          },
          { status: 403 }
        ),
      };
    }
    return {
      ok: true,
      user,
      tenantId: 'SYSTEM',
      role: 'INFRASTRUCTURE_OWNER_ADMIN',
      isSuperAdmin: false,
    };
  }

  // ---------- 4. Standard user: resolve tenant + role ----------
  const tenantId =
    req.headers.get('x-tenant-id') ||
    req.nextUrl.searchParams.get('tenantId') ||
    user.activeTenantId;

  if (!tenantId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'NO_TENANT', message: 'No active tenant selected' },
        { status: 400 }
      ),
    };
  }

  // Load UserTenant to get role
  const { prisma } = await import('@/lib/db');
  const userTenant = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    select: { role: true, isOwner: true },
  });

  if (!userTenant) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'FORBIDDEN', message: 'No access to this tenant' },
        { status: 403 }
      ),
    };
  }

  // Owner of tenant = always MAIN_ADMIN
  const effectiveRole: Role = userTenant.isOwner
    ? 'MAIN_ADMIN'
    : (userTenant.role as Role);

  // ---------- 5. Check permission matrix ----------
  const allowed = PERMISSION_MATRIX[effectiveRole]?.[action] ?? false;
  if (!allowed) {
    // Log denied attempt using existing AuditLog schema
    try {
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          tenantId,
          action: `DENIED:${action}:${resource}`,
          entityType: resource.toUpperCase(),
          entityId: user.id,
          entityName: user.email || user.name || 'unknown',
          changes: JSON.stringify({
            role: effectiveRole,
            attemptedAction: action,
            resource,
            timestamp: new Date().toISOString(),
          }),
        },
      });
    } catch {}

    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: `Your role (${effectiveRole}) cannot ${action} ${resource}`,
          requiredRole: getMinimumRoleForAction(action),
          yourRole: effectiveRole,
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    user,
    tenantId,
    role: effectiveRole,
    isSuperAdmin: false,
  };
}

// ---------- Helper: minimum role for an action ----------
export function getMinimumRoleForAction(action: Action): Role {
  switch (action) {
    case 'read': return 'VIEW_ONLY';
    case 'create': return 'DATA_ENTRY';
    case 'update':
    case 'delete': return 'JUNIOR_ADMIN';
    case 'manage_users':
    case 'settings': return 'MAIN_ADMIN';
    case 'system_admin': return 'INFRASTRUCTURE_OWNER_ADMIN';
  }
}

// ---------- Client-side helper ----------
export function canPerform(role: Role | undefined, action: Action): boolean {
  if (!role) return false;
  return PERMISSION_MATRIX[role]?.[action] ?? false;
}

// ---------- Super Admin check (for UI + bypass logic) ----------
export function isSuperAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}

export function isInfrastructureOwnerEmail(email: string | undefined): boolean {
  if (!email) return false;
  return INFRA_OWNER_EMAILS.includes(email.toLowerCase());
}

// ---------- Master Mobile bypass (Rule 1.1) ----------
// Super Admin's mobile (9101555075) can be associated with infinite tenant/user IDs
// This bypasses the standard Rule 1.2 uniqueness check
export function isMasterMobile(mobile: string): boolean {
  const masterMobile = process.env.MASTER_MOBILE_NUMBER || '9101555075';
  const normalized = mobile.replace(/\D/g, '');
  const normalizedMaster = masterMobile.replace(/\D/g, '');
  return normalized === normalizedMaster;
}

/*
 * ============================================================================
 * USAGE EXAMPLES
 * ============================================================================
 *
 * --- Standard tenant route (e.g., /api/sales) ---
 *
 *   export async function POST(req: NextRequest) {
 *     const perm = await requirePermission(req, 'sale', 'create');
 *     if (!perm.ok) return perm.response!;
 *     // Only DATA_ENTRY+ reach here (within their tenant)
 *     // perm.tenantId is guaranteed scoped
 *   }
 *
 * --- Super Admin system route (e.g., /api/admin/*) ---
 *
 *   export async function GET(req: NextRequest) {
 *     const perm = await requirePermission(req, 'system', 'system_admin');
 *     if (!perm.ok) return perm.response!;
 *     // Only SUPER_ADMIN + INFRASTRUCTURE_OWNER reach here
 *     // perm.isSuperAdmin distinguishes the two
 *   }
 *
 * --- Registration uniqueness check (Rule 1.1 bypass) ---
 *
 *   // In /api/auth/register:
 *   if (isMasterMobile(req.body.mobile)) {
 *     // Super Admin's mobile — skip uniqueness check
 *     // Allow registration even if mobile exists in other tenants
 *   } else {
 *     // Standard user — enforce Rule 1.2 uniqueness
 *     const existing = await db.tenant.findFirst({ where: { mobile: req.body.mobile } });
 *     if (existing) return res.status(409).json({ error: 'DUPLICATE_REGISTRATION' });
 *   }
 *
 * ============================================================================
 * PRISMA SCHEMA ADDITIONS (if not already added)
 * ============================================================================
 *
 *   model AuditLog {
 *     id        String   @id @default(cuid())
 *     userId    String
 *     tenantId  String
 *     action    String
 *     details   String
 *     timestamp DateTime @default(now())
 *
 *     user   User   @relation(fields: [userId], references: [id])
 *     tenant Tenant @relation(fields: [tenantId], references: [id])
 *
 *     @@index([tenantId, timestamp])
 *     @@index([userId, timestamp])
 *   }
 *
 *   // Add to User model:
 *   model User {
 *     ...
 *     role Role @default("VIEW_ONLY")  // Top-level role for non-tenant contexts
 *     ...
 *   }
 *
 *   enum Role {
 *     SUPER_ADMIN
 *     INFRASTRUCTURE_OWNER_ADMIN
 *     MAIN_ADMIN
 *     JUNIOR_ADMIN
 *     DATA_ENTRY
 *     VIEW_ONLY
 *   }
 * ============================================================================
 */
