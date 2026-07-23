import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

// =====================================================================
// v6.28.1: SINGLE SOURCE OF TRUTH for receivables
// =====================================================================
// Previously, the Debtor.currentBalance column was the source of truth
// for the Dashboard and AR tab, while the Sale Register used
// `Sale.totalAmount - Sale.amountReceived`. These two could drift
// whenever a Receipt was created without an invoiceRef, or when a
// Debtor's openingBalance was set manually.
//
// Now the `list` action derives each debtor's currentBalance from the
// Sale table — summing `totalAmount - amountReceived` across all
// non-cash, non-fully-paid sales for that party. This guarantees the
// AR tab and Dashboard always match the Sale Register's "Due" column.
//
// The Debtor.currentBalance column is still kept in the DB for backward
// compatibility, but the `list` action overwrites it with the computed
// value before returning. Manual debtor `create` still sets an opening
// balance (for pre-existing receivables not tied to a sale), which is
// added to the sale-derived balance.
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

      const debtor = await db.debtor.create({ data: { ...body.data, tenantId, currentBalance: body.data.openingBalance || 0 } })
      return NextResponse.json({ debtor })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      const debtor = await db.debtor.update({ where: { id }, data })
      return NextResponse.json({ debtor })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      await db.debtor.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
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
      const debtors = await db.debtor.findMany({ where, orderBy: { name: 'asc' } })

      // v6.28.1: Derive each debtor's currentBalance from the Sale table
      // (single source of truth). This guarantees the AR tab matches the
      // Sale Register's "Due" column exactly. We also fetch all outstanding
      // sales in one query (grouped by partyName) to avoid N+1.
      const outstandingSales = await db.sale.findMany({
        where: {
          tenantId: access.tenantId,
          isDeleted: false,
          paymentStatus: { not: 'RECEIVED' },
        },
        select: { partyName: true, totalAmount: true, amountReceived: true, amountPaid: true },
      })
      // Build a map of partyName → total outstanding receivable
      const receivableByParty: Record<string, number> = {}
      for (const s of outstandingSales) {
        const due = (s.totalAmount || 0) - (s.amountReceived || s.amountPaid || 0)
        if (due > 0) {
          receivableByParty[s.partyName] = (receivableByParty[s.partyName] || 0) + due
        }
      }

      // Overwrite each debtor's currentBalance with the sale-derived value.
      // If a debtor has an openingBalance (manual pre-existing receivable not
      // tied to a sale), add it on top so manually-created opening balances
      // are preserved.
      const debtorsWithComputedBalance = debtors.map(d => {
        const saleDerived = Math.round((receivableByParty[d.name] || 0) * 100) / 100
        const openingAdjustment = d.openingBalance || 0
        return {
          ...d,
          currentBalance: Math.round((saleDerived + openingAdjustment) * 100) / 100,
        }
      })

      const totalReceivable = debtorsWithComputedBalance.reduce((sum, d) => sum + d.currentBalance, 0)
      return NextResponse.json({
        debtors: debtorsWithComputedBalance,
        totalReceivable: Math.round(totalReceivable * 100) / 100,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Debtors error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
