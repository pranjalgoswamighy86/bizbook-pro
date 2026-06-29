/**
 * v4.155: Offline-aware API helper
 * ============================================================
 * Wraps authFetch to handle offline writes:
 *   - If online: normal authFetch, then update IndexedDB cache on success
 *   - If offline: queue the write in IndexedDB pendingWrites table
 *                 return a synthetic "queued" response
 *
 * Use this for create/update/delete operations on:
 *   - Sales, Purchases, Expenses
 *   - Inventory, Parties, Staff
 *
 * DO NOT use for:
 *   - Auth, OTP, payments (must be online)
 *   - Read operations (use authFetch directly, fallback to cache)
 */

import { authFetch, OfflineError } from '@/lib/auth-fetch'
import {
  cacheSales,
  cachePurchases,
  cacheExpenses,
  cacheInventory,
  cacheParties,
  queuePendingWrite,
  getPendingWrites,
  deletePendingWrite,
} from '@/lib/offline-db'

export interface OfflineAwareResult {
  ok: boolean
  status: number
  data: any
  queuedOffline?: boolean  // true if write was queued for later sync
}

/**
 * Make an offline-aware API call.
 * - If online: calls authFetch, caches the result if successful
 * - If offline: queues the write, returns synthetic response
 */
export async function offlineAwareFetch(
  endpoint: string,
  body: any,
  options: {
    tenantId: string
    action: string           // 'create' | 'update' | 'delete'
    entityType: string       // 'Sale' | 'Purchase' | 'Expense' | etc.
    cacheAfterSuccess?: (data: any) => Promise<void>  // optional cache update
  }
): Promise<OfflineAwareResult> {
  const { tenantId, action, entityType } = options

  // Check if online
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true

  if (!isOnline) {
    // Offline — queue the write
    console.log(`[OfflineQueue] Queuing ${action} ${entityType} for sync later`)
    await queuePendingWrite({
      tenantId,
      endpoint,
      method: 'POST',
      body,
      action,
      entityType,
    })
    return {
      ok: true,
      status: 202,  // Accepted
      data: {
        queued: true,
        message: `${entityType} ${action} queued offline. It will sync when you reconnect.`,
        entityType,
        action,
      },
      queuedOffline: true,
    }
  }

  // Online — make the request
  try {
    const res = await authFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await res.json().catch(() => ({}))

    if (res.ok) {
      // Update cache after successful write
      if (options.cacheAfterSuccess) {
        try {
          await options.cacheAfterSuccess(data)
        } catch (cacheErr) {
          console.warn(`[OfflineQueue] cacheAfterSuccess failed:`, cacheErr)
        }
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
    }
  } catch (err: any) {
    // Network error during online mode — server might be down
    if (err instanceof OfflineError || err?.name === 'OfflineError') {
      console.log(`[OfflineQueue] Network error — queuing ${action} ${entityType}`)
      await queuePendingWrite({
        tenantId,
        endpoint,
        method: 'POST',
        body,
        action,
        entityType,
      })
      return {
        ok: true,
        status: 202,
        data: {
          queued: true,
          message: `${entityType} ${action} queued — server unreachable. Will sync when connection restores.`,
          entityType,
          action,
        },
        queuedOffline: true,
      }
    }
    throw err
  }
}

// ============================================================
// Convenience helpers for common operations
// ============================================================

/**
 * Create a sale with offline support.
 * On success: refreshes the sales cache for this tenant.
 */
export async function createSaleOffline(
  tenantId: string,
  saleData: any
): Promise<OfflineAwareResult> {
  return offlineAwareFetch('/api/sales', {
    action: 'create',
    tenantId,
    data: saleData,
  }, {
    tenantId,
    action: 'create',
    entityType: 'Sale',
    cacheAfterSuccess: async () => {
      // Refresh sales cache by fetching latest list
      try {
        const listRes = await authFetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', tenantId, limit: 100 }),
        })
        if (listRes.ok) {
          const listData = await listRes.json()
          if (listData.sales) {
            await cacheSales(tenantId, listData.sales)
          }
        }
      } catch {}
    },
  })
}

/**
 * Create a purchase with offline support.
 */
export async function createPurchaseOffline(
  tenantId: string,
  purchaseData: any
): Promise<OfflineAwareResult> {
  return offlineAwareFetch('/api/purchases', {
    action: 'create',
    tenantId,
    data: purchaseData,
  }, {
    tenantId,
    action: 'create',
    entityType: 'Purchase',
    cacheAfterSuccess: async () => {
      try {
        const listRes = await authFetch('/api/purchases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', tenantId, limit: 100 }),
        })
        if (listRes.ok) {
          const listData = await listRes.json()
          if (listData.purchases) {
            await cachePurchases(tenantId, listData.purchases)
          }
        }
      } catch {}
    },
  })
}

/**
 * Create an expense with offline support.
 */
export async function createExpenseOffline(
  tenantId: string,
  expenseData: any
): Promise<OfflineAwareResult> {
  return offlineAwareFetch('/api/expenses', {
    action: 'create',
    tenantId,
    data: expenseData,
  }, {
    tenantId,
    action: 'create',
    entityType: 'Expense',
    cacheAfterSuccess: async () => {
      try {
        const listRes = await authFetch('/api/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', tenantId, limit: 100 }),
        })
        if (listRes.ok) {
          const listData = await listRes.json()
          if (listData.expenses) {
            await cacheExpenses(tenantId, listData.expenses)
          }
        }
      } catch {}
    },
  })
}

// ============================================================
// Sync pending writes — called when connection restores
// ============================================================

export async function syncAllPendingWrites(tenantId: string): Promise<{
  synced: number
  failed: number
  errors: string[]
}> {
  const pending = await getPendingWrites(tenantId)
  let synced = 0
  let failed = 0
  const errors: string[] = []

  for (const write of pending) {
    try {
      const res = await authFetch(write.endpoint, {
        method: write.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(write.body),
      })

      if (res.ok) {
        await deletePendingWrite(write.id!)
        synced++
        console.log(`[OfflineQueue] ✓ Synced ${write.entityType} ${write.action}`)
      } else {
        const errText = await res.text().catch(() => 'Unknown error')
        errors.push(`${write.entityType} ${write.action}: ${res.status} ${errText.slice(0, 100)}`)
        failed++
        // Don't delete — will retry on next sync
        // But if it's a 400 (validation error), the write is permanently invalid
        if (res.status === 400 || res.status === 422) {
          await deletePendingWrite(write.id!)
        }
      }
    } catch (err: any) {
      errors.push(`${write.entityType} ${write.action}: ${err?.message}`)
      failed++
      // Network still down — stop trying
      break
    }
  }

  return { synced, failed, errors }
}
