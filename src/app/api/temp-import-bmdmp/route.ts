import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function GET(req: NextRequest) {
  const tid = new URL(req.url).searchParams.get('tenantId') || 'cmqs5f2aq0000nx013d9w55ka'
  const count = await rawDb.inventoryItem.count({ where: { tenantId: tid } })
  return NextResponse.json({ tenantId: tid, inventoryCount: count })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, tenantId, items } = body

  if (action === 'import-dedup') {
    // Fetch ALL existing item names for this tenant (case-insensitive dedup)
    const existingItems = await rawDb.inventoryItem.findMany({
      where: { tenantId, isDeleted: false },
      select: { id: true, name: true },
    })
    const existingNames = new Set(existingItems.map(i => i.name.trim().toLowerCase()))
    console.log(`[BMDMP-IMPORT] Existing items: ${existingNames.size}`)

    let imported = 0
    let skipped = 0
    const errors: string[] = []

    for (const item of items) {
      const nameLower = item.name.trim().toLowerCase()
      if (existingNames.has(nameLower)) {
        skipped++
        continue
      }
      // Add to set to prevent duplicates within this batch too
      existingNames.add(nameLower)

      try {
        await rawDb.inventoryItem.create({
          data: {
            id: item.id,
            name: item.name.trim(),
            sku: null,
            barcode: item.barcode || null,
            hsnCode: item.hsnCode || null,
            unit: item.unit || 'PCS',
            category: item.category || null,
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
