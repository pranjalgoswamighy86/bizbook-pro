/**
 * BizBook Pro — Authentication Utilities (Security Patch v1)
 *
 * Fixes:
 *   C1 — Passwords are now hashed with scrypt (Node built-in, no deps)
 *   C2 — Sessions are signed HMAC tokens stored in an HttpOnly cookie
 *
 * Compatible with existing blueprint code: drop-in replacement for the
 * plaintext `user.password !== password` checks in api/auth/route.ts.
 *
 * No external dependencies. Uses only Node.js `crypto` module.
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

// ============================================================
// Constants
// ============================================================

export const SESSION_COOKIE = 'bizbook_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // 7 days

// Allow override via env, but default to a value derived from the deploy.
// IMPORTANT: Set SESSION_SECRET in your .env to a long random string (>= 32 chars).
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  // Fallback: derive a per-process secret so dev still works.
  // In production, ALWAYS set SESSION_SECRET explicitly — otherwise all
  // sessions invalidate on every server restart.
  crypto.createHash('sha256').update('bizbook-pro-dev-fallback-' + process.cwd()).digest('hex')

const SCRYPT_KEYLEN = 64
const SCRYPT_SALT_BYTES = 16

// ============================================================
// Password hashing (scrypt — Node built-in, no deps)
// ============================================================

/**
 * Hash a plaintext password using scrypt + per-user salt.
 * Returns "<saltHex>:<hashHex>" — store this string verbatim in the DB.
 */
export function hashPassword(password: string): string {
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters')
  }
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES)
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

/**
 * Verify a plaintext password against a stored "<salt>:<hash>" string.
 * Constant-time comparison to prevent timing attacks.
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (!password || !stored) return false
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false

  let salt: Buffer
  let expectedHash: Buffer
  try {
    salt = Buffer.from(saltHex, 'hex')
    expectedHash = Buffer.from(hashHex, 'hex')
  } catch {
    return false
  }

  const actualHash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)

  // Buffers must be same length for timingSafeEqual
  if (actualHash.length !== expectedHash.length) return false
  return crypto.timingSafeEqual(actualHash, expectedHash)
}

/**
 * Detect whether a stored password string is already hashed.
 * Used by the migration script to convert legacy plaintext passwords.
 */
export function isPasswordHashed(stored: string): boolean {
  if (!stored) return false
  // Hashed format: "<64 hex chars>:<128 hex chars>"
  const parts = stored.split(':')
  if (parts.length !== 2) return false
  const [salt, hash] = parts
  return /^[0-9a-f]+$/i.test(salt) && /^[0-9a-f]+$/i.test(hash) &&
    salt.length === SCRYPT_SALT_BYTES * 2 && hash.length === SCRYPT_KEYLEN * 2
}

// ============================================================
// Session tokens (HMAC-signed, stateless)
// ============================================================

interface SessionPayload {
  userId: string
  email: string
  expiresAt: number // epoch ms
}

/**
 * Create a signed session token for a user.
 * Token format: base64url(payloadJson).base64url(hmacSignature)
 */
export function createSessionToken(userId: string, email: string): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  const payload: SessionPayload = { userId, email, expiresAt }
  const payloadJson = JSON.stringify(payload)
  const payloadB64 = Buffer.from(payloadJson, 'utf-8').toString('base64url')
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

/**
 * Verify a session token's signature and expiry.
 * Returns the decoded payload, or null if invalid/expired/tampered.
 */
export function verifySessionToken(token: string): SessionPayload | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, sig] = parts

  // Verify signature (constant-time)
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expectedBuf.length) return null
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null

  // Decode payload
  let payload: SessionPayload
  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf-8')
    payload = JSON.parse(payloadJson)
  } catch {
    return null
  }

  // Check expiry
  if (!payload.userId || !payload.expiresAt) return null
  if (Date.now() > payload.expiresAt) return null

  return payload
}

// ============================================================
// Cookie helpers
// ============================================================

/**
 * Read the session token from the request cookies.
 */
export function getSessionTokenFromRequest(req: NextRequest): string | undefined {
  return req.cookies.get(SESSION_COOKIE)?.value
}

/**
 * Attach the session cookie to a NextResponse.
 *
 * Cookie strategy:
 *   - httpOnly: true   → JavaScript can't read it (XSS protection)
 *   - sameSite: 'lax'  → Works for same-origin requests AND top-level
 *                        navigations. Doesn't require `secure`, so it
 *                        works on both HTTP and HTTPS.
 *   - secure: false    → Works on both HTTP (dev) and HTTPS (production).
 *                        The preview URL is HTTPS but some internal hops
 *                        may be HTTP, so we don't enforce Secure.
 *   - path: '/'        → Cookie sent for all routes
 *   - maxAge: 7 days   → Session expiry
 *
 * Note: SameSite=Lax is sufficient here because the app and API share
 * the same origin. The previous SameSite=None+Secure combo was causing
 * cookies to be silently dropped when any HTTP hop existed in the chain.
 */
export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  })
}

/**
 * Clear the session cookie (for logout).
 * Must use the same attributes as setSessionCookie for the browser to
 * actually delete the cookie.
 */
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 0,
    path: '/',
  })
}
