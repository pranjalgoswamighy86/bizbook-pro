'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { AppSidebar } from '@/components/app/sidebar'
import { TopBrandingBar } from '@/components/app/top-branding-bar'
import { CoverPage } from '@/components/modules/cover'
import { CompanySelectPage } from '@/components/modules/company-select'
import { Dashboard } from '@/components/modules/dashboard'
import { SaleRegister } from '@/components/modules/sale-register'
import { PurchaseRegister } from '@/components/modules/purchase-register'
import { ExpenseRegister } from '@/components/modules/expense-register'
import { Inventory } from '@/components/modules/inventory'
import { BankStatement } from '@/components/modules/bank-statement'
import { PnLSummary } from '@/components/modules/pnl-summary'
import { DayReport } from '@/components/modules/day-report'
import { BalanceSheet } from '@/components/modules/balance-sheet'
import { Debtors } from '@/components/modules/debtors'
import { Creditors } from '@/components/modules/creditors'
import { Payments } from '@/components/modules/payments'
import { Receipts } from '@/components/modules/receipts'
import { StaffSalary } from '@/components/modules/staff-salary'
import { SettingsPage } from '@/components/modules/settings'
import { AuditLog } from '@/components/modules/audit-log'
import { BatchExpiry } from '@/components/modules/batch-expiry'
import { PriceLists } from '@/components/modules/price-lists'
import { GstReports } from '@/components/modules/gst-reports'
import { BackupPage } from '@/components/modules/backup'
import { ChartOfAccounts } from '@/components/modules/chart-of-accounts'
import { GeneralLedger } from '@/components/modules/general-ledger'
import { AIImportPage } from '@/components/modules/ai-import'
import { SubscriptionPage } from '@/components/modules/subscription'
import { AIValuationPage } from '@/components/modules/ai-valuation'
import { SuperAdminSubscriptionPanel } from '@/components/modules/super-admin-subscriptions'
import { ErrorBoundary } from '@/components/app/error-boundary'
import { Loader2 } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'
import { useSubscriptionUsageTracker } from '@/hooks/use-subscription-usage'

function ModuleRouter() {
  const { currentView } = useAppStore()

  switch (currentView) {
    case 'dashboard': return <Dashboard />
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
    case 'company-select': return <CompanySelectPage />
    default: return <Dashboard />
  }
}

export default function Home() {
  const { isAuthenticated, currentView, logout, user } = useAppStore()
  // Track subscription usage (deducts seconds every minute while active)
  useSubscriptionUsageTracker()
  // Hydration guard: wait for Zustand persist to rehydrate from localStorage
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  // Session validation: if the store says "authenticated" but the server
  // disagrees (stale cookie, different SESSION_SECRET, expired session),
  // clear the store so the user sees the login page instead of broken APIs.
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
          // Session is invalid — clear store and cookie
          console.log('[Session] Stale session detected, logging out')
          try { localStorage.removeItem('bizbook-auth') } catch {}
          document.cookie = 'bizbook_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
          logout()
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
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

  // Company selection screen is full-page (no sidebar)
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
