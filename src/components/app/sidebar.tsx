'use client'

import { useAppStore, type ViewType, canEdit, canManage, type UserRole } from '@/store/app-store'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Receipt,
  Building2,
  TrendingUp,
  CalendarDays,
  Users,
  CreditCard,
  Banknote,
  UserCheck,
  UserX,
  Settings,
  Scale,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ArrowLeftRight,
  Download,
  Plus,
  Menu,
  X,
  FileText,
  Clock,
  Tag,
  FileSpreadsheet,
  HardDrive,
  BookOpen,
  ArrowRightLeft,
  Sparkles,
  Crown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { getRoleLabel } from '@/store/app-store'
import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
import { BackupImportDialog } from '@/components/modules/backup-import-dialog'
import { authFetch } from '@/lib/auth-fetch'

interface NavItem {
  id: ViewType
  label: string
  icon: React.ReactNode
  minRole?: UserRole
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'bank', label: 'Bank Statement', icon: <Building2 className="h-4 w-4" /> },
  { id: 'sales', label: 'Sale Register', icon: <ShoppingCart className="h-4 w-4" /> },
  { id: 'purchases', label: 'Purchase Register', icon: <Package className="h-4 w-4" /> },
  { id: 'expenses', label: 'Expense Register', icon: <Receipt className="h-4 w-4" /> },
  { id: 'inventory', label: 'Inventory & Products', icon: <Package className="h-4 w-4" /> },
  { id: 'batch-expiry', label: 'Batch & Expiry', icon: <Clock className="h-4 w-4" /> },
  { id: 'price-lists', label: 'Price Lists', icon: <Tag className="h-4 w-4" /> },
  { id: 'chart-of-accounts', label: 'Chart of Accounts', icon: <BookOpen className="h-4 w-4" /> },
  { id: 'general-ledger', label: 'General Ledger', icon: <ArrowRightLeft className="h-4 w-4" /> },
  { id: 'pnl', label: 'P&L Summary', icon: <TrendingUp className="h-4 w-4" /> },
  { id: 'day-report', label: 'Day Report', icon: <CalendarDays className="h-4 w-4" /> },
  { id: 'balance-sheet', label: 'Balance Sheet', icon: <Scale className="h-4 w-4" /> },
  { id: 'gst-reports', label: 'GST Reports', icon: <FileSpreadsheet className="h-4 w-4" /> },
  { id: 'debtors', label: 'Debtors (Receivable)', icon: <UserCheck className="h-4 w-4" /> },
  { id: 'creditors', label: 'Creditors (Payable)', icon: <UserX className="h-4 w-4" /> },
  { id: 'payments', label: 'Payments', icon: <CreditCard className="h-4 w-4" /> },
  { id: 'receipts', label: 'Receipts', icon: <Banknote className="h-4 w-4" /> },
  { id: 'staff', label: 'Staff & Salary', icon: <Users className="h-4 w-4" /> },
  { id: 'audit-log', label: 'Audit Log', icon: <FileText className="h-4 w-4" />, minRole: 'MAIN_ADMIN' },
  { id: 'ai-import', label: 'AI Smart Import', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'subscription', label: 'Subscription', icon: <Crown className="h-4 w-4" /> },
  { id: 'super-admin-subscriptions', label: 'Super Admin Panel', icon: <Crown className="h-4 w-4" />, minRole: 'MAIN_ADMIN' },
  { id: 'backup', label: 'Backup & Restore', icon: <HardDrive className="h-4 w-4" />, minRole: 'MAIN_ADMIN' },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" />, minRole: 'MAIN_ADMIN' },
]

export function AppSidebar() {
  const { currentView, setView, user, tenant, companies, sidebarOpen, setSidebarOpen, logout } = useAppStore()
  const { toast } = useToast()
  const [backupLoading, setBackupLoading] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [showBackupImport, setShowBackupImport] = useState(false)

  // Detect mobile screen size
  // Use 900px breakpoint so that small screens like 800x600
  // get the mobile drawer treatment instead of cramped desktop sidebar
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 900
      setIsMobile(mobile)
      if (mobile) setSidebarOpen(false)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredItems = navItems.filter((item) => {
    if (!item.minRole) return true
    if (!user) return false
    if (item.minRole === 'MAIN_ADMIN') return canManage(user.role)
    return true
  })

  const closeMobileDrawer = useCallback(() => {
    if (isMobile) setSidebarOpen(false)
  }, [isMobile, setSidebarOpen])

  const handleSwitchCompany = () => {
    setView('company-select')
    closeMobileDrawer()
  }

  const handleNavClick = (view: ViewType) => {
    setView(view)
    closeMobileDrawer()
  }

  const handleDownloadBackup = async (format: 'json' | 'tally') => {
    if (!tenant) return
    setBackupLoading(true)
    try {
      const res = await authFetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: format, tenantId: tenant.id }),
      })

      if (!res.ok) {
        toast({ title: 'Export Failed', description: 'Could not generate backup.', variant: 'destructive' })
        return
      }

      if (format === 'tally') {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${tenant.name.replace(/[^a-zA-Z0-9]/g, '_')}_tally_export.xml`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        const data = await res.json()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${tenant.name.replace(/[^a-zA-Z0-9]/g, '_')}_backup_${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
      }

      toast({ title: 'Backup Downloaded', description: `${format === 'tally' ? 'Tally XML' : 'JSON'} backup saved successfully.` })
    } catch {
      toast({ title: 'Export Failed', description: 'Network error. Please try again.', variant: 'destructive' })
    } finally {
      setBackupLoading(false)
    }
  }

  // Shared navigation content for both mobile and desktop sidebars
  const sidebarContent = (
    <>
      {/* v4.12: Spec Section 5 + Task 10 — Top-left branding shows Tahigo (parent)
          + "A Product by Tahigo International" badge.
          Sidebar shows the Tahigo logo prominently, with the tenant (company) name below. */}
      <div className="p-4 shrink-0">
        <div className="flex items-center gap-3">
          <img
            src="/tahigo-logo.png"
            alt="Tahigo International"
            className="flex-shrink-0 h-12 w-12 rounded-xl object-contain border border-slate-100 shadow-sm p-1 bg-white"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-black truncate">Tahigo</h1>
            <p className="text-[10px] font-semibold text-slate-500 tracking-wider uppercase truncate">
              Tahigo International
            </p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {tenant?.name || 'Business'}
            </p>
          </div>
          {isMobile && (
            <Button variant="ghost" size="icon" className="flex-shrink-0 h-7 w-7" onClick={closeMobileDrawer}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        {/* Switch Company / Add Company / Import Backup buttons */}
        <div className="mt-2 space-y-1">
          <button
            onClick={handleSwitchCompany}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            {companies.length > 1 ? 'Switch Company' : 'My Companies'}
          </button>
          <button
            onClick={() => { setView('company-select'); closeMobileDrawer() }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add New Company
          </button>
          {tenant && (
            <button
              onClick={() => { setShowBackupImport(true); closeMobileDrawer() }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Import Backup
            </button>
          )}
        </div>
      </div>

      <Separator />

      {/* Navigation */}
      <ScrollArea className="flex-1 min-h-0 px-2 py-2">
        <nav className="space-y-1">
          {filteredItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                currentView === item.id
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
              title={!sidebarOpen && !isMobile ? item.label : undefined}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>
      </ScrollArea>

      <Separator />

      {/* Backup buttons */}
      <div className="px-3 py-2 space-y-1 shrink-0">
        <p className="text-xs font-medium text-muted-foreground px-2 mb-1">Data Backup</p>
        <button
          onClick={() => handleDownloadBackup('json')}
          disabled={backupLoading}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Download Backup (JSON)
        </button>
        <button
          onClick={() => handleDownloadBackup('tally')}
          disabled={backupLoading}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Export for Tally (XML)
        </button>
      </div>

      <Separator />

      {/* v4.6: User info + Logout text REMOVED from sidebar (Task 31)
          These now live in the TopBrandingBar (top-right corner, icon-only logout) */}
    </>
  )

  // Backup import dialog (shared for both mobile and desktop)
  const backupDialog = (
    <BackupImportDialog
      open={showBackupImport}
      onOpenChange={setShowBackupImport}
      companyName={tenant?.name || ''}
    />
  )

  // ============================
  // Mobile: fixed top bar + drawer overlay
  // ============================
  if (isMobile) {
    return (
      <>
        {/* Fixed mobile top bar */}
        <div className="fixed top-0 left-0 right-0 h-14 bg-card border-b border-border z-30 flex items-center gap-3 px-3 safe-area-top">
          <Button
            variant="ghost"
            size="icon"
            className="flex-shrink-0 h-9 w-9"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <img src="/tahigo-logo.png" alt="Tahigo International" className="h-12 w-12 rounded-xl object-contain flex-shrink-0 p-1 border border-slate-100 bg-white shadow-sm" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-black truncate">Tahigo</h1>
            <p className="text-[10px] font-semibold text-slate-500 tracking-wider uppercase truncate">Tahigo International</p>
            <p className="text-xs text-muted-foreground truncate">{tenant?.name || 'Business'}</p>
          </div>
        </div>

        {/* Backdrop overlay when sidebar is open */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 transition-opacity"
            onClick={closeMobileDrawer}
          />
        )}

        {/* Sidebar drawer — slides in from left */}
        <div
          className={cn(
            'fixed top-0 left-0 app-drawer-height w-72 bg-card border-r border-border z-50 flex flex-col transition-transform duration-300',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {sidebarContent}
        </div>
        {backupDialog}
      </>
    )
  }

  // ============================
  // Desktop: inline sidebar with collapse
  // ============================

  return (
    <div
      className={cn(
        'flex flex-col h-full overflow-hidden bg-card border-r border-border transition-all duration-300 relative shrink-0',
        sidebarOpen ? 'w-64' : 'w-16'
      )}
    >
      {/* Header */}
      <div className="p-4 shrink-0">
        <div className="flex items-center gap-3">
          <img
            src="/tahigo-logo.png"
            alt="Tahigo International"
            className="flex-shrink-0 h-12 w-12 rounded-xl object-contain p-1 border border-slate-100 bg-white shadow-sm"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          {sidebarOpen && (
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-black truncate">Tahigo</h1>
              <p className="text-[10px] font-semibold text-slate-500 tracking-wider uppercase truncate">Tahigo International</p>
              <p className="text-xs text-muted-foreground truncate">{tenant?.name || 'Business'}</p>
            </div>
          )}
        </div>
        {/* Switch Company / Add Company / Import Backup buttons */}
        {sidebarOpen && (
          <div className="mt-2 space-y-1">
            <button
              onClick={handleSwitchCompany}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {companies.length > 1 ? 'Switch Company' : 'My Companies'}
            </button>
            <button
              onClick={() => setView('company-select')}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add New Company
            </button>
            {tenant && (
              <button
                onClick={() => setShowBackupImport(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Import Backup
              </button>
            )}
          </div>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="absolute -right-3 top-6 h-6 w-6 rounded-full border bg-card shadow-sm z-10"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </Button>

      <Separator />

      {/* Navigation */}
      <ScrollArea className="flex-1 min-h-0 px-2 py-2">
        <nav className="space-y-1">
          {filteredItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                currentView === item.id
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
              title={!sidebarOpen ? item.label : undefined}
            >
              {item.icon}
              {sidebarOpen && <span className="truncate">{item.label}</span>}
            </button>
          ))}
        </nav>
      </ScrollArea>

      <Separator />

      {/* Backup buttons */}
      {sidebarOpen && (
        <div className="px-3 py-2 space-y-1 shrink-0">
          <p className="text-xs font-medium text-muted-foreground px-2 mb-1">Data Backup</p>
          <button
            onClick={() => handleDownloadBackup('json')}
            disabled={backupLoading}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download Backup (JSON)
          </button>
          <button
            onClick={() => handleDownloadBackup('tally')}
            disabled={backupLoading}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export for Tally (XML)
          </button>
        </div>
      )}

      <Separator />

      {/* v4.6: User info + Logout text REMOVED from sidebar (Task 31)
          These now live in the TopBrandingBar (top-right corner, icon-only logout) */}

      {backupDialog}
    </div>
  )
}
