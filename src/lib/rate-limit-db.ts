/**
 * v6.22.3: PostgreSQL-Backed Rate Limiter for Login (simplified, fail-safe)
 * =======================================================================
 *
 * ROOT CAUSE of v6.22.2 fail-safe mode (rate limiter not triggering):
 *   The tableExists() function used rawDb.$queryRaw, which tries to use
 *   the WASM query engine. But postbuild.js REMOVES the PostgreSQL WASM
 *   engine files to save space (keeps only the native binary). So
 *   tableExists() failed → returned false → rate limiter stayed in
 *   allow-all mode.
 *
 *   The existing auth route code works because it uses the Prisma client's
 *   standard query methods (findFirst, etc.) which use the NATIVE binary
 *   engine, not the WASM engine.
 *
 * FIX in v6.22.3:
 *   Remove the tableExists() check entirely. Just call db.loginAttempt.count()
 *   directly and let any errors be caught by the try/catch. If the table
 *   doesn't exist, Prisma will throw a P2021 error ("table does not exist")
 *   which is caught and handled gracefully.
 *
 *   This is simpler, more reliable, and uses the same code path as the
 *   existing auth route (native binary engine, not WASM).
 *
 * Rate limit configuration:
 *   Per-email:  5 failed attempts / 15 min → 15-min lockout
 *   Per-IP:     20 failed attempts / 15 min → 15-min lockout
 *   Escalation: 15+ failures in 24h → 1-hour lockout
 */

// ============================================================
// Configuration
// ============================================================

const LOGIN_CONFIG = {
  maxEmailAttempts: 5,
  emailWindowMs: 15 * 60 * 1000,
  emailLockoutMs: 15 * 60 * 1000,

  maxIpAttempts: 20,
  ipWindowMs: 15 * 60 * 1000,
  ipLockoutMs: 15 * 60 * 1000,

  escalationThreshold: 3,
  escalationWindowMs: 24 * 60 * 60 * 1000,
  escalationLockoutMs: 60 * 60 * 1000,
}

export interface LoginRateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
  reason?: 'email' | 'ip' | 'escalation' | 'db-unavailable'
  remaining?: number
}

// ============================================================
// IP Extraction (synchronous, no DB)
// ============================================================

export function getClientIP(request: Request): string {
  try {
    const xff = request.headers.get('x-forwarded-for')
    if (xff) {
      const firstIP = xff.split(',')[0].trim()
      if (firstIP) return firstIP
    }
    const xrealip = request.headers.get('x-real-ip')
    if (xrealip) return xrealip.trim()
  } catch (e) {
    // ignore — return 'unknown'
  }
  return 'unknown'
}

// ============================================================
// Core Rate-Limit Check (simplified — no tableExists check)
// ============================================================

export async function checkLoginRateLimit(
  email: string,
  ip: string
): Promise<LoginRateLimitResult> {
  const normalizedEmail = (email || '').toLowerCase().trim()
  const now = Date.now()

  try {
    // Dynamic import — if this fails, caught by try/catch
    const { db } = await import('@/lib/db-soft-delete')

    // === Check 1: Escalation lockout (15+ failures in 24h → 1-hour lockout) ===
    const escalationCutoff = new Date(now - LOGIN_CONFIG.escalationWindowMs)
    const escalationCount = await db.loginAttempt.count({
      where: {
        OR: [{ email: normalizedEmail }, { ip: ip }],
        success: false,
        attemptedAt: { gte: escalationCutoff },
      },
    })

    if (escalationCount >= LOGIN_CONFIG.maxEmailAttempts * LOGIN_CONFIG.escalationThreshold) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(LOGIN_CONFIG.escalationLockoutMs / 1000),
        reason: 'escalation',
      }
    }

    // === Check 2: Per-email lockout (5 failed in 15 min) ===
    const emailCutoff = new Date(now - LOGIN_CONFIG.emailWindowMs)
    const emailFailCount = await db.loginAttempt.count({
      where: {
        email: normalizedEmail,
        success: false,
        attemptedAt: { gte: emailCutoff },
      },
    })

    if (emailFailCount >= LOGIN_CONFIG.maxEmailAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(LOGIN_CONFIG.emailLockoutMs / 1000),
        reason: 'email',
        remaining: 0,
      }
    }

    // === Check 3: Per-IP lockout (20 failed in 15 min) ===
    if (ip !== 'unknown') {
      const ipCutoff = new Date(now - LOGIN_CONFIG.ipWindowMs)
      const ipFailCount = await db.loginAttempt.count({
        where: {
          ip: ip,
          success: false,
          attemptedAt: { gte: ipCutoff },
        },
      })

      if (ipFailCount >= LOGIN_CONFIG.maxIpAttempts) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(LOGIN_CONFIG.ipLockoutMs / 1000),
          reason: 'ip',
          remaining: 0,
        }
      }
    }

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: LOGIN_CONFIG.maxEmailAttempts - emailFailCount - 1,
    }
  } catch (err) {
    // FAIL-SAFE: any error (table missing, DB down, Prisma client stale) → allow
    console.error('[RATE-LIMIT-DB] Check failed (allowing request as fail-safe):', err)
    return {
      allowed: true,
      retryAfterSeconds: 0,
      reason: 'db-unavailable',
      remaining: LOGIN_CONFIG.maxEmailAttempts - 1,
    }
  }
}

// ============================================================
// Record Attempt + Clear on Success
// ============================================================

export async function recordLoginAttempt(
  email: string,
  ip: string,
  success: boolean
): Promise<void> {
  try {
    const { db } = await import('@/lib/db-soft-delete')
    const normalizedEmail = (email || '').toLowerCase().trim()

    await db.loginAttempt.create({
      data: {
        email: normalizedEmail,
        ip: ip,
        success: success,
      },
    })
  } catch (err) {
    // Non-blocking — if we can't record, the rate limiter just won't count this attempt
    console.error('[RATE-LIMIT-DB] Failed to record attempt (non-blocking):', err)
  }
}

export async function clearLoginAttempts(email: string): Promise<void> {
  try {
    const { db } = await import('@/lib/db-soft-delete')
    const normalizedEmail = (email || '').toLowerCase().trim()

    await db.loginAttempt.deleteMany({
      where: { email: normalizedEmail },
    })
  } catch (err) {
    console.error('[RATE-LIMIT-DB] Failed to clear attempts (non-blocking):', err)
  }
}

// ============================================================
// Daily Cleanup (called from railway-start.js on startup)
// ============================================================

export async function cleanupOldLoginAttempts(): Promise<number> {
  try {
    const { db } = await import('@/lib/db-soft-delete')
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const deleteResult = await db.loginAttempt.deleteMany({
      where: { attemptedAt: { lt: cutoff } },
    })
    return deleteResult.count
  } catch (err) {
    console.error('[RATE-LIMIT-DB] Cleanup failed (non-blocking):', err)
    return 0
  }
}
