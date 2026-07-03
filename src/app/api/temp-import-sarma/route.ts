import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (action === 'verify') {
    const tid = url.searchParams.get('tenantId') || 'cmr1kc00x0001qz01nw7pluu1'
    const count = await rawDb.inventoryItem.count({ where: { tenantId: tid } })
    return NextResponse.json({ tenantId: tid, inventoryCount: count })
  }

  return NextResponse.json({ error: 'Use ?action=verify&tenantId=...' })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, tenantId, items } = body

  if (action === 'import-dedup') {
    // Fetch all existing item names for this tenant
    const existingItems = await rawDb.inventoryItem.findMany({
      where: { tenantId, isDeleted: false },
      select: { id: true, name: true },
    })
    const existingNames = new Set(existingItems.map(i => i.name.trim().toLowerCase()))

    let imported = 0
    let skipped = 0
    const errors: string[] = []

    for (const item of items) {
      const nameLower = item.name.trim().toLowerCase()
      if (existingNames.has(nameLower)) {
        skipped++
        continue
      }
      // Double-check: also skip if we already added it in this batch
      if (existingNames.has(nameLower)) {
        skipped++
        continue
      }
      existingNames.add(nameLower) // prevent duplicates within the same batch

      try {
        await rawDb.inventoryItem.create({
          data: {
            id: item.id,
            name: item.name.trim(),
            sku: null,
            barcode: null,
            hsnCode: null,
            unit: item.unit || 'PCS',
            category: item.category || 'Grocery',
            brand: null,
            itemType: item.itemType || 'FINISHED_PRODUCT',
            purchasePrice: Number(item.purchasePrice) || 0,
            salePrice: Number(item.salePrice) || 0,
            mrp: Number(item.mrp) || 0,
            openingStock: Number(item.openingStock) || 0,
            currentStock: Number(item.currentStock) || 0,
            minStock: 0,
            gstRate: 0,
            value: Number(item.value) || 0,
            tenantId,
            isDeleted: false,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })
        imported++
      } catch (err: any) {
        if (errors.length < 5) {
          errors.push(`Item "${item.name}": ${err?.message?.slice(0, 200)}`)
        }
      }
    }

    // Verify final count
    const finalCount = await rawDb.inventoryItem.count({ where: { tenantId } })

    return NextResponse.json({
      imported,
      skipped,
      total: items.length,
      finalInventoryCount: finalCount,
      errors,
    })
  }

  return NextResponse.json({ error: 'Use action: import-dedup' }, { status: 400 })
}
