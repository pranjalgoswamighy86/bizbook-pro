import { NextRequest, NextResponse } from 'next/server'
import {
  triggerAutoBackup,
  forceGenerateBackup,
  getLatestBackupInfo,
  listBackupFiles,
  getBackupFilePath,
  deleteBackupFile,
} from '@/lib/auto-backup'
import { parseExcelBackup, restoreFromExcelData, generateExcelBackup } from '@/lib/excel-backup'
import { readFile } from 'fs/promises'
import { requireAuthAndTenant, requireAuthAndRole } from '@/lib/api-helpers'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_MULTIPART_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024
const MAX_JSON_RESTORE_BYTES = 100 * 1024 * 1024

async function readLimitedJson(req: NextRequest): Promise<any> {
  const reader = req.body?.getReader()
  if (!reader) throw new Error('EMPTY_REQUEST_BODY')

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    totalBytes += value.byteLength
    if (totalBytes > MAX_JSON_RESTORE_BYTES) {
      await reader.cancel()
      throw new RangeError('REQUEST_TOO_LARGE')
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}


async function readLimitedFormData(req: NextRequest): Promise<FormData> {
  const reader = req.body?.getReader()
  if (!reader) throw new Error('EMPTY_REQUEST_BODY')

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    totalBytes += value.byteLength
    if (totalBytes > MAX_MULTIPART_REQUEST_BYTES) {
      await reader.cancel()
      throw new RangeError('REQUEST_TOO_LARGE')
    }
    chunks.push(value)
  }

  const rawBody = Buffer.concat(chunks)
  const boundedRequest = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: rawBody,
  })
  return boundedRequest.formData()
}

/**
 * Tenant-scoped Excel backup API. Authorization is always derived from the
 * current session and database membership; the caller's tenantId/userRole
 * fields are never treated as proof of access.
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    return handleFileUpload(req)
  }

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > MAX_JSON_RESTORE_BYTES) {
    return NextResponse.json({ error: 'Backup restore exceeds the 100 MB request limit.' }, { status: 413 })
  }
  let body: any
  try {
    body = await readLimitedJson(req)
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: 'Backup restore exceeds the 100 MB request limit.' }, { status: 413 })
    }
    return NextResponse.json({ error: 'Invalid or missing backup request body.' }, { status: 400 })
  }
  if (!body || typeof body.tenantId !== 'string' || !body.tenantId.trim()) {
    return NextResponse.json({ error: 'Company ID is required.' }, { status: 400 })
  }

  const tenantId = body.tenantId

  if (body.action === 'trigger') {
    const access = await requireAuthAndTenant(req, tenantId)
    if (access instanceof NextResponse) return access
    triggerAutoBackup(access.tenantId, typeof body.trigger === 'string' ? body.trigger : 'manual')
    return NextResponse.json({ success: true, message: 'Backup triggered' })
  }

  const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
  if (access instanceof NextResponse) return access
  const authorizedTenantId = access.tenantId

  try {
    switch (body.action) {
      case 'generate': {
        const info = await forceGenerateBackup(
          authorizedTenantId,
          typeof body.trigger === 'string' ? body.trigger : 'manual'
        )
        if (!info) return NextResponse.json({ error: 'Failed to generate backup.' }, { status: 500 })
        return NextResponse.json({ success: true, backup: info })
      }

      case 'generate-download':
        return handleGenerateAndDownload(authorizedTenantId, body.companyName)

      case 'latest': {
        const latest = await getLatestBackupInfo(authorizedTenantId)
        return NextResponse.json({ latest }, { headers: { 'Cache-Control': 'no-store' } })
      }

      case 'list': {
        const files = await listBackupFiles(authorizedTenantId)
        return NextResponse.json({ files }, { headers: { 'Cache-Control': 'no-store' } })
      }

      case 'delete': {
        if (typeof body.filename !== 'string' || !body.filename.trim()) {
          return NextResponse.json({ error: 'Filename is required.' }, { status: 400 })
        }
        const deleted = await deleteBackupFile(authorizedTenantId, body.filename)
        return NextResponse.json({ success: deleted })
      }

      case 'upload-restore': {
        if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
          return NextResponse.json({ error: 'Backup data is required.' }, { status: 400 })
        }
        const result = await restoreFromExcelData(authorizedTenantId, body.data, access.role)
        return NextResponse.json(result)
      }

      default:
        return NextResponse.json({ error: 'Invalid backup action.' }, { status: 400 })
    }
  } catch (error) {
    console.error('[AUTO-BACKUP] Request failed:', error)
    return NextResponse.json({ error: 'Backup operation failed.' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const requestedTenantId = url.searchParams.get('tenantId')
  if (!requestedTenantId) {
    return NextResponse.json({ error: 'tenantId is required.' }, { status: 400 })
  }

  const access = await requireAuthAndRole(req, requestedTenantId, ['MAIN_ADMIN'])
  if (access instanceof NextResponse) return access

  const tenantId = access.tenantId
  const filename = url.searchParams.get('filename')
  const action = url.searchParams.get('action')
  const companyName = (url.searchParams.get('companyName') || 'BizBook')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80)
  const requestedFixedFilename = url.searchParams.get('fixedFilename') || ''
  const fixedFilename = /^[a-zA-Z0-9_-]{1,100}\.xlsx$/.test(requestedFixedFilename)
    ? requestedFixedFilename
    : undefined

  if (action === 'download-all') {
    return handleGenerateAndDownload(tenantId, companyName, fixedFilename)
  }

  if (!filename) {
    return NextResponse.json({ error: 'filename is required (or use action=download-all).' }, { status: 400 })
  }

  try {
    const filePath = getBackupFilePath(tenantId, filename)
    if (!filePath) return NextResponse.json({ error: 'File not found.' }, { status: 404 })

    const fileBuffer = await readFile(filePath)
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${companyName}_${filename.replace(/[^a-zA-Z0-9._-]/g, '')}"`,
        'Content-Length': String(fileBuffer.length),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (error) {
    console.error('[AUTO-BACKUP] Download failed:', error)
    return NextResponse.json({ error: 'Download failed.' }, { status: 500 })
  }
}

async function handleGenerateAndDownload(
  tenantId: string,
  companyName?: string,
  fixedFilename?: string
): Promise<NextResponse> {
  try {
    const { buffer, meta } = await generateExcelBackup(tenantId)

    try {
      const info = await forceGenerateBackup(tenantId, 'one-click-download')
      console.log(`[AUTO-BACKUP] Saved tenant backup: ${info?.filename || 'not saved'}`)
    } catch (error) {
      console.warn('[AUTO-BACKUP] Could not persist download copy:', error)
    }

    const safeCompanyName = (companyName || 'BizBook')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 80)
    const downloadFilename = fixedFilename && /^[a-zA-Z0-9_-]{1,100}\.xlsx$/.test(fixedFilename)
      ? fixedFilename
      : `${safeCompanyName}_BizBook_Backup.xlsx`

    return new NextResponse(new Uint8Array(buffer) as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${downloadFilename}"`,
        'Content-Length': String(buffer.length),
        'X-Backup-Records': String(meta.totalRecords),
        'X-Backup-Sheets': String(meta.sheets.length),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (error) {
    console.error('[AUTO-BACKUP] Excel generation failed:', error)
    return NextResponse.json({ error: 'Failed to generate the business backup.' }, { status: 500 })
  }
}

async function handleFileUpload(req: NextRequest): Promise<NextResponse> {
  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > MAX_MULTIPART_REQUEST_BYTES) {
    return NextResponse.json({ error: 'Excel backup exceeds the 20 MB upload limit.' }, { status: 413 })
  }

  let formData: FormData
  try {
    formData = await readLimitedFormData(req)
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: 'Excel backup exceeds the 20 MB upload limit.' }, { status: 413 })
    }
    return NextResponse.json({ error: 'Invalid or missing multipart request body.' }, { status: 400 })
  }

  const tenantId = formData.get('tenantId')
  const action = formData.get('action')
  const file = formData.get('file')

  if (typeof tenantId !== 'string' || !tenantId.trim()) {
    return NextResponse.json({ error: 'Company ID is required.' }, { status: 400 })
  }
  if (action !== 'analyze' && action !== 'restore') {
    return NextResponse.json({ error: 'Invalid Excel upload action.' }, { status: 400 })
  }

  const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
  if (access instanceof NextResponse) return access

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No Excel backup file was uploaded.' }, { status: 400 })
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Excel backup must be between 1 byte and 20 MB.' }, { status: 413 })
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Only .xlsx backup files are accepted.' }, { status: 415 })
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const parseResult = await parseExcelBackup(buffer)
    if (!parseResult.success) {
      return NextResponse.json({
        error: 'Failed to parse Excel backup.',
        errors: parseResult.errors,
      }, { status: 400 })
    }

    if (action === 'restore') {
      const result = await restoreFromExcelData(access.tenantId, parseResult.data, access.role)
      return NextResponse.json(result)
    }

    return NextResponse.json({
      success: true,
      fileName: file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120),
      meta: parseResult.meta,
      sheetNames: Object.keys(parseResult.data),
      recordCounts: Object.fromEntries(
        Object.entries(parseResult.data).map(([key, rows]) => [key, rows.length])
      ),
      warnings: parseResult.warnings,
      preview: Object.fromEntries(
        Object.entries(parseResult.data).map(([key, rows]) => [key, rows.slice(0, 3)])
      ),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[AUTO-BACKUP] Excel upload failed:', error)
    return NextResponse.json({ error: 'Failed to process the Excel backup.' }, { status: 500 })
  }
}
