import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

const UPLOAD_DIR = join(process.cwd(), 'uploaded-invoices')

export async function GET(req: NextRequest) {
  // ---- SECURITY PATCH v1: require auth ----
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth
  // ------------------------------------------

  try {
    const fileName = req.nextUrl.searchParams.get('file')
    if (!fileName) {
      return NextResponse.json({ error: 'File name is required' }, { status: 400 })
    }

    // Security: prevent directory traversal
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '')
    const filePath = join(UPLOAD_DIR, safeName)

    const fileBuffer = await readFile(filePath)

    // Determine content type
    const ext = safeName.split('.').pop()?.toLowerCase()
    const contentType = ext === 'pdf' ? 'application/pdf'
      : ext === 'png' ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : 'application/octet-stream'

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
