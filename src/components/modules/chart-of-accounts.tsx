'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore, canEdit, canManage, type UserRole } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency } from '@/lib/formulas'
import { Plus, Pencil, Trash2, Eye, Loader2, BookOpen, ChevronRight, ChevronDown, FolderTree } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

interface Account {
  id: string
  accountCode: string
  name: string
  type: string
  description: string | null
  isActive: boolean
  parentId: string | null
  parent: { id: string; name: string; accountCode: string } | null
  children: { id: string; name: string; accountCode: string; isActive: boolean }[]
  _count: { children: number }
}

const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']
const TYPE_COLORS: Record<string, string> = {
  Asset: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  Liability: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  Equity: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
  Revenue: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  Expense: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
}

export function ChartOfAccounts() {
  const { tenant, user } = useAppStore()
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [filterType, setFilterType] = useState<string>('ALL')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']))

  const [form, setForm] = useState({
    accountCode: '', name: '', type: 'Asset', description: '', parentId: '',
  })

  const fetchAccounts = useCallback(async () => {
    if (!tenant) return
    try {
      const res = await authFetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', tenantId: tenant.id }),
      })
      if (res.ok) {
        const data = await res.json()
        setAccounts(data.accounts || [])
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load accounts', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [tenant, toast])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  const handleSeedDefaults = async () => {
    if (!tenant) return
    setSeeding(true)
    try {
      const res = await authFetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed-defaults', tenantId: tenant.id }),
      })
      const data = await res.json()
      if (res.ok) {
        toast({ title: 'Chart of Accounts Created', description: `${data.created} default accounts seeded` })
        fetchAccounts()
      } else {
        toast({ title: 'Cannot Seed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to seed accounts', variant: 'destructive' })
    } finally {
      setSeeding(false)
    }
  }

  const handleSave = async () => {
    if (!tenant) return
    if (!form.accountCode || !form.name || !form.type) {
      toast({ title: 'Validation Error', description: 'Code, name, and type are required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        action: editingId ? 'update' : 'create',
        tenantId: tenant.id,
        accountCode: form.accountCode,
        name: form.name,
        type: form.type,
        description: form.description || null,
        parentId: form.parentId || null,
      }
      if (editingId) {
        payload.id = editingId
        payload.data = {
          accountCode: form.accountCode,
          name: form.name,
          type: form.type,
          description: form.description || null,
          parentId: form.parentId || null,
        }
      }

      const res = await authFetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) {
        toast({ title: editingId ? 'Account Updated' : 'Account Created', description: `${form.accountCode} - ${form.name}` })
        setShowForm(false)
        setEditingId(null)
        resetForm()
        fetchAccounts()
      } else {
        toast({ title: 'Error', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save account', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (account: Account) => {
    setForm({
      accountCode: account.accountCode,
      name: account.name,
      type: account.type,
      description: account.description || '',
      parentId: account.parentId || '',
    })
    setEditingId(account.id)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!tenant || !confirm('Deactivate this account instead of deleting? If it has no transactions, it will be permanently removed.')) return
    try {
      const res = await authFetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id, tenantId: tenant.id }),
      })
      const data = await res.json()
      if (res.ok) {
        toast({ title: 'Account Deleted', description: 'Account removed permanently' })
        fetchAccounts()
      } else {
        toast({ title: 'Cannot Delete', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete account', variant: 'destructive' })
    }
  }

  const resetForm = () => {
    setForm({ accountCode: '', name: '', type: 'Asset', description: '', parentId: '' })
    setEditingId(null)
  }

  const toggleGroup = (type: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  // Group accounts by type
  const groupedAccounts = accounts.reduce<Record<string, Account[]>>((acc, a) => {
    if (!acc[a.type]) acc[a.type] = []
    acc[a.type].push(a)
    return acc
  }, {})

  const filteredTypes = filterType === 'ALL' ? ACCOUNT_TYPES : [filterType]

  return (
    <div className="p-4 md:p-6 space-y-6">
      <AppHeader title="Chart of Accounts" />

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => { resetForm(); setShowForm(true) }} disabled={!canEdit(user?.role as UserRole)} className="gap-2">
          <Plus className="h-4 w-4" /> New Account
        </Button>
        <Button variant="outline" onClick={handleSeedDefaults} disabled={seeding} className="gap-2">
          {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderTree className="h-4 w-4" />}
          {seeding ? 'Seeding...' : 'Seed Default Accounts'}
        </Button>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Filter by type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            {ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-muted-foreground">{accounts.length} accounts</div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Accounts Yet</h3>
            <p className="text-muted-foreground mb-4">Create your Chart of Accounts to enable double-entry bookkeeping.</p>
            <Button onClick={handleSeedDefaults} disabled={seeding} className="gap-2">
              {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderTree className="h-4 w-4" />}
              Seed Default Indian Chart of Accounts
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredTypes.map(type => {
            const typeAccounts = groupedAccounts[type] || []
            if (typeAccounts.length === 0) return null
            const isExpanded = expandedGroups.has(type)

            return (
              <Card key={type}>
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleGroup(type)}
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <Badge className={TYPE_COLORS[type]}>{type}</Badge>
                  <span className="font-medium">{typeAccounts.length} account{typeAccounts.length !== 1 ? 's' : ''}</span>
                </div>
                {isExpanded && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">Code</TableHead>
                        <TableHead>Account Name</TableHead>
                        <TableHead className="w-48">Description</TableHead>
                        <TableHead className="w-24">Status</TableHead>
                        <TableHead className="w-28">Sub-accounts</TableHead>
                        <TableHead className="w-28 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {typeAccounts.map(account => (
                        <TableRow key={account.id}>
                          <TableCell className="font-mono font-medium">{account.accountCode}</TableCell>
                          <TableCell>
                            <div className="font-medium">{account.name}</div>
                            {account.parent && (
                              <div className="text-xs text-muted-foreground">Under: {account.parent.accountCode} - {account.parent.name}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{account.description || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={account.isActive ? 'default' : 'secondary'} className={account.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}>
                              {account.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">{account._count.children}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(account)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(account.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Create/Edit Account Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) resetForm() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Account' : 'Create Account'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Account Code *</Label>
                <Input placeholder="e.g., 10100" value={form.accountCode} onChange={(e) => setForm(f => ({ ...f, accountCode: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Account Type *</Label>
                <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Account Name *</Label>
              <Input placeholder="e.g., Cash, Accounts Receivable" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Optional description" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Parent Account</Label>
              <Select value={form.parentId} onValueChange={(v) => setForm(f => ({ ...f, parentId: v === 'NONE' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="None (Top-level)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">None (Top-level)</SelectItem>
                  {accounts.filter(a => a.id !== editingId).map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.accountCode} - {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm() }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingId ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
