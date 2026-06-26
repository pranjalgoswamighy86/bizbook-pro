'use client'

/**
 * SuperAdminSubscriptionPanel — Rule 1.4 UI
 * ------------------------------------------
 * Allows Super Admin (admin@bizbook.pro) and Infrastructure Owner
 * (pranjalgoswamighy86@gmail.com) to:
 *
 *   1. View ALL tenants' subscription status in a table
 *   2. Click any tenant to modify their subscription:
 *      - planHours (e.g., 50/100/200/500/1000)
 *      - remainingSeconds (top-up hours)
 *      - endDate (extend/cut short)
 *      - maxUsersAllowed (Rule 1.4)
 *      - customPlanType (Rule 1.4)
 *      - status (ACTIVE / EXPIRED / CONVERTED_TO_VIEW_ONLY)
 *
 * Restricted to ADMIN_BYPASS_EMAILS in backend (admin-list-all + admin-modify actions).
 *
 * PLACE AT: src/components/modules/super-admin-subscriptions.tsx
 * MOUNT IN: src/app/page.tsx ModuleRouter when currentView === 'super-admin-subscriptions'
 */

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'
import { Crown, Search, RefreshCw, X, Save, ShieldAlert } from 'lucide-react'

interface TenantSubscription {
  id: string
  tenantId: string
  tenantName: string
  tenantEmail: string
  tenantPhone: string
  tenantPlan?: string
  isDeleted?: boolean
  deletedAt?: string | null
  tenantCreatedAt?: string
  planName: string | null
  planHours: number
  remainingSeconds: number
  remainingHours: number
  totalSeconds: number
  status: string
  isFreeTier: boolean
  freeTierHours: number
  startDate: string | null
  endDate: string | null
  maxUsersAllowed: number | null
  customPlanType: string | null
  recordCounts?: {
    users: number
    sales: number
    purchases: number
    expenses: number
    inventory: number
    parties: number
  }
}

export function SuperAdminSubscriptionPanel() {
  const { user, tenant } = useAppStore()
  const { toast } = useToast()
  const [subscriptions, setSubscriptions] = useState<TenantSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<TenantSubscription>>({})

  // Check if user is Super Admin
  const ADMIN_BYPASS_EMAILS = [
    'admin@bizbook.pro',
    'pranjalgoswamighy86@gmail.com',
  ]
  const isAuthorized = user?.email && ADMIN_BYPASS_EMAILS.includes(user.email.toLowerCase())

  const fetchAllSubscriptions = async () => {
    if (!isAuthorized || !tenant?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await authFetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'admin-list-all',
          tenantId: tenant.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load subscriptions')
        return
      }
      setSubscriptions(data.subscriptions || [])
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAllSubscriptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, user?.email])

  const handleEdit = (sub: TenantSubscription) => {
    setEditingId(sub.id)
    setEditForm({
      planName: sub.planName,
      planHours: sub.planHours,
      remainingHours: sub.remainingHours,
      status: sub.status,
      maxUsersAllowed: sub.maxUsersAllowed || 0,
      customPlanType: sub.customPlanType || '',
      endDate: sub.endDate ? sub.endDate.split('T')[0] : '',
    })
  }

  const handleSave = async (targetTenantId: string) => {
    setLoading(true)
    try {
      // Convert remainingHours to remainingSeconds for the API
      const modifications: any = {
        planName: editForm.planName,
        planHours: Number(editForm.planHours),
        remainingSeconds: Number(editForm.remainingHours) * 3600,
        totalSeconds: Number(editForm.remainingHours) * 3600,
        status: editForm.status,
        maxUsersAllowed: editForm.maxUsersAllowed ? Number(editForm.maxUsersAllowed) : null,
        customPlanType: editForm.customPlanType || null,
      }
      if (editForm.endDate) {
        modifications.endDate = new Date(editForm.endDate).toISOString()
      }

      const res = await authFetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'admin-modify',
          tenantId: tenant?.id,
          targetTenantId,
          modifications,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({
          title: 'Modification Failed',
          description: data.error || 'Unknown error',
          variant: 'destructive',
        })
        return
      }
      toast({
        title: '✓ Subscription Modified',
        description: `Tenant subscription updated successfully (Rule 1.4)`,
      })
      setEditingId(null)
      fetchAllSubscriptions()
    } catch (err: any) {
      toast({
        title: 'Network Error',
        description: err?.message,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  // Unauthorized UI
  if (!isAuthorized) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-center">
          <ShieldAlert className="h-12 w-12 text-rose-500 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-rose-800 mb-2">Access Restricted</h2>
          <p className="text-sm text-rose-700">
            This panel is only accessible to Super Admin (<code>admin@bizbook.pro</code>) and
            Infrastructure Owner.
          </p>
          <p className="text-xs text-rose-600 mt-2">
            Your current email: <code>{user?.email || 'Not logged in'}</code>
          </p>
        </div>
      </div>
    )
  }

  // Filter by search
  const filtered = subscriptions.filter(s => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      s.tenantName.toLowerCase().includes(q) ||
      s.tenantEmail.toLowerCase().includes(q) ||
      s.tenantPhone.toLowerCase().includes(q) ||
      (s.planName || '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Crown className="h-7 w-7 text-amber-500" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Super Admin — Subscription Management</h1>
            <p className="text-xs text-muted-foreground">Rule 1.4 — Modify any tenant's subscription</p>
          </div>
        </div>
        <Button onClick={fetchAllSubscriptions} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Tenants" value={subscriptions.length} color="indigo" />
        <StatCard
          label="Active"
          value={subscriptions.filter(s => !s.isDeleted && s.status === 'ACTIVE').length}
          color="emerald"
        />
        <StatCard
          label="FREE Tier"
          value={subscriptions.filter(s => s.isFreeTier).length}
          color="amber"
        />
        <StatCard
          label="Soft-Deleted"
          value={subscriptions.filter(s => s.isDeleted).length}
          color="rose"
        />
      </div>

      {/* v4.118: Total records across all tenants */}
      {subscriptions.some(s => s.recordCounts) && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
          <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">📊 Total Records Across All Tenants</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
            <div className="text-center"><span className="text-blue-600 dark:text-blue-400 font-bold text-lg">{subscriptions.reduce((sum, s) => sum + (s.recordCounts?.sales || 0), 0)}</span><br/><span className="text-muted-foreground">Sales</span></div>
            <div className="text-center"><span className="text-blue-600 dark:text-blue-400 font-bold text-lg">{subscriptions.reduce((sum, s) => sum + (s.recordCounts?.purchases || 0), 0)}</span><br/><span className="text-muted-foreground">Purchases</span></div>
            <div className="text-center"><span className="text-blue-600 dark:text-blue-400 font-bold text-lg">{subscriptions.reduce((sum, s) => sum + (s.recordCounts?.expenses || 0), 0)}</span><br/><span className="text-muted-foreground">Expenses</span></div>
            <div className="text-center"><span className="text-blue-600 dark:text-blue-400 font-bold text-lg">{subscriptions.reduce((sum, s) => sum + (s.recordCounts?.inventory || 0), 0)}</span><br/><span className="text-muted-foreground">Inventory</span></div>
            <div className="text-center"><span className="text-blue-600 dark:text-blue-400 font-bold text-lg">{subscriptions.reduce((sum, s) => sum + (s.recordCounts?.parties || 0), 0)}</span><br/><span className="text-muted-foreground">Parties</span></div>
            <div className="text-center"><span className="text-blue-600 dark:text-blue-400 font-bold text-lg">{subscriptions.reduce((sum, s) => sum + (s.recordCounts?.users || 0), 0)}</span><br/><span className="text-muted-foreground">Users</span></div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by tenant name, email, phone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-md p-3">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto bg-card border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left p-3 font-semibold">Tenant</th>
              <th className="text-left p-3 font-semibold">Plan</th>
              <th className="text-left p-3 font-semibold">Hours Left</th>
              <th className="text-left p-3 font-semibold">Status</th>
              <th className="text-left p-3 font-semibold hidden md:table-cell">Records</th>
              <th className="text-left p-3 font-semibold hidden lg:table-cell">End Date</th>
              <th className="text-left p-3 font-semibold hidden lg:table-cell">Max Users</th>
              <th className="text-right p-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading ? (
              <tr>
                <td colSpan={8} className="text-center p-8 text-muted-foreground">
                  No tenants found.
                </td>
              </tr>
            ) : (
              filtered.map((sub) => (
                <tr key={sub.id} className={`border-b hover:bg-muted/30 ${sub.isDeleted ? 'opacity-50' : ''}`}>
                  <td className="p-3">
                    <div className="font-medium flex items-center gap-1.5">
                      {sub.tenantName || '—'}
                      {sub.isDeleted && <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">DELETED</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{sub.tenantEmail}</div>
                    {sub.tenantPhone && (
                      <div className="text-xs text-muted-foreground">📞 {sub.tenantPhone}</div>
                    )}
                    {sub.tenantCreatedAt && (
                      <div className="text-[10px] text-muted-foreground">Registered: {new Date(sub.tenantCreatedAt).toLocaleDateString('en-IN')}</div>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{sub.planName || <span className="text-muted-foreground text-xs">No plan</span>}</div>
                    {sub.isFreeTier && (
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">FREE</span>
                    )}
                    {sub.customPlanType && (
                      <div className="text-xs text-purple-600">⚡ {sub.customPlanType}</div>
                    )}
                  </td>
                  <td className="p-3">
                    {editingId === sub.id ? (
                      <Input
                        type="number"
                        value={editForm.remainingHours ?? 0}
                        onChange={(e) => setEditForm({ ...editForm, remainingHours: Number(e.target.value) })}
                        className="h-8 w-20"
                      />
                    ) : (
                      <span className={sub.remainingHours < 10 ? 'text-rose-600 font-semibold' : ''}>
                        {sub.remainingHours}h
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {editingId === sub.id ? (
                      <select
                        value={editForm.status || 'ACTIVE'}
                        onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                        className="h-8 text-xs border rounded px-2"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="EXPIRED">EXPIRED</option>
                        <option value="CONVERTED_TO_VIEW_ONLY">VIEW_ONLY</option>
                      </select>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        sub.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' :
                        sub.status === 'EXPIRED' ? 'bg-rose-100 text-rose-800' :
                        sub.status === 'NO_SUBSCRIPTION' ? 'bg-slate-100 text-slate-500' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {sub.status}
                      </span>
                    )}
                  </td>
                  {/* v4.118: Records column — shows sales/purchases/expenses/inventory/parties/users counts */}
                  <td className="p-3 hidden md:table-cell">
                    {sub.recordCounts ? (
                      <div className="text-xs space-y-0.5">
                        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Sales:</span><span className="font-medium">{sub.recordCounts.sales}</span></div>
                        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Purchases:</span><span className="font-medium">{sub.recordCounts.purchases}</span></div>
                        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Expenses:</span><span className="font-medium">{sub.recordCounts.expenses}</span></div>
                        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Inventory:</span><span className="font-medium">{sub.recordCounts.inventory}</span></div>
                        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Parties:</span><span className="font-medium">{sub.recordCounts.parties}</span></div>
                        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Users:</span><span className="font-medium">{sub.recordCounts.users}</span></div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3 hidden lg:table-cell">
                    {editingId === sub.id ? (
                      <Input
                        type="date"
                        value={(editForm.endDate as string) || ''}
                        onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                        className="h-8 w-36"
                      />
                    ) : (
                      sub.endDate ? new Date(sub.endDate).toLocaleDateString() : '—'
                    )}
                  </td>
                  <td className="p-3 hidden lg:table-cell">
                    {editingId === sub.id ? (
                      <Input
                        type="number"
                        value={editForm.maxUsersAllowed ?? 0}
                        onChange={(e) => setEditForm({ ...editForm, maxUsersAllowed: Number(e.target.value) })}
                        className="h-8 w-16"
                      />
                    ) : (
                      sub.maxUsersAllowed ?? '∞'
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {editingId === sub.id ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => handleSave(sub.tenantId)} disabled={loading} className="h-7 text-xs">
                          <Save className="h-3 w-3 mr-1" /> Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="h-7 text-xs">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => handleEdit(sub)} className="h-7 text-xs">
                        Modify
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit form (expanded view for planName + customPlanType) */}
      {editingId && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="font-semibold text-amber-900 mb-3">Additional Fields (Rule 1.4)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Plan Name</Label>
              <Input
                value={editForm.planName || ''}
                onChange={(e) => setEditForm({ ...editForm, planName: e.target.value })}
                placeholder="e.g., 100Hrs Plan"
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Plan Hours</Label>
              <Input
                type="number"
                value={editForm.planHours ?? 0}
                onChange={(e) => setEditForm({ ...editForm, planHours: Number(e.target.value) })}
                placeholder="50 / 100 / 200 / 500 / 1000"
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Custom Plan Type</Label>
              <Input
                value={editForm.customPlanType || ''}
                onChange={(e) => setEditForm({ ...editForm, customPlanType: e.target.value })}
                placeholder="e.g., ENTERPRISE / VIP / TRIAL"
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Max Users Allowed</Label>
              <Input
                type="number"
                value={editForm.maxUsersAllowed ?? 0}
                onChange={(e) => setEditForm({ ...editForm, maxUsersAllowed: Number(e.target.value) })}
                placeholder="0 = unlimited"
                className="h-8"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper component for stat cards
function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  }
  return (
    <div className={`border rounded-lg p-3 ${colorClasses[color] || colorClasses.indigo}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}
