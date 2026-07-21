import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'
import { db } from '@/lib/db-soft-delete'
import fs from 'fs'
import path from 'path'

// POST /api/upload-logo — uploads a company logo and saves the path to the tenant
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { tenantId, logoBase64 } = body

    if (!tenantId || !logoBase64) {
      return NextResponse.json({ error: 'tenantId and logoBase64 are required' }, { status: 400 })
    }

    const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
    if (access instanceof NextResponse) return access

    // Extract file extension from base64 data URL
    const matches = logoBase64.match(/^data:image\/(\w+);base64,/)
    if (!matches) {
      return NextResponse.json({ error: 'Invalid image format. Must be a valid image data URL.' }, { status: 400 })
    }

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1]
    const base64Data = logoBase64.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    // Check file size (max 2MB after base64 decode)
    if (buffer.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'Logo file too large. Maximum 2MB.' }, { status: 400 })
    }

    // Save to /public/logos/ directory
    const logosDir = path.join(process.cwd(), 'public', 'logos')
    if (!fs.existsSync(logosDir)) {
      fs.mkdirSync(logosDir, { recursive: true })
    }

    const filename = `tenant-${tenantId}.${ext}`
    const filepath = path.join(logosDir, filename)
    fs.writeFileSync(filepath, buffer)

    const logoUrl = `/logos/${filename}`

    // Update tenant record
    await db.tenant.update({
      where: { id: tenantId },
      data: { logoUrl },
    })

    await writeAuditLog({
      tenantId: access.tenantId,
      userId: access.userId,
      userName: access.user.name,
      action: 'UPDATE',
      entityType: 'Tenant',
      entityId: tenantId,
      entityName: 'Logo Upload',
      changes: { logoUrl },
    })

    return NextResponse.json({ success: true, logoUrl })
  } catch (error: any) {
    console.error('Logo upload error:', error)
    return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 })
  }
}
