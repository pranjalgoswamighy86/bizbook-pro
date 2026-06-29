/**
 * v4.155: useOfflineMode React Hook
 * ============================================================
 * Tracks online/offline status and exposes helpers to:
 *   - Check if the app is currently online
 *   - Get cached data when offline
 *   - Queue writes when offline
 *   - Sync pending writes when connection is restored
 */

import { useState, useEffect, useCallback } from 'react'
import {
  getPendingWrites,
  deletePendingWrite,
  updatePendingWriteRetry,
  getCacheStats,
  clearAllCachedData,
} from '@/lib/offline-db'
import { authFetch } from '@/lib/auth-fetch'

interface OfflineState {
  isOnline: boolean
  pendingCount: number
  lastSyncAt: number | null
  syncing: boolean
  cacheStats: {
    sales: number
    purchases: number
    expenses: number
    inventory: number
    parties: number
    pendingWrites: number
    lastCachedAt: number | null
  } | null
}

export function useOfflineMode(tenantId?: string) {
  const [state, setState] = useState<OfflineState>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingCount: 0,
    lastSyncAt: null,
    syncing: false,
    cacheStats: null,
  })

  // ============================================================
  // Online/offline event listeners
  // ============================================================
  useEffect(() => {
    const handleOnline = () => {
      console.log('[OfflineMode] Back online — syncing pending writes')
      setState(s => ({ ...s, isOnline: true }))
      if (tenantId) syncPendingWrites(tenantId)
    }
    const handleOffline = () => {
      console.log('[OfflineMode] Gone offline — using cached data')
      setState(s => ({ ...s, isOnline: false }))
    }

    // v4.155: Listen for SW Background Sync messages
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SYNC_PENDING_WRITES') {
        console.log('[OfflineMode] SW requested sync')
        if (tenantId) syncPendingWrites(tenantId)
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    navigator.serviceWorker?.addEventListener('message', handleSWMessage)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage)
    }
  }, [tenantId])

  // ============================================================
  // Refresh pending count + cache stats
  // ============================================================
  const refreshStats = useCallback(async () => {
    if (!tenantId) return
    try {
      const stats = await getCacheStats(tenantId)
      setState(s => ({ ...s, cacheStats: stats, pendingCount: stats.pendingWrites }))
    } catch (err) {
      console.warn('[OfflineMode] refreshStats failed:', err)
    }
  }, [tenantId])

  useEffect(() => {
    refreshStats()
  }, [refreshStats, state.isOnline])

  // ============================================================
  // Sync pending writes to server
  // ============================================================
  const syncPendingWrites = useCallback(async (tid: string) => {
    setState(s => ({ ...s, syncing: true }))
    try {
      const pending = await getPendingWrites(tid)
      console.log(`[OfflineMode] Syncing ${pending.length} pending writes...`)

      for (const write of pending) {
        try {
          const res = await authFetch(write.endpoint, {
            method: write.method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(write.body),
          })
          if (res.ok) {
            await deletePendingWrite(write.id!)
            console.log(`[OfflineMode] ✓ Synced: ${write.entityType} ${write.action}`)
          } else {
            const errText = await res.text().catch(() => 'Unknown error')
            await updatePendingWriteRetry(write.id!, write.retryCount + 1, errText.slice(0, 200))
            console.warn(`[OfflineMode] ✗ Sync failed (${write.id}): ${res.status} ${errText.slice(0, 100)}`)
            // Stop on first failure — try again later
            break
          }
        } catch (err: any) {
          await updatePendingWriteRetry(write.id!, write.retryCount + 1, err?.message)
          break
        }
      }

      const stats = await getCacheStats(tid)
      setState(s => ({
        ...s,
        syncing: false,
        lastSyncAt: Date.now(),
        pendingCount: stats.pendingWrites,
        cacheStats: stats,
      }))
    } catch (err) {
      console.error('[OfflineMode] syncPendingWrites failed:', err)
      setState(s => ({ ...s, syncing: false }))
    }
  }, [])

  // ============================================================
  // Clear cache
  // ============================================================
  const clearCache = useCallback(async () => {
    if (!tenantId) return
    await clearAllCachedData(tenantId)
    await refreshStats()
  }, [tenantId, refreshStats])

  return {
    ...state,
    refreshStats,
    syncPendingWrites: () => tenantId && syncPendingWrites(tenantId),
    clearCache,
  }
}
