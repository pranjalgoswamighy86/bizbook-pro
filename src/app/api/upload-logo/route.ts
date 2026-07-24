import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'
import { db } from '@/lib/db-soft-delete'

// =====================================================================
// POST /api/upload-logo — uploads a company logo, compresses to ~25KB,
// stores as a base64 DATA URI directly in the tenant.logoUrl column.
// =====================================================================
// v6.27.4: CRITICAL ARCHITECTURE FIX
// ----------------------------------
// Previously this route wrote the compressed image to /public/logos/
// on disk and stored a RELATIVE path (/logos/tenant-xxx.jpg) in the DB.
// That approach had TWO fatal flaws on Railway (and any containerized
// platform):
//
//   1. EPHEMERAL FILESYSTEM — Railway containers lose any files written
//      outside a persistent volume on every redeploy. Uploaded logos
//      vanished whenever the app re-deployed.
//
//   2. STANDALONE BUILD MISMATCH — Next.js standalone build (used by
//      this app) serves static files from .next/standalone/public/,
//      which is populated at BUILD time by postbuild.js. Runtime
//      writes to /app/public/logos/ are NOT served by the standalone
//      server, so the URL returned a 404.
//
// Both flaws caused the invoice print engine to receive a logo URL
// that 404'd, and the broken <img> tag rendered as the alt text
// "Logo" — exactly what the user reported.
//
// FIX: compress the image with sharp, then store the compressed
// bytes as a `data:image/jpeg;base64,...` URI directly in the
// tenant.logoUrl column. This:
//   - Survives container restarts (data lives in PostgreSQL)
//   - Works in any rendering context (popup, iframe, PDF generator)
//     because data: URIs are self-contained
//   - Requires no filesystem dependency
//
// The ~25KB compressed JPEG becomes a ~33KB base64 string, which is
// well within PostgreSQL's text capacity.
// =====================================================================

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

    const base64Data = logoBase64.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    // Check file size (max 2MB before compression)
    if (buffer.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'Logo file too large. Maximum 2MB before compression.' }, { status: 400 })
    }

    // Compress to ~25KB using sharp
    let quality = 80
    let width = 400
    let compressedBuffer = buffer

    try {
      const sharp = require('sharp')
      for (let attempt = 0; attempt < 10; attempt++) {
        compressedBuffer = await sharp(buffer)
          .resize(width, null, { withoutEnlargement: true })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer()

        if (compressedBuffer.length <= 25 * 1024) break

        // Reduce quality first, then width
        if (quality > 30) {
          quality -= 10
        } else if (width > 100) {
          width -= 50
          quality = 80
        } else {
          break // Can't compress further
        }
      }
    } catch (sharpError: any) {
      // Sharp unavailable — use original buffer (still works, just larger)
      console.warn('Sharp compression failed, using original image:', sharpError?.message)
      compressedBuffer = buffer
    }

    // v6.27.4: Store as base64 DATA URI directly in the database.
    // This survives container restarts and works in any rendering context.
    const finalSizeKB = (compressedBuffer.length / 1024).toFixed(1)
    const logoUrl = `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`

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
      changes: { logoUrl: '[base64 data URI]', sizeKB: finalSizeKB },
    })

    return NextResponse.json({ success: true, logoUrl, sizeKB: finalSizeKB })
  } catch (error: any) {
    console.error('Logo upload error:', error)
    return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 })
  }
}
