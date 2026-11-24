/**
 * v6.29.5: Debug route guard.
 *
 * The /api/debug, /api/debug-env, and /api/debug-smtp routes were previously
 * UNAUTHENTICATED — anyone on the internet could:
 *   - /api/debug        → echo back request headers (cookie recon)
 *   - /api/debug-env     → leak which env vars are set + masked values
 *   - /api/debug-smtp    → send real emails via BizBook's Gmail account (spam/abuse)
 *
 * This guard requires:
 *   1. A valid session token (requireAuth).
 *   2. The authenticated user's email matches a deployment-configured
 *      platform administrator identity (ADMIN_EMAIL or INFRA_OWNER_EMAIL).
 *
 * Returns null if access is granted, or a NextResponse (401/403) to return
 * directly to the client if denied.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from './api-helpers'

export async function requireDebugAccess(req: NextRequest): Promise<null | NextResponse> {
  // 1. Must be authenticated
  const access = await requireAuth(req)
  if (access instanceof NextResponse) return access

  // 2. Must be the configured admin
  const adminEmails = new Set([
    process.env.ADMIN_EMAIL || '',
    process.env.INFRA_OWNER_EMAIL || '',
    process.env.INFRASTRUCTURE_OWNER_EMAIL || '',
  ].map(value => value.toLowerCase().trim()).filter(Boolean))
  const userEmail = (access.user?.email || '').toLowerCase().trim()
  if (!userEmail || !adminEmails.has(userEmail)) {
    return NextResponse.json(
      { error: 'Forbidden. Debug endpoints are restricted to the platform administrator.' },
      { status: 403 }
    )
  }

  return null
}
