/**
 * v4.155: Offline Data Cache via IndexedDB (Dexie)
 * ============================================================
 * Stores a local copy of business data on the user's device so that:
 *   1. The user can VIEW their data even when the server is down
 *   2. The user has a copy of their data on their device (privacy claim)
 *   3. The app can queue writes when offline and sync when online
 *
 * WHAT IS CACHED:
 *   - Sales, Purchases, Expenses (last 90 days)
 *   - Inventory items (full list)
 *   - Parties (full list)
 *   - Staff (full list)
 *   - Dashboard summary (last fetched)
 *   - Subscription status
 *
 * WHAT IS NOT CACHED:
 *   - Auth tokens (handled by Zustand persist)
 *   - Audit logs (server-only)
 *   - Bank transactions (sensitive — server-only)
 *
 * SYNC STRATEGY:
 *   - READ: When online, fetch from API → update cache → return
 *           When offline, return cached data with a "stale" flag
 *   - WRITE: When online, POST to API → on success, update cache
 *            When offline, queue in `pendingWrites` table → sync on reconnect
 *
 * PRIVACY:
 *   - All data is stored in the browser's IndexedDB, scoped to the origin
 *   - User can clear via Settings → Clear Offline Cache
 *   - No data leaves the device except via the normal API calls
 */

import Dexie, { Table } from 'dexie'

// ============================================================
// Dexie Database Schema
// ============================================================

export interface CachedSale {
  id: string
  tenantId: string
  invoiceNumber: string
  date: string
  partyName: string
  partyGst: string | null
  subtotal: number
  gstAmount: number
  totalAmount: number
  paymentStatus: string
  items?: string
  cachedAt: number  // epoch ms
}

export interface CachedPurchase {
  id: string
  tenantId: string
  invoiceNumber: string
  date: string
  partyName: string
  subtotal: number
  gstAmount: number
  totalAmount: number
  paymentStatus: string
  cachedAt: number
}

export interface CachedExpense {
  id: string
  tenantId: string
  date: string
  description: string
  category: string
  amount: number
  cachedAt: number
}

export interface CachedInventoryItem {
  id: string
  tenantId: string
  name: string
  hsnCode: string | null
  currentStock: number
  purchasePrice: number
  salePrice: number
  unit: string | null
  cachedAt: number
}

export interface CachedParty {
  id: string
  tenantId: string
  name: string
  phone: string | null
  email: string | null
  gstNumber: string | null
  currentBalance: number
  type: string
  cachedAt: number
}

export interface CachedStaff {
  id: string
  tenantId: string
  name: string
  role: string | null
  department: string | null
  salary: number
  isActive: boolean
  cachedAt: number
}

export interface CachedDashboard {
  tenantId: string
  data: any  // dashboard summary JSON
  cachedAt: number
}

export interface PendingWrite {
  id?: number
  tenantId: string
  endpoint: string        // e.g., '/api/sales'
  method: string          // 'POST'
  body: any               // request body
  action: string          // 'create' | 'update' | 'delete'
  entityType: string      // 'Sale' | 'Purchase' | 'Expense'
  queuedAt: number
  retryCount: number
  lastError?: string
}

class BizBookOfflineDB extends Dexie {
  sales!: Table<CachedSale, string>
  purchases!: Table<CachedPurchase, string>
  expenses!: Table<CachedExpense, string>
  inventory!: Table<CachedInventoryItem, string>
  parties!: Table<CachedParty, string>
  staff!: Table<CachedStaff, string>
  dashboard!: Table<CachedDashboard, string>
  pendingWrites!: Table<PendingWrite, number>

  constructor() {
    super('bizbook-pro-offline')
    this.version(1).stores({
      sales:         'id, tenantId, date, cachedAt',
      purchases:     'id, tenantId, date, cachedAt',
      expenses:      'id, tenantId, date, cachedAt',
      inventory:     'id, tenantId, name, cachedAt',
      parties:       'id, tenantId, name, cachedAt',
      staff:         'id, tenantId, name, cachedAt',
      dashboard:     'tenantId, cachedAt',
      pendingWrites: '++id, tenantId, queuedAt, retryCount',
    })
  }
}

// Singleton instance
let dbInstance: BizBookOfflineDB | null = null

export function getOfflineDB(): BizBookOfflineDB {
  if (!dbInstance) {
    dbInstance = new BizBookOfflineDB()
  }
  return dbInstance
}

// ============================================================
// Cache Writers — called after successful API fetches
// ============================================================

export async function cacheSales(tenantId: string, sales: any[]): Promise<void> {
  try {
    const db = getOfflineDB()
    const cached: CachedSale[] = sales.map(s => ({
      id: s.id,
      tenantId,
      invoiceNumber: s.invoiceNumber,
      date: s.date,
      partyName: s.partyName,
      partyGst: s.partyGst || null,
      subtotal: s.subtotal || 0,
      gstAmount: s.gstAmount || 0,
      totalAmount: s.totalAmount || 0,
      paymentStatus: s.paymentStatus || 'PENDING',
      items: s.items,
      cachedAt: Date.now(),
    }))
    // Replace all cached sales for this tenant
    await db.sales.where('tenantId').equals(tenantId).delete()
    await db.sales.bulkPut(cached)
  } catch (err) {
    console.warn('[OfflineDB] cacheSales failed:', err)
  }
}

export async function cachePurchases(tenantId: string, purchases: any[]): Promise<void> {
  try {
    const db = getOfflineDB()
    const cached: CachedPurchase[] = purchases.map(p => ({
      id: p.id,
      tenantId,
      invoiceNumber: p.invoiceNumber,
      date: p.date,
      partyName: p.partyName,
      subtotal: p.subtotal || 0,
      gstAmount: p.gstAmount || 0,
      totalAmount: p.totalAmount || 0,
      paymentStatus: p.paymentStatus || 'UNPAID',
      cachedAt: Date.now(),
    }))
    await db.purchases.where('tenantId').equals(tenantId).delete()
    await db.purchases.bulkPut(cached)
  } catch (err) {
    console.warn('[OfflineDB] cachePurchases failed:', err)
  }
}

export async function cacheExpenses(tenantId: string, expenses: any[]): Promise<void> {
  try {
    const db = getOfflineDB()
    const cached: CachedExpense[] = expenses.map(e => ({
      id: e.id,
      tenantId,
      date: e.date,
      description: e.description || '',
      category: e.category || 'Other',
      amount: e.amount || 0,
      cachedAt: Date.now(),
    }))
    await db.expenses.where('tenantId').equals(tenantId).delete()
    await db.expenses.bulkPut(cached)
  } catch (err) {
    console.warn('[OfflineDB] cacheExpenses failed:', err)
  }
}

export async function cacheInventory(tenantId: string, items: any[]): Promise<void> {
  try {
    const db = getOfflineDB()
    const cached: CachedInventoryItem[] = items.map(i => ({
      id: i.id,
      tenantId,
      name: i.name,
      hsnCode: i.hsnCode || null,
      currentStock: i.currentStock || 0,
      purchasePrice: i.purchasePrice || 0,
      salePrice: i.salePrice || 0,
      unit: i.unit || null,
      cachedAt: Date.now(),
    }))
    await db.inventory.where('tenantId').equals(tenantId).delete()
    await db.inventory.bulkPut(cached)
  } catch (err) {
    console.warn('[OfflineDB] cacheInventory failed:', err)
  }
}

export async function cacheParties(tenantId: string, parties: any[]): Promise<void> {
  try {
    const db = getOfflineDB()
    const cached: CachedParty[] = parties.map(p => ({
      id: p.id,
      tenantId,
      name: p.name,
      phone: p.phone || null,
      email: p.email || null,
      gstNumber: p.gstNumber || null,
      currentBalance: p.currentBalance || 0,
      type: p.type || 'BOTH',
      cachedAt: Date.now(),
    }))
    await db.parties.where('tenantId').equals(tenantId).delete()
    await db.parties.bulkPut(cached)
  } catch (err) {
    console.warn('[OfflineDB] cacheParties failed:', err)
  }
}

export async function cacheDashboard(tenantId: string, data: any): Promise<void> {
  try {
    const db = getOfflineDB()
    await db.dashboard.put({ tenantId, data, cachedAt: Date.now() })
  } catch (err) {
    console.warn('[OfflineDB] cacheDashboard failed:', err)
  }
}

// ============================================================
// Cache Readers — called when API fetch fails (offline mode)
// ============================================================

export async function getCachedSales(tenantId: string, limit = 100): Promise<CachedSale[]> {
  try {
    const db = getOfflineDB()
    return await db.sales
      .where('tenantId').equals(tenantId)
      .reverse()
      .limit(limit)
      .toArray()
  } catch {
    return []
  }
}

export async function getCachedPurchases(tenantId: string, limit = 100): Promise<CachedPurchase[]> {
  try {
    const db = getOfflineDB()
    return await db.purchases
      .where('tenantId').equals(tenantId)
      .reverse()
      .limit(limit)
      .toArray()
  } catch {
    return []
  }
}

export async function getCachedExpenses(tenantId: string, limit = 100): Promise<CachedExpense[]> {
  try {
    const db = getOfflineDB()
    return await db.expenses
      .where('tenantId').equals(tenantId)
      .reverse()
      .limit(limit)
      .toArray()
  } catch {
    return []
  }
}

export async function getCachedInventory(tenantId: string): Promise<CachedInventoryItem[]> {
  try {
    const db = getOfflineDB()
    return await db.inventory.where('tenantId').equals(tenantId).toArray()
  } catch {
    return []
  }
}

export async function getCachedParties(tenantId: string): Promise<CachedParty[]> {
  try {
    const db = getOfflineDB()
    return await db.parties.where('tenantId').equals(tenantId).toArray()
  } catch {
    return []
  }
}

export async function getCachedDashboard(tenantId: string): Promise<CachedDashboard | null> {
  try {
    const db = getOfflineDB()
    return (await db.dashboard.get(tenantId)) || null
  } catch {
    return null
  }
}

// ============================================================
// Pending Writes Queue — for offline transaction creation
// ============================================================

export async function queuePendingWrite(write: Omit<PendingWrite, 'id' | 'queuedAt' | 'retryCount'>): Promise<number> {
  const db = getOfflineDB()
  return await db.pendingWrites.add({
    ...write,
    queuedAt: Date.now(),
    retryCount: 0,
  })
}

export async function getPendingWrites(tenantId: string): Promise<PendingWrite[]> {
  const db = getOfflineDB()
  const all = await db.pendingWrites.where('tenantId').equals(tenantId).toArray()
  return all.sort((a, b) => a.queuedAt - b.queuedAt)
}

export async function deletePendingWrite(id: number): Promise<void> {
  const db = getOfflineDB()
  await db.pendingWrites.delete(id)
}

export async function updatePendingWriteRetry(id: number, retryCount: number, lastError?: string): Promise<void> {
  const db = getOfflineDB()
  await db.pendingWrites.update(id, { retryCount, lastError })
}

// ============================================================
// Maintenance
// ============================================================

export async function clearAllCachedData(tenantId?: string): Promise<void> {
  const db = getOfflineDB()
  if (tenantId) {
    await Promise.all([
      db.sales.where('tenantId').equals(tenantId).delete(),
      db.purchases.where('tenantId').equals(tenantId).delete(),
      db.expenses.where('tenantId').equals(tenantId).delete(),
      db.inventory.where('tenantId').equals(tenantId).delete(),
      db.parties.where('tenantId').equals(tenantId).delete(),
      db.staff.where('tenantId').equals(tenantId).delete(),
      db.dashboard.where('tenantId').equals(tenantId).delete(),
      db.pendingWrites.where('tenantId').equals(tenantId).delete(),
    ])
  } else {
    await Promise.all([
      db.sales.clear(),
      db.purchases.clear(),
      db.expenses.clear(),
      db.inventory.clear(),
      db.parties.clear(),
      db.staff.clear(),
      db.dashboard.clear(),
      db.pendingWrites.clear(),
    ])
  }
}

export async function getCacheStats(tenantId: string): Promise<{
  sales: number
  purchases: number
  expenses: number
  inventory: number
  parties: number
  pendingWrites: number
  lastCachedAt: number | null
}> {
  const db = getOfflineDB()
  const [sales, purchases, expenses, inventory, parties, pendingWrites] = await Promise.all([
    db.sales.where('tenantId').equals(tenantId).count(),
    db.purchases.where('tenantId').equals(tenantId).count(),
    db.expenses.where('tenantId').equals(tenantId).count(),
    db.inventory.where('tenantId').equals(tenantId).count(),
    db.parties.where('tenantId').equals(tenantId).count(),
    db.pendingWrites.where('tenantId').equals(tenantId).count(),
  ])
  // Find latest cachedAt across all tables
  const allItems = await Promise.all([
    db.sales.where('tenantId').equals(tenantId).toArray(),
    db.purchases.where('tenantId').equals(tenantId).toArray(),
    db.expenses.where('tenantId').equals(tenantId).toArray(),
  ])
  const allTimes = allItems.flat().map((i: any) => i.cachedAt || 0)
  const lastCachedAt = allTimes.length ? Math.max(...allTimes) : null
  return { sales, purchases, expenses, inventory, parties, pendingWrites, lastCachedAt }
}
