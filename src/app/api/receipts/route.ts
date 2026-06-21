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

      const receipt = await db.receipt.create({ data: { ...body.data, tenantId } })
      return NextResponse.json({ receipt })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      const receipt = await db.receipt.update({ where: { id }, data })
      return NextResponse.json({ receipt })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      await db.receipt.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
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
      // v4.55: Add pagination for 1000+ user scalability
      const page = Number(body.page) || 1
      const limit = Math.min(Number(body.limit) || 100, 500)
      const skip = (page - 1) * limit
      const receipts = await db.receipt.findMany({ where, orderBy: { date: 'desc' }, take: limit, skip })
      const totalReceipts = receipts.reduce((sum, r) => sum + r.amount, 0)
      const totalCount = await db.receipt.count({ where })
      return NextResponse.json({ receipts, totalReceipts, page, limit, hasMore: skip + receipts.length < totalCount })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Receipts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
