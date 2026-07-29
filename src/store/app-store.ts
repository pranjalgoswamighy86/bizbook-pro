import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewType =
  | 'cover'
  | 'dashboard'
  | 'sales'
  | 'purchases'
  | 'expenses'
  | 'inventory'
  | 'bank'
  | 'pnl'
  | 'day-report'
  | 'debtors'
  | 'creditors'
  | 'staff'
  | 'payments'
  | 'receipts'
  | 'settings'
  | 'balance-sheet'
  | 'company-select'
  | 'audit-log'
  | 'batch-expiry'
  | 'price-lists'
  | 'gst-reports'
  | 'credit-debit-notes'
  | 'backup'
  | 'chart-of-accounts'
  | 'general-ledger'
  | 'trial-balance'
  | 'ai-import'
  | 'subscription'
  | 'ai-valuation'
  | 'super-admin-subscriptions'
  | 'help-support-management'

export type UserRole = 'VIEW_ONLY' | 'DATA_ENTRY' | 'JUNIOR_ADMIN' | 'MAIN_ADMIN' | 'SUPER_ADMIN'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  tenantId: string
}

export interface Tenant {
  id: string
  name: string
  address?: string
  phone?: string
  email?: string
  gstNumber?: string
  panNumber?: string
  currency: string
  upiId?: string  // v4.102: UPI ID for invoice QR code
  plan: string
  planExpires?: string
  // v6.26.0: Invoice customization fields
  logoUrl?: string
  invoiceTemplate?: string
  invoiceColor?: string
  showLogoInInvoice?: boolean
  showSignatureInInvoice?: boolean
  showQrCode?: boolean
  invoiceFooterText?: string
}

export interface CompanyInfo {
  tenantId: string
  name: string
  role: string
  isOwner: boolean
  tenant: Tenant
}

export type DateFilterType = 'all' | 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

export interface DateFilter {
  type: DateFilterType
  startDate?: string
  endDate?: string
}

interface AppState {
  currentView: ViewType
  user: User | null
  tenant: Tenant | null
  companies: CompanyInfo[]
  dateFilter: DateFilter
  searchQuery: string
  sidebarOpen: boolean
  isAuthenticated: boolean
  pendingImportFile: File | null
  sessionToken: string | null  // Bearer token for API calls (fallback when cookies blocked)

  setView: (view: ViewType) => void
  setUser: (user: User | null) => void
  setTenant: (tenant: Tenant | null) => void
  setCompanies: (companies: CompanyInfo[]) => void
  setDateFilter: (filter: DateFilter) => void
  setSearchQuery: (query: string) => void
  setSidebarOpen: (open: boolean) => void
  login: (user: User, tenant: Tenant, companies?: CompanyInfo[], sessionToken?: string) => void
  logout: () => void
  switchCompany: (tenant: Tenant) => void
  setPendingImportFile: (file: File | null) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentView: 'cover',
      user: null,
      tenant: null,
      companies: [],
      dateFilter: { type: 'all' },
      searchQuery: '',
      sidebarOpen: true,
      isAuthenticated: false,
      pendingImportFile: null,
      sessionToken: null,

      setView: (view) => set({ currentView: view }),
      setUser: (user) => set({ user }),
      setTenant: (tenant) => set({ tenant }),
      setCompanies: (companies) => set({ companies }),
      setDateFilter: (dateFilter) => set({ dateFilter }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      login: (user, tenant, companies = [], sessionToken) => {
        // ALWAYS show company selector after login — user must explicitly choose
        // This prevents data from different companies getting mixed up
        const targetView = companies.length > 0 ? 'company-select' : 'company-select'
        set({ user, tenant, companies, isAuthenticated: true, currentView: targetView, sessionToken: sessionToken || null })
      },
      logout: () =>
        set({
          user: null,
          tenant: null,
          companies: [],
          isAuthenticated: false,
          currentView: 'cover',
          dateFilter: { type: 'all' },
          searchQuery: '',
          sessionToken: null,
        }),
      switchCompany: (tenant) =>
        // v6.28.22: CRITICAL FIX — use shallow merge but Zustand's `set` with
        // a function form creates a NEW state object on every call. The
        // `persist` middleware then re-serializes and writes to localStorage.
        // This triggers `onRehydrateStorage` which sets currentView to
        // 'company-select', which triggers a re-render, which calls
        // switchCompany again... infinite loop.
        //
        // FIX: Only update if the tenant ID actually changed.
        set((state) => {
          if (state.tenant?.id === tenant.id) {
            // Same tenant — just update currentView, don't create new tenant object
            return { currentView: 'dashboard' as const }
          }
          return {
            tenant: state.tenant
              ? { ...state.tenant, ...tenant }
              : tenant,
            currentView: 'dashboard' as const,
          }
        }),
      setPendingImportFile: (file) =>
        set({ pendingImportFile: file }),
    }),
    {
      name: 'bizbook-auth',
      partialize: (state) => ({
        user: state.user,
        tenant: state.tenant,
        companies: state.companies,
        isAuthenticated: state.isAuthenticated,
        sessionToken: state.sessionToken,  // persist token so it survives page reloads
        // v6.28.22: DO persist currentView — removing onRehydrateStorage means
        // we need to remember which view the user was on.
        currentView: state.currentView,
      }),
      // v6.28.22: Removed onRehydrateStorage that forced currentView to
      // 'company-select'. This was causing an infinite loop:
      //   1. switchCompany sets currentView='dashboard' + new tenant object
      //   2. persist middleware writes to localStorage
      //   3. onRehydrateStorage fires, sets currentView='company-select'
      //   4. ModuleRouter re-renders, shows CompanySelectPage
      //   5. User clicks company → switchCompany → loop
      // Now we let the persisted state determine currentView naturally.
      // If the user was on 'dashboard' before refresh, they stay on 'dashboard'.
    }
  )
)

export function canEdit(role: UserRole): boolean {
  return role === 'DATA_ENTRY' || role === 'JUNIOR_ADMIN' || role === 'MAIN_ADMIN'
}

export function canCorrect(role: UserRole): boolean {
  return role === 'JUNIOR_ADMIN' || role === 'MAIN_ADMIN'
}

export function canManage(role: UserRole): boolean {
  return role === 'MAIN_ADMIN'
}

export function getRoleLabel(role: UserRole): string {
  switch (role) {
    case 'VIEW_ONLY': return 'View Only'
    case 'DATA_ENTRY': return 'Data Entry'
    case 'JUNIOR_ADMIN': return 'Junior Admin'
    case 'MAIN_ADMIN': return 'Main Admin'
    case 'SUPER_ADMIN': return 'Super Admin'
  }
}
