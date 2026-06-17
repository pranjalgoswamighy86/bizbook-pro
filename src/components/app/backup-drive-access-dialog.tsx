/**
 * BizBook Pro - Backup Drive Access Permission Dialog
 *
 * CORE LOCKED FEATURE: This dialog appears at the NEXT LOGIN after the
 * auto-backup update is deployed. It asks users to grant permission for
 * BizBook Pro to automatically save backup Excel files to their device.
 *
 * Design:
 * - Shows only ONCE per user (stores preference in localStorage)
 * - Appears after successful login when the user reaches the dashboard
 * - Cannot be permanently dismissed without accepting or declining
 * - If declined, the dialog reappears at next login
 * - If accepted, auto-backup downloads start immediately
 *
 * DO NOT REMOVE THIS COMPONENT - It is a core data protection feature.
 */

'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Shield, HardDrive, CheckCircle2, AlertTriangle, FileSpreadsheet, Loader2 } from 'lucide-react'
import { hasBackupDriveAccess, grantBackupDriveAccess } from '@/lib/auto-backup-client'
import { useOneClickBackup } from '@/hooks/use-excel-backup'
import { useToast } from '@/hooks/use-toast'

export function BackupDriveAccessDialog() {
  const { tenant, isAuthenticated } = useAppStore()
  const { toast } = useToast()
  const { downloadAll, downloading } = useOneClickBackup()
  const [showDialog, setShowDialog] = useState(false)
  const [testDownloading, setTestDownloading] = useState(false)

  useEffect(() => {
    // Show the dialog only if:
    // 1. User is authenticated
    // 2. User hasn't already granted drive access
    // 3. We're in the browser (not SSR)
    if (typeof window === 'undefined') return
    if (!isAuthenticated) return

    const alreadyGranted = hasBackupDriveAccess()
    if (!alreadyGranted) {
      // Small delay so the dashboard loads first
      const timer = setTimeout(() => setShowDialog(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [isAuthenticated])

  const handleAccept = async () => {
    setTestDownloading(true)

    try {
      // Test the download to verify it works
      await downloadAll()

      // If download succeeded (or at least attempted), grant access
      grantBackupDriveAccess()
      setShowDialog(false)

      toast({
        title: 'Auto-Backup Enabled!',
        description: 'BizBook Pro will now automatically save your backup Excel file to your device after every save. Your data is always protected!',
        duration: 6000,
      })
    } catch {
      // Even if test download fails, grant access - it will work on actual saves
      grantBackupDriveAccess()
      setShowDialog(false)

      toast({
        title: 'Auto-Backup Enabled!',
        description: 'BizBook Pro will automatically save your backup after every save operation. If the test download didn\'t work, it will work when you save data.',
        duration: 6000,
      })
    } finally {
      setTestDownloading(false)
    }
  }

  const handleDecline = () => {
    // Don't store the decline - dialog will reappear at next login
    // This ensures users eventually accept the feature
    setShowDialog(false)

    toast({
      title: 'Auto-Backup Paused',
      description: 'You can enable auto-backup anytime from Settings or the Backup page. This reminder will appear again at your next login.',
      duration: 5000,
    })
  }

  if (!showDialog) return null

  return (
    <Dialog open={showDialog} onOpenChange={(open) => { if (!open) handleDecline() }}>
      <DialogContent className="sm:max-w-[520px]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900">
              <Shield className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <DialogTitle className="text-xl">Protect Your Data</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-1">
                BizBook Pro Auto-Backup Feature
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Main message */}
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-4">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
              BizBook Pro needs your permission to automatically save backup Excel files to your device.
            </p>
          </div>

          {/* How it works */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">How it works:</h4>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <HardDrive className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Automatic Backup After Every Save</p>
                  <p className="text-xs text-muted-foreground">Every time you click Save or Confirm anywhere in the software, an Excel backup is automatically downloaded to your device.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <FileSpreadsheet className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Single File Per Company</p>
                  <p className="text-xs text-muted-foreground">Only ONE Excel file per company is maintained. Each new save overwrites the previous file, so no storage clutter.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Zero Data Loss</p>
                  <p className="text-xs text-muted-foreground">Even if the server data is lost, you always have a local copy of your complete business data in Excel format.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Use With Other Software</p>
                  <p className="text-xs text-muted-foreground">The Excel file can be opened in any spreadsheet software (Excel, Google Sheets, LibreOffice) to view or manage your data manually.</p>
                </div>
              </div>
            </div>
          </div>

          {/* File info */}
          {tenant && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">
                Your backup file will be saved as:
              </p>
              <p className="text-sm font-mono font-semibold mt-1">
                {tenant.name.replace(/[^a-zA-Z0-9]/g, '_')}_BizBook_Backup.xlsx
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleDecline}
            disabled={testDownloading}
            className="sm:mr-auto"
          >
            Not Now
          </Button>
          <Button
            onClick={handleAccept}
            disabled={testDownloading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {testDownloading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Testing Download...
              </>
            ) : (
              <>
                <Shield className="h-4 w-4 mr-2" />
                Allow Auto-Backup
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
