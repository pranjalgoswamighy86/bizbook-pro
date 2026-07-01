import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (action === 'find-tenant') {
    const name = url.searchParams.get('name') || ''
    const tenants: any[] = await rawDb.$queryRaw`
      SELECT id, name, "isDeleted" FROM "Tenant"
      WHERE LOWER(name) LIKE LOWER(${'%' + name + '%'})
      ORDER BY name
    ` as any[]
    return NextResponse.json({ tenants: tenants.map(t => ({ id: t.id, name: t.name })) })
  }

  if (action === 'all-tenants') {
    const tenants: any[] = await rawDb.$queryRaw`SELECT id, name FROM "Tenant" ORDER BY name` as any[]
    return NextResponse.json({ tenants })
  }

  if (action === 'verify') {
    const tid = url.searchParams.get('tenantId') || ''
    const [inv, sal, pur] = await Promise.all([
      rawDb.inventoryItem.count({ where: { tenantId: tid } }),
      rawDb.sale.count({ where: { tenantId: tid } }),
      rawDb.purchase.count({ where: { tenantId: tid } }),
    ])
    return NextResponse.json({ tenantId: tid, inventory: inv, sales: sal, purchases: pur })
  }

  return NextResponse.json({ error: 'Use ?action=find-tenant&name=... or ?action=verify&tenantId=...' })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, tenantId, items } = body

  if (action === 'import-inventory') {
    let imported = 0
    const errors: string[] = []

    for (const item of items) {
      try {
        await rawDb.inventoryItem.upsert({
          where: { id: item.id },
          create: {
            id: item.id,
            name: item.name,
            sku: item.sku || null,
            barcode: item.barcode || null,
            hsnCode: item.hsnCode || null,
            unit: item.unit || 'PCS',
            category: item.category || null,
            brand: item.brand || null,
            itemType: item.itemType || 'RAW_MATERIAL',
            purchasePrice: Number(item.purchasePrice) || 0,
            salePrice: Number(item.salePrice) || 0,
            mrp: Number(item.mrp) || 0,
            openingStock: Number(item.openingStock) || 0,
            currentStock: Number(item.currentStock) || 0,
            minStock: Number(item.minStock) || 0,
            gstRate: Number(item.gstRate) || 0,
            value: Number(item.value) || 0,
            tenantId: tenantId,
            isDeleted: false, deletedAt: null,
            createdAt: new Date(), updatedAt: new Date(),
          },
          update: {},
        })
        imported++
      } catch (err: any) {
        if (errors.length < 5) {
          errors.push(`Item "${item.name}": ${err?.message?.slice(0, 300)}`)
        }
      }
    }
    return NextResponse.json({ imported, total: items.length, errors })
  }

  return NextResponse.json({ error: 'Use action: import-inventory' }, { status: 400 })
}
