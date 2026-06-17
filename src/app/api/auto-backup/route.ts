import { NextRequest, NextResponse } from 'next/server'
import { triggerAutoBackup, forceGenerateBackup, getLatestBackupInfo, listBackupFiles, getBackupFilePath, deleteBackupFile } from '@/lib/auto-backup'
import { parseExcelBackup, restoreFromExcelData, generateExcelBackup } from '@/lib/excel-backup'
import { writeFile, mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

const UPLOAD_DIR = join(process.cwd(), 'upload')

/**
 * Auto-Backup API
 *
 * Actions (POST JSON):
 * - trigger: Trigger auto-backup after a save operation (debounced)
 * - generate: Force-generate a backup immediately
 * - generate-download: Generate a fresh backup AND return the Excel file directly (one-click download)
 * - latest: Get info about the latest backup
 * - list: List all backup files for a tenant
 * - download: Get download URL for a specific backup file
 * - delete: Delete a specific backup file
 *
 * GET params:
 * - tenantId + filename: Download an existing backup file
 * - tenantId + action=download-all: Generate fresh and download in one request
 *
 * File Upload (POST FormData):
 * - Upload an Excel file for restore
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''

    // Handle file upload (Excel restore)
    if (contentType.includes('multipart/form-data')) {
      return await handleFileUpload(req)
    }

    // Handle JSON actions
    const body = await req.json()
    const { action, tenantId } = body

    if (!tenantId && action !== 'upload-restore') {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    switch (action) {
      case 'trigger':
        triggerAutoBackup(tenantId, body.trigger || 'manual')
        return NextResponse.json({ success: true, message: 'Backup triggered' })

      case 'generate':
        const info = await forceGenerateBackup(tenantId, body.trigger || 'manual')
        if (info) {
          return NextResponse.json({ success: true, backup: info })
        }
        return NextResponse.json({ error: 'Failed to generate backup' }, { status: 500 })

      case 'generate-download':
        // ONE-CLICK: Generate fresh Excel backup and return the file directly
        return await handleGenerateAndDownload(tenantId, body.companyName)

      case 'latest':
        const latest = await getLatestBackupInfo(tenantId)
        return NextResponse.json({ latest })

      case 'list':
        const files = await listBackupFiles(tenantId)
        return NextResponse.json({ files })

      case 'delete':
        if (!body.filename) {
          return NextResponse.json({ error: 'Filename is required' }, { status: 400 })
        }
        const deleted = await deleteBackupFile(tenantId, body.filename)
        return NextResponse.json({ success: deleted })

      case 'upload-restore':
        return await handleUploadRestore(body)

      default:
        return NextResponse.json({ error: 'Invalid action. Use: trigger, generate, generate-download, latest, list, delete, upload-restore' }, { status: 400 })
    }
  } catch (error) {
    console.error('Auto-backup API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET handler - Download a backup file or generate-and-download
 * Supports:
 * - tenantId + filename: Download an existing backup file
 * - tenantId + action=download-all: Generate fresh backup and download in one request (one-click)
 */
export async function GET(req: NextRequest) {
  // ---- SECURITY PATCH v1: require auth ----
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth
  // ------------------------------------------

  try {
    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenantId')
    const filename = url.searchParams.get('filename')
    const action = url.searchParams.get('action')
    const companyName = url.searchParams.get('companyName') || tenantId?.replace(/[^a-zA-Z0-9]/g, '_') || 'backup'
    const fixedFilename = url.searchParams.get('fixedFilename') || ''

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    // One-click download: generate fresh backup and return the file directly
    if (action === 'download-all') {
      return await handleGenerateAndDownload(tenantId, companyName, fixedFilename)
    }

    // Download existing backup by filename
    if (!filename) {
      return NextResponse.json({ error: 'filename is required (or use action=download-all)' }, { status: 400 })
    }

    const filePath = getBackupFilePath(tenantId, filename)
    if (!filePath) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const fileBuffer = await readFile(filePath)

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${companyName}_${filename}"`,
        'Content-Length': String(fileBuffer.length),
      },
    })
  } catch (error) {
    console.error('Auto-backup download error:', error)
    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}

/**
 * Generate a fresh Excel backup and return it as a downloadable file.
 * This is the ONE-CLICK DOWNLOAD handler - generates + downloads in a single request.
 */
async function handleGenerateAndDownload(tenantId: string, companyName?: string, fixedFilename?: string): Promise<NextResponse> {
  try {
    console.log(`[AUTO-BACKUP] One-click download: Generating fresh Excel backup for tenant ${tenantId}`)

    // Generate the Excel backup in memory
    const { buffer, meta } = await generateExcelBackup(tenantId)

    // Also save it to disk for backup history
    try {
      const info = await forceGenerateBackup(tenantId, 'one-click-download')
      console.log(`[AUTO-BACKUP] Saved backup: ${info?.filename} (${meta.totalRecords} records)`)
    } catch {
      // Non-critical: the file was already generated in memory, disk save is bonus
      console.log('[AUTO-BACKUP] Disk save failed, but file is ready for download')
    }

    // Use fixed filename based on company name so old files get overwritten
    // This ensures only ONE Excel file per company on the user's device
    const downloadFilename = fixedFilename || (() => {
      const safeName = (companyName || tenantId).replace(/[^a-zA-Z0-9]/g, '_')
      return `${safeName}_BizBook_Backup.xlsx`
    })()

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${downloadFilename}"`,
        'Content-Length': String(buffer.length),
        'X-Backup-Records': String(meta.totalRecords),
        'X-Backup-Sheets': String(meta.sheets.length),
      },
    })
  } catch (error) {
    console.error('One-click download error:', error)
    return NextResponse.json({ error: 'Failed to generate backup for download' }, { status: 500 })
  }
}

// ============================================================
// File Upload Handlers
// ============================================================

async function handleFileUpload(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const tenantId = formData.get('tenantId') as string | null
    const action = formData.get('action') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    // Save the uploaded file temporarily
    await mkdir(UPLOAD_DIR, { recursive: true })
    const fileId = randomUUID()
    const filePath = join(UPLOAD_DIR, `${fileId}.xlsx`)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(filePath, buffer)

    // Parse the Excel file
    const parseResult = await parseExcelBackup(buffer)

    if (!parseResult.success) {
      return NextResponse.json({
        error: 'Failed to parse Excel file',
        errors: parseResult.errors,
      }, { status: 400 })
    }

    // If action is 'analyze', just return the parsed data for preview
    if (action === 'analyze') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      return NextResponse.json({
        success: true,
        fileName: file.name,
        meta: parseResult.meta,
        sheetNames: Object.keys(parseResult.data),
        recordCounts: Object.fromEntries(
          Object.entries(parseResult.data).map(([key, rows]) => [key, rows.length])
        ),
        warnings: parseResult.warnings,
        // Include sample data from each sheet (first 3 rows)
        preview: Object.fromEntries(
          Object.entries(parseResult.data).map(([key, rows]) => [key, rows.slice(0, 3)])
        ),
      })
    }

    // If action is 'restore', apply the data to the database
    if (action === 'restore' && tenantId) {
      const userRole = formData.get('userRole') as string | null
      const result = await restoreFromExcelData(tenantId, parseResult.data, userRole || undefined)
      return NextResponse.json(result)
    }

    // Default: return parsed data info
    return NextResponse.json({
      success: true,
      fileName: file.name,
      meta: parseResult.meta,
      sheetNames: Object.keys(parseResult.data),
      recordCounts: Object.fromEntries(
        Object.entries(parseResult.data).map(([key, rows]) => [key, rows.length])
      ),
      warnings: parseResult.warnings,
      errors: parseResult.errors,
    })
  } catch (error) {
    console.error('File upload error:', error)
    return NextResponse.json({ error: 'Failed to process uploaded file' }, { status: 500 })
  }
}

async function handleUploadRestore(body: any): Promise<NextResponse> {
  const { tenantId, userRole, data } = body

  if (!tenantId || !data) {
    return NextResponse.json({ error: 'tenantId and data are required' }, { status: 400 })
  }

  const result = await restoreFromExcelData(tenantId, data, userRole)
  return NextResponse.json(result)
}
