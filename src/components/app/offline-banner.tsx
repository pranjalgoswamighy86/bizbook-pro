'use client'

/**
 * v4.155: Offline Banner + Sync Status
 * Shows a banner when the app is offline or has pending writes to sync.
 * Mounted in the main layout.
 */

import { useEffect, useState } from 'react'
import { useOfflineMode } from '@/hooks/use-offline-mode'
import { useAppStore } from '@/store/app-store'
import { Wifi, WifiOff, RefreshCw, Check, AlertTriangle, CloudOff, Database } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function OfflineBanner() {
  const { tenant } = useAppStore()
  const { isOnline, pendingCount, syncing, lastSyncAt, syncPendingWrites, cacheStats } = useOfflineMode(tenant?.id)
  const [dismissed, setDismissed] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  // Auto-recover from dismissed state when status changes
  useEffect(() => {
    if (!isOnline) setDismissed(false)
  }, [isOnline])

  // Don't show anything if online and no pending writes and not dismissed
  if (isOnline && pendingCount === 0 && !showDetails) {
    return null
  }

  // Dismissed offline banner (only dismissible if online)
  if (dismissed && isOnline && pendingCount === 0) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg shadow-lg p-3 mb-2">
          <div className="flex items-start gap-2">
            <WifiOff className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                You're offline
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                Showing cached data. New transactions will be queued and synced when you reconnect.
              </p>
              {cacheStats && cacheStats.lastCachedAt && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                  Last sync: {new Date(cacheStats.lastCachedAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pending writes banner */}
      {pendingCount > 0 && isOnline && (
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg shadow-lg p-3 mb-2">
          <div className="flex items-start gap-2">
            <RefreshCw className={`h-4 w-4 text-blue-600 mt-0.5 shrink-0 ${syncing ? 'animate-spin' : ''}`} />
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                {syncing ? 'Syncing...' : `${pendingCount} pending write${pendingCount > 1 ? 's' : ''} to sync`}
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                {syncing
                  ? 'Uploading your offline transactions to the server...'
                  : 'Click sync to upload your offline transactions to the server.'}
              </p>
              {!syncing && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
                  onClick={syncPendingWrites}
                >
                  <RefreshCw className="h-3 w-3 mr-1" /> Sync now
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Syncing in progress (when offline → online transition) */}
      {syncing && pendingCount === 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-lg shadow-lg p-3 mb-2">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
              All synced
            </p>
          </div>
          <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
            Your offline transactions have been uploaded.
          </p>
        </div>
      )}

      {/* Floating cache info button */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full shadow-md p-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        title="Offline cache info"
      >
        <Database className="h-4 w-4 text-slate-600 dark:text-slate-300" />
      </button>

      {/* Cache details popover */}
      {showDetails && cacheStats && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-3 mb-2 w-64">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold flex items-center gap-1">
              <Database className="h-3 w-3" /> Offline Cache
            </p>
            <button onClick={() => setShowDetails(false)} className="text-xs text-muted-foreground hover:text-foreground">×</button>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Status:</span>
              <span className={isOnline ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                {isOnline ? '● Online' : '● Offline'}
              </span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Sales cached:</span><span>{cacheStats.sales}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Purchases cached:</span><span>{cacheStats.purchases}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Expenses cached:</span><span>{cacheStats.expenses}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Inventory cached:</span><span>{cacheStats.inventory}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Parties cached:</span><span>{cacheStats.parties}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Pending writes:</span><span className={cacheStats.pendingWrites > 0 ? 'text-blue-600 font-semibold' : ''}>{cacheStats.pendingWrites}</span></div>
            {cacheStats.lastCachedAt && (
              <div className="flex justify-between"><span className="text-muted-foreground">Last cached:</span>
                <span className="text-[10px]">{new Date(cacheStats.lastCachedAt).toLocaleString()}</span>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground pt-2 border-t mt-2">
              💾 Your data is stored locally on your device. Even if our server goes down, you can view your business data offline.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
