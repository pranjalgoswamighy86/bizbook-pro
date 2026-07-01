import { NextRequest, NextResponse } from 'next/server'
import { rawDb, db } from '@/lib/db-soft-delete'
import { restoreFromExcelData } from '@/lib/excel-backup'

/**
 * TEMPORARY endpoint — find tenant and import Bakers Mart data
 * This will be deleted after the import is complete.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (action === 'find-tenant') {
    const name = url.searchParams.get('name') || 'Bakers Mart - DMP'
    const tenants: any[] = await rawDb.$queryRaw`
      SELECT id, name, "isDeleted", "createdAt" FROM "Tenant"
      WHERE LOWER(name) LIKE LOWER(${'%' + name + '%'})
      ORDER BY name
    ` as any[]
    return NextResponse.json({
      search: name, found: tenants.length,
      tenants: tenants.map(t => ({ id: t.id, name: t.name, isDeleted: t.isDeleted, createdAt: t.createdAt })),
    })
  }

  if (action === 'all-tenants') {
    const tenants: any[] = await rawDb.$queryRaw`SELECT id, name, "isDeleted" FROM "Tenant" ORDER BY name` as any[]
    return NextResponse.json({ tenants: tenants.map(t => ({ id: t.id, name: t.name, isDeleted: t.isDeleted })) })
  }

  if (action === 'verify-import') {
    const tenantId = url.searchParams.get('tenantId') || 'cmqs5f2aq0000nx013d9w55ka'
    const [invCount, saleCount, purCount] = await Promise.all([
      rawDb.inventoryItem.count({ where: { tenantId } }),
      rawDb.sale.count({ where: { tenantId } }),
      rawDb.purchase.count({ where: { tenantId } }),
    ])
    return NextResponse.json({
      tenantId,
      inventory: invCount,
      sales: saleCount,
      purchases: purCount,
    })
  }

  if (action === 'cleanup-temp') {
    // Delete the temp admin tenant created during auth testing
    await rawDb.tenant.deleteMany({ where: { id: 'admin_tenant_import_001' } }).catch(() => {})
    await rawDb.user.deleteMany({ where: { id: { startsWith: 'temp_auth_' } } }).catch(() => {})
    return NextResponse.json({ cleaned: true })
  }

  return NextResponse.json({ error: 'Use ?action=find-tenant, ?action=all-tenants, ?action=verify-import, or ?action=cleanup-temp' })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, tenantId } = body

  if (action === 'import-sales') {
    const { sales } = body
    let imported = 0
    const errors: string[] = []

    for (const sale of sales) {
      try {
        await rawDb.sale.upsert({
          where: { id: sale.id },
          create: {
            id: sale.id,
            invoiceNumber: sale.invoiceNumber,
            date: new Date(sale.date),
            partyName: sale.partyName,
            partyAddress: sale.partyAddress || null,
            partyGst: sale.partyGst || null,
            items: typeof sale.items === 'string' ? sale.items : JSON.stringify(sale.items || []),
            subtotal: Number(sale.subtotal) || 0,
            gstAmount: Number(sale.gstAmount) || 0,
            totalAmount: Number(sale.totalAmount) || 0,
            paymentStatus: sale.paymentStatus || 'RECEIVED',
            paymentMode: sale.paymentMode || null,
            invoiceStatus: sale.invoiceStatus || 'CONFIRMED',
            upiAmount: Number(sale.upiAmount) || 0,
            amountReceived: Number(sale.amountReceived) || 0,
            amountPaid: Number(sale.amountPaid) || 0,
            notes: sale.notes || null,
            invoiceFile: null,
            einvoiceIrn: null, einvoiceAckNo: null, einvoiceAckDate: null,
            einvoiceQrCodeText: null, einvoiceStatus: 'PENDING',
            createdBy: null,
            tenantId: tenantId,
            isDeleted: false, deletedAt: null,
            createdAt: new Date(), updatedAt: new Date(),
          },
          update: {},
        })
        imported++
      } catch (err: any) {
        if (errors.length < 3) {
          errors.push(`Sale ${sale.invoiceNumber}: ${err?.message?.slice(0, 300)}`)
        }
      }
    }
    return NextResponse.json({ imported, errors, total: sales.length })
  }

  if (action === 'import-purchases') {
    const { purchases } = body
    let imported = 0
    const errors: string[] = []

    for (const pur of purchases) {
      try {
        await rawDb.purchase.upsert({
          where: { id: pur.id },
          create: {
            id: pur.id,
            invoiceNumber: pur.invoiceNumber,
            date: new Date(pur.date),
            partyName: pur.partyName,
            partyAddress: pur.partyAddress || null,
            partyGst: pur.partyGst || null,
            items: typeof pur.items === 'string' ? pur.items : JSON.stringify(pur.items || []),
            subtotal: Number(pur.subtotal) || 0,
            gstAmount: Number(pur.gstAmount) || 0,
            totalAmount: Number(pur.totalAmount) || 0,
            paymentStatus: pur.paymentStatus || 'PAID',
            paymentMode: pur.paymentMode || null,
            amountPaid: Number(pur.amountPaid) || 0,
            notes: pur.notes || null,
            invoiceFile: null,
            einvoiceIrn: null, einvoiceAckNo: null, einvoiceAckDate: null,
            einvoiceQrCodeText: null, einvoiceStatus: 'PENDING',
            createdBy: null,
            tenantId: tenantId,
            isDeleted: false, deletedAt: null,
            createdAt: new Date(), updatedAt: new Date(),
          },
          update: {},
        })
        imported++
      } catch (err: any) {
        if (errors.length < 3) {
          errors.push(`Purchase ${pur.invoiceNumber}: ${err?.message?.slice(0, 300)}`)
        }
      }
    }
    return NextResponse.json({ imported, errors, total: purchases.length })
  }

  return NextResponse.json({ error: 'Use action: import-sales or import-purchases' }, { status: 400 })
}
