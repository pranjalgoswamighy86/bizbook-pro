/**
 * Workspace Resolver — Rule 2.2 Implementation
 * --------------------------------------------
 * When user submits credentials, query user mapping tables.
 * If credential intersects multiple active workspace records →
 * halt routing flow → prompt Login Profile Resolution state.
 *
 * PLACE AT: lib/auth/workspace-resolver.ts
 */

import { prisma } from '@/lib/db';

// ---------- Types ----------
export interface ResolvedWorkspace {
  tenantId: string;
  tenantName: string;
  role: 'MAIN_ADMIN' | 'JUNIOR_ADMIN' | 'DATA_ENTRY' | 'VIEW_ONLY';
  isOwner: boolean;
  isOwnTenant: boolean;  // true if user is the owner/Main Admin of this tenant
}

export interface WorkspaceResolutionResult {
  needsSelection: boolean;
  workspaces: ResolvedWorkspace[];
  ownTenant?: ResolvedWorkspace;  // User's own Main Admin tenant (if exists)
  connectedStaffTenants: ResolvedWorkspace[];  // Tenants where user is sub-user
}

// ---------- Main resolver ----------
export async function resolveUserWorkspaces(
  identifier: string
): Promise<WorkspaceResolutionResult> {
  const normalizedId = identifier.trim().toLowerCase();

  // Find user by email (User table only has email, not mobile — mobile lives on Tenant)
  const user = await prisma.user.findFirst({
    where: {
      email: { equals: normalizedId, mode: 'insensitive' },
      isDeleted: false,
    },
    select: { id: true, email: true, name: true },
  });

  // Also try tenant phone/email lookup if email didn't match
  if (!user) {
    const tenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { phone: normalizedId },
          { email: { equals: normalizedId, mode: 'insensitive' } },
        ],
        isDeleted: false,
      },
      select: { id: true, name: true, phone: true, email: true },
    });
    if (tenant) {
      // Find any user belonging to this tenant
      const tenantUser = await prisma.user.findFirst({
        where: { tenantId: tenant.id, isDeleted: false },
        select: { id: true, email: true, name: true },
      });
      if (tenantUser) {
        return resolveWorkspacesForUser(tenantUser);
      }
    }
  }

  if (!user) {
    return {
      needsSelection: false,
      workspaces: [],
      connectedStaffTenants: [],
    };
  }

  return resolveWorkspacesForUser(user);
}

// Internal helper — given a user, load all their workspaces
async function resolveWorkspacesForUser(user: { id: string; email: string; name: string }): Promise<WorkspaceResolutionResult> {

  // Load all UserTenant mappings
  const userTenants = await prisma.userTenant.findMany({
    where: { userId: user.id },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          isDeleted: true,
        },
      },
    },
  });

  // Filter out soft-deleted tenants
  const activeTenants = userTenants.filter(ut => !ut.tenant.isDeleted);

  // Categorize: own tenant (Main Admin) vs connected staff
  const workspaces: ResolvedWorkspace[] = activeTenants.map(ut => ({
    tenantId: ut.tenant.id,
    tenantName: ut.tenant.name,
    role: ut.role as ResolvedWorkspace['role'],
    isOwner: ut.isOwner,
    isOwnTenant: ut.role === 'MAIN_ADMIN' && ut.isOwner,
  }));

  const ownTenant = workspaces.find(w => w.isOwnTenant);
  const connectedStaffTenants = workspaces.filter(w => !w.isOwnTenant);

  // Rule 2.2: If user has 2+ active workspaces, force selection
  const needsSelection = workspaces.length > 1;

  return {
    needsSelection,
    workspaces,
    ownTenant,
    connectedStaffTenants,
  };
}

// ---------- JWT token generator ----------
// Issues tenant_id + role-scoped token after user selects workspace
export function generateWorkspaceScopedToken(
  userId: string,
  userEmail: string,
  selectedWorkspace: ResolvedWorkspace
): string {
  const crypto = require('crypto');
  const secret = process.env.SESSION_SECRET || 'fallback-dev-secret-change-me';

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    email: userEmail,
    tenant_id: selectedWorkspace.tenantId,
    tenant_name: selectedWorkspace.tenantName,
    role: selectedWorkspace.role,
    is_owner: selectedWorkspace.isOwner,
    is_own_tenant: selectedWorkspace.isOwnTenant,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/*
 * ============================================================================
 * INTEGRATION WITH EXISTING AUTH FLOW
 * ============================================================================
 *
 * In your /api/auth/route.ts POST handler (action: 'login'):
 *
 *   // AFTER password validation succeeds:
 *   const resolution = await resolveUserWorkspaces(user.email);
 *
 *   if (resolution.needsSelection) {
 *     // Rule 2.2: Halt routing, return workspaces for frontend to show modal
 *     return NextResponse.json({
 *       status: 'WORKSPACE_SELECTION_REQUIRED',
 *       user: { id: user.id, email: user.email, name: user.name },
 *       workspaces: resolution.workspaces,
 *       ownTenant: resolution.ownTenant,
 *       connectedStaffTenants: resolution.connectedStaffTenants,
 *       // NO token issued yet — user must select first
 *     });
 *   }
 *
 *   // Single workspace → log in directly
 *   const single = resolution.workspaces[0];
 *   const token = generateWorkspaceScopedToken(user.id, user.email, single);
 *   return NextResponse.json({
 *     status: 'LOGGED_IN',
 *     user, token, workspace: single,
 *   });
 *
 * ============================================================================
 * NEW API ROUTE: /api/auth/select-workspace
 * ============================================================================
 *
 *   // After user clicks a workspace button in the modal:
 *   export async function POST(req: NextRequest) {
 *     const { userId, tenantId } = await req.json();
 *     const resolution = await resolveUserWorkspaces(userEmail);  // pass user's email
 *     const selected = resolution.workspaces.find(w => w.tenantId === tenantId);
 *     if (!selected) return NextResponse.json({ error: 'INVALID_WORKSPACE' }, { status: 400 });
 *     const token = generateWorkspaceScopedToken(userId, userEmail, selected);
 *     return NextResponse.json({ status: 'LOGGED_IN', token, workspace: selected });
 *   }
 * ============================================================================
 */
