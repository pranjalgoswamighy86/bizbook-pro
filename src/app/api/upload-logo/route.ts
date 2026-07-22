import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'
import { db } from '@/lib/db-soft-delete'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

// POST /api/upload-logo — uploads a company logo, compresses to ~25KB, saves to tenant
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

    // Check file size (max 2MB before compression)
    if (buffer.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'Logo file too large. Maximum 2MB before compression.' }, { status: 400 })
    }

    // Save to /public/logos/ directory
    const logosDir = path.join(process.cwd(), 'public', 'logos')
    if (!fs.existsSync(logosDir)) {
      fs.mkdirSync(logosDir, { recursive: true })
    }

    // Save original first
    const origFilename = `tenant-${tenantId}-orig.${ext}`
    const origFilepath = path.join(logosDir, origFilename)
    fs.writeFileSync(origFilepath, buffer)

    // Compress to ~25KB using sharp (if available) or ImageMagick
    const finalFilename = `tenant-${tenantId}.${ext}`
    const finalFilepath = path.join(logosDir, finalFilename)

    try {
      // Try sharp first — it's installed in the project
      const sharp = require('sharp')
      
      // Start with reasonable dimensions and quality, then reduce until under 25KB
      let quality = 80
      let width = 400
      let compressedBuffer = buffer

      for (let attempt = 0; attempt < 10; attempt++) {
        compressedBuffer = await sharp(origFilepath)
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

      // Save as .jpg for better compression
      const jpgFilename = `tenant-${tenantId}.jpg`
      const jpgFilepath = path.join(logosDir, jpgFilename)
      fs.writeFileSync(jpgFilepath, compressedBuffer)

      // Remove original
      try { fs.unlinkSync(origFilepath) } catch {}

      // Remove old format file if exists
      try { fs.unlinkSync(finalFilepath) } catch {}

      const logoUrl = `/logos/${jpgFilename}`
      const finalSizeKB = (compressedBuffer.length / 1024).toFixed(1)

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
        changes: { logoUrl, sizeKB: finalSizeKB },
      })

      return NextResponse.json({ success: true, logoUrl, sizeKB: finalSizeKB })
    } catch (sharpError: any) {
      // Fallback: just save the original (no compression)
      console.warn('Sharp compression failed, saving original:', sharpError?.message)
      
      fs.renameSync(origFilepath, finalFilepath)
      const logoUrl = `/logos/${finalFilename}`
      const finalSizeKB = (buffer.length / 1024).toFixed(1)

      await db.tenant.update({
        where: { id: tenantId },
        data: { logoUrl },
      })

      return NextResponse.json({ success: true, logoUrl, sizeKB: finalSizeKB })
    }
  } catch (error: any) {
    console.error('Logo upload error:', error)
    return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 })
  }
}
