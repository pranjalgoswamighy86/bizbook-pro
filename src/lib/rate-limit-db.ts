/**
 * v6.22.1: PostgreSQL-Backed Rate Limiter for Login (lazy-import version)
 * =======================================================================
 *
 * ROOT CAUSE of v6.22.0 staging crash:
 *   Even with serverExternalPackages fix, the static `import { db } from
 *   '@/lib/db-soft-delete'` at the top of this file caused the auth route
 *   module to fail loading entirely. If the Prisma client or db-soft-delete
 *   module has ANY load-time error, the entire /api/auth route becomes
 *   non-functional → HTTP 500 on every request.
 *
 * FIX in v6.22.1:
 *   Use dynamic `await import()` inside each function instead of a static
 *   import at the top. This isolates any Prisma/db errors to the rate-limit
 *   function itself — the auth route module loads successfully regardless.
 *
 *   Combined with the existing try/catch fail-safe, this means:
 *     - If the DB is down → rate limiter returns allowed:true (login proceeds)
 *     - If Prisma client is stale → rate limiter returns allowed:true
 *     - If LoginAttempt table doesn't exist → rate limiter returns allowed:true
 *     - If everything works → rate limiter enforces 5/15min + 20/15min + escalation
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
  reason?: 'email' | 'ip' | 'escalation' | 'table-missing' | 'db-unavailable'
  remaining?: number
}

// ============================================================
// Table-Existence Cache
// ============================================================

let tableExistsCache: boolean | null = null
let tableCheckedAt: number = 0
const TABLE_CHECK_INTERVAL_MS = 5 * 60 * 1000

async function tableExists(): Promise<boolean> {
  const now = Date.now()
  if (tableExistsCache !== null && now - tableCheckedAt < TABLE_CHECK_INTERVAL_MS) {
    return tableExistsCache
  }

  try {
    const { rawDb } = await import('@/lib/db-soft-delete')
    const result = await rawDb.$queryRaw`
      SELECT to_regclass('LoginAttempt') as exists
    ` as any[]
    tableExistsCache = result[0]?.exists !== null
    tableCheckedAt = now
    if (!tableExistsCache) {
      console.warn('[RATE-LIMIT-DB] ⚠️ LoginAttempt table does not exist — rate limiter in allow-all mode')
    }
    return tableExistsCache
  } catch (err) {
    console.error('[RATE-LIMIT-DB] Table existence check failed:', err)
    tableExistsCache = false
    tableCheckedAt = now
    return false
  }
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
// Core Rate-Limit Check (fully fail-safe)
// ============================================================

export async function checkLoginRateLimit(
  email: string,
  ip: string
): Promise<LoginRateLimitResult> {
  const normalizedEmail = (email || '').toLowerCase().trim()
  const now = Date.now()

  try {
    // Dynamic import — if this fails, the error is caught and we return allowed:true
    const { db } = await import('@/lib/db-soft-delete')

    // Check if the LoginAttempt table exists
    const exists = await tableExists()
    if (!exists) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
        reason: 'table-missing',
        remaining: LOGIN_CONFIG.maxEmailAttempts - 1,
      }
    }

    // === Check 1: Escalation lockout ===
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

    // === Check 2: Per-email lockout ===
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

    // === Check 3: Per-IP lockout ===
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
    // FAIL-SAFE: any error → allow the request
    // This is the key difference from v6.22.0 — the entire function body
    // is wrapped in try/catch, including the dynamic import.
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
// Record Attempt + Clear on Success (fully fail-safe)
// ============================================================

export async function recordLoginAttempt(
  email: string,
  ip: string,
  success: boolean
): Promise<void> {
  try {
    const exists = await tableExists()
    if (!exists) return

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
    // Non-blocking
    console.error('[RATE-LIMIT-DB] Failed to record attempt (non-blocking):', err)
  }
}

export async function clearLoginAttempts(email: string): Promise<void> {
  try {
    const exists = await tableExists()
    if (!exists) return

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
    const { rawDb } = await import('@/lib/db-soft-delete')
    const result = await rawDb.$queryRaw`
      SELECT to_regclass('LoginAttempt') as exists
    ` as any[]
    if (!result[0]?.exists) return 0

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
