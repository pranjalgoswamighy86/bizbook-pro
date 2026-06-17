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

      const staff = await db.staff.create({ data: { ...body.data, tenantId } })
      return NextResponse.json({ staff })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      const staff = await db.staff.update({ where: { id }, data })
      return NextResponse.json({ staff })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      await db.staff.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
      return NextResponse.json({ success: true })
    }

    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { search, department, activeOnly } = body
      const where: Record<string, unknown> = { tenantId, isDeleted: false }
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { phone: { contains: search } },
          { department: { contains: search } },
        ]
      }
      if (department) where.department = department
      if (activeOnly) where.isActive = true

      const staffList = await db.staff.findMany({
        where,
        include: { salaryPayments: { orderBy: { paidDate: 'desc' }, take: 3 } },
        orderBy: { name: 'asc' },
      })
      return NextResponse.json({ staff: staffList })
    }

    if (action === 'pay-salary') {
      const { staffId, month, amount, paidDate, paymentMode, notes } = body
      const staff = await db.staff.findUnique({ where: { id: staffId } })
      if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

      const payment = await db.salaryPayment.create({
        data: { staffId, month, amount, paidDate: new Date(paidDate), paymentMode, notes, tenantId },
      })
      return NextResponse.json({ payment })
    }

    if (action === 'salary-history') {
      const { staffId } = body
      const payments = await db.salaryPayment.findMany({
        where: { staffId },
        orderBy: { paidDate: 'desc' },
      })
      return NextResponse.json({ payments })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Staff error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
