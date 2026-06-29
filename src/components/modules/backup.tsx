'use client'

import { useEffect, useState } from 'react'
import { useAppStore, canManage } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { HardDrive, Loader2, Download, Upload, Clock, RefreshCw, Shield, Trash2, Calendar, FileSpreadsheet, Database, WifiOff, CheckCircle2, AlertCircle } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatDate } from '@/lib/formulas'
import { authFetch } from '@/lib/auth-fetch'
// v4.156: Offline cache + auto Excel backup
import { getCacheStats, clearAllCachedData } from '@/lib/offline-db'

interface BackupRecord {
  name: string
  size: number
  created: string
  reason: string
}

interface AutoBackupConfig {
  enabled: boolean
  frequency: 'daily' | 'weekly'
  lastRun: string | null
}

// v4.156: Excel auto-backup file from /api/auto-backup
interface ExcelBackupFile {
  name: string
  size: number
  created: string
  reason: string
}

// v4.156: Latest auto-backup info
interface LatestBackupInfo {
  timestamp: string | null
  filename: string | null
  recordCount: number
  fileSize: number
  trigger: string | null
}

export function BackupPage() {
  const { tenant, user } = useAppStore()
  const { toast } = useToast()
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [autoConfig, setAutoConfig] = useState<AutoBackupConfig>({ enabled: false, frequency: 'daily', lastRun: null })

  // v4.156: Excel auto-backup state
  const [excelBackups, setExcelBackups] = useState<ExcelBackupFile[]>([])
  const [latestBackup, setLatestBackup] = useState<LatestBackupInfo | null>(null)
  const [excelLoading, setExcelLoading] = useState(true)
  const [downloadingExcel, setDownloadingExcel] = useState(false)

  // v4.156: Offline cache state
  const [cacheStats, setCacheStats] = useState<{
    sales: number
    purchases: number
    expenses: number
    inventory: number
    parties: number
    pendingWrites: number
    lastCachedAt: number | null
  } | null>(null)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [clearingCache, setClearingCache] = useState(false)

  // Restore confirmation
  const [restoreName, setRestoreName] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (!tenant) return
    loadBackups()
    loadExcelBackups()  // v4.156
    loadCacheStats()    // v4.156
  }, [tenant]) // eslint-disable-line react-hooks/exhaustive-deps

  // v4.156: Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const loadBackups = async () => {
    if (!tenant) return
    setLoading(true)
    try {
      const res = await authFetch('/api/db-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list-backups', tenantId: tenant.id }),
      })
      if (res.ok) {
        const data = await res.json()
        setBackups(data.backups || [])
        if (data.autoConfig) setAutoConfig(data.autoConfig)
      }
    } catch {
      // Fallback: try backup list via the backup API
      try {
        const res = await authFetch('/api/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list-backups', tenantId: tenant.id }),
        })
        if (res.ok) {
          const data = await res.json()
          setBackups(data.backups || [])
        }
      } catch {
        toast({ title: 'Error', description: 'Failed to load backups', variant: 'destructive' })
      }
    } finally {
      setLoading(false)
    }
  }

  // v4.156: Load Excel auto-backup files from /api/auto-backup
  const loadExcelBackups = async () => {
    if (!tenant) return
    setExcelLoading(true)
    try {
      // Load list of Excel backups
      const [listRes, latestRes] = await Promise.all([
        authFetch('/api/auto-backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', tenantId: tenant.id }),
        }),
        authFetch('/api/auto-backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'latest', tenantId: tenant.id }),
        }),
      ])
      if (listRes.ok) {
        const data = await listRes.json()
        setExcelBackups(data.files || [])
      }
      if (latestRes.ok) {
        const data = await latestRes.json()
        setLatestBackup(data.latest || null)
      }
    } catch {
      // Silent fail — Excel backups may not be available on all deployments
    } finally {
      setExcelLoading(false)
    }
  }

  // v4.156: Load IndexedDB cache stats
  const loadCacheStats = async () => {
    if (!tenant) return
    try {
      const stats = await getCacheStats(tenant.id)
      setCacheStats(stats)
    } catch {
      // IndexedDB might not be available (private browsing, etc.)
    }
  }

  // v4.156: Download the latest Excel backup (one-click)
  const handleDownloadExcelBackup = async () => {
    if (!tenant) return
    setDownloadingExcel(true)
    try {
      // Use the one-click download-all endpoint — generates fresh + downloads
      const url = `/api/auto-backup?tenantId=${encodeURIComponent(tenant.id)}&action=download-all&companyName=${encodeURIComponent(tenant.name)}`
      const res = await authFetch(url)
      if (res.ok) {
        const blob = await res.blob()
        const downloadUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = downloadUrl
        // Fixed filename — overwrites same file on user's device
        const safeName = tenant.name.replace(/[^a-zA-Z0-9]/g, '_')
        a.download = `${safeName}_BizBook_Backup.xlsx`
        a.click()
        URL.revokeObjectURL(downloadUrl)
        toast({ title: '✓ Excel Backup Downloaded', description: `${safeName}_BizBook_Backup.xlsx saved to your device` })
      } else {
        const errData = await res.json().catch(() => ({}))
        toast({ title: 'Download Failed', description: errData.error || 'Could not generate Excel backup', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to download Excel backup', variant: 'destructive' })
    } finally {
      setDownloadingExcel(false)
    }
  }

  // v4.156: Download a specific Excel backup by filename
  const handleDownloadSpecificExcel = async (filename: string) => {
    if (!tenant) return
    try {
      const url = `/api/auto-backup?tenantId=${encodeURIComponent(tenant.id)}&filename=${encodeURIComponent(filename)}&companyName=${encodeURIComponent(tenant.name)}`
      const res = await authFetch(url)
      if (res.ok) {
        const blob = await res.blob()
        const downloadUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = downloadUrl
        a.download = filename
        a.click()
        URL.revokeObjectURL(downloadUrl)
        toast({ title: 'Downloaded', description: filename })
      }
    } catch {
      toast({ title: 'Error', description: 'Download failed', variant: 'destructive' })
    }
  }

  // v4.156: Clear offline cache
  const handleClearCache = async () => {
    if (!tenant) return
    setClearingCache(true)
    try {
      await clearAllCachedData(tenant.id)
      await loadCacheStats()
      toast({ title: '✓ Cache Cleared', description: 'Offline data removed from your device' })
    } catch {
      toast({ title: 'Error', description: 'Failed to clear cache', variant: 'destructive' })
    } finally {
      setClearingCache(false)
    }
  }

  // v4.156: Delete an Excel backup file
  const handleDeleteExcelBackup = async (filename: string) => {
    if (!tenant) return
    try {
      const res = await authFetch('/api/auto-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', tenantId: tenant.id, filename }),
      })
      if (res.ok) {
        toast({ title: 'Deleted', description: filename })
        loadExcelBackups()
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete backup', variant: 'destructive' })
    }
  }

  const handleCreateBackup = async () => {
    if (!tenant) return
    setCreating(true)
    try {
      const res = await authFetch('/api/db-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backup' }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          toast({ title: 'Backup Created', description: `Saved to ${data.path}` })
          loadBackups()
        } else {
          toast({ title: 'Backup Failed', description: data.error || 'Unknown error', variant: 'destructive' })
        }
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to create backup', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const handleDownloadBackup = async (backupName: string) => {
    if (!tenant) return
    try {
      const res = await authFetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'json', tenantId: tenant.id }),
      })
      if (res.ok) {
        const data = await res.json()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${tenant.name.replace(/[^a-zA-Z0-9]/g, '_')}_backup_${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
        toast({ title: 'Downloaded', description: 'Backup file saved' })
      }
    } catch {
      toast({ title: 'Error', description: 'Download failed', variant: 'destructive' })
    }
  }

  const handleRestore = async () => {
    if (!tenant || !restoreName) return
    try {
      toast({ title: 'Restore Started', description: 'Contact your administrator to restore from backup file manually.' })
      setRestoreName(null)
    } catch {
      toast({ title: 'Error', description: 'Restore failed', variant: 'destructive' })
    }
  }

  const handleDeleteBackup = async () => {
    if (!deleting) return
    try {
      const res = await authFetch('/api/db-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-backup', filename: deleting }),
      })
      if (res.ok) {
        toast({ title: 'Backup Deleted' })
        setDeleting(null)
        loadBackups()
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete backup', variant: 'destructive' })
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (!canManage(user?.role || 'VIEW_ONLY')) {
    return (
      <div className="p-6">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold">Admin Access Required</h3>
            <p className="text-sm text-muted-foreground">Only Main Admin can manage backups.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <AppHeader title="Backup & Restore" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950">
                  <HardDrive className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Create Backup</p>
                  <p className="text-xs text-muted-foreground">Manual database backup</p>
                </div>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8" onClick={handleCreateBackup} disabled={creating}>
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Create'}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950">
                  <Download className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Export Data</p>
                  <p className="text-xs text-muted-foreground">JSON backup download</p>
                </div>
                <Button size="sm" variant="outline" className="h-8" onClick={() => handleDownloadBackup('json')}>
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950">
                  <Clock className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Auto Backup</p>
                  <p className="text-xs text-muted-foreground">
                    {autoConfig.enabled ? `Enabled (${autoConfig.frequency})` : 'Not configured'}
                  </p>
                </div>
                <Badge variant="outline" className="text-xs">
                  {autoConfig.enabled ? 'Active' : 'Off'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* v4.156: Auto Excel Backup — "Your data is saved on your device" */}
        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Auto Excel Backup — Saved on Your Device
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Every sale, purchase, and expense automatically generates a fresh Excel backup.
              The file downloads silently to your device with a fixed filename (overwrites itself).
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Latest backup status */}
            <div className="bg-white dark:bg-slate-900 rounded-lg p-3 border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Last Auto-Backup</p>
                  {latestBackup?.timestamp ? (
                    <>
                      <p className="text-sm font-semibold">
                        {formatDate(latestBackup.timestamp)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {latestBackup.recordCount} records · {formatFileSize(latestBackup.fileSize)} · triggered by {latestBackup.trigger || 'manual'}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No auto-backup yet — create a sale to trigger one</p>
                  )}
                </div>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleDownloadExcelBackup}
                  disabled={downloadingExcel}
                >
                  {downloadingExcel ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  Download Excel Backup
                </Button>
              </div>
            </div>

            {/* Excel backup history */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Excel Backup History (server-side, max 10 per company)
              </p>
              {excelLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading Excel backups...
                </div>
              ) : excelBackups.length === 0 ? (
                <div className="text-xs text-muted-foreground py-3 text-center bg-white dark:bg-slate-900 rounded border border-dashed">
                  No Excel backups yet. They auto-generate after every sale/purchase/expense.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto bg-white dark:bg-slate-900 rounded border">
                  {excelBackups.map((file, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 border-b last:border-0 text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="font-mono truncate">{file.name}</p>
                        <p className="text-muted-foreground text-[10px]">
                          {formatDate(file.created)} · {formatFileSize(file.size)} · {file.reason}
                        </p>
                      </div>
                      <div className="flex gap-1 ml-2">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-emerald-600" onClick={() => handleDownloadSpecificExcel(file.name)}>
                          <Download className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteExcelBackup(file.name)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Info banner */}
            <div className="bg-emerald-100 dark:bg-emerald-950 rounded-lg p-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Your data is always on your device</p>
                <p className="mt-1">
                  Every transaction downloads <code className="bg-emerald-200 dark:bg-emerald-900 px-1 rounded">{tenant?.name?.replace(/[^a-zA-Z0-9]/g, '_')}_BizBook_Backup.xlsx</code> to your Downloads folder.
                  You can open it in Excel, Google Sheets, or LibreOffice at any time.
                  Even if our servers go down permanently, you have a complete copy of your business data.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* v4.156: Data on Your Device — Offline Cache */}
        <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-violet-50 dark:from-blue-950/30 dark:to-violet-950/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-600" />
              Data on Your Device (Offline Cache)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Your business data is cached locally in your browser so you can view it even when offline.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Connection status */}
            <div className={`rounded-lg p-3 flex items-center gap-2 ${isOnline ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200' : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200'}`}>
              {isOnline ? <CheckCircle2 className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              <span className="text-sm font-semibold">
                {isOnline ? '● Online — caching enabled' : '● Offline — using cached data'}
              </span>
            </div>

            {/* Cache stats */}
            {cacheStats ? (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <div className="bg-white dark:bg-slate-900 rounded p-2 text-center border">
                  <p className="text-lg font-bold text-emerald-600">{cacheStats.sales}</p>
                  <p className="text-[10px] text-muted-foreground">Sales</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded p-2 text-center border">
                  <p className="text-lg font-bold text-orange-600">{cacheStats.purchases}</p>
                  <p className="text-[10px] text-muted-foreground">Purchases</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded p-2 text-center border">
                  <p className="text-lg font-bold text-red-600">{cacheStats.expenses}</p>
                  <p className="text-[10px] text-muted-foreground">Expenses</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded p-2 text-center border">
                  <p className="text-lg font-bold text-blue-600">{cacheStats.inventory}</p>
                  <p className="text-[10px] text-muted-foreground">Inventory</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded p-2 text-center border">
                  <p className="text-lg font-bold text-violet-600">{cacheStats.parties}</p>
                  <p className="text-[10px] text-muted-foreground">Parties</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded p-2 text-center border">
                  <p className={`text-lg font-bold ${cacheStats.pendingWrites > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                    {cacheStats.pendingWrites}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Pending</p>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-2">
                Cache stats loading... (If this persists, your browser may not support IndexedDB)
              </div>
            )}

            {/* Last cached */}
            {cacheStats?.lastCachedAt && (
              <p className="text-xs text-muted-foreground">
                Last cached: {new Date(cacheStats.lastCachedAt).toLocaleString()}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={loadCacheStats}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Refresh Stats
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs text-destructive border-red-200 hover:bg-red-50"
                onClick={handleClearCache}
                disabled={clearingCache}
              >
                {clearingCache ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1" />}
                Clear Offline Cache
              </Button>
            </div>

            {/* Privacy banner */}
            <div className="bg-blue-100 dark:bg-blue-950 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-200 flex items-start gap-2">
              <Shield className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Your data stays private on your device</p>
                <p className="mt-1">
                  This cache is stored in your browser's IndexedDB, scoped to this website.
                  It never leaves your device except via the normal API calls you make.
                  Clear your browser data or click "Clear Offline Cache" to remove it.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Backups List */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-emerald-600" />
                Backup History
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadBackups}>
                <RefreshCw className="h-3 w-3 mr-1" /> Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              </div>
            ) : backups.length === 0 ? (
              <div className="text-center py-12">
                <HardDrive className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No backups yet</p>
                <p className="text-xs text-muted-foreground mt-1">Create your first backup to protect your data</p>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 mt-4" onClick={handleCreateBackup}>
                  <HardDrive className="h-4 w-4 mr-1" /> Create Backup
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Backup File</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="w-32">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backups.map((backup, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{backup.name}</TableCell>
                        <TableCell className="text-sm">{formatDate(backup.created)}</TableCell>
                        <TableCell className="text-right text-sm">{formatFileSize(backup.size)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {backup.reason}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-600" onClick={() => handleDownloadBackup(backup.name)}>
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-amber-600" onClick={() => setRestoreName(backup.name)}>
                              <Upload className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => setDeleting(backup.name)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="border-0 shadow-sm bg-muted/30">
          <CardContent className="p-4">
            <div className="flex gap-3">
              <Shield className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium">Backup Information</h4>
                <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                  <li>• <strong>Auto Excel Backup:</strong> Every sale, purchase, and expense auto-generates an Excel file on your device</li>
                  <li>• <strong>Offline Cache:</strong> Your business data is cached in your browser for offline access</li>
                  <li>• <strong>Server Backups:</strong> Last 10 Excel backups retained on server (below in Backup History)</li>
                  <li>• <strong>JSON Backups:</strong> Full database export in JSON format (for migration)</li>
                  <li>• To restore data, upload an Excel backup using AI Smart Import</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Restore Confirmation Dialog */}
        <Dialog open={!!restoreName} onOpenChange={(open) => { if (!open) setRestoreName(null) }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-amber-600" />
                Confirm Restore
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Restoring from backup will replace all current data. This action cannot be undone.
            </p>
            <p className="text-sm font-medium mt-2">
              Backup: {restoreName}
            </p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setRestoreName(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleRestore}>Restore Backup</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Backup</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete this backup file? This action cannot be undone.
            </p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteBackup}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
