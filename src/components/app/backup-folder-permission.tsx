'use client'

/**
 * BackupFolderPermission component
 *
 * Shown during:
 *   - Registration (after business details, before "Verify Email & Continue")
 *   - Add New Company dialog
 *
 * Asks the user to grant BizBook Pro permission to save backup Excel files
 * to a folder on their physical drive. Uses the File System Access API when
 * supported (Chrome/Edge), and falls back to standard Downloads folder
 * downloads on browsers that don't support it (Firefox/Safari/mobile).
 *
 * Behavior:
 *   - User clicks "Choose Backup Folder"
 *   - Native folder picker appears
 *   - User selects a folder (e.g., D:\Backups\BizBook)
 *   - Handle is persisted in IndexedDB for future use
 *   - Component shows the chosen folder name
 *   - User can change the folder or skip (will use Downloads)
 */

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { HardDrive, FolderCheck, FolderOpen, Info, AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  isFileSystemAccessSupported,
  pickBackupDirectory,
  getStoredDirectoryHandle,
} from '@/lib/backup-drive-picker'

interface BackupFolderPermissionProps {
  /** Tenant ID — used to store the directory handle per company */
  tenantId?: string
  /** Company name — for display in the filename preview */
  companyName?: string
  /** Callback when user grants permission */
  onPermissionGranted?: (folderName: string) => void
  /** Callback when user skips */
  onSkip?: () => void
  /** Compact mode (smaller padding) */
  compact?: boolean
}

export function BackupFolderPermission({
  tenantId,
  companyName = 'YourCompany',
  onPermissionGranted,
  onSkip,
  compact = false,
}: BackupFolderPermissionProps) {
  const [supported] = useState(() => isFileSystemAccessSupported())
  const [folderName, setFolderName] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')

  // Check if a directory was already chosen for this tenant
  useEffect(() => {
    if (!tenantId) return
    getStoredDirectoryHandle(tenantId).then(handle => {
      if (handle) setFolderName(handle.name)
    }).catch(() => {})
  }, [tenantId])

  const handlePick = async () => {
    if (!tenantId) {
      setError('Please enter company details first.')
      return
    }
    setPicking(true)
    setError('')
    try {
      const result = await pickBackupDirectory(tenantId)
      if (result.handle) {
        setFolderName(result.name)
        onPermissionGranted?.(result.name || '')
      }
      // If user cancelled (handle is null), do nothing — they can try again
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to pick folder'
      setError(msg)
    } finally {
      setPicking(false)
    }
  }

  // Generate the safe filename preview
  const safeCompanyName = (companyName || 'YourCompany').replace(/[^a-zA-Z0-9]/g, '_')
  const backupFilename = `${safeCompanyName}_BizBook_Backup.xlsx`

  if (!supported) {
    // Browser doesn't support File System Access API — inform user we'll
    // use the Downloads folder instead (still works, just less clean)
    return (
      <div className={`rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 ${compact ? 'p-3' : 'p-4'} space-y-2`}>
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              Automatic Backup to Downloads
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              Your browser doesn't support folder picker. Backups will be saved to your browser's Downloads folder as <span className="font-mono font-semibold">{backupFilename}</span>. Each save overwrites the previous file.
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1.5">
              💡 For full drive access (pick any folder, no Downloads clutter), use Chrome or Edge on desktop.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border ${folderName ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'} ${compact ? 'p-3' : 'p-4'} space-y-3`}>
      <div className="flex items-start gap-2">
        {folderName ? (
          <FolderCheck className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
        ) : (
          <HardDrive className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${folderName ? 'text-emerald-800 dark:text-emerald-200' : 'text-amber-800 dark:text-amber-200'}`}>
            {folderName ? 'Backup Folder Connected' : 'Choose a Backup Folder'}
          </p>
          <p className={`text-xs mt-1 ${folderName ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
            BizBook Pro will automatically save a backup Excel file named <span className="font-mono font-semibold">{backupFilename}</span> after every save operation. The file is overwritten each time so you always have the latest backup.
          </p>
        </div>
      </div>

      {folderName ? (
        <div className="flex items-center gap-2 p-2 bg-white dark:bg-gray-900 rounded border border-emerald-200 dark:border-emerald-800">
          <FolderOpen className="h-4 w-4 text-emerald-600 flex-shrink-0" />
          <span className="text-sm font-medium text-emerald-800 dark:text-emerald-200 truncate flex-1">
            {folderName}
          </span>
          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePick}
            disabled={picking || !tenantId}
            className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950"
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            {picking ? 'Choose Folder...' : 'Choose Backup Folder'}
          </Button>
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline text-left"
          >
            Skip for now — use Downloads folder instead
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {folderName && (
        <button
          type="button"
          onClick={handlePick}
          className="text-xs text-emerald-700 dark:text-emerald-300 hover:underline text-left"
        >
          Change folder
        </button>
      )}
    </div>
  )
}
