/**
 * BizBook Pro - Drive Folder Picker for Auto-Backup Storage
 *
 * Uses the File System Access API (showDirectoryPicker) to let the user
 * pick a folder on their physical drive where automatic Excel backups
 * will be saved. Falls back to the standard Downloads folder approach
 * if the browser doesn't support the File System Access API (Firefox,
 * Safari, mobile browsers).
 *
 * === Behavior ===
 * 1. User clicks "Choose Backup Folder" button
 * 2. Browser shows native folder picker
 * 3. User picks a folder (e.g., D:\Backups\BizBook or ~/Documents/BizBook)
 * 4. We store the FileSystemDirectoryHandle in IndexedDB (persists across sessions)
 * 5. On every save operation, we write the Excel backup to that folder
 *    with filename: <CompanyName>_BizBook_Backup.xlsx
 * 6. If the file already exists, it gets overwritten (single file per company)
 *
 * === Browser Support ===
 * - Chrome / Edge / Opera / Brave: Full support (showDirectoryPicker)
 * - Firefox: No support → fallback to regular Downloads folder
 * - Safari: No support → fallback to regular Downloads folder
 * - Mobile: No support → fallback to regular Downloads folder
 *
 * The fallback uses the existing auto-backup-client.ts module which
 * downloads to the browser's Downloads folder.
 */

const DB_NAME = 'bizbook-backup-fs'
const DB_VERSION = 1
const STORE_NAME = 'directory-handles'
const KEY_COMPANY_PREFIX = 'company:'

// ============================================================
// IndexedDB helpers for persisting directory handles across sessions
// ============================================================

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function storeDirectoryHandleInternal(tenantId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, KEY_COMPANY_PREFIX + tenantId)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

// Public export so other modules (cover.tsx, company-select.tsx) can
// re-key directory handles from temp IDs to real tenant IDs after
// registration / add-company completes.
export async function storeDirectoryHandle(tenantId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  return storeDirectoryHandleInternal(tenantId, handle)
}

export async function getStoredDirectoryHandle(tenantId: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(KEY_COMPANY_PREFIX + tenantId)
      req.onsuccess = () => { db.close(); resolve(req.result || null) }
      req.onerror = () => { db.close(); reject(req.error) }
    })
  } catch {
    return null
  }
}

export async function clearStoredDirectoryHandle(tenantId: string): Promise<void> {
  try {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(KEY_COMPANY_PREFIX + tenantId)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch {
    // ignore
  }
}

// ============================================================
// Browser capability detection
// ============================================================

export function isFileSystemAccessSupported(): boolean {
  if (typeof window === 'undefined') return false
  // @ts-expect-error - showDirectoryPicker is not yet in TS DOM lib
  return typeof window.showDirectoryPicker === 'function'
}

// ============================================================
// Pick a directory for backups
// ============================================================

/**
 * Show the native folder picker. Returns the chosen handle, or null if
 * the user cancels.
 *
 * The handle is persisted in IndexedDB so the user only has to pick once
 * per company (the browser will re-prompt for permission on next use
 * if the user closed the tab — this is a security feature of the API).
 */
export async function pickBackupDirectory(tenantId: string): Promise<{
  handle: FileSystemDirectoryHandle | null
  name: string | null
}> {
  if (!isFileSystemAccessSupported()) {
    return { handle: null, name: null }
  }

  try {
    // @ts-expect-error - showDirectoryPicker is not yet in TS DOM lib
    const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
      id: 'bizbook-backup',
      mode: 'readwrite',
      startIn: 'documents',
    })

    // Persist the handle in IndexedDB
    await storeDirectoryHandleInternal(tenantId, handle)

    return { handle, name: handle.name }
  } catch (err: unknown) {
    // User cancelled — not an error, just return null
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { handle: null, name: null }
    }
    console.error('[BACKUP-FS] Failed to pick directory:', err)
    throw err
  }
}

/**
 * Verify we still have permission to write to a previously-stored directory.
 * Browsers require re-verification after the tab is closed/reopened.
 */
export async function verifyDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // Use `any` for permission descriptor since the FileSystemHandle* types
    // are still experimental in TS DOM lib.
    const opts: any = { mode: 'readwrite' }
    if ((await (handle as any).queryPermission(opts)) === 'granted') return true
    if ((await (handle as any).requestPermission(opts)) === 'granted') return true
    return false
  } catch {
    return false
  }
}

// ============================================================
// Write a backup file to the chosen directory
// ============================================================

/**
 * Write the backup Excel file to the user's chosen directory.
 * If no directory is chosen (or permission was revoked), falls back to
 * standard download (saves to Downloads folder).
 *
 * @returns true if the file was written successfully, false if it fell
 *          back to standard download (or failed entirely)
 */
export async function writeBackupToDirectory(
  tenantId: string,
  filename: string,
  blob: Blob
): Promise<{ written: boolean; location: string }> {
  const handle = await getStoredDirectoryHandle(tenantId)
  if (!handle) {
    // No directory chosen — fallback to standard download
    return { written: false, location: 'Downloads folder (no directory chosen)' }
  }

  // Re-verify permission (browser requires this after tab restart)
  const hasPermission = await verifyDirectoryPermission(handle)
  if (!hasPermission) {
    console.warn('[BACKUP-FS] Directory permission was revoked — falling back to Downloads')
    return { written: false, location: 'Downloads folder (permission revoked)' }
  }

  try {
    // Get or create the file inside the directory
    const fileHandle = await handle.getFileHandle(filename, { create: true })
    const writable = await (fileHandle as any).createWritable()
    await writable.write(blob)
    await writable.close()
    return { written: true, location: `${handle.name}/${filename}` }
  } catch (err) {
    console.error('[BACKUP-FS] Failed to write backup file:', err)
    return { written: false, location: 'Downloads folder (write failed)' }
  }
}
