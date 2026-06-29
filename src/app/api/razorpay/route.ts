import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'
import crypto from 'crypto'
import Razorpay from 'razorpay'

// ============================================================
// Razorpay Integration
// ============================================================
// To enable live payments, set these in .env:
//   RAZORPAY_KEY_ID="rzp_live_xxxxx"
//   RAZORPAY_KEY_SECRET="xxxxx"
//
// For testing, use test keys from https://dashboard.razorpay.com/app/keys
//   RAZORPAY_KEY_ID="rzp_test_xxxxx"
//   RAZORPAY_KEY_SECRET="xxxxx"
//
// If keys are not set, the API falls back to MANUAL mode (admin activates
// plans manually without payment).
// ============================================================

function getRazorpayInstance(): Razorpay | null {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) return null
  return new Razorpay({ key_id: keyId, key_secret: keySecret })
}

// Plan definitions (must match subscription/route.ts)
const PLANS: Record<number, { name: string; mrp: number; discountAmount: number; totalSeconds: number; roleAllocation: { MAIN_ADMIN: number; JUNIOR_ADMIN: number; DATA_ENTRY: number; VIEW_ONLY: number } }> = {
  50:   { name: '50Hrs Plan',   mrp: 749,   discountAmount: 150, totalSeconds: 180000,  roleAllocation: { MAIN_ADMIN: 10, JUNIOR_ADMIN: 15,  DATA_ENTRY: 25,  VIEW_ONLY: 0 } },
  100:  { name: '100Hrs Plan',  mrp: 1449,  discountAmount: 217, totalSeconds: 360000,  roleAllocation: { MAIN_ADMIN: 20, JUNIOR_ADMIN: 30,  DATA_ENTRY: 50,  VIEW_ONLY: 0 } },
  200:  { name: '200Hrs Plan',  mrp: 2849,  discountAmount: 285, totalSeconds: 720000,  roleAllocation: { MAIN_ADMIN: 40, JUNIOR_ADMIN: 60,  DATA_ENTRY: 100, VIEW_ONLY: 0 } },
  500:  { name: '500Hrs Plan',  mrp: 7049,  discountAmount: 493, totalSeconds: 1440000, roleAllocation: { MAIN_ADMIN: 80, JUNIOR_ADMIN: 120, DATA_ENTRY: 200, VIEW_ONLY: 0 } },
  1000: { name: '1000Hrs Plan', mrp: 14049, discountAmount: 562, totalSeconds: 2880000, roleAllocation: { MAIN_ADMIN: 40, JUNIOR_ADMIN: 60,  DATA_ENTRY: 100, VIEW_ONLY: 0 } },
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    // ============================================================
    // CREATE-ORDER — create a Razorpay order for a recharge plan
    // ============================================================
    if (action === 'create-order') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      const { planHours } = body
      const plan = PLANS[planHours]
      if (!plan) {
        return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
      }

      // v4.138: Add ₹30 Razorpay platform fee per transaction
      const RAZORPAY_PLATFORM_FEE = 30
      const basePrice = plan.mrp - plan.discountAmount

      // v4.138: Add 15% surcharge if tenant has extra non-view-only users
      const { rawDb } = await import('@/lib/db-soft-delete')
      const nonViewOnlyCount = await rawDb.userTenant.count({
        where: { tenantId, role: { notIn: ['VIEW_ONLY'] } },
      })
      const hasExtraUsers = nonViewOnlyCount > 3
      const surchargeAmount = hasExtraUsers ? Math.round(basePrice * 0.15) : 0

      const finalPrice = basePrice + surchargeAmount + RAZORPAY_PLATFORM_FEE
      const amountInPaise = Math.round(finalPrice * 100)

      const rzp = getRazorpayInstance()

      // If Razorpay is not configured, return MANUAL mode
      if (!rzp) {
        return NextResponse.json({
          mode: 'MANUAL',
          message: 'Razorpay is not configured. Use UPI payment instead (no platform fee).',
          plan: { name: plan.name, hours: planHours, finalPrice, basePrice, surchargeAmount, platformFee: RAZORPAY_PLATFORM_FEE },
        })
      }

      // Create a Razorpay order
      const order = await rzp.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `bizbook_${tenantId.slice(-8)}_${planHours}h_${Date.now()}`,
        notes: {
          tenantId,
          planHours: String(planHours),
          planName: plan.name,
          userEmail: access.email,
          basePrice: String(basePrice),
          surcharge: String(surchargeAmount),
          platformFee: String(RAZORPAY_PLATFORM_FEE),
          userName: access.user.name,
        },
      })

      return NextResponse.json({
        mode: 'RAZORPAY',
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        plan: {
          name: plan.name,
          hours: planHours,
          mrp: plan.mrp,
          discountAmount: plan.discountAmount,
          finalPrice,
        },
        prefill: {
          name: access.user.name,
          email: access.email,
        },
      })
    }

    // ============================================================
    // VERIFY-PAYMENT — verify Razorpay signature and activate plan
    // ============================================================
    if (action === 'verify-payment') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      const { razorpayOrderId, razorpayPaymentId, razorpaySignature, planHours } = body

      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !planHours) {
        return NextResponse.json({ error: 'Missing payment details' }, { status: 400 })
      }

      const plan = PLANS[planHours]
      if (!plan) {
        return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
      }

      // Verify the signature
      const keySecret = process.env.RAZORPAY_KEY_SECRET
      if (!keySecret) {
        return NextResponse.json({ error: 'Razorpay not configured' }, { status: 500 })
      }

      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex')

      if (expectedSignature !== razorpaySignature) {
        return NextResponse.json({ error: 'Invalid payment signature. Payment verification failed.' }, { status: 400 })
      }

      // Payment verified — activate the plan
      let subscription = await db.subscription.findUnique({ where: { tenantId } })
      if (!subscription) {
        return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
      }

      const newRemaining = subscription.remainingSeconds + plan.totalSeconds

      subscription = await db.subscription.update({
        where: { id: subscription.id },
        data: {
          planHours: planHours,
          planName: plan.name,
          mrp: plan.mrp,
          discountPercent: Math.round((plan.discountAmount / plan.mrp) * 100),
          discountAmount: plan.discountAmount,
          totalSeconds: subscription.totalSeconds + plan.totalSeconds,
          remainingSeconds: newRemaining,
          status: 'ACTIVE',
          isFreeTier: false,
          mainAdminHours: subscription.mainAdminHours + plan.roleAllocation.MAIN_ADMIN,
          juniorAdminHours: subscription.juniorAdminHours + plan.roleAllocation.JUNIOR_ADMIN,
          dataEntryHours: subscription.dataEntryHours + plan.roleAllocation.DATA_ENTRY,
        },
      })

      // Create recharge log with payment details
      await db.recharge.create({
        data: {
          subscriptionId: subscription.id,
          planHours: planHours,
          planName: plan.name,
          mrp: plan.mrp,
          discountPercent: Math.round((plan.discountAmount / plan.mrp) * 100),
          discountAmount: plan.discountAmount,
          totalSeconds: plan.totalSeconds,
          paymentMode: 'RAZORPAY',
          paymentRef: razorpayPaymentId,
          status: 'COMPLETED',
        },
      })

      await writeAuditLog({
        tenantId,
        userId: access.userId,
        userName: access.user.name,
        action: 'CREATE',
        entityType: 'Recharge',
        entityName: `${plan.name} (Razorpay: ${razorpayPaymentId})`,
        changes: { planHours, mrp: plan.mrp, paymentId: razorpayPaymentId, orderId: razorpayOrderId },
      })

      return NextResponse.json({
        success: true,
        message: `${plan.name} activated successfully! Payment ID: ${razorpayPaymentId}`,
        subscription: {
          planHours: subscription.planHours,
          planName: subscription.planName,
          remainingHours: Math.floor(subscription.remainingSeconds / 3600),
          status: subscription.status,
        },
      })
    }

    // ============================================================
    // GET-KEY — return the Razorpay public key for frontend checkout
    // ============================================================
    if (action === 'get-key') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      const keyId = process.env.RAZORPAY_KEY_ID
      if (!keyId) {
        return NextResponse.json({ configured: false, mode: 'MANUAL' })
      }

      return NextResponse.json({
        configured: true,
        mode: 'RAZORPAY',
        keyId,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    console.error('[Razorpay] Error:', error?.message || error)
    console.error('[Razorpay] Stack:', error?.stack?.slice(0, 300))
    // Return the ACTUAL error message so the frontend can show it
    const errMsg = error?.error?.description || error?.message || 'Internal server error'
    return NextResponse.json({
      error: errMsg,
      details: error?.error || undefined,
    }, { status: 500 })
  }
}
