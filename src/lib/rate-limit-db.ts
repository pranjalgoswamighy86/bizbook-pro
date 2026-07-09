/**
 * v6.21.0: PostgreSQL-Backed Rate Limiter for Login
 * ==================================================
 *
 * Resolves audit finding P1-2 (HIGH):
 * The previous in-memory rate limiter (src/lib/rate-limit.ts) used a Map that
 * reset on every container restart — and the container restarts ~9×/day on
 * Railway. An attacker could simply wait for a restart to get a fresh counter.
 *
 * This module provides PostgreSQL-backed rate limiting that survives restarts.
 * It is used ONLY for the login endpoint (the highest-risk brute-force target).
 * OTP and password-reset endpoints continue to use the in-memory limiter (their
 * windows are short enough that restart-reset is acceptable).
 *
 * Two-dimensional limiting:
 *   - Per-email: 5 failed attempts per 15 minutes → 15-minute lockout
 *   - Per-IP: 20 failed attempts per 15 minutes → 15-minute lockout
 *
 * Fail-safe: if the database query fails for any reason, the rate limiter
 * ALLOWS the request. Rationale: blocking legitimate users because of an infra
 * issue is worse than allowing a few extra brute-force attempts. The in-memory
 * limiter (which never fails) still provides a second layer of protection.
 *
 * Lockout escalation: 3 lockouts in 24 hours → 1-hour lockout.
 */

import { db } from '@/lib/db-soft-delete'

// ============================================================
// Configuration
// ============================================================

const LOGIN_CONFIG = {
  // Per-email: 5 failed attempts per 15 minutes
  maxEmailAttempts: 5,
  emailWindowMs: 15 * 60 * 1000, // 15 minutes
  emailLockoutMs: 15 * 60 * 1000, // 15 minutes

  // Per-IP: 20 failed attempts per 15 minutes (higher because IPs are shared)
  maxIpAttempts: 20,
  ipWindowMs: 15 * 60 * 1000,
  ipLockoutMs: 15 * 60 * 1000,

  // Escalation: 3 lockouts in 24 hours → 1-hour lockout
  escalationThreshold: 3,
  escalationWindowMs: 24 * 60 * 60 * 1000, // 24 hours
  escalationLockoutMs: 60 * 60 * 1000, // 1 hour
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

/**
 * Extract the client IP from a Next.js request.
 * Railway uses x-forwarded-for (standard proxy header).
 */
export function getClientIP(request: Request): string {
  // x-forwarded-for: "client-ip, proxy1-ip, proxy2-ip" — take the first
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const firstIP = xff.split(',')[0].trim()
    if (firstIP) return firstIP
  }

  // x-real-ip: some proxies set this instead
  const xrealip = request.headers.get('x-real-ip')
  if (xrealip) return xrealip.trim()

  // Fallback: unknown (rate limiting by IP won't work, but email-based still does)
  return 'unknown'
}

// ============================================================
// Core Rate-Limit Check
// ============================================================

/**
 * Check if a login attempt should be allowed based on recent failed attempts.
 *
 * This function does NOT record the attempt — call recordLoginAttempt() separately
 * after the password check completes. This separation ensures we only count
 * actual failed attempts (not requests that were already rate-limited).
 */
export async function checkLoginRateLimit(
  email: string,
  ip: string
): Promise<LoginRateLimitResult> {
  const normalizedEmail = email.toLowerCase().trim()
  const now = Date.now()

  try {
    // === Check 1: Escalation lockout (3 lockouts in 24h → 1-hour lockout) ===
    // Count lockouts in the last 24 hours (an "escalation lockout" is a 1-hour lockout)
    const escalationThreshold = new Date(now - LOGIN_CONFIG.escalationWindowMs)
    const escalationLockoutCount = await db.loginAttempt.count({
      where: {
        OR: [
          { email: normalizedEmail, success: false },
          { ip: ip, success: false },
        ],
        attemptedAt: { gte: escalationThreshold },
        // Heuristic: if there have been >15 failed attempts in 24h for this email/IP,
        // they've hit the 3-lockout threshold (5 per lockout × 3 = 15)
      },
    })

    if (escalationLockoutCount >= LOGIN_CONFIG.maxEmailAttempts * LOGIN_CONFIG.escalationThreshold) {
      // Escalation lockout: 1 hour
      const retryAfterSeconds = Math.ceil(LOGIN_CONFIG.escalationLockoutMs / 1000)
      return {
        allowed: false,
        retryAfterSeconds,
        reason: 'escalation',
      }
    }

    // === Check 2: Per-email lockout (5 failed in 15 min) ===
    const emailWindowStart = new Date(now - LOGIN_CONFIG.emailWindowMs)
    const emailFailCount = await db.loginAttempt.count({
      where: {
        email: normalizedEmail,
        success: false,
        attemptedAt: { gte: emailWindowStart },
      },
    })

    if (emailFailCount >= LOGIN_CONFIG.maxEmailAttempts) {
      const retryAfterSeconds = Math.ceil(LOGIN_CONFIG.emailLockoutMs / 1000)
      return {
        allowed: false,
        retryAfterSeconds,
        reason: 'email',
        remaining: 0,
      }
    }

    // === Check 3: Per-IP lockout (20 failed in 15 min) ===
    if (ip !== 'unknown') {
      const ipWindowStart = new Date(now - LOGIN_CONFIG.ipWindowMs)
      const ipFailCount = await db.loginAttempt.count({
        where: {
          ip: ip,
          success: false,
          attemptedAt: { gte: ipWindowStart },
        },
      })

      if (ipFailCount >= LOGIN_CONFIG.maxIpAttempts) {
        const retryAfterSeconds = Math.ceil(LOGIN_CONFIG.ipLockoutMs / 1000)
        return {
          allowed: false,
          retryAfterSeconds,
          reason: 'ip',
          remaining: 0,
        }
      }
    }

    // All checks passed — allow the login attempt
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: LOGIN_CONFIG.maxEmailAttempts - emailFailCount - 1,
    }
  } catch (err) {
    // FAIL-SAFE: if DB query fails, allow the request
    // Rationale: don't block legitimate users because of an infra issue.
    // The in-memory rate limiter (src/lib/rate-limit.ts) still provides
    // a second layer of protection within the current container's lifetime.
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

/**
 * Record a login attempt outcome (success or failure).
 * Call this AFTER the password check completes.
 */
export async function recordLoginAttempt(
  email: string,
  ip: string,
  success: boolean
): Promise<void> {
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

/**
 * Clear all login attempts for an email after a successful login.
 * Rationale: a legitimate user who mistypes their password once then
 * succeeds should not have 4 "failures" counted against them.
 */
export async function clearLoginAttempts(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim()

  try {
    await db.loginAttempt.deleteMany({
      where: { email: normalizedEmail },
    })
  } catch (err) {
    // Non-blocking: if cleanup fails, the old attempts will eventually
    // expire via the daily cleanup job in railway-start.js.
    console.error('[RATE-LIMIT-DB] Failed to clear attempts (non-blocking):', err)
  }
}

// ============================================================
// Daily Cleanup (called from railway-start.js on startup)
// ============================================================

/**
 * Delete login attempts older than 24 hours.
 * Called on every container startup to keep the table small.
 * At ~100 attempts/day at current traffic, the table stays under 1000 rows.
 */
export async function cleanupOldLoginAttempts(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const result = await db.loginAttempt.deleteMany({
      where: { attemptedAt: { lt: cutoff } },
    })
    return result.count
  } catch (err) {
    console.error('[RATE-LIMIT-DB] Cleanup failed (non-blocking):', err)
    return 0
  }
}
