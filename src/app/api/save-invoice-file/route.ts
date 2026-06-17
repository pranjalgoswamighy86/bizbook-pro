import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

const UPLOAD_DIR = join(process.cwd(), 'uploaded-invoices')

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { fileData, fileName } = body

    if (!fileData) {
      return NextResponse.json({ error: 'No file data provided' }, { status: 400 })
    }

    // Validate it's a base64 data URL
    const match = fileData.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) {
      return NextResponse.json({ error: 'Invalid file data format' }, { status: 400 })
    }

    const mimeType = match[1]
    const base64 = match[2]
    const isPdf = mimeType === 'application/pdf'
    const ext = isPdf ? 'pdf' : (mimeType.split('/')[1] || 'png')

    // Generate a safe filename
    const safeName = (fileName || 'invoice').replace(/[^a-zA-Z0-9._-]/g, '_')
    const savedName = `${safeName}_${Date.now()}.${ext}`

    await mkdir(UPLOAD_DIR, { recursive: true })
    const filePath = join(UPLOAD_DIR, savedName)

    const buffer = Buffer.from(base64, 'base64')
    await writeFile(filePath, buffer)

    return NextResponse.json({ fileName: savedName, size: buffer.length })
  } catch (error) {
    console.error('Save invoice file error:', error)
    return NextResponse.json({
      error: 'Failed to save invoice file',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
