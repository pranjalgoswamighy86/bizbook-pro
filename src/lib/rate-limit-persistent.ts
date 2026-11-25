import { db } from '@/lib/db'
import { decideRateLimit, rateLimitStoreUnavailable, type RateLimitDecision } from '@/lib/rate-limit-policy'

export interface PersistentRateLimitConfig {
  maxRequests: number
  windowMs: number
}

let lastCleanupAttemptAt = 0
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const RETENTION_MS = 24 * 60 * 60 * 1000

async function cleanupExpiredBuckets(now: number): Promise<void> {
  if (now - lastCleanupAttemptAt < CLEANUP_INTERVAL_MS) return
  lastCleanupAttemptAt = now

  try {
    await db.rateLimitBucket.deleteMany({
      where: { resetAt: { lt: new Date(now - RETENTION_MS) } },
    })
  } catch (error) {
    // Cleanup is maintenance only; it must never change the rate-limit decision.
    lastCleanupAttemptAt = 0
    console.warn('[RATE-LIMIT] Failed to prune expired chat buckets:', error)
  }
}

/**
 * Atomically increments one shared bucket in PostgreSQL.
 * The unique key row lock serializes concurrent requests across all app replicas.
 * Database errors fail closed so AI provider credits cannot be bypassed on outage.
 */
export async function checkPersistentRateLimit(
  key: string,
  config: PersistentRateLimitConfig
): Promise<RateLimitDecision> {
  if (!key || !Number.isInteger(config.maxRequests) || config.maxRequests < 1 ||
      !Number.isFinite(config.windowMs) || config.windowMs < 1) {
    throw new Error('Invalid persistent rate-limit configuration')
  }

  try {
    const rows = await db.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
      VALUES (${key}, 1, NOW() + (${Math.floor(config.windowMs)} * INTERVAL '1 millisecond'), NOW())
      ON CONFLICT ("key") DO UPDATE
      SET
        "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= NOW() THEN 1
          ELSE LEAST("RateLimitBucket"."count" + 1, ${config.maxRequests + 1})
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= NOW() THEN EXCLUDED."resetAt"
          ELSE "RateLimitBucket"."resetAt"
        END,
        "updatedAt" = NOW()
      RETURNING "count", "resetAt"
    `

    if (rows.length !== 1) {
      throw new Error('Rate-limit upsert returned no bucket')
    }

    const decision = decideRateLimit(
      rows[0].count,
      rows[0].resetAt,
      config.maxRequests
    )
    await cleanupExpiredBuckets(Date.now())
    return decision
  } catch (error) {
    console.error('[RATE-LIMIT] Persistent chat rate-limit check failed; denying request:', error)
    return rateLimitStoreUnavailable()
  }
}
