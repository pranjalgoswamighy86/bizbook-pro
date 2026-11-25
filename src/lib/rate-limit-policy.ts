export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
  statusCode: 200 | 429 | 503
  reason?: 'limit' | 'db-unavailable'
}

/** Convert the count returned by the atomic PostgreSQL upsert into an HTTP decision. */
export function decideRateLimit(
  count: number,
  resetAt: Date | number,
  maxRequests: number,
  now = Date.now()
): RateLimitDecision {
  const resetAtMs = resetAt instanceof Date ? resetAt.getTime() : resetAt
  if (count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
      statusCode: 429,
      reason: 'limit',
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - count),
    retryAfterSeconds: 0,
    statusCode: 200,
  }
}

export function rateLimitStoreUnavailable(retryAfterSeconds = 30): RateLimitDecision {
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds,
    statusCode: 503,
    reason: 'db-unavailable',
  }
}
