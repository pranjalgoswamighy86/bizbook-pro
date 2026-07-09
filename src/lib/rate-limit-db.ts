/**
 * v6.22.0: PostgreSQL-Backed Rate Limiter for Login (Prisma client version)
 * ========================================================================
 *
 * ROOT CAUSE of v6.21.0/v6.21.1 outage:
 *   The standalone-bundled Prisma client was generated at BUILD time (before
 *   LoginAttempt was added to the schema). At runtime, db.loginAttempt was
 *   undefined → TypeError → HTTP 500 on every login request.
 *
 * FIX in v6.22.0:
 *   Added "@prisma/client" and ".prisma/client" to serverExternalPackages in
 *   next.config.ts. This tells Next.js NOT to bundle the Prisma client into
 *   the standalone output. Instead, it's loaded from node_modules/ at runtime
 *   — where `prisma generate` (in railway-start.js) has updated it with the
 *   latest schema (including LoginAttempt).
 *
 * ADDITIONAL FAIL-SAFE:
 *   This version includes a table-existence check. If the LoginAttempt table
 *   doesn't exist (e.g., prisma db push failed), the rate limiter gracefully
 *   degrades to allow-all mode and logs a warning. This prevents a repeat of
 *   the v6.21.0 outage where a missing model caused 500 errors.
 *
 * Rate limit configuration (two-dimensional):
 *   Per-email:  5 failed attempts / 15 min → 15-min lockout
 *   Per-IP:     20 failed attempts / 15 min → 15-min lockout
 *   Escalation: 15+ failures in 24h → 1-hour lockout
 */

import { db } from '@/lib/db-soft-delete'

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

  escalationThreshold: 3, // 3 × 5 = 15 failures in 24h
  escalationWindowMs: 24 * 60 * 60 * 1000,
  escalationLockoutMs: 60 * 60 * 1000,
}

export interface LoginRateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
  reason?: 'email' | 'ip' | 'escalation' | 'table-missing'
  remaining?: number
}

// ============================================================
// Table-Existence Cache (checked once per container lifetime)
// ============================================================

let tableExistsCache: boolean | null = null
let tableCheckedAt: number = 0
const TABLE_CHECK_INTERVAL_MS = 5 * 60 * 1000 // re-check every 5 min

/**
 * Check if the LoginAttempt table exists in the database.
 * Cached for 5 minutes to avoid repeated queries.
 * If the table doesn't exist, the rate limiter degrades to allow-all mode.
 */
async function tableExists(): Promise<boolean> {
  const now = Date.now()
  if (tableExistsCache !== null && now - tableCheckedAt < TABLE_CHECK_INTERVAL_MS) {
    return tableExistsCache
  }

  try {
    // Use rawDb to bypass the soft-delete extension (which would try to
    // add isDeleted: false — LoginAttempt doesn't have that column)
    const { rawDb } = await import('@/lib/db-soft-delete')
    const result = await rawDb.$queryRaw`
      SELECT to_regclass('LoginAttempt') as exists
    ` as any[]
    tableExistsCache = result[0]?.exists !== null
    tableCheckedAt = now
    if (!tableExistsCache) {
      console.warn('[RATE-LIMIT-DB] ⚠️ LoginAttempt table does not exist — rate limiter in allow-all mode (fail-safe)')
      console.warn('[RATE-LIMIT-DB] ⚠️ Run `prisma db push` to create the table')
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
// IP Extraction
// ============================================================

export function getClientIP(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const firstIP = xff.split(',')[0].trim()
    if (firstIP) return firstIP
  }
  const xrealip = request.headers.get('x-real-ip')
  if (xrealip) return xrealip.trim()
  return 'unknown'
}

// ============================================================
// Core Rate-Limit Check
// ============================================================

export async function checkLoginRateLimit(
  email: string,
  ip: string
): Promise<LoginRateLimitResult> {
  const normalizedEmail = email.toLowerCase().trim()
  const now = Date.now()

  // Fail-safe 1: if the LoginAttempt table doesn't exist, allow the request
  const exists = await tableExists()
  if (!exists) {
    return {
      allowed: true,
      retryAfterSeconds: 0,
      reason: 'table-missing',
      remaining: LOGIN_CONFIG.maxEmailAttempts - 1,
    }
  }

  try {
    // === Check 1: Escalation lockout (15+ failures in 24h → 1-hour lockout) ===
    const escalationCutoff = new Date(now - LOGIN_CONFIG.escalationWindowMs)
    const escalationCount = await db.loginAttempt.count({
      where: {
        OR: [
          { email: normalizedEmail },
          { ip: ip },
        ],
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
    // Fail-safe 2: if the DB query fails, allow the request
    console.error('[RATE-LIMIT-DB] Check failed (allowing request as fail-safe):', err)
    return {
      allowed: true,
      retryAfterSeconds: 0,
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
  const exists = await tableExists()
  if (!exists) return // fail-safe: don't try to insert if table doesn't exist

  const normalizedEmail = email.toLowerCase().trim()

  try {
    await db.loginAttempt.create({
      data: {
        email: normalizedEmail,
        ip: ip,
        success: success,
      },
    })
  } catch (err) {
    // Non-blocking: if we can't record the attempt, the rate limiter
    // simply won't count it. Better than crashing the login flow.
    console.error('[RATE-LIMIT-DB] Failed to record attempt (non-blocking):', err)
  }
}

export async function clearLoginAttempts(email: string): Promise<void> {
  const exists = await tableExists()
  if (!exists) return

  const normalizedEmail = email.toLowerCase().trim()

  try {
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
    // Check if table exists before attempting cleanup
    const result = await rawDb.$queryRaw`
      SELECT to_regclass('LoginAttempt') as exists
    ` as any[]
    if (!result[0]?.exists) return 0

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
