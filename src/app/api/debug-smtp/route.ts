import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

export const maxDuration = 30

/**
 * DEBUG ENDPOINT — Diagnose why OTP emails aren't being received.
 *
 * This endpoint runs a comprehensive SMTP diagnosis and returns the
 * EXACT error (if any) that Gmail is returning. It does NOT send a
 * real OTP — just a test email + verbose diagnostic info.
 *
 * Usage:
 *   GET /api/debug-smtp?email=your@email.com
 *
 * Returns JSON with:
 *   - smtpConfigured: bool (whether SMTP_USER + SMTP_PASS are set)
 *   - smtpUser: string (the SMTP_USER value, masked)
 *   - fromAddress: string (the From address that would be used)
 *   - connectionVerified: bool (whether SMTP connection works)
 *   - emailSent: bool (whether the test email was accepted by Gmail)
 *   - messageId: string (Gmail's message ID if sent)
 *   - error: string (the EXACT error if any step failed)
 *   - errorCode: string (EAUTH, EENVELOPE, ECONNECTION, etc.)
 *   - recommendations: string[] (actionable next steps)
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const testEmail = url.searchParams.get('email') || process.env.SMTP_USER || 'test@example.com'

  const result: {
    timestamp: string
    testEmail: string
    smtpConfigured: boolean
    smtpUser: string
    smtpHost: string
    smtpPort: string
    smtpSecure: string
    fromAddress: string
    emailFromEnv: string
    connectionVerified: boolean
    emailSent: boolean
    messageId?: string
    response?: string
    error?: string
    errorCode?: string
    errorStage?: string
    recommendations: string[]
  } = {
    timestamp: new Date().toISOString(),
    testEmail,
    smtpConfigured: false,
    smtpUser: '',
    smtpHost: '',
    smtpPort: '',
    smtpSecure: '',
    fromAddress: '',
    emailFromEnv: '',
    connectionVerified: false,
    emailSent: false,
    recommendations: [],
  }

  // === Step 1: Check env vars ===
  const smtpUser = process.env.SMTP_USER || ''
  const smtpPass = process.env.SMTP_PASS || ''
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com'
  const smtpPort = process.env.SMTP_PORT || '587'
  const smtpSecure = process.env.SMTP_SECURE || 'false'
  const emailFrom = process.env.EMAIL_FROM || process.env.SMTP_FROM || ''

  // Mask the SMTP_USER for security (show first 3 + last 4 chars)
  const maskedUser = smtpUser
    ? smtpUser.length > 8
      ? `${smtpUser.slice(0, 3)}***${smtpUser.slice(-4)}`
      : '***'
    : '(not set)'

  result.smtpUser = maskedUser
  result.smtpHost = smtpHost
  result.smtpPort = smtpPort
  result.smtpSecure = smtpSecure
  result.emailFromEnv = emailFrom ? '(set)' : '(not set)'

  // Compute the From address (same logic as email.ts getFromAddress)
  if (emailFrom) {
    result.fromAddress = emailFrom
  } else if (smtpUser) {
    result.fromAddress = `"BizBook Pro" <${smtpUser}>`
  } else {
    result.fromAddress = '"BizBook Pro" <noreply@bizbook.pro>'
  }

  if (!smtpUser || !smtpPass) {
    result.smtpConfigured = false
    result.error = 'SMTP_USER or SMTP_PASS is not set in environment variables'
    result.errorCode = 'ENV_NOT_SET'
    result.errorStage = 'env-check'
    result.recommendations.push(
      'Add SMTP_USER and SMTP_PASS to Railway Variables tab',
      'SMTP_USER should be your Gmail address (e.g., pranjalgoswamighy86@gmail.com)',
      'SMTP_PASS should be a 16-char Gmail App Password (e.g., "aeah qokp ycyn kcgk")',
      'Generate App Password at https://myaccount.google.com/apppasswords'
    )
    return NextResponse.json(result)
  }

  result.smtpConfigured = true

  // === Step 2: Create transporter and verify connection ===
  const port = Number(smtpPort) || 587
  const secure = smtpSecure === 'true' || port === 465

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port,
    secure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  })

  try {
    await transporter.verify()
    result.connectionVerified = true
  } catch (err: unknown) {
    const error = err as Error & { code?: string; response?: string; responseCode?: number }
    result.connectionVerified = false
    result.error = error.message || 'Unknown SMTP connection error'
    result.errorCode = error.code || 'UNKNOWN'
    result.errorStage = 'connection-verify'

    if (error.code === 'EAUTH') {
      result.recommendations.push(
        '❌ Gmail rejected your credentials — App Password is wrong or expired',
        'Go to https://myaccount.google.com/apppasswords',
        'Delete the old "BizBook Pro" app password',
        'Create a new one and update SMTP_PASS in Railway Variables',
        'Make sure 2-Step Verification is enabled on your Google account'
      )
    } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
      result.recommendations.push(
        '❌ Cannot connect to SMTP server — network issue',
        `Check that ${smtpHost}:${smtpPort} is accessible from Railway`,
        'Try changing SMTP_PORT to 465 and SMTP_SECURE to true',
        'Railway may be blocking outbound SMTP — try a different port'
      )
    } else {
      result.recommendations.push(
        `❌ SMTP connection failed: ${error.message}`,
        `Error code: ${error.code}`,
        'Check Railway deployment logs for more details'
      )
    }
    return NextResponse.json(result)
  }

  // === Step 3: Try sending a test email ===
  try {
    const info = await transporter.sendMail({
      from: result.fromAddress,
      to: testEmail,
      subject: 'BizBook Pro — SMTP Debug Test',
      text: `This is a debug test email from BizBook Pro.\n\nIf you received this, SMTP is working correctly!\n\nTimestamp: ${result.timestamp}\nFrom: ${result.fromAddress}\nTo: ${testEmail}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #059669;">BizBook Pro — SMTP Debug Test</h2>
          <p>If you received this email, SMTP is working correctly!</p>
          <hr>
          <p><strong>Timestamp:</strong> ${result.timestamp}</p>
          <p><strong>From:</strong> ${result.fromAddress}</p>
          <p><strong>To:</strong> ${testEmail}</p>
        </div>
      `,
    })

    result.emailSent = true
    result.messageId = info.messageId
    result.response = info.response
    result.recommendations.push(
      '✅ Test email sent successfully!',
      `Check the inbox of ${testEmail} (and spam folder)`,
      `Message ID: ${info.messageId}`,
      'If the email does not arrive, the issue is on the recipient side:',
      '  → Check spam/junk folder',
      '  → Check if recipient email provider is blocking Gmail senders',
      '  → Try a different recipient email address'
    )
  } catch (err: unknown) {
    const error = err as Error & { code?: string; response?: string; responseCode?: number }
    result.emailSent = false
    result.error = error.message || 'Unknown send error'
    result.errorCode = error.code || 'UNKNOWN'
    result.errorStage = 'send-mail'

    if (error.code === 'EENVELOPE') {
      result.recommendations.push(
        '❌ Gmail rejected the email envelope — usually a From address issue',
        `Current From: ${result.fromAddress}`,
        'The From address must match the authenticated SMTP_USER',
        'Set EMAIL_FROM in Railway Variables to: "BizBook Pro" <your@gmail.com>',
        'Or leave EMAIL_FROM unset and the system will default to SMTP_USER'
      )
    } else if (error.code === 'EMESSAGE') {
      result.recommendations.push(
        '❌ Email message format issue',
        'Check the email content for invalid characters',
        error.message
      )
    } else if (error.responseCode === 550) {
      result.recommendations.push(
        '❌ Gmail returned 550 — mailbox unavailable',
        'The recipient email address may not exist or is blocking the sender',
        `Try sending to a different email address (currently: ${testEmail})`
      )
    } else if (error.responseCode === 421) {
      result.recommendations.push(
        '❌ Gmail returned 421 — service not available / rate limited',
        'Gmail is throttling your emails — wait 1 hour and try again',
        'If this persists, switch to Resend.com (3000 free emails/month)'
      )
    } else {
      result.recommendations.push(
        `❌ Email send failed: ${error.message}`,
        `Error code: ${error.code || 'unknown'}`,
        `Gmail response: ${error.response || 'none'}`,
        `Response code: ${error.responseCode || 'none'}`,
        'Check Railway deployment logs for full error details'
      )
    }
  }

  return NextResponse.json(result)
}
