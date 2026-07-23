import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

// =====================================================================
// v6.28.1: SINGLE SOURCE OF TRUTH for payables
// =====================================================================
// Previously, the Creditor.currentBalance column was the source of truth
// for the Dashboard and AP tab, while the Purchase Register used
// `Purchase.totalAmount - Purchase.amountPaid`. These two could drift
// whenever a Payment was created without an invoiceRef, or when a
// Creditor's openingBalance was set manually.
//
// Now the `list` action derives each creditor's currentBalance from the
// Purchase table — summing `totalAmount - amountPaid` across all
// non-cash, non-fully-paid purchases for that party. This guarantees the
// AP tab and Dashboard always match the Purchase Register's "Due" column.
//
// The Creditor.currentBalance column is still kept in the DB for backward
// compatibility, but the `list` action overwrites it with the computed
// value before returning. Manual creditor `create` still sets an opening
// balance (for pre-existing payables not tied to a purchase), which is
// added to the purchase-derived balance.
// =====================================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const creditor = await db.creditor.create({ data: { ...body.data, tenantId, currentBalance: body.data.openingBalance || 0 } })
      return NextResponse.json({ creditor })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      const creditor = await db.creditor.update({ where: { id }, data })
      return NextResponse.json({ creditor })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      await db.creditor.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
      return NextResponse.json({ success: true })
    }

    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { search } = body
      const where: Record<string, unknown> = { tenantId: access.tenantId, isDeleted: false }
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { phone: { contains: search } },
          { gstNumber: { contains: search } },
        ]
      }
      // v4.55: Add pagination for 1000+ user scalability
      const page = Number(body.page) || 1
      const limit = Math.min(Number(body.limit) || 100, 500)
      const skip = (page - 1) * limit
      const creditors = await db.creditor.findMany({ where, orderBy: { name: 'asc' }, take: limit, skip })

      // v6.28.1: Derive each creditor's currentBalance from the Purchase table
      // (single source of truth). This guarantees the AP tab matches the
      // Purchase Register's "Due" column exactly. We fetch all outstanding
      // purchases in one query (grouped by partyName) to avoid N+1.
      const outstandingPurchases = await db.purchase.findMany({
        where: {
          tenantId: access.tenantId,
          isDeleted: false,
          paymentStatus: { not: 'PAID' },
        },
        select: { partyName: true, totalAmount: true, amountPaid: true },
      })
      // Build a map of partyName → total outstanding payable
      const payableByParty: Record<string, number> = {}
      for (const p of outstandingPurchases) {
        const due = (p.totalAmount || 0) - (p.amountPaid || 0)
        if (due > 0) {
          payableByParty[p.partyName] = (payableByParty[p.partyName] || 0) + due
        }
      }

      // Overwrite each creditor's currentBalance with the purchase-derived value.
      // If a creditor has an openingBalance (manual pre-existing payable not
      // tied to a purchase), add it on top so manually-created opening balances
      // are preserved.
      const creditorsWithComputedBalance = creditors.map(c => {
        const purchaseDerived = Math.round((payableByParty[c.name] || 0) * 100) / 100
        const openingAdjustment = c.openingBalance || 0
        return {
          ...c,
          currentBalance: Math.round((purchaseDerived + openingAdjustment) * 100) / 100,
        }
      })

      const totalPayable = creditorsWithComputedBalance.reduce((sum, c) => sum + c.currentBalance, 0)
      const totalCount = await db.creditor.count({ where })
      return NextResponse.json({
        creditors: creditorsWithComputedBalance,
        totalPayable: Math.round(totalPayable * 100) / 100,
        page, limit,
        hasMore: skip + creditors.length < totalCount,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Creditors error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
