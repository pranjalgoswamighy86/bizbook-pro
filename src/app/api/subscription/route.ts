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

// v4.130: Pricing model constants
// - Default: 3 non-view-only users included with every plan
// - Extra non-view-only user: ₹149 one-time fee
// - Recharge surcharge: 15% added to plan price if tenant has extra non-view-only users
// - View-only users: UNLIMITED (free, not counted toward any limit)
export const DEFAULT_NON_VIEW_ONLY_USERS = 3
export const EXTRA_USER_ONE_TIME_FEE = 149
export const EXTRA_USER_RECHARGE_SURCHARGE_PERCENT = 15

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

      // v6.10: TENANT-LEVEL WALLET — find the OWNER's subscription (not this company's)
      // The tenant (owner) has ONE wallet. All companies read from the SAME wallet.
      // If user is in Company B, we find the OWNER's original company (Company A)
      // and read the subscription from THERE.
      const ownerUserTenants = await db.userTenant.findMany({
        where: { userId: access.userId, role: 'MAIN_ADMIN', isOwner: true },
        select: { tenantId: true },
      })
      const allOwnerTenantIds = ownerUserTenants.map(ut => ut.tenantId)

      // v6.10: Find subscription from ANY of the owner's companies
      // Use the FIRST one that has a subscription (this is the "wallet")
      let subscription = await db.subscription.findFirst({
        where: { tenantId: { in: allOwnerTenantIds.length > 0 ? allOwnerTenantIds : [tenantId] } },
        include: { recharges: { orderBy: { createdAt: 'desc' }, take: 10 } },
      })

      // If no subscription exists, create ONE for this tenant (the wallet)
      if (!subscription) {
        const totalUsers = await db.user.count()
        const freeHours = getFreeTierHours(totalUsers)
        const plan = PLANS.find(p => p.hours === freeHours) || PLANS[0]

        subscription = await db.subscription.create({
          data: {
            tenantId, // Create on current company, but all companies read from it
            planHours: freeHours,
            planName: `${freeHours}Hrs Free Plan`,
            mrp: 0,
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

        console.log(`[SUBSCRIPTION] Created free tier (${freeHours}Hrs) — TENANT WALLET for tenant ${tenantId}`)
      }

      // v6.10: The wallet is the subscription we just found.
      // ALL companies see the SAME remainingSeconds from this wallet.
      // No per-company splitting. No summing. Just ONE number.
      const walletRemainingSeconds = subscription.remainingSeconds
      const walletStatus = subscription.status

      // v6.6: Count ACTUAL non-view-only users GLOBALLY across ALL companies
      // (reuse allOwnerTenantIds from the wallet lookup above)
      const { rawDb } = await import('@/lib/db-soft-delete')

      // Count ALL UNIQUE non-view-only users across ALL companies
      const allNonViewUserTenants = await rawDb.userTenant.findMany({
        where: {
          tenantId: { in: allOwnerTenantIds.length > 0 ? allOwnerTenantIds : [tenantId] },
          role: { notIn: ['VIEW_ONLY'] },
        },
        select: { userId: true },
        distinct: ['userId'],
      })
      const actualNonViewOnlyCount = allNonViewUserTenants.length
      const DEFAULT_NON_VIEW_ONLY_USERS = 3
      const actualExtraIds = Math.max(0, actualNonViewOnlyCount - DEFAULT_NON_VIEW_ONLY_USERS)
      const hasExtraUsers = actualNonViewOnlyCount > DEFAULT_NON_VIEW_ONLY_USERS

      return NextResponse.json({
        subscription: {
          id: subscription.id,
          planHours: subscription.planHours,
          planName: subscription.planName,
          // v6.10: ALL companies see the SAME wallet balance
          remainingHours: Math.floor(walletRemainingSeconds / 3600),
          remainingMinutes: Math.floor((walletRemainingSeconds % 3600) / 60),
          remainingSeconds: walletRemainingSeconds,
          status: walletStatus,
          isFreeTier: subscription.isFreeTier,
          freeTierHours: subscription.freeTierHours,
          mainAdminHours: subscription.mainAdminHours,
          juniorAdminHours: subscription.juniorAdminHours,
          dataEntryHours: subscription.dataEntryHours,
          viewOnlyHours: subscription.viewOnlyHours,
          startDate: subscription.startDate.toISOString(),
          endDate: subscription.endDate?.toISOString() || null,
          extraJuniorAdminSlots: (subscription as any).extraJuniorAdminSlots || 0,
          extraDataEntrySlots: (subscription as any).extraDataEntrySlots || 0,
          maxUsersAllowed: (subscription as any).maxUsersAllowed || null,
          actualNonViewOnlyCount,
          actualExtraIds,
          hasExtraUsers,
          mrp: subscription.mrp,
          includedSlots: {
            mainAdmin: 1,
            juniorAdmin: 1,
            dataEntry: 1,
            viewOnly: 'Unlimited',
          },
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
          finalPrice: p.discountAmount, // v4.143: discountAmount IS the price customer pays (e.g., ₹150 for 50Hrs)
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

      // v6.10: Find the TENANT WALLET (not per-company subscription)
      // The wallet is the first subscription found across ALL owner's companies
      const rechargeOwnerTenants = await db.userTenant.findMany({
        where: { userId: access.userId, role: 'MAIN_ADMIN', isOwner: true },
        select: { tenantId: true },
      })
      const rechargeAllTenantIds = rechargeOwnerTenants.map(ut => ut.tenantId)

      let subscription = await db.subscription.findFirst({
        where: { tenantId: { in: rechargeAllTenantIds.length > 0 ? rechargeAllTenantIds : [tenantId] } },
      })
      if (!subscription) {
        return NextResponse.json({ error: 'No subscription found. Please refresh.' }, { status: 404 })
      }

      // v6.6: Calculate 15% surcharge based on GLOBAL non-view-only user count
      const { rawDb: rawDb2 } = await import('@/lib/db-soft-delete')

      // v6.9: Count UNIQUE non-view-only users (not per-company entries)
      const allNonViewUserTenantsRecharge = await rawDb2.userTenant.findMany({
        where: {
          tenantId: { in: rechargeAllTenantIds.length > 0 ? rechargeAllTenantIds : [tenantId] },
          role: { notIn: ['VIEW_ONLY'] },
        },
        select: { userId: true },
        distinct: ['userId'],
      })
      const actualNonViewOnlyCountRecharge = allNonViewUserTenantsRecharge.length
      const hasExtraUsers = actualNonViewOnlyCountRecharge > DEFAULT_NON_VIEW_ONLY_USERS
      const basePrice = plan.discountAmount // e.g., 150 for 50Hrs plan
      const surchargeAmount = hasExtraUsers ? Math.round(basePrice * EXTRA_USER_RECHARGE_SURCHARGE_PERCENT / 100) : 0
      const finalPrice = basePrice + surchargeAmount

      if (hasExtraUsers) {
        console.log(`[RECHARGE] User ${access.userId} has ${actualNonViewOnlyCountRecharge} non-view-only users globally (> ${DEFAULT_NON_VIEW_ONLY_USERS}). Applying 15% surcharge: ₹${basePrice} + ₹${surchargeAmount} = ₹${finalPrice}`)
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
          planName: hasExtraUsers ? `${plan.name} (+15% extra user surcharge)` : plan.name,
          mrp: plan.mrp,
          discountPercent: plan.discountPercent,
          discountAmount: finalPrice, // v4.130: includes surcharge if applicable
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
    // LOG-USAGE — deduct seconds from POOLED subscription across ALL companies
    // ============================================================
    // v6.5: Hours are now POOLED across all companies owned by the same user.
    // When user A uses hours in Company X, the deduction applies to ALL
    // companies where user A is the owner (MAIN_ADMIN + isOwner).
    // This implements the "universal admin" model where one user's hours
    // are shared across all their companies.
    if (action === 'log-usage') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { secondsUsed, userRole } = body
      if (!secondsUsed || secondsUsed <= 0) {
        return NextResponse.json({ error: 'secondsUsed must be positive' }, { status: 400 })
      }

      // Only deduct from non-VIEW_ONLY users
      if (userRole === 'VIEW_ONLY') {
        return NextResponse.json({ success: true, message: 'View Only users are free' })
      }

      // v6.10: Find the TENANT WALLET (single subscription, not per-company)
      // The wallet is ONE subscription record. All companies read/write to it.
      const walletOwnerTenants = await db.userTenant.findMany({
        where: { userId: access.userId, role: 'MAIN_ADMIN', isOwner: true },
        select: { tenantId: true },
      })
      const walletTenantIds = walletOwnerTenants.map(ut => ut.tenantId)

      const walletSubscription = await db.subscription.findFirst({
        where: { tenantId: { in: walletTenantIds.length > 0 ? walletTenantIds : [tenantId] } },
      })

      if (!walletSubscription) {
        return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
      }

      // v6.10: Deduct from the SINGLE wallet (not per-company)
      const walletRemaining = walletSubscription.remainingSeconds
      const newRemaining = Math.max(0, walletRemaining - secondsUsed)
      const wasActive = walletSubscription.status !== 'CONVERTED_TO_VIEW_ONLY'
      const isNowExhausted = newRemaining === 0
      const newStatus = isNowExhausted ? 'CONVERTED_TO_VIEW_ONLY' : walletSubscription.status

      // Update the wallet
      await db.subscription.update({
        where: { id: walletSubscription.id },
        data: {
          remainingSeconds: newRemaining,
          status: newStatus,
        },
      })

      // Log usage
      await db.usageLog.create({
        data: {
          subscriptionId: walletSubscription.id,
          userId: access.userId,
          userRole,
          secondsUsed,
          remainingAfter: newRemaining,
        },
      })

      console.log(`[WALLET] Tenant used ${secondsUsed}s. Wallet: ${walletRemaining} → ${newRemaining}`)

      // v6.5: Check usage limit (maxSecondsPerMonth) for this user in this tenant
      const userTenant = await db.userTenant.findUnique({
        where: { userId_tenantId: { userId: access.userId, tenantId } },
      })
      if (userTenant?.maxSecondsPerMonth) {
        // Check how much this user has used this month
        const monthStart = new Date()
        monthStart.setDate(1)
        monthStart.setHours(0, 0, 0, 0)

        const monthlyUsage = await db.usageLog.aggregate({
          where: {
            userId: access.userId,
            loggedAt: { gte: monthStart },
          },
          _sum: { secondsUsed: true },
        })

        const totalUsedThisMonth = monthlyUsage._sum.secondsUsed || 0
        if (totalUsedThisMonth >= userTenant.maxSecondsPerMonth) {
          return NextResponse.json({
            error: `Monthly usage limit reached (${Math.floor(userTenant.maxSecondsPerMonth / 3600)} hours). Contact your administrator.`,
            code: 'MONTHLY_LIMIT_REACHED',
            usedSeconds: totalUsedThisMonth,
            maxSeconds: userTenant.maxSecondsPerMonth,
          }, { status: 403 })
        }
      }

      // v6.10: Auto-convert when WALLET is exhausted
      if (isNowExhausted && wasActive) {
        console.log(`[WALLET] Hours exhausted for user ${access.userId}. Auto-converting non-owner users to VIEW_ONLY.`)
        // Convert across ALL companies owned by this user
        for (const wt of walletOwnerTenants) {
          const usersToConvert = await db.userTenant.findMany({
            where: {
              tenantId: wt.tenantId,
              role: { not: 'VIEW_ONLY' },
              isOwner: false,
            },
            select: { userId: true },
          })

          await db.userTenant.updateMany({
            where: {
              tenantId: wt.tenantId,
              role: { not: 'VIEW_ONLY' },
              isOwner: false,
            },
            data: { role: 'VIEW_ONLY' },
          })

          if (usersToConvert.length > 0) {
            await db.user.updateMany({
              where: { id: { in: usersToConvert.map(u => u.userId) } },
              data: { role: 'VIEW_ONLY' },
            })
          }

          // Owner: User.role = VIEW_ONLY, UserTenant.role stays MAIN_ADMIN
          const owner = await db.userTenant.findFirst({
            where: { tenantId: wt.tenantId, isOwner: true },
            select: { userId: true },
          })
          if (owner) {
            await db.user.update({
              where: { id: owner.userId },
              data: { role: 'VIEW_ONLY' },
            })
          }
        }
        // Audit log the auto-conversion
        await db.auditLog.create({
          data: {
            tenantId,
            userId: access.userId,
            userName: access.user.name,
            userRole,
            action: 'UPDATE',
            entityType: 'Subscription',
            entityId: 'pooled',
            entityName: 'Auto-converted to VIEW_ONLY (pooled hours exhausted)',
          },
        })
      }

      return NextResponse.json({
        success: true,
        remainingSeconds: newRemaining,
        remainingHours: Math.floor(newRemaining / 3600),
        status: newStatus,
        autoConverted: isNowExhausted && wasActive,
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

      // v4.118: Query ALL tenants (not just those with subscription records).
      // Previously this only queried db.subscription.findMany() which missed any
      // tenant that didn't have a subscription row yet. Now we query tenants
      // first, then LEFT JOIN subscriptions + record counts for a full report.
      const allTenants = await db.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          plan: true,
          isDeleted: true,
          deletedAt: true,
          createdAt: true,
        },
      })

      // Fetch all subscriptions (for the tenants that have them)
      const allSubs = await db.subscription.findMany({
        where: { tenantId: { in: allTenants.map(t => t.id) } },
      })
      const subMap = new Map(allSubs.map(s => [s.tenantId, s]))

      // Fetch record counts per tenant (sales, purchases, expenses, inventory, parties)
      // Using rawDb to bypass soft-delete filter — we want to see ALL data including soft-deleted
      const { rawDb } = await import('@/lib/db-soft-delete')
      const tenantIds = allTenants.map(t => t.id)

      // Use groupBy to count records per tenant for each table
      const [salesCounts, purchaseCounts, expenseCounts, inventoryCounts, partyCounts, userCounts] = await Promise.all([
        rawDb.sale.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
        rawDb.purchase.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
        rawDb.expense.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
        rawDb.inventoryItem.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
        rawDb.party.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
        rawDb.user.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
      ])

      // Build count maps
      const toCountMap = (rows: Array<{ tenantId: string; _count: { _all: number } }>) => {
        const map = new Map<string, number>()
        for (const r of rows) map.set(r.tenantId, r._count._all)
        return map
      }
      const salesMap = toCountMap(salesCounts as any[])
      const purchaseMap = toCountMap(purchaseCounts as any[])
      const expenseMap = toCountMap(expenseCounts as any[])
      const inventoryMap = toCountMap(inventoryCounts as any[])
      const partyMap = toCountMap(partyCounts as any[])
      const userMap = toCountMap(userCounts as any[])

      return NextResponse.json({
        totalTenants: allTenants.length,
        activeTenants: allTenants.filter(t => !t.isDeleted).length,
        softDeletedTenants: allTenants.filter(t => t.isDeleted).length,
        tenantsWithSubscriptions: allSubs.length,
        subscriptions: allTenants.map(t => {
          const s = subMap.get(t.id)
          return {
            id: s?.id || `tenant-${t.id}`,
            tenantId: t.id,
            tenantName: t.name,
            tenantEmail: t.email || '',
            tenantPhone: t.phone || '',
            tenantPlan: t.plan,
            isDeleted: t.isDeleted,
            deletedAt: t.deletedAt?.toISOString() || null,
            tenantCreatedAt: t.createdAt.toISOString(),
            // Subscription fields (may be null if no subscription record)
            planName: s?.planName || null,
            planHours: s?.planHours || 0,
            remainingSeconds: s?.remainingSeconds || 0,
            remainingHours: s ? Math.floor(s.remainingSeconds / 3600) : 0,
            totalSeconds: s?.totalSeconds || 0,
            status: s?.status || 'NO_SUBSCRIPTION',
            isFreeTier: s?.isFreeTier ?? true,
            freeTierHours: s?.freeTierHours || 100,
            startDate: s?.startDate?.toISOString() || null,
            endDate: s?.endDate?.toISOString() || null,
            maxUsersAllowed: (s as any)?.maxUsersAllowed || null,
            customPlanType: (s as any)?.customPlanType || null,
            // v4.118: Record counts for full tenant report
            recordCounts: {
              users: userMap.get(t.id) || 0,
              sales: salesMap.get(t.id) || 0,
              purchases: purchaseMap.get(t.id) || 0,
              expenses: expenseMap.get(t.id) || 0,
              inventory: inventoryMap.get(t.id) || 0,
              parties: partyMap.get(t.id) || 0,
            },
          }
        }),
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

    // ============================================================
    // v4.96: ADD-EXTRA-ID — Purchase extra Junior Admin or Data Entry slot
    // Cost: ₹149 per ID
    // Recharge amount increases by 15% of MRP of current plan per extra ID
    // ============================================================
    if (action === 'add-extra-id') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      // v4.132: Removed roleType requirement — single "Add Extra ID" option
      const { utr, screenshot } = body

      // v4.99: Require UTR + screenshot for payment proof
      if (!utr || !utr.trim()) {
        return NextResponse.json({ error: 'UTR number is required. Enter the 12-digit UPI transaction ID.' }, { status: 400 })
      }
      if (!screenshot) {
        return NextResponse.json({ error: 'Payment screenshot is required.' }, { status: 400 })
      }

      const subscription = await db.subscription.findUnique({ where: { tenantId: access.tenantId } })
      if (!subscription) {
        return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
      }

      // Calculate cost: ₹149 per ID
      const costPerId = EXTRA_USER_ONE_TIME_FEE

      // v4.132: Auto-verify — check if UTR matches any bank transaction
      let autoApproved = false
      try {
        const { rawDb } = await import('@/lib/db-soft-delete')
        // Check if this UTR already exists in bank transactions (any tenant's bank statement)
        const matchingTxn = await rawDb.bankTransaction.findFirst({
          where: {
            reference: { contains: utr.trim(), mode: 'insensitive' as any },
          },
        })
        if (matchingTxn && matchingTxn.deposit >= costPerId) {
          autoApproved = true
          console.log(`[EXTRA-ID] UTR ${utr} matched bank transaction ${matchingTxn.id} — auto-approving`)
        }
      } catch (e: any) {
        console.warn('[EXTRA-ID] Bank UTR auto-check failed:', e?.message)
      }

      // v4.99: Create a SubscriptionQueue entry for payment proof tracking
      const queueEntry = await db.subscriptionQueue.create({
        data: {
          tenantId: access.tenantId,
          baseAmount: costPerId,
          finalAmount: costPerId,
          paiseIncrement: 0,
          planHours: 0,
          planName: 'Extra ID (Non-View-Only)',
          status: autoApproved ? 'AUTO_APPROVED' : 'PROOF_SUBMITTED',
          utrNumber: utr.trim(),
          screenshotPath: screenshot,
          proofSubmittedAt: new Date(),
          ...(autoApproved ? { approvedAt: new Date() } : {}),
        },
      })

      // Update subscription with extra slot (use maxUsersAllowed field)
      const currentMax = (subscription as any).maxUsersAllowed || 0
      const newMax = currentMax === 0 ? DEFAULT_NON_VIEW_ONLY_USERS + 1 : currentMax + 1

      const updated = await db.subscription.update({
        where: { id: subscription.id },
        data: {
          maxUsersAllowed: newMax,
        },
      })

      // Audit log
      await db.auditLog.create({
        data: {
          tenantId: access.tenantId,
          userId: access.userId,
          userName: access.user.name,
          action: 'UPDATE',
          entityType: 'Subscription',
          entityId: subscription.id,
          entityName: `Extra ID purchased${autoApproved ? ' (Auto-approved via UTR match)' : ''}`,
          changes: JSON.stringify({
            costPerId,
            utr: utr.trim(),
            queueId: queueEntry.id,
            newMaxUsers: newMax,
            autoApproved,
            timestamp: new Date().toISOString(),
          }),
        },
      })

      return NextResponse.json({
        success: true,
        autoApproved,
        message: autoApproved
          ? 'Extra ID activated! UTR matched bank statement — auto-approved.'
          : 'Extra ID payment proof submitted. Awaiting Super Admin verification.',
        newMaxUsers: newMax,
        cost: costPerId,
        utr: utr.trim(),
      })
    }

    // ============================================================
    // v4.96: GET-EXTRA-ID-INFO — Get pricing info for extra IDs
    // ============================================================
    if (action === 'get-extra-id-info') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const subscription = await db.subscription.findUnique({ where: { tenantId: access.tenantId } })
      if (!subscription) {
        return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
      }

      const costPerId = 149
      const rechargeIncrease = Math.round(subscription.mrp * 0.15)

      return NextResponse.json({
        costPerId,
        rechargeIncrease,
        currentPlanMRP: subscription.mrp,
        extraJuniorAdminSlots: (subscription as any).extraJuniorAdminSlots || 0,
        extraDataEntrySlots: (subscription as any).extraDataEntrySlots || 0,
        includedSlots: {
          mainAdmin: 1,
          juniorAdmin: 1,
          dataEntry: 1,
          viewOnly: 'Unlimited',
        },
        pricingNote: `Each extra Junior Admin or Data Entry ID costs ₹${costPerId}. Recharge amount increases by 15% of MRP (₹${rechargeIncrease}) for each extra ID.`,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Subscription error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
