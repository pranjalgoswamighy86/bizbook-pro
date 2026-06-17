'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FileText, Loader2, AlertTriangle, RefreshCw, Filter, ChevronLeft, ChevronRight } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatDate } from '@/lib/formulas'
import { authFetch } from '@/lib/auth-fetch'

interface AuditLogEntry {
  id: string
  tenantId: string
  userId: string | null
  userName: string | null
  action: string
  entityType: string
  entityId: string | null
  entityName: string | null
  changes: string | null
  createdAt: string
}

interface FilterOptions {
  users: Array<{ id: string; name: string | null }>
  actionTypes: string[]
  entityTypes: string[]
}

export function AuditLog() {
  const { tenant, user } = useAppStore()
  const { toast } = useToast()
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 50

  // Filters
  const [filterUser, setFilterUser] = useState<string>('all')
  const [filterAction, setFilterAction] = useState<string>('all')
  const [filterEntity, setFilterEntity] = useState<string>('all')
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ users: [], actionTypes: [], entityTypes: [] })

  // Change detail dialog
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null)

  useEffect(() => {
    if (!tenant) return
    loadFilterOptions()
  }, [tenant]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tenant) return
    loadLogs()
  }, [tenant, page, filterUser, filterAction, filterEntity]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadFilterOptions = async () => {
    if (!tenant) return
    try {
      const res = await authFetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'filter-options', tenantId: tenant.id }),
      })
      if (res.ok) {
        const data = await res.json()
        setFilterOptions(data)
      }
    } catch {
      console.error('Failed to load filter options')
    }
  }

  const loadLogs = async () => {
    if (!tenant) return
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        action: 'list',
        tenantId: tenant.id,
        page,
        pageSize,
      }
      if (filterUser !== 'all') body.userId = filterUser
      if (filterAction !== 'all') body.actionType = filterAction
      if (filterEntity !== 'all') body.entityType = filterEntity

      const res = await authFetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs)
        setTotal(data.total)
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load audit logs', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      case 'UPDATE': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
      case 'DELETE': return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
      default: return 'bg-muted text-muted-foreground'
    }
  }

  const getEntityTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      Sale: 'Sale', Purchase: 'Purchase', Expense: 'Expense',
      InventoryItem: 'Inventory', BankTransaction: 'Bank Txn',
      Staff: 'Staff', Payment: 'Payment', Receipt: 'Receipt',
      Debtor: 'Debtor', Creditor: 'Creditor', Party: 'Party',
      Product: 'Product', Batch: 'Batch', PriceList: 'Price List',
      User: 'User', Tenant: 'Company',
    }
    return labels[type] || type
  }

  const parseChanges = (changes: string | null) => {
    if (!changes) return null
    try {
      return JSON.parse(changes)
    } catch {
      return null
    }
  }

  const totalPages = Math.ceil(total / pageSize)

  if (loading && logs.length === 0) {
    return (
      <div>
        <AppHeader title="Audit Log" />
        <div className="p-6 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      </div>
    )
  }

  return (
    <div>
      <AppHeader title="Audit Log" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Total Entries</p>
              <p className="text-2xl font-bold">{total}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Users</p>
              <p className="text-2xl font-bold text-emerald-600">{filterOptions.users.length}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Entity Types</p>
              <p className="text-2xl font-bold text-orange-600">{filterOptions.entityTypes.length}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Actions</p>
              <p className="text-2xl font-bold text-blue-600">{filterOptions.actionTypes.length}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters</span>
              <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => { loadLogs(); loadFilterOptions() }}>
                <RefreshCw className="h-3 w-3 mr-1" /> Refresh
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select value={filterUser} onValueChange={setFilterUser}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All Users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  {filterOptions.users.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name || 'Unknown'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterAction} onValueChange={setFilterAction}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="CREATE">Create</SelectItem>
                  <SelectItem value="UPDATE">Update</SelectItem>
                  <SelectItem value="DELETE">Delete</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterEntity} onValueChange={setFilterEntity}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All Entities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  {filterOptions.entityTypes.map(e => (
                    <SelectItem key={e} value={e}>{getEntityTypeLabel(e)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-emerald-600" />
              Activity Log
            </CardTitle>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No audit logs found</p>
                <p className="text-xs text-muted-foreground mt-1">Actions performed in the system will appear here</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto max-h-[60vh] overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-36">Timestamp</TableHead>
                        <TableHead className="w-28">User</TableHead>
                        <TableHead className="w-24">Action</TableHead>
                        <TableHead className="w-28">Entity Type</TableHead>
                        <TableHead>Entity Name</TableHead>
                        <TableHead className="w-20">Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={log.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedLog(log)}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(log.createdAt).toLocaleString('en-IN', {
                              day: '2-digit', month: '2-digit', year: '2-digit',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </TableCell>
                          <TableCell className="text-sm">{log.userName || 'System'}</TableCell>
                          <TableCell>
                            <Badge className={`text-xs ${getActionColor(log.action)}`}>
                              {log.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{getEntityTypeLabel(log.entityType)}</TableCell>
                          <TableCell className="text-sm font-medium max-w-[200px] truncate">{log.entityName || '-'}</TableCell>
                          <TableCell>
                            {log.changes ? (
                              <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-600" onClick={(e) => { e.stopPropagation(); setSelectedLog(log) }}>
                                View
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-muted-foreground">
                    Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs">{page} / {totalPages || 1}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Change Detail Dialog */}
        <Dialog open={!!selectedLog} onOpenChange={(open) => { if (!open) setSelectedLog(null) }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-600" />
                Audit Detail
              </DialogTitle>
            </DialogHeader>
            {selectedLog && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Timestamp</p>
                    <p className="font-medium">{new Date(selectedLog.createdAt).toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">User</p>
                    <p className="font-medium">{selectedLog.userName || 'System'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Action</p>
                    <Badge className={getActionColor(selectedLog.action)}>{selectedLog.action}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Entity Type</p>
                    <p className="font-medium">{getEntityTypeLabel(selectedLog.entityType)}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Entity Name</p>
                    <p className="font-medium">{selectedLog.entityName || '-'}</p>
                  </div>
                </div>
                {selectedLog.changes && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Changes</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto max-h-60 overflow-y-auto">
                      {JSON.stringify(parseChanges(selectedLog.changes), null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
