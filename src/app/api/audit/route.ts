import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 })
    }

    // List audit logs with filters
    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { userId, actionType, entityType, startDate, endDate, page = 1, pageSize = 50 } = body
      const where: Record<string, unknown> = { tenantId }

      if (userId) where.userId = userId
      if (actionType) where.action = actionType
      if (entityType) where.entityType = entityType
      if (startDate || endDate) {
        const createdAt: Record<string, Date> = {}
        if (startDate) createdAt.gte = new Date(startDate)
        if (endDate) createdAt.lte = new Date(endDate)
        where.createdAt = createdAt
      }

      const [logs, total] = await Promise.all([
        db.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.auditLog.count({ where }),
      ])

      return NextResponse.json({ logs, total, page, pageSize })
    }

    // Create an audit log entry
    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { userId, userName, auditAction, entityType, entityId, entityName, changes } = body
      const log = await db.auditLog.create({
        data: {
          tenantId,
          userId: userId || null,
          userName: userName || null,
          action: auditAction,
          entityType,
          entityId: entityId || null,
          entityName: entityName || null,
          changes: changes ? JSON.stringify(changes) : null,
        },
      })
      return NextResponse.json({ log })
    }

    // Get filter options (distinct values for filters)
    if (action === 'filter-options') {
      const [users, actionTypes, entityTypes] = await Promise.all([
        db.auditLog.findMany({
          where: { tenantId },
          select: { userId: true, userName: true },
          distinct: ['userId'],
          orderBy: { userName: 'asc' },
        }),
        db.auditLog.findMany({
          where: { tenantId },
          select: { action: true },
          distinct: ['action'],
          orderBy: { action: 'asc' },
        }),
        db.auditLog.findMany({
          where: { tenantId },
          select: { entityType: true },
          distinct: ['entityType'],
          orderBy: { entityType: 'asc' },
        }),
      ])

      return NextResponse.json({
        users: users.filter(u => u.userId).map(u => ({ id: u.userId, name: u.userName })),
        actionTypes: actionTypes.map(a => a.action),
        entityTypes: entityTypes.map(e => e.entityType),
      })
    }

    return NextResponse.json({ error: 'Invalid action. Use: list, create, filter-options' }, { status: 400 })
  } catch (error) {
    console.error('Audit log error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
