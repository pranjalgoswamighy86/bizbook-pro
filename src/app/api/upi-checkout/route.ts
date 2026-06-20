import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuth, requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (action === 'initiate') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      const { planHours } = body
      const PLANS: Record<number, { name: string; price: number; totalSeconds: number }> = {
        50: { name: '50Hrs Plan', price: 150, totalSeconds: 180000 },
        100: { name: '100Hrs Plan', price: 217, totalSeconds: 360000 },
        200: { name: '200Hrs Plan', price: 285, totalSeconds: 720000 },
        500: { name: '500Hrs Plan', price: 493, totalSeconds: 1440000 },
        1000: { name: '1000Hrs Plan', price: 562, totalSeconds: 2880000 },
      }
      if (!planHours || !PLANS[Number(planHours)]) {
        return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
      }
      const plan = PLANS[Number(planHours)]

      // Expire old pending entries (cleanup — 30 min grace)
      const expiry = new Date(Date.now() - 30 * 60 * 1000)
      await db.subscriptionQueue.updateMany({ where: { status: 'PENDING', createdAt: { lt: expiry } }, data: { status: 'EXPIRED' } })

      // Find unique paise
      const active = await db.subscriptionQueue.findMany({ where: { status: 'PENDING' }, select: { finalAmount: true } })
      const usedAmounts = active.map(p => Number((p.finalAmount % 1).toFixed(2)))
      let paise = 0.01
      while (usedAmounts.includes(Number(paise.toFixed(2)))) { paise += 0.01; if (paise >= 1) return NextResponse.json({ error: 'Checkout buffer full. Retry later.' }, { status: 503 }) }

      const finalAmount = Number((plan.price + paise).toFixed(2))
      const payeeVPA = process.env.NEXT_PUBLIC_SUPER_ADMIN_UPI_ID || process.env.MASTER_UPI_VPA || '9101555075@kotakbank'
      const payeeName = encodeURIComponent(process.env.MASTER_UPI_NAME || 'Tahigo International')
      const txnNote = encodeURIComponent(`BIZBOOK_PRO_RECHARGE_${tenantId}_${planHours}HRS`)
      const upiUri = `upi://pay?pa=${payeeVPA}&pn=${payeeName}&am=${finalAmount.toFixed(2)}&cu=INR&tn=${txnNote}`

      const entry = await db.subscriptionQueue.create({
        data: { tenantId, baseAmount: plan.price, finalAmount, paiseIncrement: Number(paise.toFixed(2)), planHours: Number(planHours), planName: plan.name, status: 'PENDING', upiUri }
      })

      return NextResponse.json({
        success: true, queueId: entry.id, planName: plan.name, planHours: Number(planHours),
        baseAmount: plan.price, finalAmount, paiseIncrement: Number(paise.toFixed(2)),
        upiUri, payeeVPA, payeeName: process.env.MASTER_UPI_NAME || 'Tahigo International',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      })
    }

    if (action === 'check-status') {
      const auth = await requireAuth(req)
      if (auth instanceof NextResponse) return auth
      const { queueId } = body
      if (!queueId) return NextResponse.json({ error: 'queueId required' }, { status: 400 })

      const entry = await db.subscriptionQueue.findUnique({ where: { id: queueId } })
      if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      const imapEnabled = !!(process.env.AUTO_ALERT_EMAIL_USER && process.env.AUTO_ALERT_EMAIL_PASSWORD)
      // v4.46: SMS webhook auto-verification is enabled if SMS_WEBHOOK_SECRET is set
      // User has Android SMS forwarder app installed that POSTs to /api/cron/sms-webhook
      const smsWebhookEnabled = !!process.env.SMS_WEBHOOK_SECRET || !!process.env.CRON_SECRET
      const autoVerifyEnabled = imapEnabled || smsWebhookEnabled

      // v4.45: AUTO-VERIFY — always trigger IMAP scan when PENDING (even if not enabled, returns disabled status)
      // v4.46: Note — SMS webhook is PUSH-based (Android app POSTs immediately on SMS arrival)
      //        so we don't need to poll it. We only trigger IMAP scan as fallback if configured.
      if (entry.status === 'PENDING' && imapEnabled) {
        try {
          const imapRes = await fetch(`http://localhost:${process.env.PORT || 8080}/api/cron/imap-scan${process.env.CRON_SECRET ? '?secret=' + process.env.CRON_SECRET : ''}`)
          if (imapRes.ok) {
            const imapData = await imapRes.json()
            console.log('[UPI-CHECKOUT] IMAP scan triggered:', imapData.status, 'matched:', imapData.matched)
            const updated = await db.subscriptionQueue.findUnique({ where: { id: queueId } })
            if (updated?.status === 'SUCCESS') {
              return NextResponse.json({
                status: 'SUCCESS',
                planName: entry.planName,
                finalAmount: entry.finalAmount,
                imapEnabled,
                smsWebhookEnabled,
                autoVerifyEnabled,
                message: 'Payment verified automatically!'
              })
            }
          }
        } catch (imapErr) {
          console.warn('[UPI-CHECKOUT] IMAP auto-verify failed:', (imapErr as any)?.message)
        }
      }

      const queueAgeSec = Math.round((Date.now() - entry.createdAt.getTime()) / 1000)
      return NextResponse.json({
        status: entry.status,
        planName: entry.planName,
        finalAmount: entry.finalAmount,
        imapEnabled,
        smsWebhookEnabled,
        autoVerifyEnabled,
        queueAgeSec,
      })
    }

    // v4.45: SECURITY FIX — "I've Paid" button now ONLY triggers IMAP verification.
    // It does NOT auto-activate. If IMAP confirms payment → SUCCESS.
    // If IMAP can't confirm → returns 'payment_not_detected' (user must wait or contact admin).
    // This prevents the critical security bug where users could click "I've Paid"
    // without paying and still get the plan activated.
    if (action === 'verify-payment') {
      console.log('[UPI-VERIFY] verify-payment called (IMAP-only)', { queueId: body.queueId, tenantId: body.tenantId })
      const auth = await requireAuth(req)
      if (auth instanceof NextResponse) {
        console.error('[UPI-VERIFY] Auth failed — session expired or invalid')
        return auth
      }
      const { queueId } = body
      if (!queueId) {
        return NextResponse.json({ error: 'queueId required' }, { status: 400 })
      }
      const entry = await db.subscriptionQueue.findUnique({ where: { id: queueId } })
      if (!entry) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      if (entry.status === 'SUCCESS') {
        return NextResponse.json({ success: true, status: 'SUCCESS', message: 'Already activated', planName: entry.planName })
      }

      const imapEnabled = !!(process.env.AUTO_ALERT_EMAIL_USER && process.env.AUTO_ALERT_EMAIL_PASSWORD)
      const smsWebhookEnabled = !!process.env.SMS_WEBHOOK_SECRET || !!process.env.CRON_SECRET
      const autoVerifyEnabled = imapEnabled || smsWebhookEnabled
      console.log('[UPI-VERIFY] Auto-verify options:', { imapEnabled, smsWebhookEnabled, autoVerifyEnabled })

      if (!autoVerifyEnabled) {
        console.warn('[UPI-VERIFY] No auto-verification configured — cannot verify')
        return NextResponse.json({
          success: false,
          status: 'auto_verify_not_configured',
          error: 'Auto-verification is not configured. Please wait for an admin to manually verify your payment, or contact support with your UTR number.',
          requiresAdmin: true,
        }, { status: 403 })
      }

      // v4.46: SMS webhook is PUSH-based — Android app POSTs immediately when SMS arrives.
      //        So we don't need to "trigger" it — it's already running on the user's phone.
      //        We only need to trigger IMAP scan as fallback if IMAP is configured.
      if (imapEnabled) {
        try {
          console.log('[UPI-VERIFY] Triggering IMAP scan as fallback...')
          const imapRes = await fetch(`http://localhost:${process.env.PORT || 8080}/api/cron/imap-scan${process.env.CRON_SECRET ? '?secret=' + process.env.CRON_SECRET : ''}`)
          if (imapRes.ok) {
            const imapData = await imapRes.json()
            console.log('[UPI-VERIFY] IMAP scan result:', imapData.status, 'matched:', imapData.matched)
          }
        } catch (imapErr: any) {
          console.warn('[UPI-VERIFY] IMAP scan failed (SMS webhook may still work):', imapErr?.message)
        }
      }

      // Re-check status after IMAP scan (and give SMS webhook a chance to fire if user just paid)
      // Wait 2 seconds then re-check (allows time for SMS webhook POST to arrive)
      await new Promise(r => setTimeout(r, 2000))
      const updated = await db.subscriptionQueue.findUnique({ where: { id: queueId } })
      if (updated?.status === 'SUCCESS') {
        console.log('[UPI-VERIFY] ✅ Payment auto-verified (IMAP or SMS webhook)')
        return NextResponse.json({
          success: true,
          status: 'SUCCESS',
          planName: entry.planName,
          message: 'Payment verified automatically!'
        })
      }

      // Auto-verification didn't match yet — payment not detected
      console.warn('[UPI-VERIFY] Payment not detected yet')
      return NextResponse.json({
        success: false,
        status: 'payment_not_detected',
        error: smsWebhookEnabled
          ? 'Payment not detected yet. SMS alerts usually arrive within 30 seconds. Wait 1-2 minutes and try again. If still not detected, contact support with your UTR number.'
          : 'Payment not detected yet. Bank alerts can take 2-5 minutes to arrive. Please wait and try again, or contact support with your UTR number.',
        requiresAdmin: false,
      }, { status: 202 })
    }

    // v4.45: NEW — admin-override-verify action
    // Super Admin ONLY — manually activates a subscription after EXTERNAL verification
    // (e.g., admin checked bank statement and confirmed payment received).
    // This is the ONLY way to manually activate a plan.
    // The tenant user CANNOT use this action — they can only request admin review.
    if (action === 'admin-override-verify') {
      console.log('[UPI-VERIFY] admin-override-verify called', { queueId: body.queueId, tenantId: body.tenantId })
      // Require SUPER_ADMIN role
      const auth = await requireAuthAndRole(req, body.tenantId || '', ['SUPER_ADMIN'] as any)
      if (auth instanceof NextResponse) {
        // Fallback: also accept MAIN_ADMIN if SUPER_ADMIN check fails (single-tenant scenarios)
        const auth2 = await requireAuth(req)
        if (auth2 instanceof NextResponse) {
          console.error('[UPI-VERIFY] Admin override — auth failed')
          return auth2
        }
        // Check if user is admin@bizbook.pro or pranjalgoswamighy86@gmail.com
        const user = await db.user.findUnique({ where: { id: auth2.userId } })
        const ADMIN_OVERRIDE_EMAILS = [
          'admin@bizbook.pro',
          'pranjalgoswamighy86@gmail.com',
          (process.env.ADMIN_EMAIL || '').toLowerCase(),
        ].filter(Boolean)
        if (!user || !ADMIN_OVERRIDE_EMAILS.includes(user.email.toLowerCase())) {
          return NextResponse.json({ error: 'Only Super Admin can manually override payment verification' }, { status: 403 })
        }
      }
      console.log('[UPI-VERIFY] Admin override — auth OK')

      const { queueId, overrideReason } = body
      if (!queueId) {
        return NextResponse.json({ error: 'queueId required' }, { status: 400 })
      }
      const entry = await db.subscriptionQueue.findUnique({ where: { id: queueId } })
      if (!entry) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      if (entry.status === 'SUCCESS') {
        return NextResponse.json({ error: 'Already verified' }, { status: 400 })
      }

      console.log('[UPI-VERIFY] Admin override — activating', {
        queueId, tenantId: entry.tenantId, planName: entry.planName,
        finalAmount: entry.finalAmount, reason: overrideReason || 'no reason given'
      })

      try {
        await db.$transaction([
          db.subscriptionQueue.update({
            where: { id: queueId },
            data: { status: 'SUCCESS', completedAt: new Date() }
          }),
          db.subscription.upsert({
            where: { tenantId: entry.tenantId },
            create: { tenantId: entry.tenantId, planHours: entry.planHours, planName: entry.planName, totalSeconds: entry.planHours * 3600, remainingSeconds: entry.planHours * 3600, status: 'ACTIVE', isFreeTier: false },
            update: { planHours: entry.planHours, planName: entry.planName, remainingSeconds: { increment: entry.planHours * 3600 }, status: 'ACTIVE', isFreeTier: false },
          }),
        ])
        console.log('[UPI-VERIFY] ✅ Admin override — transaction committed')

        const sub = await db.subscription.findUnique({ where: { tenantId: entry.tenantId } })
        if (sub) {
          await db.recharge.create({ data: { subscriptionId: sub.id, planHours: entry.planHours, planName: entry.planName, mrp: entry.baseAmount, discountPercent: 0, discountAmount: entry.finalAmount, totalSeconds: entry.planHours * 3600, paymentMode: 'ADMIN_OVERRIDE', paymentRef: queueId, status: 'COMPLETED' } })
        }

        console.log('[UPI-VERIFY] ✅ Admin override — plan activated:', entry.planName)
        return NextResponse.json({ success: true, message: `${entry.planName} activated via admin override` })
      } catch (txErr: any) {
        console.error('[UPI-VERIFY] ❌ Admin override — transaction failed:', txErr?.message)
        return NextResponse.json({ error: `Activation failed: ${txErr?.message || 'DB error'}` }, { status: 500 })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('UPI checkout error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
