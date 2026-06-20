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

      // Expire old pending entries (cleanup — but doesn't auto-expire current)
      const expiry = new Date(Date.now() - 30 * 60 * 1000) // 30 min grace (was 15)
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

      // v4.43: DON'T auto-expire in check-status. Keep PENDING until admin-verify.
      // The 30-min timer is just a UI hint, not a hard server-side expiry.

      const imapEnabled = !!(process.env.AUTO_ALERT_EMAIL_USER && process.env.AUTO_ALERT_EMAIL_PASSWORD)

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
        queueAgeSec,
        canManualVerify: entry.status === 'PENDING' || entry.status === 'EXPIRED',
      })
    }

    if (action === 'admin-verify') {
      // v4.43: Added detailed logging for payment verification debugging
      console.log('[UPI-VERIFY] admin-verify called', { queueId: body.queueId, tenantId: body.tenantId })
      const auth = await requireAuth(req)
      if (auth instanceof NextResponse) {
        console.error('[UPI-VERIFY] Auth failed — session expired or invalid')
        return auth
      }
      console.log('[UPI-VERIFY] Auth OK', { userId: auth.userId })
      const { queueId } = body
      if (!queueId) {
        console.error('[UPI-VERIFY] Missing queueId')
        return NextResponse.json({ error: 'queueId required' }, { status: 400 })
      }
      const entry = await db.subscriptionQueue.findUnique({ where: { id: queueId } })
      if (!entry) {
        console.error('[UPI-VERIFY] Queue entry not found:', queueId)
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      console.log('[UPI-VERIFY] Queue entry found', {
        queueId, tenantId: entry.tenantId, planName: entry.planName,
        finalAmount: entry.finalAmount, status: entry.status,
        age: Math.round((Date.now() - entry.createdAt.getTime()) / 1000) + 's'
      })
      if (entry.status === 'SUCCESS') {
        console.warn('[UPI-VERIFY] Already verified:', queueId)
        return NextResponse.json({ error: 'Already verified' }, { status: 400 })
      }

      // v4.43: Allow re-verification even if EXPIRED (user might have paid just before expiry)
      try {
        console.log('[UPI-VERIFY] Activating plan...', { queueId, planHours: entry.planHours })
        await db.$transaction([
          db.subscriptionQueue.update({ where: { id: queueId }, data: { status: 'SUCCESS', completedAt: new Date() } }),
          db.subscription.upsert({
            where: { tenantId: entry.tenantId },
            create: { tenantId: entry.tenantId, planHours: entry.planHours, planName: entry.planName, totalSeconds: entry.planHours * 3600, remainingSeconds: entry.planHours * 3600, status: 'ACTIVE', isFreeTier: false },
            update: { planHours: entry.planHours, planName: entry.planName, remainingSeconds: { increment: entry.planHours * 3600 }, status: 'ACTIVE', isFreeTier: false },
          }),
        ])
        console.log('[UPI-VERIFY] ✅ Transaction committed — queue + subscription updated')

        const sub = await db.subscription.findUnique({ where: { tenantId: entry.tenantId } })
        if (sub) {
          await db.recharge.create({ data: { subscriptionId: sub.id, planHours: entry.planHours, planName: entry.planName, mrp: entry.baseAmount, discountPercent: 0, discountAmount: entry.finalAmount, totalSeconds: entry.planHours * 3600, paymentMode: 'UPI_AUTO', paymentRef: queueId, status: 'COMPLETED' } })
          console.log('[UPI-VERIFY] ✅ Recharge record created')
        }

        console.log('[UPI-VERIFY] ✅ Plan activated successfully:', { queueId, planName: entry.planName })
        return NextResponse.json({ success: true, message: `${entry.planName} activated!` })
      } catch (txErr: any) {
        console.error('[UPI-VERIFY] ❌ Transaction failed:', txErr?.message, txErr?.code)
        return NextResponse.json({ error: `Activation failed: ${txErr?.message || 'DB error'}` }, { status: 500 })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('UPI checkout error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
