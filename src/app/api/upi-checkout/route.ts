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

      // Expire old pending entries
      const expiry = new Date(Date.now() - 15 * 60 * 1000)
      await db.subscriptionQueue.updateMany({ where: { status: 'PENDING', createdAt: { lt: expiry } }, data: { status: 'EXPIRED' } })

      // Find unique paise
      const active = await db.subscriptionQueue.findMany({ where: { status: 'PENDING' }, select: { finalAmount: true } })
      const usedAmounts = active.map(p => Number((p.finalAmount % 1).toFixed(2)))
      let paise = 0.01
      while (usedAmounts.includes(Number(paise.toFixed(2)))) { paise += 0.01; if (paise >= 1) return NextResponse.json({ error: 'Checkout buffer full. Retry later.' }, { status: 503 }) }

      const finalAmount = Number((plan.price + paise).toFixed(2))
      // v4.11: Spec Section 24 — use NEXT_PUBLIC_SUPER_ADMIN_UPI_ID with MASTER_UPI_VPA fallback
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
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
    }

    if (action === 'check-status') {
      const auth = await requireAuth(req)
      if (auth instanceof NextResponse) return auth
      const { queueId } = body
      if (!queueId) return NextResponse.json({ error: 'queueId required' }, { status: 400 })

      const entry = await db.subscriptionQueue.findUnique({ where: { id: queueId } })
      if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      if (entry.status === 'PENDING' && Date.now() - entry.createdAt.getTime() > 15 * 60 * 1000) {
        await db.subscriptionQueue.update({ where: { id: entry.id }, data: { status: 'EXPIRED' } })
        return NextResponse.json({ status: 'EXPIRED' })
      }

      return NextResponse.json({ status: entry.status, planName: entry.planName, finalAmount: entry.finalAmount })
    }

    if (action === 'admin-verify') {
      const auth = await requireAuth(req)
      if (auth instanceof NextResponse) return auth
      const { queueId } = body
      const entry = await db.subscriptionQueue.findUnique({ where: { id: queueId } })
      if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (entry.status === 'SUCCESS') return NextResponse.json({ error: 'Already verified' }, { status: 400 })

      await db.$transaction([
        db.subscriptionQueue.update({ where: { id: queueId }, data: { status: 'SUCCESS', completedAt: new Date() } }),
        db.subscription.upsert({
          where: { tenantId: entry.tenantId },
          create: { tenantId: entry.tenantId, planHours: entry.planHours, planName: entry.planName, totalSeconds: entry.planHours * 3600, remainingSeconds: entry.planHours * 3600, status: 'ACTIVE', isFreeTier: false },
          update: { planHours: entry.planHours, planName: entry.planName, remainingSeconds: { increment: entry.planHours * 3600 }, status: 'ACTIVE', isFreeTier: false },
        }),
      ])

      const sub = await db.subscription.findUnique({ where: { tenantId: entry.tenantId } })
      if (sub) { await db.recharge.create({ data: { subscriptionId: sub.id, planHours: entry.planHours, planName: entry.planName, mrp: entry.baseAmount, discountPercent: 0, discountAmount: entry.finalAmount, totalSeconds: entry.planHours * 3600, paymentMode: 'UPI_AUTO', paymentRef: queueId, status: 'COMPLETED' } }) }

      return NextResponse.json({ success: true, message: `${entry.planName} activated!` })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('UPI checkout error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
