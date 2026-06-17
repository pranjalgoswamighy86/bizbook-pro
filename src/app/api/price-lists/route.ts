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

    // List all price lists
    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const priceLists = await db.priceList.findMany({
        where: { tenantId, isActive: true },
        include: {
          items: {
            include: {
              inventoryItem: { select: { id: true, name: true, sku: true, unit: true, salePrice: true } },
            },
            orderBy: { inventoryItem: { name: 'asc' } },
          },
        },
        orderBy: { name: 'asc' },
      })

      return NextResponse.json({ priceLists })
    }

    // Get a single price list with items
    if (action === 'get') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      const priceList = await db.priceList.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              inventoryItem: { select: { id: true, name: true, sku: true, unit: true, salePrice: true } },
            },
            orderBy: { inventoryItem: { name: 'asc' } },
          },
        },
      })
      if (!priceList || priceList.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Price list not found' }, { status: 404 })
      }
      return NextResponse.json({ priceList })
    }

    // Create a new price list
    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { name, description, isDefault, items } = body.data

      // If this is set as default, unset any existing default
      if (isDefault) {
        await db.priceList.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        })
      }

      const priceList = await db.priceList.create({
        data: {
          tenantId,
          name,
          description: description || null,
          isDefault: isDefault || false,
        },
      })

      // Create price list items if provided
      if (items && items.length > 0) {
        await db.priceListItem.createMany({
          data: items.map((item: { inventoryItemId: string; price: number }) => ({
            priceListId: priceList.id,
            inventoryItemId: item.inventoryItemId,
            price: item.price,
          })),
        })
      }

      // Audit log
      await db.auditLog.create({
        data: {
          tenantId,
          userId: body.userId || null,
          userName: body.userName || null,
          action: 'CREATE',
          entityType: 'PriceList',
          entityId: priceList.id,
          entityName: name,
        },
      })

      return NextResponse.json({ priceList })
    }

    // Update a price list
    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body

      if (data.isDefault) {
        await db.priceList.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        })
      }

      const priceList = await db.priceList.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description || null,
          isDefault: data.isDefault,
        },
      })

      // Audit log
      await db.auditLog.create({
        data: {
          tenantId,
          userId: body.userId || null,
          userName: body.userName || null,
          action: 'UPDATE',
          entityType: 'PriceList',
          entityId: id,
          entityName: data.name,
        },
      })

      return NextResponse.json({ priceList })
    }

    // Delete a price list
    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      const priceList = await db.priceList.update({
        where: { id },
        data: { isActive: false },
      })

      // Audit log
      await db.auditLog.create({
        data: {
          tenantId,
          userId: body.userId || null,
          userName: body.userName || null,
          action: 'DELETE',
          entityType: 'PriceList',
          entityId: id,
          entityName: priceList.name,
        },
      })

      return NextResponse.json({ success: true })
    }

    // Set/update prices for items in a price list
    if (action === 'set-prices') {
      const { priceListId, prices } = body // prices: [{ inventoryItemId, price }]

      // Delete existing items not in the new list
      const existingItems = await db.priceListItem.findMany({
        where: { priceListId },
      })
      const newItemIds = new Set(prices.map((p: { inventoryItemId: string }) => p.inventoryItemId))

      // Delete items not in new list
      const toDelete = existingItems.filter(i => !newItemIds.has(i.inventoryItemId))
      if (toDelete.length > 0) {
        await db.priceListItem.deleteMany({
          where: { id: { in: toDelete.map(i => i.id) } },
        })
      }

      // Upsert items
      for (const p of prices) {
        const existing = existingItems.find(i => i.inventoryItemId === p.inventoryItemId)
        if (existing) {
          await db.priceListItem.update({
            where: { id: existing.id },
            data: { price: p.price },
          })
        } else {
          await db.priceListItem.create({
            data: {
              priceListId,
              inventoryItemId: p.inventoryItemId,
              price: p.price,
            },
          })
        }
      }

      const priceList = await db.priceList.findUnique({
        where: { id: priceListId },
        include: {
          items: {
            include: {
              inventoryItem: { select: { id: true, name: true, sku: true, unit: true, salePrice: true } },
            },
          },
        },
      })

      return NextResponse.json({ priceList })
    }

    // Get inventory items for price editing
    if (action === 'inventory-items') {
      const items = await db.inventoryItem.findMany({
        where: { tenantId, isDeleted: false },
        select: { id: true, name: true, sku: true, unit: true, salePrice: true, purchasePrice: true },
        orderBy: { name: 'asc' },
      })
      return NextResponse.json({ items })
    }

    return NextResponse.json({ error: 'Invalid action. Use: list, get, create, update, delete, set-prices, inventory-items' }, { status: 400 })
  } catch (error) {
    console.error('Price list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
