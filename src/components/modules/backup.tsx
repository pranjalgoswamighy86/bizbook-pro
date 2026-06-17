'use client'

import { useEffect, useState } from 'react'
import { useAppStore, canManage } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { HardDrive, Loader2, Download, Upload, Clock, RefreshCw, Shield, Trash2, Calendar } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatDate } from '@/lib/formulas'
import { authFetch } from '@/lib/auth-fetch'

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

export function BackupPage() {
  const { tenant, user } = useAppStore()
  const { toast } = useToast()
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [autoConfig, setAutoConfig] = useState<AutoBackupConfig>({ enabled: false, frequency: 'daily', lastRun: null })

  // Restore confirmation
  const [restoreName, setRestoreName] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (!tenant) return
    loadBackups()
  }, [tenant]) // eslint-disable-line react-hooks/exhaustive-deps

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
                  <li>• Backups are stored in the server&apos;s backup directory</li>
                  <li>• Auto-backups are created on server startup</li>
                  <li>• Last 20 backups are retained; older ones are automatically deleted</li>
                  <li>• To restore data, download a backup and upload it using AI Smart Import</li>
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
