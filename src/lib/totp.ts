/**
 * TOTP (Time-Based One-Time Password) Utility for BizBook Pro
 *
 * Implements Two-Factor Authentication using standard RFC 6238 TOTP.
 * Compatible with Google Authenticator, Microsoft Authenticator, Authy, etc.
 *
 * Flow:
 * 1. User clicks "Enable 2FA" in Settings → generates secret + QR code
 * 2. User scans QR code with authenticator app
 * 3. User enters first 6-digit code to verify setup
 * 4. 2FA is enabled → future logins require email+password + TOTP code
 */

import { generateSecret, generateURI, generateSync, verifySync } from 'otplib'
import QRCode from 'qrcode'

// TOTP configuration: 6-digit codes, 30-second window
const TOTP_CONFIG = {
  step: 30,          // 30-second time step
  digits: 6,         // 6-digit OTP
  window: 1,         // Allow 1 step before/after for clock drift
}

/**
 * Generate a new TOTP secret for a user.
 * Returns the base32-encoded secret that will be stored in the database.
 */
export function createSecret(): string {
  return generateSecret()
}

/**
 * Generate a TOTP URI for authenticator apps.
 * This URI is encoded into the QR code that users scan.
 *
 * Format: otpauth://totp/BizBook%20Pro:user@email?secret=XXX&issuer=BizBook%20Pro
 */
export function createTotpUri(secret: string, email: string): string {
  return generateURI({
    secret,
    label: email,
    issuer: 'BizBook Pro',
    algorithm: 'SHA1',
    digits: TOTP_CONFIG.digits,
    period: TOTP_CONFIG.step,
    type: 'totp',
  })
}

/**
 * Generate a QR code as a base64 data URL.
 * The QR code encodes the otpauth:// URI that authenticator apps scan.
 */
export async function createQRCodeDataUrl(secret: string, email: string): Promise<string> {
  const uri = createTotpUri(secret, email)
  try {
    const dataUrl = await QRCode.toDataURL(uri, {
      width: 256,
      margin: 2,
      color: {
        dark: '#111827',  // Dark QR code
        light: '#FFFFFF',  // White background
      },
      errorCorrectionLevel: 'M',
    })
    return dataUrl
  } catch (error) {
    console.error('[TOTP] QR code generation failed:', error)
    throw new Error('Failed to generate QR code')
  }
}

/**
 * Verify a TOTP token against a secret.
 * Returns true if the token is valid within the current time window.
 *
 * @param secret - The base32-encoded TOTP secret stored for the user
 * @param token - The 6-digit code entered by the user
 */
export function verifyTOTP(secret: string, token: string): boolean {
  try {
    // Remove any spaces or dashes the user might have typed
    const cleanToken = token.replace(/[\s-]/g, '')

    const result = verifySync({ token: cleanToken, secret, digits: TOTP_CONFIG.digits, period: TOTP_CONFIG.step, window: TOTP_CONFIG.window, algorithm: 'SHA1' })
    return result.valid === true
  } catch {
    return false
  }
}

/**
 * Generate the current TOTP token for testing/display purposes.
 * WARNING: This should only be used for debugging, never in production responses.
 */
export function generateCurrentToken(secret: string): string {
  return generateSync({ secret, digits: TOTP_CONFIG.digits, period: TOTP_CONFIG.step, algorithm: 'SHA1' })
}
