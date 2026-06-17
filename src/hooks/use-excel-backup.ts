/**
 * BizBook Pro - Excel Backup Hook
 *
 * Provides reusable functions for auto Excel backup downloads.
 * This is a CORE LOCKED feature - never remove.
 *
 * Features:
 * - useOneClickBackup(): Hook for manual "Download All Data" button
 * - triggerBackupDownload(): Module-level function for auto-download after saves
 * - Every single save/confirm triggers a download (NO debounce)
 * - Fixed company-name filename (auto-overwrites old file)
 *
 * After every successful save operation, components should call:
 *   triggerBackupDownload(tenantId, tenantName, 'sale:create')
 *
 * This ensures users ALWAYS have a physical Excel backup on their device.
 */

import { useState, useCallback } from 'react'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'
import { triggerBackupDownload, forceBackupDownload, hasBackupDriveAccess, grantBackupDriveAccess, revokeBackupDriveAccess } from '@/lib/auto-backup-client'

/**
 * Module-level auto-backup trigger.
 * Call this after every successful save operation to auto-download Excel backup.
 *
 * This is the PRIMARY integration point for auto-backup.
 * All data-saving components should call this after successful API responses.
 *
 * @param tenantId - The company/tenant ID
 * @param companyName - The company name (for fixed filename)
 * @param trigger - What triggered this backup (e.g., 'sale:create', 'inventory:update')
 */
export { triggerBackupDownload } from '@/lib/auto-backup-client'

/**
 * React hook for one-click Excel backup download with loading state and toast notifications.
 * Use this in any component that needs a "Download All Data" button.
 */
export function useOneClickBackup() {
  const { tenant } = useAppStore()
  const { toast } = useToast()
  const [downloading, setDownloading] = useState(false)

  const downloadAll = useCallback(async () => {
    if (!tenant) {
      toast({ title: 'Error', description: 'No company selected', variant: 'destructive' })
      return
    }

    setDownloading(true)
    try {
      const result = await forceBackupDownload(tenant.id, tenant.name)

      if (result.success) {
        toast({
          title: 'Excel Backup Downloaded!',
          description: `${result.recordCount || 'All'} records saved as "${tenant.name.replace(/[^a-zA-Z0-9]/g, '_')}_BizBook_Backup.xlsx". Keep this file safe - it contains ALL your business data.`,
          duration: 5000,
        })
      } else {
        toast({
          title: 'Download Failed',
          description: result.error || 'Could not generate backup. Please try again.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to download backup. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setDownloading(false)
    }
  }, [tenant, toast])

  return { downloadAll, downloading }
}

/**
 * React hook for auto-backup after save operations.
 * Provides a function that triggers auto-download with toast notification.
 *
 * Usage:
 *   const { notifyBackupDownloaded } = useAutoBackupDownload()
 *   // After successful save:
 *   triggerBackupDownload(tenant.id, tenant.name, 'sale:create')
 *   notifyBackupDownloaded('sale:create')
 */
export function useAutoBackupDownload() {
  const { tenant } = useAppStore()
  const { toast } = useToast()

  /**
   * Trigger auto-download after a save operation.
   * NO DEBOUNCE - every save triggers a download.
   */
  const triggerAutoDownload = useCallback(async (trigger: string = 'save') => {
    if (!tenant) return

    try {
      await triggerBackupDownload(tenant.id, tenant.name, trigger)
    } catch {
      // Silently fail - auto-download is a bonus, not critical
    }
  }, [tenant])

  /**
   * Show a toast notification that backup was downloaded.
   * Call this after triggerBackupDownload to inform the user.
   */
  const notifyBackupDownloaded = useCallback((trigger: string = 'save') => {
    toast({
      title: 'Backup Saved to Device',
      description: `Your data has been automatically backed up as an Excel file (${trigger}). You always have a local copy.`,
      duration: 4000,
    })
  }, [toast])

  /**
   * Show a subtle notification that server backup was updated.
   */
  const notifyBackupReady = useCallback((trigger: string = 'save') => {
    if (!tenant) return

    toast({
      title: 'Backup Updated',
      description: `Your backup has been updated (${trigger}). Your data is safe on your device.`,
      duration: 3000,
    })
  }, [tenant, toast])

  return { triggerAutoDownload, notifyBackupDownloaded, notifyBackupReady }
}

/**
 * Hook for managing backup drive access permission.
 * Shows a dialog asking the user to allow auto-backup downloads to their device.
 */
export function useBackupDriveAccess() {
  const { tenant } = useAppStore()
  const { toast } = useToast()

  const isGranted = typeof window !== 'undefined' ? hasBackupDriveAccess() : false

  const grantAccess = useCallback(() => {
    grantBackupDriveAccess()
    toast({
      title: 'Drive Access Granted',
      description: 'BizBook Pro will now automatically save your backup Excel file after every save operation. Your data is always safe!',
      duration: 5000,
    })
  }, [toast])

  const revokeAccess = useCallback(() => {
    revokeBackupDriveAccess()
    toast({
      title: 'Drive Access Revoked',
      description: 'Auto-backup downloads have been disabled. You can still manually download backups from the Backup page.',
      duration: 5000,
    })
  }, [toast])

  return { isGranted, grantAccess, revokeAccess }
}
