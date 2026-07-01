import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'

/**
 * TEMPORARY endpoint — find tenant and import Bakers Mart data
 * This will be deleted after the import is complete.
 *
 * GET  /api/import-bakers-mart?action=find-tenant&name=Bakers Mart - DMP
 * POST /api/import-bakers-mart  { action: 'import', tenantId: '...' }
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (action === 'find-tenant') {
    const name = url.searchParams.get('name') || 'Bakers Mart - DMP'
    // Query ALL tenants to find by name (case-insensitive)
    const tenants: any[] = await rawDb.$queryRaw`
      SELECT id, name, "isDeleted", "createdAt" FROM "Tenant"
      WHERE LOWER(name) LIKE LOWER(${'%' + name + '%'})
      ORDER BY name
    ` as any[]

    return NextResponse.json({
      search: name,
      found: tenants.length,
      tenants: tenants.map(t => ({
        id: t.id,
        name: t.name,
        isDeleted: t.isDeleted,
        createdAt: t.createdAt,
      })),
    })
  }

  if (action === 'find-user') {
    const email = url.searchParams.get('email') || 'bakersmartghy@gmail.com'
    const users: any[] = await rawDb.$queryRaw`
      SELECT u.id, u.email, u.role, u."tenantId", t.name as "tenantName"
      FROM "User" u
      LEFT JOIN "Tenant" t ON u."tenantId" = t.id
      WHERE LOWER(u.email) = LOWER(${email})
    ` as any[]

    // Also check UserTenant
    const userTenants: any[] = await rawDb.$queryRaw`
      SELECT ut."userId", ut."tenantId", ut.role, t.name as "tenantName", u.email
      FROM "UserTenant" ut
      JOIN "Tenant" t ON ut."tenantId" = t.id
      JOIN "User" u ON ut."userId" = u.id
      WHERE LOWER(u.email) = LOWER(${email})
    ` as any[]

    return NextResponse.json({
      search: email,
      users: users.map(u => ({ id: u.id, email: u.email, role: u.role, tenantId: u.tenantId, tenantName: u.tenantName })),
      userTenants: userTenants.map(ut => ({ userId: ut.userId, tenantId: ut.tenantId, role: ut.role, tenantName: ut.tenantName, email: ut.email })),
    })
  }

  if (action === 'all-tenants') {
    const tenants: any[] = await rawDb.$queryRaw`
      SELECT id, name, "isDeleted" FROM "Tenant" ORDER BY name
    ` as any[]
    return NextResponse.json({ tenants: tenants.map(t => ({ id: t.id, name: t.name, isDeleted: t.isDeleted })) })
  }

  return NextResponse.json({ error: 'Use ?action=find-tenant&name=... or ?action=find-user&email=... or ?action=all-tenants' })
}
