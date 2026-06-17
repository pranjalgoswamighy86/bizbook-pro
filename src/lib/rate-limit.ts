/**
 * Rate Limiter for BizBook Pro API endpoints
 *
 * Prevents brute-force attacks on OTP endpoints and other sensitive actions.
 * Uses an in-memory store with automatic cleanup of expired entries.
 *
 * Configuration:
 * - OTP endpoints: 5 requests per 15 minutes per identifier (email/phone)
 * - Login: 10 attempts per 15 minutes per email
 * - General API: 60 requests per minute per IP
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

// In-memory rate limit store: key → entry
const store = new Map<string, RateLimitEntry>()

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (now >= entry.resetAt) {
      store.delete(key)
    }
  }
}, 5 * 60 * 1000)

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number
  /** Time window in milliseconds */
  windowMs: number
}

// Predefined rate limit configurations
export const RATE_LIMITS = {
  /** OTP send/verify: 5 requests per 15 minutes */
  OTP: { maxRequests: 5, windowMs: 15 * 60 * 1000 },
  /** Login attempts: 10 per 15 minutes */
  LOGIN: { maxRequests: 10, windowMs: 15 * 60 * 1000 },
  /** Password reset: 3 per 15 minutes */
  PASSWORD_RESET: { maxRequests: 3, windowMs: 15 * 60 * 1000 },
  /** General API: 60 per minute */
  GENERAL: { maxRequests: 60, windowMs: 60 * 1000 },
} as const

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in the current window */
  remaining: number
  /** Time in seconds until the rate limit resets */
  retryAfterSeconds: number
  /** HTTP status code to return if blocked */
  statusCode: number
}

/**
 * Check if a request should be rate-limited.
 *
 * @param key - Unique identifier for the rate limit bucket (e.g., "otp:user@email.com")
 * @param config - Rate limit configuration
 * @returns RateLimitResult indicating whether the request is allowed
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now()
  const entry = store.get(key)

  // No existing entry or window has expired — start fresh
  if (!entry || now >= entry.resetAt) {
    store.set(key, {
      count: 1,
      resetAt: now + config.windowMs,
    })
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      retryAfterSeconds: 0,
      statusCode: 200,
    }
  }

  // Entry exists and within the window
  if (entry.count >= config.maxRequests) {
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000)
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      statusCode: 429,
    }
  }

  // Increment the counter
  entry.count += 1
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    retryAfterSeconds: 0,
    statusCode: 200,
  }
}

/**
 * Create a rate limit key for OTP endpoints.
 * Uses the email or phone as the identifier.
 */
export function otpRateLimitKey(identifier: string): string {
  return `otp:${identifier.toLowerCase().trim()}`
}

/**
 * Create a rate limit key for login endpoints.
 * Uses the email as the identifier.
 */
export function loginRateLimitKey(email: string): string {
  return `login:${email.toLowerCase().trim()}`
}

/**
 * Create a rate limit key for password reset endpoints.
 * Uses the email as the identifier.
 */
export function passwordResetRateLimitKey(identifier: string): string {
  return `pwreset:${identifier.toLowerCase().trim()}`
}
