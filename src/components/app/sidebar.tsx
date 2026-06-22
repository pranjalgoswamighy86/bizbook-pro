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
  ShieldCheck,
  HelpCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { getRoleLabel } from '@/store/app-store'
import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
import { BackupImportDialog } from '@/components/modules/backup-import-dialog'
import { HelpModal } from '@/components/app/help-modal' // v4.49: Help & Support modal
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
  { id: 'ai-valuation', label: 'Smart AI Company Valuation', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'super-admin-subscriptions', label: 'Super Admin Panel', icon: <Crown className="h-4 w-4" />, minRole: 'SUPER_ADMIN' },
  { id: 'payment-proof-review', label: 'Payment Proofs', icon: <ShieldCheck className="h-4 w-4" />, minRole: 'SUPER_ADMIN' },
  { id: 'help-support-management', label: 'Help & Support Management', icon: <HelpCircle className="h-4 w-4" />, minRole: 'SUPER_ADMIN' },
  { id: 'backup', label: 'Backup & Restore', icon: <HardDrive className="h-4 w-4" />, minRole: 'MAIN_ADMIN' },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" />, minRole: 'MAIN_ADMIN' },
]

export function AppSidebar() {
  const { currentView, setView, user, tenant, companies, sidebarOpen, setSidebarOpen, logout } = useAppStore()
  const { toast } = useToast()
  const [backupLoading, setBackupLoading] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [showBackupImport, setShowBackupImport] = useState(false)
  const [showHelp, setShowHelp] = useState(false) // v4.49: Help modal state

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
    // v4.61: SUPER_ADMIN items only visible to admin@bizbook.pro / pranjalgoswamighy86@gmail.com
    if (item.minRole === 'SUPER_ADMIN') {
      const SUPER_ADMIN_EMAILS = ['admin@bizbook.pro', 'pranjalgoswamighy86@gmail.com']
      return SUPER_ADMIN_EMAILS.includes(user.email.toLowerCase())
    }
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

  // v4.51: Fix Help button on mobile — close drawer BEFORE opening modal
  // Without this, the drawer (z-50) and Dialog (z-50) compete for the same
  // z-index level, and the drawer's translate-x transform creates a stacking
  // context that traps the dialog behind it.
  const handleHelpClick = useCallback(() => {
    closeMobileDrawer() // Close drawer first (mobile)
    // Small delay to let drawer close animation finish before opening modal
    setTimeout(() => setShowHelp(true), 100)
  }, [closeMobileDrawer])

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
      {/* Branding: Both logos + BizBook Pro / Tahigo International */}
      <div className="p-3 shrink-0 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <img
            src="/tahigo-logo.png"
            alt="Tahigo International"
            className="flex-shrink-0 h-10 w-10 rounded-lg object-contain p-1 border border-sidebar-border bg-white shadow-sm"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          <img
            src="/bizbook-pro-logo.png"
            alt="BizBook Pro"
            className="flex-shrink-0 h-10 w-10 rounded-lg object-contain p-1 border border-sidebar-border bg-white shadow-sm"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-black text-sidebar-foreground truncate leading-tight">BizBook Pro</h1>
            <p className="text-[9px] font-semibold text-sidebar-foreground/60 tracking-wider uppercase truncate">Tahigo International</p>
          </div>
          {isMobile && (
            <Button variant="ghost" size="icon" className="flex-shrink-0 h-7 w-7 text-sidebar-foreground" onClick={closeMobileDrawer}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Switch Company / Add Company / Import Backup buttons */}
      <div className="p-3 shrink-0">
        <div className="space-y-1">
          <button
            onClick={handleSwitchCompany}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-sidebar-primary hover:bg-sidebar-accent transition-colors"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            {companies.length > 1 ? 'Switch Company' : 'My Companies'}
          </button>
          <button
            onClick={() => { setView('company-select'); closeMobileDrawer() }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-sidebar-primary hover:bg-sidebar-accent transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add New Company
          </button>
          {tenant && (
            <button
              onClick={() => { setShowBackupImport(true); closeMobileDrawer() }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-amber-400 hover:bg-sidebar-accent transition-colors"
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
              onMouseEnter={() => {
                // v4.59: Prefetch module chunk on hover — instant load when clicked
                // Next.js dynamic imports are cached after first load, so this
                // only downloads the chunk if it hasn't been loaded yet
                if (item.id !== currentView && item.id !== 'dashboard' && item.id !== 'company-select') {
                  const chunkMap: Record<string, () => Promise<unknown>> = {
                    'sales': () => import('@/components/modules/sale-register'),
                    'purchases': () => import('@/components/modules/purchase-register'),
                    'expenses': () => import('@/components/modules/expense-register'),
                    'inventory': () => import('@/components/modules/inventory'),
                    'bank': () => import('@/components/modules/bank-statement'),
                    'pnl': () => import('@/components/modules/pnl-summary'),
                    'day-report': () => import('@/components/modules/day-report'),
                    'balance-sheet': () => import('@/components/modules/balance-sheet'),
                    'debtors': () => import('@/components/modules/debtors'),
                    'creditors': () => import('@/components/modules/creditors'),
                    'payments': () => import('@/components/modules/payments'),
                    'receipts': () => import('@/components/modules/receipts'),
                    'staff': () => import('@/components/modules/staff-salary'),
                    'settings': () => import('@/components/modules/settings'),
                    'audit-log': () => import('@/components/modules/audit-log'),
                    'batch-expiry': () => import('@/components/modules/batch-expiry'),
                    'price-lists': () => import('@/components/modules/price-lists'),
                    'gst-reports': () => import('@/components/modules/gst-reports'),
                    'backup': () => import('@/components/modules/backup'),
                    'chart-of-accounts': () => import('@/components/modules/chart-of-accounts'),
                    'general-ledger': () => import('@/components/modules/general-ledger'),
                    'ai-import': () => import('@/components/modules/ai-import'),
                    'subscription': () => import('@/components/modules/subscription'),
                    'ai-valuation': () => import('@/components/modules/ai-valuation'),
                    'super-admin-subscriptions': () => import('@/components/modules/super-admin-subscriptions'),
                    'payment-proof-review': () => import('@/components/modules/payment-proof-review'),
                    'help-support-management': () => import('@/components/modules/help-support-management'),
                  }
                  chunkMap[item.id]?.().catch(() => {})
                }
              }}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                currentView === item.id
                  ? 'bg-sidebar-accent text-sidebar-primary font-medium'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground'
              )}
              title={!sidebarOpen && !isMobile ? item.label : undefined}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}

          {/* v4.49: Help button — opens Help modal with FAQ + guides + contact
              v4.51: Use handleHelpClick to close mobile drawer first (fixes z-index conflict) */}
          <button
            onClick={handleHelpClick}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title={!sidebarOpen && !isMobile ? 'Help & Support' : undefined}
          >
            <HelpCircle className="h-4 w-4" />
            <span className="truncate">Help &amp; Support</span>
          </button>
        </nav>
      </ScrollArea>

      <Separator />

      {/* Backup buttons */}
      <div className="px-3 py-2 space-y-1 shrink-0">
        <p className="text-xs font-medium text-sidebar-foreground/60 px-2 mb-1">Data Backup</p>
        <button
          onClick={() => handleDownloadBackup('json')}
          disabled={backupLoading}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Download Backup (JSON)
        </button>
        <button
          onClick={() => handleDownloadBackup('tally')}
          disabled={backupLoading}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
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
        <div className="fixed top-0 left-0 right-0 h-14 bg-background border-b border-border z-30 flex items-center gap-3 px-3 safe-area-top">
          <Button
            variant="ghost"
            size="icon"
            className="flex-shrink-0 h-9 w-9"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          {/* v4.18: No logos in mobile sidebar top bar — TopBrandingBar handles branding */}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground truncate">{tenant?.name || 'Business'}</p>
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
            'fixed top-0 left-0 app-drawer-height w-72 bg-sidebar border-r border-sidebar-border z-50 flex flex-col transition-transform duration-300',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {sidebarContent}
        </div>
        {backupDialog}
        {/* v4.51: Fix — HelpModal was only mounted on desktop, never on mobile.
            Clicking Help button on mobile did nothing because the modal component
            wasn't in the render tree. Now mounted in BOTH paths. */}
        <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
      </>
    )
  }

  // ============================
  // Desktop: inline sidebar with collapse
  // ============================
  // v4.18: Branding is in TopBrandingBar — sidebar starts with company switcher + nav.
  // No duplicate logos/text in sidebar header.

  return (
    <div
      className={cn(
        'flex flex-col h-full overflow-hidden bg-sidebar border-r border-sidebar-border transition-all duration-300 relative shrink-0',
        sidebarOpen ? 'w-64' : 'w-16'
      )}
    >
      {/* Branding: Both logos + BizBook Pro / Tahigo International */}
      <div className="p-3 shrink-0 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <img
            src="/tahigo-logo.png"
            alt="Tahigo International"
            className="flex-shrink-0 h-10 w-10 rounded-lg object-contain p-1 border border-sidebar-border bg-white shadow-sm"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          <img
            src="/bizbook-pro-logo.png"
            alt="BizBook Pro"
            className="flex-shrink-0 h-10 w-10 rounded-lg object-contain p-1 border border-sidebar-border bg-white shadow-sm"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          {sidebarOpen && (
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-black text-sidebar-foreground truncate leading-tight">BizBook Pro</h1>
              <p className="text-[9px] font-semibold text-sidebar-foreground/60 tracking-wider uppercase truncate">Tahigo International</p>
            </div>
          )}
        </div>
      </div>

      {/* Switch Company / Add Company / Import Backup buttons */}
      <div className="p-3 shrink-0">
        {sidebarOpen && (
          <div className="space-y-1">
            <button
              onClick={handleSwitchCompany}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-sidebar-primary hover:bg-sidebar-accent transition-colors"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {companies.length > 1 ? 'Switch Company' : 'My Companies'}
            </button>
            <button
              onClick={() => setView('company-select')}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-sidebar-primary hover:bg-sidebar-accent transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add New Company
            </button>
            {tenant && (
              <button
                onClick={() => setShowBackupImport(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-amber-400 hover:bg-sidebar-accent transition-colors"
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
                  ? 'bg-sidebar-accent text-sidebar-primary font-medium'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground'
              )}
              title={!sidebarOpen ? item.label : undefined}
            >
              {item.icon}
              {sidebarOpen && <span className="truncate">{item.label}</span>}
            </button>
          ))}

          {/* v4.50: Help button — desktop sidebar version (always show, even when collapsed)
              v4.51: Use handleHelpClick for consistent behavior */}
          <button
            onClick={handleHelpClick}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="Help & Support"
          >
            <HelpCircle className="h-4 w-4 flex-shrink-0" />
            {sidebarOpen && <span className="truncate">Help &amp; Support</span>}
          </button>
        </nav>
      </ScrollArea>

      <Separator />

      {/* Backup buttons */}
      {sidebarOpen && (
        <div className="px-3 py-2 space-y-1 shrink-0">
          <p className="text-xs font-medium text-sidebar-foreground/60 px-2 mb-1">Data Backup</p>
          <button
            onClick={() => handleDownloadBackup('json')}
            disabled={backupLoading}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download Backup (JSON)
          </button>
          <button
            onClick={() => handleDownloadBackup('tally')}
            disabled={backupLoading}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
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

      {/* v4.49: Help modal — mounted at sidebar root so it works in both desktop and mobile drawer */}
      <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  )
}
