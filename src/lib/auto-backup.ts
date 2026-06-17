/**
 * BizBook Pro - Auto-Backup Trigger System
 *
 * CORE FEATURE: This module automatically triggers Excel backup generation
 * after every data save operation (create/update/delete).
 *
 * Design:
 * - Debounced: Max one backup per 30 seconds per tenant (avoids performance issues)
 * - Asynchronous: Does not block the API response
 * - Fire-and-forget: Errors are logged but don't fail the save operation
 * - Persists last backup info for UI display
 *
 * DO NOT REMOVE THIS MODULE - It is a core data protection feature.
 */

import { generateExcelBackup } from './excel-backup'
import { writeFile, mkdir, readFile, unlink, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const BACKUP_DIR = path.join(process.cwd(), 'db', 'excel-backups')
const DEBOUNCE_MS = 30_000 // 30 seconds between auto-backups per tenant
const MAX_BACKUPS_PER_TENANT = 10 // Keep last 10 Excel backups per tenant

// Track last backup time per tenant (in-memory debounce)
const lastBackupTime = new Map<string, number>()
// Track pending backup promises to avoid duplicates
const pendingBackups = new Map<string, Promise<void>>()

interface BackupInfo {
  tenantId: string
  timestamp: string
  filename: string
  recordCount: number
  fileSize: number
  trigger: string // What triggered this backup (e.g., 'sale:create', 'purchase:update')
}

/**
 * Trigger an auto-backup for a tenant after a data save operation.
 * This is debounced - if a backup was recently generated for this tenant,
 * it will be skipped.
 *
 * @param tenantId - The tenant/company ID
 * @param trigger - What operation triggered this backup (e.g., 'sale:create')
 */
export function triggerAutoBackup(tenantId: string, trigger: string = 'auto'): void {
  if (!tenantId) return

  const now = Date.now()
  const lastTime = lastBackupTime.get(tenantId) || 0

  // Debounce: Skip if backup was generated recently
  if (now - lastTime < DEBOUNCE_MS) {
    console.log(`[AUTO-BACKUP] Debounced for tenant ${tenantId} (${now - lastTime}ms ago)`)
    return
  }

  // Skip if a backup is already in progress for this tenant
  if (pendingBackups.has(tenantId)) {
    console.log(`[AUTO-BACKUP] Already in progress for tenant ${tenantId}`)
    return
  }

  // Mark the time immediately to prevent duplicate triggers
  lastBackupTime.set(tenantId, now)

  // Fire-and-forget async backup generation
  const backupPromise = generateAndSaveBackup(tenantId, trigger)
    .then(() => {
      pendingBackups.delete(tenantId)
    })
    .catch((err) => {
      console.error(`[AUTO-BACKUP] Failed for tenant ${tenantId}:`, err)
      pendingBackups.delete(tenantId)
      // Reset debounce on failure so it can retry
      lastBackupTime.delete(tenantId)
    })

  pendingBackups.set(tenantId, backupPromise)
}

/**
 * Force-generate a backup immediately (bypasses debounce).
 * Used for manual backup requests.
 */
export async function forceGenerateBackup(tenantId: string, trigger: string = 'manual'): Promise<BackupInfo | null> {
  try {
    return await generateAndSaveBackup(tenantId, trigger)
  } catch (err) {
    console.error(`[AUTO-BACKUP] Force backup failed for tenant ${tenantId}:`, err)
    return null
  }
}

/**
 * Get info about the latest backup for a tenant.
 */
export async function getLatestBackupInfo(tenantId: string): Promise<BackupInfo | null> {
  try {
    const infoPath = path.join(BACKUP_DIR, tenantId, '_latest.json')
    if (!existsSync(infoPath)) return null
    const content = await readFile(infoPath, 'utf-8')
    return JSON.parse(content) as BackupInfo
  } catch {
    return null
  }
}

/**
 * Get all backup files for a tenant.
 */
export async function listBackupFiles(tenantId: string): Promise<Array<{
  filename: string
  size: number
  created: string
  recordCount: number
  trigger: string
}>> {
  const tenantDir = path.join(BACKUP_DIR, tenantId)
  if (!existsSync(tenantDir)) return []

  try {
    const files = await readdir(tenantDir)
    const backups: Array<{
      filename: string
      size: number
      created: string
      recordCount: number
      trigger: string
    }> = []

    for (const file of files) {
      if (!file.endsWith('.xlsx') || file.startsWith('~$')) continue
      const filePath = path.join(tenantDir, file)
      const fileStat = await stat(filePath)

      // Try to read corresponding info file
      const infoFile = file.replace('.xlsx', '.json')
      let recordCount = 0
      let trigger = 'auto'
      try {
        const infoPath = path.join(tenantDir, infoFile)
        if (existsSync(infoPath)) {
          const info = JSON.parse(await readFile(infoPath, 'utf-8'))
          recordCount = info.recordCount || 0
          trigger = info.trigger || 'auto'
        }
      } catch {}

      backups.push({
        filename: file,
        size: fileStat.size,
        created: fileStat.mtime.toISOString(),
        recordCount,
        trigger,
      })
    }

    // Sort by creation time (newest first)
    backups.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())

    return backups
  } catch {
    return []
  }
}

/**
 * Get the full path of a backup file for download.
 */
export function getBackupFilePath(tenantId: string, filename: string): string | null {
  // Security: prevent path traversal
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '')
  if (!sanitized.endsWith('.xlsx')) return null

  const filePath = path.join(BACKUP_DIR, tenantId, sanitized)
  if (!existsSync(filePath)) return null

  return filePath
}

/**
 * Delete a specific backup file.
 */
export async function deleteBackupFile(tenantId: string, filename: string): Promise<boolean> {
  try {
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '')
    const filePath = path.join(BACKUP_DIR, tenantId, sanitized)

    if (!existsSync(filePath)) return false

    await unlink(filePath)

    // Also delete corresponding info file
    const infoFile = sanitized.replace('.xlsx', '.json')
    const infoPath = path.join(BACKUP_DIR, tenantId, infoFile)
    if (existsSync(infoPath)) {
      await unlink(infoPath).catch(() => {})
    }

    return true
  } catch {
    return false
  }
}

// ============================================================
// Internal: Generate and save backup to disk
// ============================================================

async function generateAndSaveBackup(tenantId: string, trigger: string): Promise<BackupInfo> {
  console.log(`[AUTO-BACKUP] Generating Excel backup for tenant ${tenantId} (trigger: ${trigger})`)

  // Ensure backup directory exists
  const tenantDir = path.join(BACKUP_DIR, tenantId)
  await mkdir(tenantDir, { recursive: true })

  // Generate the Excel backup
  const { buffer, meta } = await generateExcelBackup(tenantId)

  // Create filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const filename = `backup_${timestamp}.xlsx`
  const filePath = path.join(tenantDir, filename)

  // Save the Excel file
  await writeFile(filePath, buffer)

  // Save metadata info file
  const info: BackupInfo = {
    tenantId,
    timestamp: meta.exportedAt,
    filename,
    recordCount: meta.totalRecords,
    fileSize: buffer.length,
    trigger,
  }
  const infoPath = path.join(tenantDir, filename.replace('.xlsx', '.json'))
  await writeFile(infoPath, JSON.stringify(info, null, 2))

  // Save as _latest.json for quick access
  const latestPath = path.join(tenantDir, '_latest.json')
  await writeFile(latestPath, JSON.stringify(info, null, 2))

  // Clean up old backups (keep last N)
  await cleanupOldBackups(tenantId)

  console.log(`[AUTO-BACKUP] Saved: ${filename} (${meta.totalRecords} records, ${(buffer.length / 1024).toFixed(1)}KB)`)

  return info
}

async function cleanupOldBackups(tenantId: string): Promise<void> {
  const tenantDir = path.join(BACKUP_DIR, tenantId)
  if (!existsSync(tenantDir)) return

  try {
    const files = await readdir(tenantDir)
    const xlsxFiles = files
      .filter(f => f.startsWith('backup_') && f.endsWith('.xlsx'))
      .map(f => ({
        name: f,
        time: f.replace('backup_', '').replace('.xlsx', ''),
      }))
      .sort((a, b) => b.time.localeCompare(a.time)) // newest first

    // Delete old backups beyond the limit
    if (xlsxFiles.length > MAX_BACKUPS_PER_TENANT) {
      const toDelete = xlsxFiles.slice(MAX_BACKUPS_PER_TENANT)
      for (const file of toDelete) {
        const filePath = path.join(tenantDir, file.name)
        await unlink(filePath).catch(() => {})

        // Also delete corresponding info file
        const infoFile = file.name.replace('.xlsx', '.json')
        const infoPath = path.join(tenantDir, infoFile)
        await unlink(infoPath).catch(() => {})
      }
      console.log(`[AUTO-BACKUP] Cleaned up ${toDelete.length} old backups for tenant ${tenantId}`)
    }
  } catch (err) {
    console.error(`[AUTO-BACKUP] Cleanup failed for tenant ${tenantId}:`, err)
  }
}
