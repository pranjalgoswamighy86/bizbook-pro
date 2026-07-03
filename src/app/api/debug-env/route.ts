import { NextRequest, NextResponse } from 'next/server'

/**
 * DEBUG ENDPOINT — Check which environment variables are loaded.
 *
 * Returns a SAFE list (true/false only — no values) of all critical
 * env vars. This helps diagnose "OTP not working" issues by confirming
 * whether Railway is actually loading the env vars.
 *
 * Usage:
 *   GET /api/debug-env
 */

export async function GET(req: NextRequest) {
  const envStatus: Record<string, { set: boolean; maskedValue: string }> = {}

  const checkVar = (name: string) => {
    const value = process.env[name]
    if (!value) {
      envStatus[name] = { set: false, maskedValue: '(not set)' }
    } else {
      // Mask the value — show only length + first/last 2 chars
      const masked = value.length > 8
        ? `${value.slice(0, 2)}...${value.slice(-2)} (${value.length} chars)`
        : `*** (${value.length} chars)`
      envStatus[name] = { set: true, maskedValue: masked }
    }
  }

  // Check all critical env vars
  const criticalVars = [
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'EMAIL_FROM',
    'SMTP_FROM',
    'TWOFACTOR_API_KEY',
    'TWOFACTOR_SENDER_ID',
    'TWOFACTOR_TEMPLATE_NAME',
    'SESSION_SECRET',
    'MASTER_MOBILE_NUMBER',
    'ADMIN_EMAIL',
    'NEXT_PUBLIC_APP_URL',
    'DATABASE_URL',
    'NODE_ENV',
    'PORT',
    'HOSTNAME',
  ]

  for (const v of criticalVars) {
    checkVar(v)
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    railway: process.env.RAILWAY_PROJECT_ID ? 'yes' : 'no',
    envVars: envStatus,
    summary: {
      smtpReady: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
      smsReady: !!(process.env.TWOFACTOR_API_KEY && process.env.TWOFACTOR_TEMPLATE_NAME),
      sessionReady: !!process.env.SESSION_SECRET,
      masterMobileReady: !!process.env.MASTER_MOBILE_NUMBER,
      adminEmailReady: !!process.env.ADMIN_EMAIL,
    },
    recommendations: [
      ...(!process.env.SMTP_USER || !process.env.SMTP_PASS
        ? ['❌ SMTP not configured — add SMTP_USER and SMTP_PASS to Railway Variables']
        : ['✅ SMTP configured']),
      ...(!process.env.SESSION_SECRET
        ? ['❌ SESSION_SECRET not set — sessions will be unstable across restarts']
        : ['✅ SESSION_SECRET set']),
      ...(!process.env.MASTER_MOBILE_NUMBER
        ? ['❌ MASTER_MOBILE_NUMBER not set — defaults to 9101555075']
        : ['✅ MASTER_MOBILE_NUMBER set']),
      ...(!process.env.ADMIN_EMAIL
        ? ['❌ ADMIN_EMAIL not set — defaults to admin@bizbook.pro']
        : ['✅ ADMIN_EMAIL set']),
    ],
  })
}
