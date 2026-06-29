import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'
import crypto from 'crypto'
import Razorpay from 'razorpay'

// ============================================================
// Razorpay Standard Web Checkout Integration (v4.144)
// ============================================================
// Credentials are set via environment variables:
//   RAZORPAY_KEY_ID=rzp_test_T7KS0ZM14WrydY
//   RAZORPAY_KEY_SECRET=ERbF7vwNbT5erPQjsnN6SomI
//
// Flow:
//   1. Frontend calls create-order → backend creates Razorpay order
//   2. Frontend opens Razorpay checkout.js modal with order_id
//   3. User pays → Razorpay returns payment_id + signature
//   4. Frontend calls verify-payment → backend verifies HMAC-SHA256
//   5. If signature matches → activate plan/extra ID
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

// v4.144: Pricing constants
const DEFAULT_NON_VIEW_ONLY_USERS = 3
const RAZORPAY_FEE_PERCENT = 2
const GST_ON_FEE_PERCENT = 18

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    // ============================================================
    // CREATE-ORDER — create a Razorpay order
    // ============================================================
    if (action === 'create-order') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      const { planHours, purpose } = body // purpose: 'recharge' | 'extra-id'

      const rzp = getRazorpayInstance()
      if (!rzp) {
        return NextResponse.json({
          error: 'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on Railway.',
        }, { status: 500 })
      }

      let basePrice = 0
      let planName = ''

      if (purpose === 'extra-id') {
        basePrice = 149
        planName = 'Extra ID'
      } else {
        // Recharge
        const plan = PLANS[Number(planHours)]
        if (!plan) {
          return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
        }
        basePrice = plan.discountAmount // This IS the price customer pays
        planName = plan.name

        // Add 15% surcharge if tenant has extra non-view-only users
        const { rawDb } = await import('@/lib/db-soft-delete')
        const nonViewOnlyCount = await rawDb.userTenant.count({
          where: { tenantId, role: { notIn: ['VIEW_ONLY'] } },
        })
        if (nonViewOnlyCount > DEFAULT_NON_VIEW_ONLY_USERS) {
          const surcharge = Math.round(basePrice * 0.15)
          basePrice += surcharge
          planName += ' (+15% surcharge)'
        }
      }

      // v4.144: Add Razorpay 2% fee + 18% GST on fee
      const rzpFee = Math.round(basePrice * RAZORPAY_FEE_PERCENT * 100) / 100
      const rzpGst = Math.round(rzpFee * GST_ON_FEE_PERCENT * 100) / 100
      const totalAmount = Math.round((basePrice + rzpFee + rzpGst) * 100) / 100
      const amountInPaise = Math.round(totalAmount * 100)

      if (amountInPaise < 100) {
        return NextResponse.json({ error: 'Amount must be at least ₹1 (100 paise)' }, { status: 400 })
      }

      // Create Razorpay order
      const order = await rzp.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `bizbook_${tenantId.slice(-8)}_${purpose || 'recharge'}_${Date.now()}`,
        notes: {
          tenantId,
          planHours: String(planHours || 0),
          purpose: purpose || 'recharge',
          planName,
          basePrice: String(basePrice),
          rzpFee: String(rzpFee),
          rzpGst: String(rzpGst),
          totalAmount: String(totalAmount),
          userEmail: access.email,
          userName: access.user.name,
        },
      })

      return NextResponse.json({
        mode: 'RAZORPAY',
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID, // Safe to expose KEY_ID to frontend
        planName,
        basePrice,
        rzpFee,
        rzpGst,
        totalAmount,
        prefill: {
          name: access.user.name,
          email: access.email,
        },
      })
    }

    // ============================================================
    // VERIFY-PAYMENT — verify HMAC-SHA256 signature
    // ============================================================
    if (action === 'verify-payment') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      const { razorpayOrderId, razorpayPaymentId, razorpaySignature, planHours, purpose } = body

      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return NextResponse.json({ error: 'Missing payment details: razorpayOrderId, razorpayPaymentId, razorpaySignature are required' }, { status: 400 })
      }

      const keySecret = process.env.RAZORPAY_KEY_SECRET
      if (!keySecret) {
        return NextResponse.json({ error: 'Razorpay not configured (KEY_SECRET missing)' }, { status: 500 })
      }

      // HMAC-SHA256 signature verification
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex')

      if (expectedSignature !== razorpaySignature) {
        return NextResponse.json({
          error: 'Signature mismatch. Payment verification failed. Do NOT mark as paid.',
        }, { status: 400 })
      }

      // === Signature verified — process the payment ===

      if (purpose === 'extra-id') {
        // Add extra ID slot
        const subscription = await db.subscription.findUnique({ where: { tenantId } })
        if (!subscription) {
          return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
        }

        const currentMax = (subscription as any).maxUsersAllowed || 0
        const newMax = currentMax === 0 ? DEFAULT_NON_VIEW_ONLY_USERS + 1 : currentMax + 1

        await db.subscription.update({
          where: { id: subscription.id },
          data: { maxUsersAllowed: newMax },
        })

        await db.subscriptionQueue.create({
          data: {
            tenantId,
            baseAmount: 149,
            finalAmount: 149,
            paiseIncrement: 0,
            planHours: 0,
            planName: 'Extra ID (Razorpay)',
            status: 'COMPLETED',
            utrNumber: razorpayPaymentId,
            proofSubmittedAt: new Date(),
            approvedAt: new Date(),
          },
        })

        await writeAuditLog({
          tenantId,
          userId: access.userId,
          userName: access.user.name,
          action: 'CREATE',
          entityType: 'Subscription',
          entityName: `Extra ID purchased (Razorpay: ${razorpayPaymentId})`,
          changes: { newMaxUsers: newMax, paymentId: razorpayPaymentId },
        })

        return NextResponse.json({
          success: true,
          message: `Extra ID activated! Payment ID: ${razorpayPaymentId}`,
          newMaxUsers: newMax,
        })
      }

      // === Recharge — activate the plan ===
      const plan = PLANS[Number(planHours)]
      if (!plan) {
        return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
      }

      let subscription = await db.subscription.findUnique({ where: { tenantId } })
      if (!subscription) {
        return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
      }

      const newRemaining = subscription.remainingSeconds + plan.totalSeconds

      subscription = await db.subscription.update({
        where: { id: subscription.id },
        data: {
          planHours: Number(planHours),
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

      await db.recharge.create({
        data: {
          subscriptionId: subscription.id,
          planHours: Number(planHours),
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
    // GET-KEY — return the Razorpay public key for frontend
    // ============================================================
    if (action === 'get-key') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      const keyId = process.env.RAZORPAY_KEY_ID
      if (!keyId) {
        return NextResponse.json({ configured: false })
      }

      return NextResponse.json({ configured: true, keyId })
    }

    return NextResponse.json({ error: 'Invalid action. Use: create-order | verify-payment | get-key' }, { status: 400 })
  } catch (error: any) {
    console.error('[Razorpay] Error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: error?.message || 'Unknown error',
    }, { status: 500 })
  }
}
