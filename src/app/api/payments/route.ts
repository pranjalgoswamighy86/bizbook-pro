import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const payment = await db.payment.create({ data: { ...body.data, tenantId } })
      return NextResponse.json({ payment })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      const payment = await db.payment.update({ where: { id }, data })
      return NextResponse.json({ payment })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      await db.payment.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
      return NextResponse.json({ success: true })
    }

    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { startDate, endDate, search } = body
      const where: Record<string, unknown> = { tenantId, isDeleted: false }
      if (startDate && endDate) {
        where.date = { gte: new Date(startDate), lt: new Date(endDate) }
      }
      if (search) {
        where.OR = [
          { partyName: { contains: search } },
          { purpose: { contains: search } },
          { reference: { contains: search } },
        ]
      }
      const payments = await db.payment.findMany({ where, orderBy: { date: 'desc' } })
      const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0)
      return NextResponse.json({ payments, totalPayments })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Payments error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
