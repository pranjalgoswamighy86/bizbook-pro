import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { rawDb } from '@/lib/db-soft-delete'
import { requireAuth, requireAuthAndTenant } from '@/lib/api-helpers'

const UPLOAD_ROOT = process.env.BIZBOOK_UPLOAD_DIR ||
  (process.env.NODE_ENV === 'production' ? '/app/data/uploaded-invoices' : join(process.cwd(), 'uploaded-invoices'))

const FILE_PATTERN = /^[A-Za-z0-9_-]+\.(pdf|jpg|jpeg|png|webp)$/i

export async function GET(req: NextRequest) {
  try {
    const requestedFile = req.nextUrl.searchParams.get('file')
    if (!requestedFile) {
      return NextResponse.json({ error: 'File name is required.' }, { status: 400 })
    }

    const segments = requestedFile.split('/')
    let tenantId: string
    let storedFileName: string
    let isLegacyFlatFile = false

    if (segments.length === 2 && /^[A-Za-z0-9_-]{1,128}$/.test(segments[0]) && FILE_PATTERN.test(segments[1])) {
      tenantId = segments[0]
      storedFileName = segments[1]
    } else if (segments.length === 1 && FILE_PATTERN.test(segments[0])) {
      // Backwards compatibility for old flat filenames. They are served only
      // when the active tenant has an invoice record referencing that exact name.
      const auth = await requireAuth(req)
      if (auth instanceof NextResponse) return auth
      tenantId = auth.user.tenantId
      if (!tenantId) {
        return NextResponse.json({ error: 'A business membership is required.' }, { status: 403 })
      }
      storedFileName = segments[0]
      isLegacyFlatFile = true
    } else {
      return NextResponse.json({ error: 'Invalid invoice file reference.' }, { status: 400 })
    }

    const access = await requireAuthAndTenant(req, tenantId)
    if (access instanceof NextResponse) return access
    const authorizedTenantId = access.tenantId

    // A valid path is not sufficient: the tenant must own an active sale or
    // purchase record which explicitly references this invoice file.
    const [saleReference, purchaseReference] = await Promise.all([
      rawDb.sale.findFirst({
        where: { tenantId: authorizedTenantId, invoiceFile: requestedFile, isDeleted: false },
        select: { id: true },
      }),
      rawDb.purchase.findFirst({
        where: { tenantId: authorizedTenantId, invoiceFile: requestedFile, isDeleted: false },
        select: { id: true },
      }),
    ])

    if (!saleReference && !purchaseReference) {
      return NextResponse.json({ error: 'Invoice file not found.' }, { status: 404 })
    }

    const filePath = isLegacyFlatFile
      ? join(UPLOAD_ROOT, storedFileName)
      : join(UPLOAD_ROOT, authorizedTenantId, storedFileName)
    const fileBuffer = await readFile(filePath)

    const ext = storedFileName.split('.').pop()?.toLowerCase()
    const contentType = ext === 'pdf' ? 'application/pdf'
      : ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : 'application/octet-stream'

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${storedFileName}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[INVOICE-FILE] Failed to read invoice:', error)
    return NextResponse.json({ error: 'File not found.' }, { status: 404 })
  }
}
