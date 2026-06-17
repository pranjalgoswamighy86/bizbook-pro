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

    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { search, expiryStatus, productId } = body
      const where: Record<string, unknown> = { tenantId, isActive: true }

      if (productId) where.inventoryItemId = productId
      if (search) {
        where.OR = [
          { batchNumber: { contains: search } },
          { supplier: { contains: search } },
          { inventoryItem: { name: { contains: search } } },
        ]
      }

      const batches = await db.batch.findMany({
        where,
        include: {
          inventoryItem: { select: { id: true, name: true, sku: true, unit: true } },
        },
        orderBy: { expiryDate: 'asc' },
      })

      const now = new Date()
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 86400000)
      const sixtyDaysFromNow = new Date(now.getTime() + 60 * 86400000)
      const ninetyDaysFromNow = new Date(now.getTime() + 90 * 86400000)

      // Add computed expiry status
      const enriched = batches.map(b => {
        let status = 'valid'
        if (b.expiryDate) {
          const expDate = new Date(b.expiryDate)
          if (expDate <= now) status = 'expired'
          else if (expDate <= thirtyDaysFromNow) status = 'critical'
          else if (expDate <= sixtyDaysFromNow) status = 'near-expiry-60'
          else if (expDate <= ninetyDaysFromNow) status = 'near-expiry-90'
        }

        return { ...b, expiryStatus: status }
      })

      // Filter by expiry status if requested
      let filtered = enriched
      if (expiryStatus === 'expired') filtered = enriched.filter(b => b.expiryStatus === 'expired')
      else if (expiryStatus === 'near-expiry') filtered = enriched.filter(b => ['critical', 'near-expiry-60', 'near-expiry-90'].includes(b.expiryStatus))
      else if (expiryStatus === 'critical') filtered = enriched.filter(b => b.expiryStatus === 'critical')

      const summary = {
        total: enriched.length,
        expired: enriched.filter(b => b.expiryStatus === 'expired').length,
        critical: enriched.filter(b => b.expiryStatus === 'critical').length,
        nearExpiry60: enriched.filter(b => b.expiryStatus === 'near-expiry-60').length,
        nearExpiry90: enriched.filter(b => b.expiryStatus === 'near-expiry-90').length,
        valid: enriched.filter(b => b.expiryStatus === 'valid').length,
      }

      return NextResponse.json({ batches: filtered, summary })
    }

    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { inventoryItemId, batchNumber, manufacturingDate, expiryDate, quantity, supplier, notes } = body.data
      const batch = await db.batch.create({
        data: {
          tenantId,
          inventoryItemId,
          batchNumber,
          manufacturingDate: manufacturingDate ? new Date(manufacturingDate) : null,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          quantity: parseFloat(quantity) || 0,
          supplier: supplier || null,
          notes: notes || null,
        },
        include: { inventoryItem: { select: { name: true } } },
      })

      // Audit log
      await db.auditLog.create({
        data: {
          tenantId,
          userId: body.userId || null,
          userName: body.userName || null,
          action: 'CREATE',
          entityType: 'Batch',
          entityId: batch.id,
          entityName: `${batch.inventoryItem.name} - ${batchNumber}`,
          changes: JSON.stringify({ batchNumber, quantity, expiryDate }),
        },
      })

      return NextResponse.json({ batch })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      const updateData: Record<string, unknown> = {}
      if (data.batchNumber !== undefined) updateData.batchNumber = data.batchNumber
      if (data.manufacturingDate !== undefined) updateData.manufacturingDate = data.manufacturingDate ? new Date(data.manufacturingDate) : null
      if (data.expiryDate !== undefined) updateData.expiryDate = data.expiryDate ? new Date(data.expiryDate) : null
      if (data.quantity !== undefined) updateData.quantity = parseFloat(data.quantity) || 0
      if (data.supplier !== undefined) updateData.supplier = data.supplier
      if (data.notes !== undefined) updateData.notes = data.notes
      if (data.isActive !== undefined) updateData.isActive = data.isActive

      const batch = await db.batch.update({
        where: { id },
        data: updateData,
        include: { inventoryItem: { select: { name: true } } },
      })

      // Audit log
      await db.auditLog.create({
        data: {
          tenantId,
          userId: body.userId || null,
          userName: body.userName || null,
          action: 'UPDATE',
          entityType: 'Batch',
          entityId: id,
          entityName: `${batch.inventoryItem.name} - ${batch.batchNumber}`,
          changes: JSON.stringify(data),
        },
      })

      return NextResponse.json({ batch })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      const batch = await db.batch.update({
        where: { id },
        data: { isActive: false },
        include: { inventoryItem: { select: { name: true } } },
      })

      // Audit log
      await db.auditLog.create({
        data: {
          tenantId,
          userId: body.userId || null,
          userName: body.userName || null,
          action: 'DELETE',
          entityType: 'Batch',
          entityId: id,
          entityName: `${batch.inventoryItem.name} - ${batch.batchNumber}`,
        },
      })

      return NextResponse.json({ success: true })
    }

    // Get inventory items for dropdown
    if (action === 'inventory-items') {
      const items = await db.inventoryItem.findMany({
        where: { tenantId, isDeleted: false },
        select: { id: true, name: true, sku: true, unit: true },
        orderBy: { name: 'asc' },
      })
      return NextResponse.json({ items })
    }

    return NextResponse.json({ error: 'Invalid action. Use: list, create, update, delete, inventory-items' }, { status: 400 })
  } catch (error) {
    console.error('Batch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
