/**
 * Payment Proof Review Endpoint (v4.47)
 * ======================================
 * Super Admin ONLY — review payment proofs submitted by users.
 *
 * Actions:
 *   - list-pending: Get all queue entries with status=PROOF_SUBMITTED
 *   - approve:      Approve proof → activate subscription (uses admin-override-verify logic)
 *   - reject:       Reject proof → status returns to PENDING (user can re-submit)
 *
 * Security:
 *   - Only admin@bizbook.pro or pranjalgoswamighy86@gmail.com can call this endpoint
 *   - All actions logged with admin user ID + timestamp + notes
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuth } from '@/lib/api-helpers'

// Admin override email list — must match upi-checkout route
const ADMIN_OVERRIDE_EMAILS = [
  'admin@bizbook.pro',
  'pranjalgoswamighy86@gmail.com',
  (process.env.ADMIN_EMAIL || '').toLowerCase(),
].filter(Boolean)

async function requireSuperAdmin(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth
  const user = await db.user.findUnique({ where: { id: auth.userId } })
  if (!user || !ADMIN_OVERRIDE_EMAILS.includes(user.email.toLowerCase())) {
    return NextResponse.json(
      { error: 'Super Admin access required' },
      { status: 403 }
    )
  }
  return { auth, user }
}

export async function POST(req: NextRequest) {
  try {
    const adminAccess = await requireSuperAdmin(req)
    if (adminAccess instanceof NextResponse) return adminAccess
    const { auth, user } = adminAccess

    const body = await req.json()
    const { action } = body

    // ---------- LIST PENDING PROOFS ----------
    if (action === 'list-pending') {
      const pending = await db.subscriptionQueue.findMany({
        where: { status: 'PROOF_SUBMITTED' },
        include: {
          tenant: {
            select: { id: true, name: true, email: true, phone: true }
          }
        },
        orderBy: { proofSubmittedAt: 'asc' } // oldest first (FIFO)
      })

      return NextResponse.json({
        success: true,
        count: pending.length,
        proofs: pending.map(p => ({
          queueId: p.id,
          tenantId: p.tenantId,
          tenantName: p.tenant.name,
          tenantEmail: p.tenant.email,
          tenantPhone: p.tenant.phone,
          planName: p.planName,
          planHours: p.planHours,
          finalAmount: p.finalAmount,
          utrNumber: p.utrNumber,
          screenshotPath: p.screenshotPath,
          screenshotUrl: `/api/payment-proof?file=${p.screenshotPath}`,
          submittedAt: p.proofSubmittedAt,
          queueCreatedAt: p.createdAt,
          reviewNotes: p.reviewNotes,
        }))
      })
    }

    // ---------- APPROVE PROOF (activate subscription) ----------
    if (action === 'approve') {
      const { queueId, reviewNotes } = body
      if (!queueId) {
        return NextResponse.json({ error: 'queueId required' }, { status: 400 })
      }

      const entry = await db.subscriptionQueue.findUnique({ where: { id: queueId } })
      if (!entry) {
        return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 })
      }
      if (entry.status === 'SUCCESS') {
        return NextResponse.json({ error: 'Already activated' }, { status: 400 })
      }
      if (!entry.utrNumber || !entry.screenshotPath) {
        return NextResponse.json({ error: 'No proof submitted for this entry' }, { status: 400 })
      }

      console.log(`[PAYMENT-PROOF-REVIEW] Admin ${user.email} approving queue ${queueId} — UTR: ${entry.utrNumber}`)

      // Atomic transaction: mark SUCCESS + activate subscription + record recharge
      await db.$transaction([
        db.subscriptionQueue.update({
          where: { id: queueId },
          data: {
            status: 'SUCCESS',
            completedAt: new Date(),
            reviewedBy: auth.userId,
            reviewedAt: new Date(),
            reviewNotes: reviewNotes || `Approved by admin ${user.email} on ${new Date().toISOString()}`,
          },
        }),
        db.subscription.upsert({
          where: { tenantId: entry.tenantId },
          update: {
            planName: entry.planName,
            planHours: entry.planHours,
            remainingSeconds: { increment: entry.planHours * 3600 },
            totalSeconds: { increment: entry.planHours * 3600 },
            status: 'ACTIVE',
            isFreeTier: false,
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
          create: {
            tenantId: entry.tenantId,
            planName: entry.planName,
            planHours: entry.planHours,
            remainingSeconds: entry.planHours * 3600,
            totalSeconds: entry.planHours * 3600,
            status: 'ACTIVE',
            isFreeTier: false,
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        }),
      ])

      const sub = await db.subscription.findUnique({ where: { tenantId: entry.tenantId } })
      if (sub) {
        await db.recharge.create({
          data: {
            subscriptionId: sub.id,
            planHours: entry.planHours,
            planName: entry.planName,
            mrp: entry.baseAmount,
            discountPercent: 0,
            discountAmount: entry.finalAmount,
            totalSeconds: entry.planHours * 3600,
            paymentMode: 'ADMIN_VERIFIED_UTR',
            paymentRef: `UTR:${entry.utrNumber}`,
            status: 'COMPLETED',
          },
        })
      }

      console.log(`[PAYMENT-PROOF-REVIEW] ✅ Approved — ${entry.planName} activated for tenant ${entry.tenantId}`)

      return NextResponse.json({
        success: true,
        message: `${entry.planName} activated. UTR ${entry.utrNumber} verified by admin.`,
        queueId,
        planName: entry.planName,
        tenantId: entry.tenantId,
      })
    }

    // ---------- REJECT PROOF (return to PENDING) ----------
    if (action === 'reject') {
      const { queueId, reviewNotes } = body
      if (!queueId) {
        return NextResponse.json({ error: 'queueId required' }, { status: 400 })
      }

      const entry = await db.subscriptionQueue.findUnique({ where: { id: queueId } })
      if (!entry) {
        return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 })
      }
      if (entry.status === 'SUCCESS') {
        return NextResponse.json({ error: 'Already activated, cannot reject' }, { status: 400 })
      }

      console.log(`[PAYMENT-PROOF-REVIEW] Admin ${user.email} rejecting queue ${queueId}: ${reviewNotes || 'no reason'}`)

      // Return to PENDING but keep the UTR/screenshot for audit
      // User can submit a new proof (will overwrite UTR/screenshot)
      await db.subscriptionQueue.update({
        where: { id: queueId },
        data: {
          status: 'PENDING',
          reviewedBy: auth.userId,
          reviewedAt: new Date(),
          reviewNotes: `REJECTED: ${reviewNotes || 'Admin did not provide reason'}`,
        },
      })

      return NextResponse.json({
        success: true,
        message: 'Proof rejected. User can re-submit a new proof.',
        queueId,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    console.error('[PAYMENT-PROOF-REVIEW] Error:', error?.message)
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
