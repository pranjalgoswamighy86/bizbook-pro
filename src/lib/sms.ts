/**
 * SMS Service for BizBook Pro — 2Factor.in Integration
 *
 * Configured for 2Factor.in with the provided credentials:
 *   API Key:        from TWOFACTOR_API_KEY env var
 *   Sender ID:      BIZBOK (from TWOFACTOR_SENDER_ID env var)
 *   Template Name:  "BizBook Pro" (from TWOFACTOR_TEMPLATE_NAME env var)
 *
 * API Docs: https://documenter.getpostman.com/view/301893/TWDamFGh
 *
 * Supports two flows:
 *   1. sendOtpSms()     — send our own OTP code via approved template
 *   2. verifyOtpSms()   — verify OTP using 2Factor's session (optional)
 *
 * Setup:
 *   1. Sign up at https://2factor.in
 *   2. Get API key from Dashboard → put in .env as TWOFACTOR_API_KEY
 *   3. Get Sender ID approved (BIZBOK) → .env as TWOFACTOR_SENDER_ID
 *   4. Get OTP template approved ("BizBook Pro") → .env as TWOFACTOR_TEMPLATE_NAME
 */

interface SmsResult {
  success: boolean
  error?: string
  sessionId?: string
}

/**
 * Check if SMS is properly configured.
 */
export function isSmsConfigured(): boolean {
  return !!(process.env.TWOFACTOR_API_KEY && process.env.TWOFACTOR_TEMPLATE_NAME)
}

export function getSmsProviderName(): string {
  if (isSmsConfigured()) return '2Factor.in'
  return 'None'
}

/**
 * Normalize an Indian phone number to 91XXXXXXXXXX format (12 digits).
 * Handles inputs like:
 *   9876543210           → 919876543210
 *   09876543210          → 919876543210
 *   919876543210         → 919876543210
 *   +919876543210        → 919876543210
 *   0091 98765 43210     → 919876543210
 */
function normalizeIndianPhone(phone: string): string | null {
  const clean = phone.replace(/[^0-9]/g, '')
  if (clean.length === 10) return `91${clean}`
  if (clean.length === 11 && clean.startsWith('0')) return `91${clean.slice(1)}`
  if (clean.length === 12 && clean.startsWith('91')) return clean
  if (clean.length === 13 && clean.startsWith('0091')) return `91${clean.slice(3)}`
  if (clean.length >= 12) return `91${clean.slice(-10)}`
  return null
}

/**
 * Send OTP via 2Factor.in using our own OTP code.
 *
 * 2Factor has two APIs:
 *   A) "SEND OTP" — they generate the OTP, you call "VERIFY OTP" to check
 *   B) "Send custom OTP" — you generate the OTP, they just deliver it
 *
 * We use (B) since we already store OTPs in our DB for email fallback.
 *
 * Endpoint: GET https://2factor.in/API/V1/{api_key}/SMS/{phone}/{otp}/{template}
 */
export async function sendOtpSms(phone: string, otp: string): Promise<SmsResult> {
  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS_NOT_CONFIGURED' }
  }

  const apiKey = process.env.TWOFACTOR_API_KEY!
  const templateName = process.env.TWOFACTOR_TEMPLATE_NAME!
  const senderId = process.env.TWOFACTOR_SENDER_ID || ''

  const recipientPhone = normalizeIndianPhone(phone)
  if (!recipientPhone) {
    return { success: false, error: `Invalid phone number format: ${phone}` }
  }

  try {
    // 2Factor.in "Send OTP" API (we send our own OTP via this endpoint)
    let url = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(recipientPhone)}/${encodeURIComponent(otp)}/${encodeURIComponent(templateName)}`
    if (senderId) {
      url += `?sid=${encodeURIComponent(senderId)}`
    }

    console.log(`[2Factor] Sending OTP to ${recipientPhone} (template="${templateName}", sender="${senderId}")`)

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })

    const data = await response.json() as { Status?: string; status?: string; Details?: string; details?: string; Error?: string; error?: string }

    if (data.Status === 'Success' || data.status === 'Success') {
      const sessionId = data.Details || data.details || ''
      console.log(`[2Factor] ✓ OTP sent to ${recipientPhone} (session: ${sessionId})`)
      return { success: true, sessionId }
    } else {
      const errMsg = data.Details || data.details || data.Error || data.error || '2Factor delivery failed'
      console.error(`[2Factor] ✗ Failed to send to ${recipientPhone}:`, errMsg, data)
      return { success: false, error: errMsg }
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown SMS error'
    console.error('[2Factor] Exception:', errMsg)
    return { success: false, error: errMsg }
  }
}

/**
 * Verify an OTP using 2Factor's session (optional — only if you used
 * 2Factor's "SEND OTP" endpoint that auto-generates the code).
 *
 * We don't use this — we verify OTPs against our own DB. But exposing
 * the helper in case it's useful for future integrations.
 */
export async function verifyOtpSms(sessionId: string, otp: string): Promise<SmsResult> {
  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS_NOT_CONFIGURED' }
  }

  const apiKey = process.env.TWOFACTOR_API_KEY!

  try {
    const url = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/VERIFY/${encodeURIComponent(sessionId)}/${encodeURIComponent(otp)}`
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } })
    const data = await response.json() as { Status?: string; status?: string; Details?: string; details?: string; Error?: string; error?: string }

    if (data.Status === 'Success' || data.status === 'Success') {
      return { success: true }
    } else {
      const errMsg = data.Details || data.details || data.Error || data.error || 'OTP verification failed'
      return { success: false, error: errMsg }
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: errMsg }
  }
}

/**
 * Send a plain SMS (non-OTP) — e.g., "Your invoice INV-001 has been created".
 * Uses 2Factor's "General SMS" API.
 *
 * Note: requires an approved transactional template on 2Factor dashboard.
 */
export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS_NOT_CONFIGURED' }
  }

  const apiKey = process.env.TWOFACTOR_API_KEY!
  const senderId = process.env.TWOFACTOR_SENDER_ID || 'BIZBOK'

  const recipientPhone = normalizeIndianPhone(phone)
  if (!recipientPhone) {
    return { success: false, error: `Invalid phone number: ${phone}` }
  }

  try {
    // 2Factor General SMS API
    const url = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/ADDON_SERVICES/SEND/TSMS`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        From: senderId,
        To: recipientPhone,
        Msg: message,
      }),
    })

    const data = await response.json() as { Status?: string; status?: string; Details?: string; details?: string; Error?: string; error?: string }

    if (data.Status === 'Success' || data.status === 'Success') {
      console.log(`[2Factor] ✓ SMS sent to ${recipientPhone}`)
      return { success: true }
    } else {
      const errMsg = data.Details || data.details || data.Error || data.error || 'SMS delivery failed'
      console.error('[2Factor] ✗ SMS failed:', errMsg)
      return { success: false, error: errMsg }
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: errMsg }
  }
}
