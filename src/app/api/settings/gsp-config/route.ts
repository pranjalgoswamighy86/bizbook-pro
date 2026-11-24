import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'
import { saveTenantGspConfig, clearTenantGspConfig, tenantHasGspCredentials, isEncryptionActive } from '@/lib/gsp-credentials'
import { db } from '@/lib/db-soft-delete'

const ADMIN_ROLES = ['MAIN_ADMIN']

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId') || ''
  const access = await requireAuthAndRole(req, tenantId, ADMIN_ROLES)
  if (access instanceof NextResponse) return access
  const [tenant, configured] = await Promise.all([
    db.tenant.findFirst({
      where: { id: access.tenantId },
      select: { gspCode: true, irpEnv: true },
    }),
    tenantHasGspCredentials(access.tenantId),
  ])
  return NextResponse.json({
    configured,
    gspCode: tenant?.gspCode || '',
    irpEnv: tenant?.irpEnv || 'sandbox',
    encryptionActive: isEncryptionActive(),
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : ''
    const access = await requireAuthAndRole(req, tenantId, ADMIN_ROLES)
    if (access instanceof NextResponse) return access

    const fields = ['gspCode', 'gspClientId', 'gspClientSecret', 'gspUsername', 'gspPassword'] as const
    for (const field of fields) {
      if (typeof body[field] !== 'string' || !body[field].trim()) {
        return NextResponse.json({ error: `${field} is required.` }, { status: 400 })
      }
      if (body[field].length > 512) return NextResponse.json({ error: `${field} is too long.` }, { status: 400 })
    }
    if (body.irpEnv !== undefined && !['sandbox', 'production'].includes(body.irpEnv)) {
      return NextResponse.json({ error: 'Invalid IRP environment.' }, { status: 400 })
    }

    await saveTenantGspConfig(access.tenantId, {
      gspCode: body.gspCode,
      gspClientId: body.gspClientId,
      gspClientSecret: body.gspClientSecret,
      gspUsername: body.gspUsername,
      gspPassword: body.gspPassword,
      irpEnv: body.irpEnv,
    })
    await writeAuditLog({
      tenantId: access.tenantId, userId: access.userId, userName: access.user?.name || 'Unknown',
      action: 'UPDATE', entityType: 'GSP Configuration', entityName: 'Tenant GSP credentials',
      changes: { configured: true, environment: body.irpEnv === 'production' ? 'production' : 'sandbox' },
    })
    return NextResponse.json({ success: true, configured: await tenantHasGspCredentials(access.tenantId) })
  } catch {
    return NextResponse.json({ error: 'Unable to save GSP configuration. Verify server encryption configuration and try again.' }, { status: 503 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : ''
    const access = await requireAuthAndRole(req, tenantId, ADMIN_ROLES)
    if (access instanceof NextResponse) return access
    await clearTenantGspConfig(access.tenantId)
    await writeAuditLog({
      tenantId: access.tenantId, userId: access.userId, userName: access.user?.name || 'Unknown',
      action: 'DELETE', entityType: 'GSP Configuration', entityName: 'Tenant GSP credentials',
      changes: { configured: false },
    })
    return NextResponse.json({ success: true, configured: false })
  } catch {
    return NextResponse.json({ error: 'Unable to clear GSP configuration.' }, { status: 500 })
  }
}
