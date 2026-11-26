/**
 * Payment Proof Upload Endpoint (v4.47)
 * =====================================
 * USER FLOW:
 *   1. User pays via UPI app on iPhone
 *   2. User takes screenshot of the UPI success screen (shows UTR + amount + date)
 *   3. User uploads screenshot + enters UTR number via UPI modal
 *   4. This endpoint stores:
 *      - Screenshot file → /payment-proofs/{queueId}_{timestamp}.{ext}
 *      - UTR number → SubscriptionQueue.utrNumber
 *      - Submission timestamp → SubscriptionQueue.proofSubmittedAt
 *      - Status changes from PENDING → PROOF_SUBMITTED
 *   5. Super Admin reviews proof in Super Admin Panel
 *      - If verified: admin-override-verify activates the plan
 *      - If rejected: status returns to PENDING, user can re-submit
 *
 * SECURITY:
 *   - Only the tenant who owns the queue entry can upload proof
 *   - File size limit: 1MB (v4.48: reduced from 5MB per user request)
 *   - Allowed file types: jpg, jpeg, png, webp, pdf
 *   - UTR validated: 12 digits (UPI) OR 22 chars alphanumeric (NEFT/RTGS)
 *   - Duplicate UTR detection across all queue entries
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuth } from '@/lib/api-helpers'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomBytes } from 'crypto'

// Railway mounts the persistent application volume at /app/data.
// Keep proof files on that volume instead of the ephemeral container layer.
const DATA_DIR = join(process.cwd(), 'data')
const UPLOAD_DIR = join(DATA_DIR, 'payment-proofs')
const MAX_FILE_SIZE = 1 * 1024 * 1024 // 1MB (v4.48: was 5MB, reduced per user request)
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf']

const MIME_BY_EXTENSION: Record<string, string[]> = {
  jpg: ['image/jpeg', 'image/jpg'],
  jpeg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
}

function hasValidFileSignature(buffer: Buffer, ext: string): boolean {
  if (ext === 'jpg' || ext === 'jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (ext === 'png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (ext === 'webp') {
    return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  }
  if (ext === 'pdf') {
    return buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-'
  }
  return false
}

// UTR validation: 12 digits (UPI) or 22 chars alphanumeric (NEFT/RTGS)
function isValidUTR(utr: string): boolean {
  const trimmed = utr.trim().toUpperCase()
  // UPI UTR: 12 digits
  if (/^\d{12}$/.test(trimmed)) return true
  // NEFT/RTGS reference: up to 22 alphanumeric
  if (/^[A-Z0-9]{16,22}$/.test(trimmed)) return true
  return false
}

export async function POST(req: NextRequest) {
  try {
    console.log('[PAYMENT-PROOF] Upload request received')
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) {
      console.error('[PAYMENT-PROOF] Auth failed')
      return auth
    }

    const formData = await req.formData()
    const queueId = formData.get('queueId') as string
    const utrNumber = (formData.get('utrNumber') as string || '').trim()
    const file = formData.get('screenshot') as File | null

    // ---------- Validate inputs ----------
    if (!queueId) {
      return NextResponse.json({ error: 'queueId is required' }, { status: 400 })
    }
    if (!utrNumber) {
      return NextResponse.json({ error: 'UTR number is required' }, { status: 400 })
    }
    if (!isValidUTR(utrNumber)) {
      return NextResponse.json({
        error: 'Invalid UTR. UTR should be 12 digits (UPI) or 16-22 alphanumeric (NEFT/RTGS). Check your UPI app transaction details.'
      }, { status: 400 })
    }
    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'Screenshot file is required' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB.` }, { status: 413 })
    }

    // Require a matching extension AND MIME type, then verify the actual
    // file signature. Browser-supplied names and MIME types are untrusted.
    const mimeType = file.type.toLowerCase()
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (!ALLOWED_EXTENSIONS.includes(ext) || !MIME_BY_EXTENSION[ext]?.includes(mimeType) || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json({
        error: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
      }, { status: 415 })
    }
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (!hasValidFileSignature(buffer, ext)) {
      return NextResponse.json({ error: 'File content does not match the selected file type' }, { status: 415 })
    }

    // ---------- Verify queue entry belongs to this user's active tenant ----------
    const entry = await db.subscriptionQueue.findFirst({
      where: { id: queueId, tenant: { isDeleted: false } }
    })
    if (!entry) {
      return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 })
    }

    // Check user has access to this tenant
    const userTenant = await db.userTenant.findFirst({
      where: { userId: auth.userId, tenantId: entry.tenantId, tenant: { isDeleted: false } }
    })
    if (!userTenant) {
      console.error(`[PAYMENT-PROOF] User ${auth.userId} tried to upload proof for tenant ${entry.tenantId} they don't own`)
      return NextResponse.json({ error: 'You do not have access to this queue entry' }, { status: 403 })
    }

    if (entry.status !== 'PENDING') {
      return NextResponse.json({ error: 'This payment proof cannot be submitted in its current status' }, { status: 409 })
    }

    // ---------- Check for duplicate UTR ----------
    const existingUTR = await db.subscriptionQueue.findFirst({
      where: {
        utrNumber: utrNumber.toUpperCase(),
        NOT: { id: queueId }, // exclude current entry
        status: { in: ['SUCCESS', 'PROOF_SUBMITTED'] }
      }
    })
    if (existingUTR) {
      console.warn(`[PAYMENT-PROOF] Duplicate UTR detected: ${utrNumber} already used by queue ${existingUTR.id}`)
      return NextResponse.json({
        error: 'This UTR number has already been used for another payment. Each UTR can only be used once. If you believe this is an error, contact support.'
      }, { status: 409 })
    }

    // ---------- Save screenshot file ----------
    await mkdir(UPLOAD_DIR, { recursive: true })
    const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : 'png'
    const uniqueId = randomBytes(8).toString('hex')
    const fileName = `proof_${queueId}_${uniqueId}.${safeExt}`
    const filePath = join(UPLOAD_DIR, fileName)

    await writeFile(filePath, buffer)

    console.log(`[PAYMENT-PROOF] Screenshot saved: ${fileName} (${(file.size / 1024).toFixed(1)} KB)`)

    // ---------- Update queue entry ----------
    const submitted = await db.subscriptionQueue.updateMany({
      where: {
        id: queueId,
        tenantId: entry.tenantId,
        status: 'PENDING',
        tenant: { isDeleted: false },
      },
      data: {
        utrNumber: utrNumber.toUpperCase(),
        screenshotPath: fileName,
        proofSubmittedAt: new Date(),
        status: 'PROOF_SUBMITTED',
      },
    })
    if (submitted.count !== 1) {
      const { unlink } = await import('fs/promises')
      await unlink(filePath).catch(() => undefined)
      return NextResponse.json({ error: 'This payment proof was already submitted or the queue entry is no longer active' }, { status: 409 })
    }

    console.log(`[PAYMENT-PROOF] ✓ Proof submitted for queue ${queueId} — UTR: ${utrNumber.toUpperCase()}, status: PROOF_SUBMITTED`)

    return NextResponse.json({
      success: true,
      message: 'Payment proof submitted successfully! Admin will review it shortly.',
      status: 'PROOF_SUBMITTED',
      utrNumber: utrNumber.toUpperCase(),
      submittedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[PAYMENT-PROOF] Upload error:', error?.message)
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// ---------- GET endpoint — download screenshot (admin only) ----------
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    const fileName = req.nextUrl.searchParams.get('file')
    if (!fileName) {
      return NextResponse.json({ error: 'File name is required' }, { status: 400 })
    }

    // Security: prevent directory traversal
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '')
    const filePath = join(UPLOAD_DIR, safeName)

    // Verify the requesting user is admin OR owns the queue entry
    const queueEntry = await db.subscriptionQueue.findFirst({
      where: { screenshotPath: safeName, tenant: { isDeleted: false } }
    })
    if (!queueEntry) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Check admin status or tenant ownership
    const user = await db.user.findUnique({ where: { id: auth.userId } })
    const ADMIN_EMAILS = [
  process.env.ADMIN_EMAIL || '',
  process.env.INFRA_OWNER_EMAIL || '',
  process.env.INFRASTRUCTURE_OWNER_EMAIL || '',
].map(value => value.toLowerCase().trim()).filter(Boolean)

    const isAdmin = user && ADMIN_EMAILS.includes(user.email.toLowerCase())
    if (!isAdmin) {
      // Non-admin: must own the queue entry
      const userTenant = await db.userTenant.findFirst({
        where: { userId: auth.userId, tenantId: queueEntry.tenantId, tenant: { isDeleted: false } }
      })
      if (!userTenant) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    const { readFile } = await import('fs/promises')
    const fileBuffer = await readFile(filePath)

    const ext = safeName.split('.').pop()?.toLowerCase()
    const contentType = ext === 'pdf' ? 'application/pdf'
      : ext === 'png' ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'webp' ? 'image/webp'
      : 'application/octet-stream'

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error: any) {
    console.error('[PAYMENT-PROOF] Download error:', error?.message)
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
