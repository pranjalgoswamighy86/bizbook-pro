/**
 * v6.29.6: Cron endpoint secret guard.
 *
 * The cron endpoints (health-monitor, imap-scan, sms-webhook) are invoked by
 * Railway's cron scheduler with a shared secret passed as ?secret=<CRON_SECRET>.
 *
 * Previous bug (health-monitor, imap-scan):
 *   if (expectedSecret && providedSecret !== expectedSecret) { return 401 }
 *
 * This FAILS OPEN: if CRON_SECRET is not set in the environment (operator
 * forgot, env var typo, config drift), expectedSecret is undefined, the
 * `&&` short-circuits, and the entire auth check is bypassed — the endpoint
 * becomes fully unauthenticated. The health-monitor endpoint reads user
 * counts and DB stats; the imap-scan endpoint scans a mailbox and can
 * CREATE SUBSCRIPTIONS (credits AI hours!). An unauthenticated attacker
 * could trigger fake subscription credits by hitting imap-scan with no secret.
 *
 * This guard FAILS CLOSED: if the expected secret is unset, return 500
 * (server misconfiguration) instead of letting the request through.
 * Comparison is constant-time (timingSafeEqual) to prevent secret extraction
 * via timing attacks.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export type CronSecretEnv =
  | 'CRON_SECRET'
  | 'SMS_WEBHOOK_SECRET'

/**
 * Verify the ?secret= query param against the expected env var.
 * Returns null if access is granted, or a NextResponse (401/500) to return.
 *
 * @param req The NextRequest (reads `secret` query param)
 * @param envVar Which env var holds the expected secret. Falls back to
 *               CRON_SECRET if the primary is unset (sms-webhook behavior).
 */
export function verifyCronSecret(
  req: NextRequest,
  envVar: CronSecretEnv = 'CRON_SECRET'
): null | NextResponse {
  const expectedSecret = envVar === 'SMS_WEBHOOK_SECRET'
    ? (process.env.SMS_WEBHOOK_SECRET || process.env.CRON_SECRET)
    : process.env.CRON_SECRET

  if (!expectedSecret) {
    // FAIL CLOSED — server misconfiguration, do not let the request through.
    console.error(`[CRON-GUARD] ${envVar} (and CRON_SECRET fallback) not set — refusing request`)
    return NextResponse.json(
      { error: 'Cron secret not configured on server' },
      { status: 500 }
    )
  }

  const providedSecret = req.nextUrl.searchParams.get('secret') || ''

  // Constant-time comparison to prevent timing-based secret extraction.
  // (Plain `providedSecret !== expectedSecret` leaks length + prefix info.)
  const a = Buffer.from(providedSecret, 'utf-8')
  const b = Buffer.from(expectedSecret, 'utf-8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  return null
}
