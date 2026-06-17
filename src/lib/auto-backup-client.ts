/**
 * BizBook Pro - Client-Side Auto-Backup Download Module
 *
 * CORE LOCKED FEATURE: This module automatically downloads an Excel backup
 * to the user's physical storage after EVERY save/confirm operation.
 *
 * Design:
 * - NO DEBOUNCE: Every single save/confirm triggers a download
 * - Fixed filename by company name: Each company gets ONE file that gets overwritten
 *   (e.g., "Tahigo_International_BizBook_Backup.xlsx") — no multi-file clutter
 * - Silent background download to user's Downloads folder
 * - Non-blocking: Does not affect save operation performance
 * - Fire-and-forget: Download failures are logged but don't fail the save
 * - Works alongside the server-side auto-backup system
 *
 * DO NOT REMOVE THIS MODULE - It is a core data protection feature.
 * Users rely on this for zero data loss probability.
 */

// Track in-progress downloads to avoid duplicate concurrent requests
let pendingDownload: Promise<void> | null = null

/**
 * Generate a fixed filename for a company's backup file.
 * Uses the company name so the same file gets overwritten every time.
 * This ensures only ONE Excel file per company on the user's device.
 *
 * Example: "Tahigo International" → "Tahigo_International_BizBook_Backup.xlsx"
 */
function getBackupFilename(companyName: string): string {
  const safeName = companyName.replace(/[^a-zA-Z0-9]/g, '_')
  return `${safeName}_BizBook_Backup.xlsx`
}

/**
 * Trigger an automatic Excel backup download to the user's device.
 *
 * This is called after EVERY successful save/confirm operation.
 * It downloads a fresh Excel file with ALL business data to the user's
 * physical storage (Downloads folder), ensuring they always have a
 * local copy of their data.
 *
 * Key Features:
 * - NO DEBOUNCE: Every save triggers a download (as per user requirement)
 * - Fixed filename: Same company name = same file, auto-overwrites old backup
 * - Queue-based: If a download is in progress, the next one waits
 * - Background: Downloads silently without disrupting the UI
 * - Non-blocking: Does not slow down the save operation
 * - Resilient: Failures are silently logged, never block the user
 *
 * @param tenantId - The company/tenant ID
 * @param companyName - The company name (used for fixed filename)
 * @param trigger - What operation triggered this (e.g., 'sale:create', 'inventory:update')
 */
export async function triggerBackupDownload(
  tenantId: string | undefined,
  companyName: string | undefined,
  trigger: string = 'save'
): Promise<void> {
  if (!tenantId) return

  // If a download is already in progress, skip this one
  // (the next save will trigger another download soon anyway)
  if (pendingDownload) {
    console.log(`[AUTO-BACKUP-CLIENT] Download in progress, queuing (trigger: ${trigger})`)
    // Wait for the current download to finish, then start a new one
    pendingDownload = pendingDownload.then(() => performAutoDownload(tenantId, companyName || 'Backup', trigger)).catch(() => {}).then(() => { pendingDownload = null })
    return
  }

  console.log(`[AUTO-BACKUP-CLIENT] Triggering auto-download for "${companyName}" (trigger: ${trigger})`)

  // Fire-and-forget: start the download in the background
  pendingDownload = performAutoDownload(tenantId, companyName || 'Backup', trigger)
    .then(() => {
      pendingDownload = null
    })
    .catch((err) => {
      console.error('[AUTO-BACKUP-CLIENT] Auto-download failed:', err)
      pendingDownload = null
    })
}

/**
 * Perform the actual download of the Excel backup file.
 * Uses a fixed filename based on company name so old files get overwritten.
 */
async function performAutoDownload(
  tenantId: string,
  companyName: string,
  trigger: string
): Promise<void> {
  try {
    const safeName = encodeURIComponent(companyName.replace(/[^a-zA-Z0-9]/g, '_'))
    const fixedFilename = getBackupFilename(companyName)

    console.log(`[AUTO-BACKUP-CLIENT] Starting auto-download: ${fixedFilename} (trigger: ${trigger})`)

    const res = await fetch(`/api/auto-backup?action=download-all&tenantId=${tenantId}&companyName=${safeName}&fixedFilename=${encodeURIComponent(fixedFilename)}`)

    if (!res.ok) {
      console.error(`[AUTO-BACKUP-CLIENT] Download request failed: ${res.status}`)
      return
    }

    const recordCount = parseInt(res.headers.get('X-Backup-Records') || '0', 10)
    const blob = await res.blob()

    // Create download link and trigger the download
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url

    // IMPORTANT: Use fixed filename from Content-Disposition header
    // The server now sends the fixed company-name filename
    const contentDisposition = res.headers.get('Content-Disposition') || ''
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/)
    a.download = filenameMatch ? filenameMatch[1] : fixedFilename

    // Trigger the download
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    console.log(`[AUTO-BACKUP-CLIENT] Auto-download complete: ${fixedFilename} (${recordCount} records, trigger: ${trigger})`)
  } catch (error) {
    console.error('[AUTO-BACKUP-CLIENT] Auto-download error:', error)
    throw error
  }
}

/**
 * Force an immediate backup download (for manual "Download All Data" button).
 * Also uses the fixed company-name filename.
 */
export async function forceBackupDownload(
  tenantId: string,
  companyName: string,
  trigger: string = 'manual'
): Promise<{ success: boolean; recordCount?: number; error?: string }> {
  try {
    const safeName = encodeURIComponent(companyName.replace(/[^a-zA-Z0-9]/g, '_'))
    const fixedFilename = getBackupFilename(companyName)

    const res = await fetch(`/api/auto-backup?action=download-all&tenantId=${tenantId}&companyName=${safeName}&fixedFilename=${encodeURIComponent(fixedFilename)}`)

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Download failed' }))
      return { success: false, error: data.error || 'Download failed' }
    }

    const recordCount = parseInt(res.headers.get('X-Backup-Records') || '0', 10)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url

    const contentDisposition = res.headers.get('Content-Disposition') || ''
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/)
    a.download = filenameMatch ? filenameMatch[1] : fixedFilename

    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    return { success: true, recordCount }
  } catch (error) {
    console.error('[AUTO-BACKUP-CLIENT] Force download error:', error)
    return { success: false, error: 'Network error. Please try again.' }
  }
}

/**
 * Reset the pending download state.
 * Useful when switching companies/tenants.
 */
export function resetAutoBackupCooldown(): void {
  pendingDownload = null
}

/**
 * Check if the user has granted drive access permission for auto-backup.
 * Returns true if the user has already accepted.
 */
export function hasBackupDriveAccess(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem('bizbook_backup_drive_access') === 'granted'
}

/**
 * Mark that the user has granted drive access permission for auto-backup.
 */
export function grantBackupDriveAccess(): void {
  if (typeof window === 'undefined') return
  localStorage.setItem('bizbook_backup_drive_access', 'granted')
}

/**
 * Revoke drive access permission for auto-backup.
 */
export function revokeBackupDriveAccess(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem('bizbook_backup_drive_access')
}
