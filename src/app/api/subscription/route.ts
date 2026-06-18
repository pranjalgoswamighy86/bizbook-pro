import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'

// ============================================================
// Subscription Plans (from the pricing sheet)
// ============================================================
export const PLANS = [
  {
    hours: 50,
    name: '50Hrs Plan',
    mrp: 749,
    discountPercent: 80,
    discountAmount: 150,
    totalSeconds: 180000,
    roleAllocation: { MAIN_ADMIN: 10, JUNIOR_ADMIN: 15, DATA_ENTRY: 25, VIEW_ONLY: 0 },
  },
  {
    hours: 100,
    name: '100Hrs Plan',
    mrp: 1449,
    discountPercent: 85,
    discountAmount: 217,
    totalSeconds: 360000,
    roleAllocation: { MAIN_ADMIN: 20, JUNIOR_ADMIN: 30, DATA_ENTRY: 50, VIEW_ONLY: 0 },
  },
  {
    hours: 200,
    name: '200Hrs Plan',
    mrp: 2849,
    discountPercent: 90,
    discountAmount: 285,
    totalSeconds: 720000,
    roleAllocation: { MAIN_ADMIN: 40, JUNIOR_ADMIN: 60, DATA_ENTRY: 100, VIEW_ONLY: 0 },
  },
  {
    hours: 500,
    name: '500Hrs Plan',
    mrp: 7049,
    discountPercent: 93,
    discountAmount: 493,
    totalSeconds: 1440000,
    roleAllocation: { MAIN_ADMIN: 80, JUNIOR_ADMIN: 120, DATA_ENTRY: 200, VIEW_ONLY: 0 },
  },
  {
    hours: 1000,
    name: '1000Hrs Plan',
    mrp: 14049,
    discountPercent: 96,
    discountAmount: 562,
    totalSeconds: 2880000,
    roleAllocation: { MAIN_ADMIN: 40, JUNIOR_ADMIN: 60, DATA_ENTRY: 100, VIEW_ONLY: 0 },
  },
] as const

// Free tier hours based on user registration number
// First 500 users: 100Hrs free
// Users 501-10000: 50Hrs free
// After 10000: 20Hrs free
function getFreeTierHours(userCount: number): number {
  if (userCount <= 500) return 100
  if (userCount <= 10000) return 50
  return 20
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    // ============================================================
    // GET-STATUS — get current subscription for the tenant
    // ============================================================
    if (action === 'get-status') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      let subscription = await db.subscription.findUnique({
        where: { tenantId },
        include: { recharges: { orderBy: { createdAt: 'desc' }, take: 10 } },
      })

      // If no subscription exists, create a free tier one
      if (!subscription) {
        const totalUsers = await db.user.count()
        const freeHours = getFreeTierHours(totalUsers)
        const plan = PLANS.find(p => p.hours === freeHours) || PLANS[0]

        subscription = await db.subscription.create({
          data: {
            tenantId,
            planHours: freeHours,
            planName: `${freeHours}Hrs Free Plan`,
            mrp: 0, // Free
            discountPercent: 100,
            discountAmount: 0,
            totalSeconds: freeHours * 3600,
            remainingSeconds: freeHours * 3600,
            status: 'ACTIVE',
            isFreeTier: true,
            freeTierHours: freeHours,
            mainAdminHours: plan.roleAllocation.MAIN_ADMIN,
            juniorAdminHours: plan.roleAllocation.JUNIOR_ADMIN,
            dataEntryHours: plan.roleAllocation.DATA_ENTRY,
            viewOnlyHours: 0,
          },
          include: { recharges: true },
        })

        console.log(`[SUBSCRIPTION] Created free tier (${freeHours}Hrs) for tenant ${tenantId}`)
      }

      return NextResponse.json({
        subscription: {
          id: subscription.id,
          planHours: subscription.planHours,
          planName: subscription.planName,
          remainingHours: Math.floor(subscription.remainingSeconds / 3600),
          remainingMinutes: Math.floor((subscription.remainingSeconds % 3600) / 60),
          status: subscription.status,
          isFreeTier: subscription.isFreeTier,
          freeTierHours: subscription.freeTierHours,
          mainAdminHours: subscription.mainAdminHours,
          juniorAdminHours: subscription.juniorAdminHours,
          dataEntryHours: subscription.dataEntryHours,
          viewOnlyHours: subscription.viewOnlyHours,
          startDate: subscription.startDate.toISOString(),
          endDate: subscription.endDate?.toISOString() || null,
        },
        recharges: subscription.recharges.map(r => ({
          id: r.id,
          planName: r.planName,
          planHours: r.planHours,
          mrp: r.mrp,
          paymentMode: r.paymentMode,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        })),
        availablePlans: PLANS.map(p => ({
          hours: p.hours,
          name: p.name,
          mrp: p.mrp,
          discountPercent: p.discountPercent,
          discountAmount: p.discountAmount,
          finalPrice: p.mrp - p.discountAmount,
          totalSeconds: p.totalSeconds,
          roleAllocation: p.roleAllocation,
        })),
      })
    }

    // ============================================================
    // RECHARGE — activate a paid plan (MANUAL for now, FREE for free tier)
    // ============================================================
    if (action === 'recharge') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      const { planHours, paymentMode, paymentRef } = body
      const plan = PLANS.find(p => p.hours === planHours)
      if (!plan) {
        return NextResponse.json({ error: 'Invalid plan. Choose from: 50, 100, 200, 500, 1000' }, { status: 400 })
      }

      let subscription = await db.subscription.findUnique({ where: { tenantId } })
      if (!subscription) {
        return NextResponse.json({ error: 'No subscription found. Please refresh.' }, { status: 404 })
      }

      // Add recharge seconds to remaining
      const newRemaining = subscription.remainingSeconds + plan.totalSeconds

      // Update subscription
      subscription = await db.subscription.update({
        where: { id: subscription.id },
        data: {
          planHours: plan.hours,
          planName: plan.name,
          mrp: plan.mrp,
          discountPercent: plan.discountPercent,
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

      // Create recharge log
      await db.recharge.create({
        data: {
          subscriptionId: subscription.id,
          planHours: plan.hours,
          planName: plan.name,
          mrp: plan.mrp,
          discountPercent: plan.discountPercent,
          discountAmount: plan.discountAmount,
          totalSeconds: plan.totalSeconds,
          paymentMode: paymentMode || 'MANUAL',
          paymentRef: paymentRef || null,
          status: 'COMPLETED',
        },
      })

      await writeAuditLog({
        tenantId,
        userId: access.userId,
        userName: access.user.name,
        action: 'CREATE',
        entityType: 'Recharge',
        entityName: plan.name,
        changes: { planHours: plan.hours, mrp: plan.mrp, paymentMode: paymentMode || 'MANUAL' },
      })

      return NextResponse.json({
        success: true,
        message: `${plan.name} activated successfully!`,
        subscription: {
          planHours: subscription.planHours,
          planName: subscription.planName,
          remainingHours: Math.floor(subscription.remainingSeconds / 3600),
          status: subscription.status,
        },
      })
    }

    // ============================================================
    // LOG-USAGE — deduct seconds from subscription (called by middleware)
    // ============================================================
    if (action === 'log-usage') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { secondsUsed, userRole } = body
      if (!secondsUsed || secondsUsed <= 0) {
        return NextResponse.json({ error: 'secondsUsed must be positive' }, { status: 400 })
      }

      const subscription = await db.subscription.findUnique({ where: { tenantId } })
      if (!subscription) {
        return NextResponse.json({ error: 'No subscription' }, { status: 404 })
      }

      // Only deduct from non-VIEW_ONLY users
      if (userRole === 'VIEW_ONLY') {
        return NextResponse.json({ success: true, message: 'View Only users are free' })
      }

      const newRemaining = Math.max(0, subscription.remainingSeconds - secondsUsed)
      const newStatus = newRemaining === 0 ? 'CONVERTED_TO_VIEW_ONLY' : subscription.status

      await db.subscription.update({
        where: { id: subscription.id },
        data: {
          remainingSeconds: newRemaining,
          status: newStatus,
        },
      })

      await db.usageLog.create({
        data: {
          subscriptionId: subscription.id,
          userId: access.userId,
          userRole,
          secondsUsed,
          remainingAfter: newRemaining,
        },
      })

      return NextResponse.json({
        success: true,
        remainingSeconds: newRemaining,
        remainingHours: Math.floor(newRemaining / 3600),
        status: newStatus,
      })
    }

    // ============================================================
    // GET-USAGE-LOGS — main admin can view usage logs
    // ============================================================
    if (action === 'usage-logs') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      const subscription = await db.subscription.findUnique({ where: { tenantId } })
      if (!subscription) {
        return NextResponse.json({ logs: [] })
      }

      const logs = await db.usageLog.findMany({
        where: { subscriptionId: subscription.id },
        orderBy: { loggedAt: 'desc' },
        take: 100,
      })

      return NextResponse.json({
        logs: logs.map(l => ({
          id: l.id,
          userRole: l.userRole,
          secondsUsed: l.secondsUsed,
          remainingAfter: l.remainingAfter,
          loggedAt: l.loggedAt.toISOString(),
        })),
      })
    }

    // ============================================================
    // v4.7: ADMIN-LIST-ALL — Super Admin views ALL tenants' subscriptions (Rule 1.4)
    // ============================================================
    if (action === 'admin-list-all') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      // Restrict to admin@bizbook.pro or pranjalgoswamighy86@gmail.com (per Spec Part 9)
      const ADMIN_BYPASS_EMAILS = [
        'admin@bizbook.pro',
        (process.env.ADMIN_EMAIL || '').toLowerCase(),
        'pranjalgoswamighy86@gmail.com',
        (process.env.INFRASTRUCTURE_OWNER_EMAIL || '').toLowerCase(),
      ].filter(Boolean)

      if (!access.user?.email || !ADMIN_BYPASS_EMAILS.includes(access.user.email.toLowerCase())) {
        return NextResponse.json({ error: 'FORBIDDEN — Super Admin only' }, { status: 403 })
      }

      // Fetch ALL subscriptions with tenant info
      const allSubs = await db.subscription.findMany({
        include: {
          tenant: {
            select: { id: true, name: true, email: true, phone: true, plan: true, createdAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      return NextResponse.json({
        totalTenants: allSubs.length,
        subscriptions: allSubs.map(s => ({
          id: s.id,
          tenantId: s.tenantId,
          tenantName: s.tenant?.name || 'Unknown',
          tenantEmail: s.tenant?.email || '',
          tenantPhone: s.tenant?.phone || '',
          planName: s.planName,
          planHours: s.planHours,
          remainingSeconds: s.remainingSeconds,
          remainingHours: Math.floor(s.remainingSeconds / 3600),
          totalSeconds: s.totalSeconds,
          status: s.status,
          isFreeTier: s.isFreeTier,
          freeTierHours: s.freeTierHours,
          startDate: s.startDate.toISOString(),
          endDate: s.endDate?.toISOString() || null,
          maxUsersAllowed: (s as any).maxUsersAllowed || null,
          customPlanType: (s as any).customPlanType || null,
        })),
      })
    }

    // ============================================================
    // v4.7: ADMIN-MODIFY — Super Admin modifies any tenant's subscription (Rule 1.4)
    // Allows: maxUsersAllowed, customPlanType, endDate, remainingSeconds, planHours, planName
    // ============================================================
    if (action === 'admin-modify') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      // Restrict to admin@bizbook.pro or pranjalgoswamighy86@gmail.com (per Spec Part 9)
      const ADMIN_BYPASS_EMAILS = [
        'admin@bizbook.pro',
        (process.env.ADMIN_EMAIL || '').toLowerCase(),
        'pranjalgoswamighy86@gmail.com',
        (process.env.INFRASTRUCTURE_OWNER_EMAIL || '').toLowerCase(),
      ].filter(Boolean)

      if (!access.user?.email || !ADMIN_BYPASS_EMAILS.includes(access.user.email.toLowerCase())) {
        return NextResponse.json({ error: 'FORBIDDEN — Super Admin only' }, { status: 403 })
      }

      const { targetTenantId, modifications } = body
      if (!targetTenantId) {
        return NextResponse.json({ error: 'targetTenantId required' }, { status: 400 })
      }

      // Find the target tenant's subscription
      const targetSub = await db.subscription.findUnique({
        where: { tenantId: targetTenantId },
      })
      if (!targetSub) {
        return NextResponse.json({ error: 'Subscription not found for target tenant' }, { status: 404 })
      }

      // Build update payload from allowed modifications (Rule 1.4)
      const updateData: any = {}
      const allowedFields = [
        'remainingSeconds',
        'planHours',
        'planName',
        'status',
        'isFreeTier',
        'freeTierHours',
        'maxUsersAllowed',
        'customPlanType',
        'endDate',
        'totalSeconds',
      ]

      for (const field of allowedFields) {
        if (field in (modifications || {})) {
          if (field === 'endDate' && modifications[field]) {
            updateData[field] = new Date(modifications[field])
          } else {
            updateData[field] = modifications[field]
          }
        }
      }

      if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: 'No valid modifications provided' }, { status: 400 })
      }

      const updated = await db.subscription.update({
        where: { id: targetSub.id },
        data: updateData,
      })

      // Audit log (use existing writeAuditLog signature)
      await writeAuditLog({
        tenantId: targetTenantId,
        userId: access.userId,
        action: 'UPDATE',
        entityType: 'Subscription',
        entityId: targetSub.id,
        entityName: targetSub.planName,
        changes: {
          adminEmail: access.user.email,
          action: 'SUBSCRIPTION_ADMIN_MODIFY',
          modifications: updateData,
          timestamp: new Date().toISOString(),
        } as any,
      })

      console.log(`[SUBSCRIPTION][ADMIN-MODIFY] ${access.user.email} modified tenant ${targetTenantId}:`, updateData)

      return NextResponse.json({
        success: true,
        subscription: {
          id: updated.id,
          tenantId: updated.tenantId,
          planName: updated.planName,
          planHours: updated.planHours,
          remainingSeconds: updated.remainingSeconds,
          status: updated.status,
          endDate: updated.endDate?.toISOString() || null,
          maxUsersAllowed: (updated as any).maxUsersAllowed || null,
          customPlanType: (updated as any).customPlanType || null,
        },
        message: 'Subscription modified by Super Admin (Rule 1.4)',
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Subscription error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
