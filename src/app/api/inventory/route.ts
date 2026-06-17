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

      const data = { ...body.data, tenantId }
      data.value = (data.currentStock || 0) * (data.purchasePrice || 0)
      const item = await db.inventoryItem.create({ data })
      return NextResponse.json({ item })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      if (data.currentStock !== undefined || data.purchasePrice !== undefined) {
        const existing = await db.inventoryItem.findUnique({ where: { id } })
        if (existing) {
          const stock = data.currentStock ?? existing.currentStock
          const price = data.purchasePrice ?? existing.purchasePrice
          data.value = stock * price
        }
      }
      const item = await db.inventoryItem.update({ where: { id }, data })
      return NextResponse.json({ item })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      await db.inventoryItem.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
      return NextResponse.json({ success: true })
    }

    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { search, category, lowStock } = body
      const where: Record<string, unknown> = { tenantId, isDeleted: false }
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { sku: { contains: search } },
          { hsnCode: { contains: search } },
          { brand: { contains: search } },
          { category: { contains: search } },
        ]
      }
      if (category) where.category = category
      if (lowStock) where.currentStock = { lte: 0 }

      const items = await db.inventoryItem.findMany({ where, orderBy: { name: 'asc' } })
      const totalValue = items.reduce((sum, i) => sum + i.value, 0)
      const totalItems = items.length
      const lowStockItems = items.filter((i) => i.currentStock <= i.minStock).length
      return NextResponse.json({ items, totalValue, totalItems, lowStockItems })
    }

    if (action === 'adjust-stock') {
      const { id, quantity, type } = body // type: 'in' or 'out'
      const item = await db.inventoryItem.findUnique({ where: { id } })
      if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

      const newStock = type === 'in' ? item.currentStock + quantity : item.currentStock - quantity
      const updated = await db.inventoryItem.update({
        where: { id },
        data: { currentStock: newStock, value: newStock * item.purchasePrice },
      })
      return NextResponse.json({ item: updated })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Inventory error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
