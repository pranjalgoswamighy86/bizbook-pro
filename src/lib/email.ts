import nodemailer from 'nodemailer'

/**
 * Email Service — Gmail SMTP
 *
 * Sends OTP emails FROM: BizBook Pro <pranjalgoswamighy86@gmail.com>
 * TO: any user's email address
 *
 * === PORT STRATEGY (Railway compatibility) ===
 * Railway blocks outbound port 587 (STARTTLS) to prevent spam.
 * We try multiple ports in order:
 *   1. Port 465 (SSL/TLS) — most likely to work on Railway
 *   2. Port 587 (STARTTLS) — works locally, may fail on Railway
 *   3. Port 2525 (alternate) — some providers support this
 *
 * The From address is always the SMTP_USER's Gmail (your email),
 * which Gmail accepts as the authenticated sender.
 */

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS)
}

function getFromAddress(): string {
  const smtpUser = process.env.SMTP_USER || ''
  if (smtpUser) return `"BizBook Pro" <${smtpUser}>`
  return '"BizBook Pro" <noreply@bizbook.pro>'
}

// Try multiple ports — Railway blocks 587 but may allow 465
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

export async function sendOtpEmail(email: string, otp: string, userName?: string): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    console.error('[EMAIL] Cannot send OTP: SMTP_USER or SMTP_PASS not configured')
    return { success: false, error: 'SMTP_NOT_CONFIGURED' }
  }

  const fromAddress = getFromAddress()
  const mailOptions = {
    from: fromAddress,
    to: email,
    subject: 'BizBook Pro — Your Verification OTP',
    priority: 'high' as const,
    html: `
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
    `,
    text: `BizBook Pro — Your Verification OTP\n\nHello${userName ? ` ${userName}` : ''},\n\nYour OTP is: ${otp}\n\nThis OTP expires in 5 minutes. If you did not request this, please ignore this email.\n\n— BizBook Pro (Tahigo International)`,
  }

  // === Try each port until one works ===
  let lastError = ''
  for (const { port, secure } of SMTP_PORTS) {
    try {
      console.log(`[EMAIL] Trying SMTP ${process.env.SMTP_HOST || 'smtp.gmail.com'}:${port} (secure=${secure})`)
      const transporter = createTransporter(port, secure)

      // Verify connection
      await transporter.verify()
      console.log(`[EMAIL] ✅ SMTP connected on port ${port}!`)

      // Send email
      const info = await transporter.sendMail(mailOptions)
      console.log(`[EMAIL] ✅ OTP sent to ${email} via port ${port} (messageId: ${info.messageId})`)
      return { success: true }
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : 'Unknown error'
      const code = (error as { code?: string })?.code || ''
      console.error(`[EMAIL] ❌ Port ${port} failed: ${code} — ${lastError}`)

      if (code === 'EAUTH') {
        // Auth error — no point trying other ports
        console.error('[EMAIL] EAUTH — App Password is wrong. Stopping.')
        return { success: false, error: `SMTP_EAUTH: ${lastError}` }
      }
      // Otherwise try next port
    }
  }

  console.error(`[EMAIL] All SMTP ports failed. Last error: ${lastError}`)
  return { success: false, error: lastError }
}
