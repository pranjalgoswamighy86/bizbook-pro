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
      const where: Record<string, unknown> = { tenantId, isDeleted: false }
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { phone: { contains: search } },
          { gstNumber: { contains: search } },
        ]
      }
      const debtors = await db.debtor.findMany({ where, orderBy: { name: 'asc' } })
      const totalReceivable = debtors.reduce((sum, d) => sum + d.currentBalance, 0)
      return NextResponse.json({ debtors, totalReceivable })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Debtors error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
