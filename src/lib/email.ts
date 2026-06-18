import nodemailer from 'nodemailer'

/**
 * Email Service — Resend API (primary) + Gmail SMTP (fallback)
 *
 * === WHY RESEND FIRST? ===
 * Railway blocks outbound ports 25/465/587 to prevent spam.
 * Resend uses HTTPS (port 443) which Railway always allows.
 *
 * === FALLBACK CHAIN ===
 *   1. Resend API (HTTPS 443) — works everywhere, free tier 3,000/mo
 *   2. SMTP port 465 (SSL) — works locally, sometimes on Railway
 *   3. SMTP port 587 (STARTTLS) — works locally
 *   4. SMTP port 2525 (alternate)
 *
 * === ENV VARS ===
 * RESEND_API_KEY   = re_xxxxxxxx        (from resend.com — free signup)
 * RESEND_FROM      = "BizBook Pro <onboarding@resend.dev>"  (or your verified domain)
 *
 * SMTP_USER        = your Gmail address (fallback)
 * SMTP_PASS        = your Gmail App Password (fallback)
 */

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

export function isEmailConfigured(): boolean {
  const hasResend = !!process.env.RESEND_API_KEY
  const hasSmtp = !!(process.env.SMTP_USER && process.env.SMTP_PASS)
  return hasResend || hasSmtp
}

export function isResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

function getFromAddress(): string {
  // 1. Resend "from" address (can be onboarding@resend.dev for testing)
  if (process.env.RESEND_FROM) return process.env.RESEND_FROM
  // 2. SMTP user
  const smtpUser = process.env.SMTP_USER || ''
  if (smtpUser) return `"BizBook Pro" <${smtpUser}>`
  // 3. Default
  return '"BizBook Pro" <onboarding@resend.dev>'
}

// ---------------------------------------------------------------------------
// SMTP fallback ports (Railway blocks most of these — that's why Resend is #1)
// ---------------------------------------------------------------------------
const SMTP_PORTS = [
  { port: 465, secure: true },
  { port: 587, secure: false },
  { port: 2525, secure: false },
]

function createTransporter(port: number, secure: boolean) {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  })
}

// ---------------------------------------------------------------------------
// HTML + plain-text OTP message
// ---------------------------------------------------------------------------
function buildOtpMessage(email: string, otp: string, userName?: string) {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 480px; margin: 0 auto; background: #f9fafb; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 28px 32px; text-align: center;">
        <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">BizBook Pro</h1>
        <p style="margin: 6px 0 0 0; color: #d1fae5; font-size: 14px;">A Product by Tahigo International</p>
        <p style="margin: 4px 0 0 0; color: #d1fae5; font-size: 12px; opacity: 0.85;">Verification Code</p>
      </div>
      <div style="padding: 32px;">
        <p style="margin: 0 0 8px 0; font-size: 16px; color: #111827;">Hello${userName ? ` ${userName}` : ''},</p>
        <p style="margin: 0 0 24px 0; font-size: 14px; color: #6b7280; line-height: 1.6;">
          Use the OTP below to verify your identity. This code is for your BizBook Pro account.
        </p>
        <div style="background: #ecfdf5; border: 2px dashed #059669; border-radius: 10px; padding: 20px; text-align: center; margin: 0 0 24px 0;">
          <p style="margin: 0 0 8px 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Your One-Time Password</p>
          <p style="margin: 0; font-size: 36px; font-weight: 800; color: #059669; letter-spacing: 8px; font-family: 'Courier New', monospace;">${otp}</p>
        </div>
        <div style="background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px; padding: 12px 16px; margin: 0 0 24px 0;">
          <p style="margin: 0; font-size: 13px; color: #92400e;">
            <strong>⏱ This OTP expires in 5 minutes.</strong> If it expires, please request a new one.
          </p>
        </div>
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #6b7280; line-height: 1.6;">
          If you did not request this code, please ignore this email. Your account is safe and no changes have been made.
        </p>
      </div>
      <div style="background: #f3f4f6; padding: 16px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
        <p style="margin: 0; font-size: 12px; color: #9ca3af;">
          This is an automated message from BizBook Pro (Tahigo International). Please do not reply to this email.
        </p>
      </div>
    </div>
  `
  const text = `BizBook Pro — Your Verification OTP\n\nHello${userName ? ` ${userName}` : ''},\n\nYour OTP is: ${otp}\n\nThis OTP expires in 5 minutes. If you did not request this, please ignore this email.\n\n— BizBook Pro (Tahigo International)`
  return { html, text }
}

// ---------------------------------------------------------------------------
// PRIMARY SENDER: Resend API (HTTPS — works on Railway)
// ---------------------------------------------------------------------------
async function sendViaResend(
  email: string,
  otp: string,
  userName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Lazy import so projects without resend installed can still call this file
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { html, text } = buildOtpMessage(email, otp, userName)

    const from = getFromAddress()
    console.log(`[EMAIL][RESEND] Sending OTP to ${email} from ${from}`)

    const { data, error } = await resend.emails.send({
      from,
      to: email,
      subject: 'BizBook Pro — Your Verification OTP',
      html,
      text,
    })

    if (error) {
      console.error(`[EMAIL][RESEND] ❌ API error:`, error)
      return { success: false, error: `RESEND_API: ${error.message || JSON.stringify(error)}` }
    }

    console.log(`[EMAIL][RESEND] ✅ OTP sent to ${email} (id: ${data?.id || 'n/a'})`)
    return { success: true }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[EMAIL][RESEND] ❌ Exception:`, errMsg)
    return { success: false, error: `RESEND_EX: ${errMsg}` }
  }
}

// ---------------------------------------------------------------------------
// FALLBACK SENDER: SMTP multi-port retry
// ---------------------------------------------------------------------------
async function sendViaSmtp(
  email: string,
  otp: string,
  userName?: string
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { success: false, error: 'SMTP_NOT_CONFIGURED' }
  }

  const { html, text } = buildOtpMessage(email, otp, userName)
  const mailOptions = {
    from: getFromAddress(),
    to: email,
    subject: 'BizBook Pro — Your Verification OTP',
    priority: 'high' as const,
    html,
    text,
  }

  let lastError = ''
  for (const { port, secure } of SMTP_PORTS) {
    try {
      console.log(`[EMAIL][SMTP] Trying ${process.env.SMTP_HOST || 'smtp.gmail.com'}:${port} (secure=${secure})`)
      const transporter = createTransporter(port, secure)
      await transporter.verify()
      console.log(`[EMAIL][SMTP] ✅ Connected on port ${port}`)
      const info = await transporter.sendMail(mailOptions)
      console.log(`[EMAIL][SMTP] ✅ OTP sent to ${email} via port ${port} (messageId: ${info.messageId})`)
      return { success: true }
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : 'Unknown error'
      const code = (error as { code?: string })?.code || ''
      console.error(`[EMAIL][SMTP] ❌ Port ${port} failed: ${code} — ${lastError}`)
      if (code === 'EAUTH') {
        return { success: false, error: `SMTP_EAUTH: ${lastError}` }
      }
    }
  }
  return { success: false, error: lastError }
}

// ---------------------------------------------------------------------------
// PUBLIC API — send OTP email
// ---------------------------------------------------------------------------
export async function sendOtpEmail(
  email: string,
  otp: string,
  userName?: string
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    console.error('[EMAIL] Cannot send OTP: no email provider configured (RESEND_API_KEY or SMTP_USER/SMTP_PASS)')
    return { success: false, error: 'EMAIL_NOT_CONFIGURED' }
  }

  // === Step 1: Try Resend API first (works on Railway) ===
  if (isResendConfigured()) {
    const result = await sendViaResend(email, otp, userName)
    if (result.success) return result
    console.warn('[EMAIL] Resend failed, falling back to SMTP...')
  }

  // === Step 2: Fallback to SMTP ===
  const smtpResult = await sendViaSmtp(email, otp, userName)
  if (smtpResult.success) return smtpResult

  console.error(`[EMAIL] All email providers failed. Last error: ${smtpResult.error}`)
  return smtpResult
}
