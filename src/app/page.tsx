'use client'

import { useState, useEffect, Suspense, lazy } from 'react'
import { useAppStore } from '@/store/app-store'
import { AppSidebar } from '@/components/app/sidebar'
import { TopBrandingBar } from '@/components/app/top-branding-bar'
import { CoverPage } from '@/components/modules/cover'
import { CompanySelectPage } from '@/components/modules/company-select'
import { Dashboard } from '@/components/modules/dashboard'
import { ErrorBoundary } from '@/components/app/error-boundary'
import { Loader2 } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'
import { useSubscriptionUsageTracker } from '@/hooks/use-subscription-usage'

// v4.58: Lazy load ALL modules except Dashboard (default view)
// This reduces initial JS bundle by 60-70% — only the active module's
// code is downloaded, not all 25+ modules at once.
const ModuleLoader = () => (
  <div className="flex items-center justify-center h-64">
    <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
  </div>
)

const SaleRegister = lazy(() => import('@/components/modules/sale-register').then(m => ({ default: m.SaleRegister })))
const PurchaseRegister = lazy(() => import('@/components/modules/purchase-register').then(m => ({ default: m.PurchaseRegister })))
const ExpenseRegister = lazy(() => import('@/components/modules/expense-register').then(m => ({ default: m.ExpenseRegister })))
const Inventory = lazy(() => import('@/components/modules/inventory').then(m => ({ default: m.Inventory })))
const BankStatement = lazy(() => import('@/components/modules/bank-statement').then(m => ({ default: m.BankStatement })))
const PnLSummary = lazy(() => import('@/components/modules/pnl-summary').then(m => ({ default: m.PnLSummary })))
const DayReport = lazy(() => import('@/components/modules/day-report').then(m => ({ default: m.DayReport })))
const BalanceSheet = lazy(() => import('@/components/modules/balance-sheet').then(m => ({ default: m.BalanceSheet })))
const Debtors = lazy(() => import('@/components/modules/debtors').then(m => ({ default: m.Debtors })))
const Creditors = lazy(() => import('@/components/modules/creditors').then(m => ({ default: m.Creditors })))
const Payments = lazy(() => import('@/components/modules/payments').then(m => ({ default: m.Payments })))
const Receipts = lazy(() => import('@/components/modules/receipts').then(m => ({ default: m.Receipts })))
const StaffSalary = lazy(() => import('@/components/modules/staff-salary').then(m => ({ default: m.StaffSalary })))
const SettingsPage = lazy(() => import('@/components/modules/settings').then(m => ({ default: m.SettingsPage })))
const AuditLog = lazy(() => import('@/components/modules/audit-log').then(m => ({ default: m.AuditLog })))
const BatchExpiry = lazy(() => import('@/components/modules/batch-expiry').then(m => ({ default: m.BatchExpiry })))
const PriceLists = lazy(() => import('@/components/modules/price-lists').then(m => ({ default: m.PriceLists })))
const GstReports = lazy(() => import('@/components/modules/gst-reports').then(m => ({ default: m.GstReports })))
const BackupPage = lazy(() => import('@/components/modules/backup').then(m => ({ default: m.BackupPage })))
const ChartOfAccounts = lazy(() => import('@/components/modules/chart-of-accounts').then(m => ({ default: m.ChartOfAccounts })))
const GeneralLedger = lazy(() => import('@/components/modules/general-ledger').then(m => ({ default: m.GeneralLedger })))
const AIImportPage = lazy(() => import('@/components/modules/ai-import').then(m => ({ default: m.AIImportPage })))
const SubscriptionPage = lazy(() => import('@/components/modules/subscription').then(m => ({ default: m.SubscriptionPage })))
const AIValuationPage = lazy(() => import('@/components/modules/ai-valuation').then(m => ({ default: m.AIValuationPage })))
const SuperAdminSubscriptionPanel = lazy(() => import('@/components/modules/super-admin-subscriptions').then(m => ({ default: m.SuperAdminSubscriptionPanel })))
const PaymentProofReview = lazy(() => import('@/components/modules/payment-proof-review').then(m => ({ default: m.PaymentProofReview })))

function ModuleRouter() {
  const { currentView } = useAppStore()

  // Dashboard is eagerly loaded (default view — most frequently accessed)
  if (currentView === 'dashboard') return <Dashboard />
  if (currentView === 'company-select') return <CompanySelectPage />

  // All other modules are lazy-loaded with Suspense fallback
  const renderModule = () => {
    switch (currentView) {
      case 'sales': return <SaleRegister />
      case 'purchases': return <PurchaseRegister />
      case 'expenses': return <ExpenseRegister />
      case 'inventory': return <Inventory />
      case 'bank': return <BankStatement />
      case 'pnl': return <PnLSummary />
      case 'day-report': return <DayReport />
      case 'balance-sheet': return <BalanceSheet />
      case 'debtors': return <Debtors />
      case 'creditors': return <Creditors />
      case 'payments': return <Payments />
      case 'receipts': return <Receipts />
      case 'staff': return <StaffSalary />
      case 'settings': return <SettingsPage />
      case 'audit-log': return <AuditLog />
      case 'batch-expiry': return <BatchExpiry />
      case 'price-lists': return <PriceLists />
      case 'gst-reports': return <GstReports />
      case 'backup': return <BackupPage />
      case 'chart-of-accounts': return <ChartOfAccounts />
      case 'general-ledger': return <GeneralLedger />
      case 'ai-import': return <AIImportPage />
      case 'subscription': return <SubscriptionPage />
      case 'ai-valuation': return <AIValuationPage />
      case 'super-admin-subscriptions': return <SuperAdminSubscriptionPanel />
      case 'payment-proof-review': return <PaymentProofReview />
      default: return <Dashboard />
    }
  }

  return (
    <Suspense fallback={<ModuleLoader />}>
      {renderModule()}
    </Suspense>
  )
}

export default function Home() {
  const { isAuthenticated, currentView, logout, user } = useAppStore()
  useSubscriptionUsageTracker()
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  // Session validation
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return
    let cancelled = false
    authFetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'me' }),
      credentials: 'include',
    })
      .then((r) => {
        if (cancelled) return
        if (r.status === 401) {
          console.log('[Session] Stale session detected, logging out')
          try { localStorage.removeItem('bizbook-auth') } catch {}
          document.cookie = 'bizbook_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
          logout()
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [hydrated, isAuthenticated, logout])

  // v4.49: AFK auto-logout after 5 minutes of inactivity
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return

    let afkTimer: ReturnType<typeof setTimeout>
    const AFK_TIMEOUT_MS = 5 * 60 * 1000

    const resetAFKTimer = () => {
      clearTimeout(afkTimer)
      afkTimer = setTimeout(() => {
        const hasOpenDialog = document.querySelector('[role="dialog"][data-state="open"]')
        if (hasOpenDialog) {
          console.log('[AFK] Open dialog detected — extending auto-logout by 5 minutes')
          afkTimer = setTimeout(() => {
            console.log('[AFK] Auto-logout after extended inactivity (dialog was open)')
            try { localStorage.removeItem('bizbook-auth') } catch {}
            document.cookie = 'bizbook_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
            logout()
          }, AFK_TIMEOUT_MS)
          return
        }

        console.log('[AFK] Auto-logout after 5 minutes of inactivity')
        try { localStorage.removeItem('bizbook-auth') } catch {}
        document.cookie = 'bizbook_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
        logout()
      }, AFK_TIMEOUT_MS)
    }

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']
    let lastReset = 0
    const throttledReset = () => {
      const now = Date.now()
      if (now - lastReset > 10000) {
        lastReset = now
        resetAFKTimer()
      }
    }
    events.forEach(e => window.addEventListener(e, throttledReset, { passive: true }))
    resetAFKTimer()

    return () => {
      clearTimeout(afkTimer)
      events.forEach(e => window.removeEventListener(e, throttledReset))
    }
  }, [hydrated, isAuthenticated, logout])

  if (!hydrated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <CoverPage />
  }

  if (currentView === 'company-select') {
    return <CompanySelectPage />
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background" style={{ height: '100dvh' }}>
      <TopBrandingBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <AppSidebar />
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden" style={{ scrollbarGutter: 'stable' }}>
          <ErrorBoundary>
            <ModuleRouter />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
