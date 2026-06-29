import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'
// v4.155: Auto Excel backup after every expense create/update/delete
import { triggerAutoBackup } from '@/lib/auto-backup'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const expense = await db.expense.create({ data: { ...body.data, tenantId } })
      // v4.155: Auto Excel backup after expense create
      triggerAutoBackup(tenantId, 'expense:create').catch(e => console.warn('[AutoBackup] expense:create failed:', e?.message))
      return NextResponse.json({ expense })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      const expense = await db.expense.update({ where: { id }, data })
      // v4.155: Auto Excel backup after expense update
      triggerAutoBackup(tenantId, 'expense:update').catch(e => console.warn('[AutoBackup] expense:update failed:', e?.message))
      return NextResponse.json({ expense })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      await db.expense.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
      // v4.155: Auto Excel backup after expense delete
      triggerAutoBackup(tenantId, 'expense:delete').catch(e => console.warn('[AutoBackup] expense:delete failed:', e?.message))
      return NextResponse.json({ success: true })
    }

    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { startDate, endDate, search, category } = body
      const where: Record<string, unknown> = { tenantId, isDeleted: false }
      if (startDate && endDate) {
        where.date = { gte: new Date(startDate), lt: new Date(endDate) }
      }
      if (search) {
        where.OR = [
          { description: { contains: search } },
          { category: { contains: search } },
          { reference: { contains: search } },
        ]
      }
      if (category) {
        where.category = category
      }
      // v4.55: Add pagination for 1000+ user scalability (was loading entire table)
      const page = Number(body.page) || 1
      const limit = Math.min(Number(body.limit) || 100, 500) // max 500 per page
      const skip = (page - 1) * limit
      const expenses = await db.expense.findMany({ where, orderBy: { date: 'desc' }, take: limit, skip })
      const total = await db.expense.count({ where })
      return NextResponse.json({ expenses, total, page, limit, hasMore: skip + expenses.length < total })
    }

    if (action === 'stats') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { startDate, endDate } = body
      const where: Record<string, unknown> = { tenantId, isDeleted: false }
      if (startDate && endDate) {
        where.date = { gte: new Date(startDate), lt: new Date(endDate) }
      }
      const expenses = await db.expense.findMany({ where })
      const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)
      const byCategory = expenses.reduce<Record<string, number>>((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + e.amount
        return acc
      }, {})
      return NextResponse.json({ totalExpenses, byCategory, count: expenses.length })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Expenses error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
