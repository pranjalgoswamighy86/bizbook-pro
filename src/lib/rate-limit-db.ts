/**
 * v6.21.1 HOTFIX: PostgreSQL-Backed Rate Limiter for Login (raw SQL version)
 * ====================================================================
 *
 * The v6.21.0 version used db.loginAttempt.count() / .create() / .deleteMany()
 * via the Prisma client. This caused HTTP 500 errors in production because the
 * standalone-bundled Prisma client was generated at BUILD time (before the
 * LoginAttempt model was added to the schema), and the runtime prisma generate
 * in railway-start.js doesn't update the bundled client.
 *
 * This hotfix uses raw SQL queries via rawDb.$queryRaw and rawDb.$executeRaw
 * — the same pattern the auth route already uses for user lookups. This bypasses
 * the Prisma client model registry entirely and goes straight to PostgreSQL.
 *
 * The table is created by `prisma db push` in railway-start.js on container
 * startup, which DOES pick up the new LoginAttempt model from schema.prisma.
 */

import { rawDb } from '@/lib/db-soft-delete'

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
  reason?: 'email' | 'ip' | 'escalation'
  remaining?: number
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
// Core Rate-Limit Check (raw SQL)
// ============================================================

export async function checkLoginRateLimit(
  email: string,
  ip: string
): Promise<LoginRateLimitResult> {
  const normalizedEmail = email.toLowerCase().trim()
  const now = Date.now()

  try {
    // === Check 1: Escalation lockout (15+ failures in 24h → 1-hour lockout) ===
    const escalationCutoff = new Date(now - LOGIN_CONFIG.escalationWindowMs)
    const escalationRows = await rawDb.$queryRaw`
      SELECT COUNT(*)::int as count FROM "LoginAttempt"
      WHERE success = false
        AND attemptedAt >= ${escalationCutoff}
        AND (email = ${normalizedEmail} OR ip = ${ip})
    ` as any[]
    const escalationCount = escalationRows[0]?.count || 0

    if (escalationCount >= LOGIN_CONFIG.maxEmailAttempts * LOGIN_CONFIG.escalationThreshold) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(LOGIN_CONFIG.escalationLockoutMs / 1000),
        reason: 'escalation',
      }
    }

    // === Check 2: Per-email lockout (5 failed in 15 min) ===
    const emailCutoff = new Date(now - LOGIN_CONFIG.emailWindowMs)
    const emailRows = await rawDb.$queryRaw`
      SELECT COUNT(*)::int as count FROM "LoginAttempt"
      WHERE email = ${normalizedEmail}
        AND success = false
        AND attemptedAt >= ${emailCutoff}
    ` as any[]
    const emailFailCount = emailRows[0]?.count || 0

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
      const ipRows = await rawDb.$queryRaw`
        SELECT COUNT(*)::int as count FROM "LoginAttempt"
        WHERE ip = ${ip}
          AND success = false
          AND attemptedAt >= ${ipCutoff}
      ` as any[]
      const ipFailCount = ipRows[0]?.count || 0

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
    // FAIL-SAFE: if DB query fails, allow the request
    console.error('[RATE-LIMIT-DB] Check failed (allowing request as fail-safe):', err)
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: LOGIN_CONFIG.maxEmailAttempts - 1,
    }
  }
}

// ============================================================
// Record Attempt + Clear on Success (raw SQL)
// ============================================================

export async function recordLoginAttempt(
  email: string,
  ip: string,
  success: boolean
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim()

  try {
    await rawDb.$executeRaw`
      INSERT INTO "LoginAttempt" (id, email, ip, success, "attemptedAt")
      VALUES (gen_random_uuid(), ${normalizedEmail}, ${ip}, ${success}, NOW())
    `
  } catch (err) {
    console.error('[RATE-LIMIT-DB] Failed to record attempt (non-blocking):', err)
  }
}

export async function clearLoginAttempts(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim()

  try {
    await rawDb.$executeRaw`
      DELETE FROM "LoginAttempt" WHERE email = ${normalizedEmail}
    `
  } catch (err) {
    console.error('[RATE-LIMIT-DB] Failed to clear attempts (non-blocking):', err)
  }
}

// ============================================================
// Daily Cleanup (called from railway-start.js on startup)
// ============================================================

export async function cleanupOldLoginAttempts(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const result = await rawDb.$executeRaw`
      DELETE FROM "LoginAttempt" WHERE "attemptedAt" < ${cutoff}
    `
    return typeof result === 'number' ? result : 0
  } catch (err) {
    console.error('[RATE-LIMIT-DB] Cleanup failed (non-blocking):', err)
    return 0
  }
}
