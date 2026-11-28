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

      // v4.90: Whitelist allowed fields to prevent Prisma errors
      const rawData = body.data || {}
      const data: Record<string, unknown> = { tenantId }
      const allowedFields = ['name', 'sku', 'barcode', 'hsnCode', 'unit', 'category', 'brand', 'itemType', 'purchasePrice', 'salePrice', 'mrp', 'openingStock', 'currentStock', 'minStock', 'gstRate']
      for (const field of allowedFields) {
        if (rawData[field] !== undefined) {
          if (['purchasePrice', 'salePrice', 'mrp', 'openingStock', 'currentStock', 'minStock', 'gstRate'].includes(field)) {
            data[field] = Number(rawData[field]) || 0
          } else {
            data[field] = rawData[field]
          }
        }
      }
      data.value = (Number(data.currentStock) || 0) * (Number(data.purchasePrice) || 0)

      // v4.174: DEDUPLICATION ENFORCEMENT — prevent duplicate items in master inventory
      // Each item must exist as exactly ONE primary row per tenant.
      // Items can appear unlimited times in sales/purchase transactions,
      // but the master inventory registry allows only one entry per item name.
      const itemName = String(data.name || '').trim()
      if (itemName) {
        const { rawDb } = await import('@/lib/db-soft-delete')
        // Case-insensitive dedup check
        const existingItems = await rawDb.inventoryItem.findMany({
          where: { tenantId, isDeleted: false },
          select: { id: true, name: true },
        })
        const duplicate = existingItems.find(i => i.name.trim().toLowerCase() === itemName.toLowerCase())
        if (duplicate) {
          return NextResponse.json({
            error: `Duplicate item: "${itemName}" already exists in inventory (ID: ${duplicate.id}). Master inventory allows only one entry per item. Use "Update" to modify the existing item, or "Adjust Stock" to change its quantity.`,
            code: 'DUPLICATE_ITEM',
            existingItemId: duplicate.id,
            existingItemName: duplicate.name,
          }, { status: 409 })
        }
      }

      const item = await db.inventoryItem.create({ data: data as any })
      return NextResponse.json({ item })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data: rawData } = body
      // v6.30.3: SECURITY FIX — verify the inventory item belongs to this
      // tenant before updating. Was: db.inventoryItem.update({ where: { id } })
      // with no tenant check → cross-tenant mutation hole. The findUnique
      // below already exists for stock/price recalc, but it didn't check
      // tenantId; now it's a findFirst with tenantId + isDeleted.
      const existing = await db.inventoryItem.findFirst({
        where: { id, tenantId: access.tenantId, isDeleted: false },
      })
      if (!existing) {
        return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
      }
      // v4.90: Whitelist allowed fields to prevent Prisma errors from unknown fields
      const data: Record<string, unknown> = {}
      const allowedFields = ['name', 'sku', 'barcode', 'hsnCode', 'unit', 'category', 'brand', 'itemType', 'purchasePrice', 'salePrice', 'mrp', 'openingStock', 'currentStock', 'minStock', 'gstRate', 'value']
      for (const field of allowedFields) {
        if (rawData[field] !== undefined) {
          if (field === 'purchasePrice' || field === 'salePrice' || field === 'mrp' || field === 'openingStock' || field === 'currentStock' || field === 'minStock' || field === 'gstRate' || field === 'value') {
            data[field] = Number(rawData[field]) || 0
          } else {
            data[field] = rawData[field]
          }
        }
      }
      if (data.currentStock !== undefined && Number(data.currentStock) < 0) {
        return NextResponse.json({ error: 'Stock cannot be negative. Use a valid stock adjustment instead.' }, { status: 400 })
      }
      if (data.currentStock !== undefined || data.purchasePrice !== undefined) {
        // Number(undefined) is NaN (and NaN ?? fallback remains NaN). Preserve
        // the persisted value for whichever field was not included in this patch.
        const stock = data.currentStock !== undefined ? Number(data.currentStock) : existing.currentStock
        const price = data.purchasePrice !== undefined ? Number(data.purchasePrice) : existing.purchasePrice
        data.value = stock * price
      }
      const item = await db.inventoryItem.update({ where: { id }, data: data as any })
      return NextResponse.json({ item })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      // v6.30.3: SECURITY FIX — same tenant-ownership check as update.
      const existing = await db.inventoryItem.findFirst({
        where: { id, tenantId: access.tenantId, isDeleted: false },
        select: { id: true },
      })
      if (!existing) {
        return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
      }
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
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { hsnCode: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
          { brand: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } },
        ]
      }
      if (category) where.category = category
      if (lowStock) where.currentStock = { lte: 0 }

      // v4.176: Remove 100-item pagination limit — load ALL items
      // Default: no limit (load all). If client specifies a limit, cap at 10000.
      const page = Number(body.page) || 1
      const limit = body.limit ? Math.min(Number(body.limit), 10000) : 10000
      const skip = (page - 1) * limit
      const items = await db.inventoryItem.findMany({ where, orderBy: { name: 'asc' }, take: limit, skip })
      const totalValue = items.reduce((sum, i) => sum + i.value, 0)
      const totalItems = await db.inventoryItem.count({ where })
      const lowStockItems = await db.inventoryItem.count({ where: { ...where, currentStock: { lte: 0 } } })
      return NextResponse.json({ items, totalValue, totalItems, lowStockItems, page, limit, hasMore: skip + items.length < totalItems })
    }

    if (action === 'adjust-stock') {
      // Authenticated, tenant-scoped, atomic stock adjustment.
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { id, quantity: rawQuantity, type } = body
      const quantity = Number(rawQuantity)
      if (!id || !Number.isFinite(quantity) || quantity <= 0 || !type) {
        return NextResponse.json({ error: 'id, positive quantity, and type (in/out) are required' }, { status: 400 })
      }
      if (type !== 'in' && type !== 'out') {
        return NextResponse.json({ error: "type must be 'in' or 'out'" }, { status: 400 })
      }

      // Serializable transactions plus conditional stock predicates prevent lost
      // updates and stock-out races from pushing inventory below zero.
      let result: { item: any; oldStock: number } | { insufficient: true; currentStock: number } | { notFound: true }
      try {
        result = await db.$transaction(async (tx) => {
          const item = await tx.inventoryItem.findFirst({
            where: { id, tenantId: access.tenantId, isDeleted: false },
          })
          if (!item) return { notFound: true as const }

          const predicate = type === 'out' ? { currentStock: { gte: quantity } } : {}
          const updatedCount = await tx.inventoryItem.updateMany({
            where: { id, tenantId: access.tenantId, isDeleted: false, ...predicate },
            data: { currentStock: type === 'in' ? { increment: quantity } : { decrement: quantity } },
          })
          if (updatedCount.count !== 1) {
            return { insufficient: true as const, currentStock: item.currentStock }
          }

          const updatedStock = await tx.inventoryItem.findFirst({
            where: { id, tenantId: access.tenantId, isDeleted: false },
          })
          if (!updatedStock) return { notFound: true as const }

          const itemWithValue = await tx.inventoryItem.update({
            where: { id: updatedStock.id },
            data: { value: updatedStock.currentStock * updatedStock.purchasePrice },
          })

          await tx.auditLog.create({
            data: {
              tenantId: access.tenantId,
              userId: access.userId,
              userName: access.user.name,
              action: 'UPDATE',
              entityType: 'InventoryItem',
              entityId: id,
              entityName: item.name,
              changes: JSON.stringify({
                action: 'adjust-stock',
                type,
                quantity,
                oldStock: item.currentStock,
                newStock: updatedStock.currentStock,
              }),
            },
          })

          return { item: itemWithValue, oldStock: item.currentStock }
        }, { isolationLevel: 'Serializable' })
      } catch (error: unknown) {
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
        if (code === 'P2034') {
          return NextResponse.json({ error: 'Stock changed concurrently. Refresh inventory and retry.' }, { status: 409 })
        }
        throw error
      }

      if ('notFound' in result) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      if ('insufficient' in result) {
        return NextResponse.json({
          error: `Insufficient stock. Current: ${result.currentStock}, attempted to remove: ${quantity}.`,
        }, { status: 409 })
      }
      return NextResponse.json({ item: result.item })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Inventory error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
