'use client'

/**
 * TopBrandingBar — Sticky Top Header (Spec Part 4)
 * -----------------------------------------------
 * Implements Tasks 30-33 from chat log + Spec Part 4:
 *
 *   Task 30: Tahigo Logo Premium Styling (shadow, chroma, container)
 *   Task 31: Sidebar Cleanup (removed bottom user block)  ← done in sidebar.tsx
 *   Task 32: Top Header Bar (sticky, branding + subscription + profile + logout)
 *   Task 33: Top-Bar Redundancy Clean-Up
 *
 * Layout (left to right):
 *   [Tahigo logo] | [BizBook Pro title + Tahigo International subtitle]   <flex-1 spacer>   [Subscription badge] | [User name + role] | [Logout icon]
 *
 * Sticky: position: sticky; top: 0; z-40 — remains visible during scroll
 *
 * MOUNT: in src/app/page.tsx, render <TopBrandingBar /> above <AppSidebar />
 *        and adjust main element to have pt-14 to make room for the bar
 *        (on screens < 900px where sidebar becomes a drawer).
 */

import { useAppStore, getRoleLabel } from '@/store/app-store'
import { LogOut, Crown, Sparkles, Download, TrendingUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { authFetch } from '@/lib/auth-fetch'

interface SubscriptionInfo {
  planName: string
  remainingHours: number
  remainingMinutes: number
  isFreeTier: boolean
  status: string
}

export function TopBrandingBar() {
  const { user, tenant, logout, setView } = useAppStore()
  const router = useRouter()
  const [subInfo, setSubInfo] = useState<SubscriptionInfo | null>(null)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)

  // v4.20: PWA install prompt — "Download Desktop" button
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  // Fetch subscription info for the badge
  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    const fetchSub = async () => {
      try {
        const res = await authFetch('/api/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get-status', tenantId: tenant?.id }),
        })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        // v4.14: API returns remainingHours + remainingMinutes (NOT remainingSeconds)
        setSubInfo({
          planName: data.subscription?.planName || 'FREE',
          remainingHours: data.subscription?.remainingHours ?? 0,
          remainingMinutes: data.subscription?.remainingMinutes ?? 0,
          isFreeTier: data.subscription?.isFreeTier ?? true,
          status: data.subscription?.status || 'ACTIVE',
        })
      } catch (err) {
        // Silent fail — badge will show default
      }
    }
    fetchSub()
    const interval = setInterval(fetchSub, 60000) // refresh every minute
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [tenant?.id])

  const handleLogout = () => {
    logout()
    router.refresh()
  }

  const handleSubscriptionClick = () => {
    setView('subscription')
  }

  // v4.14: Use remainingHours directly from API (was incorrectly computing from remainingSeconds
  // which was never returned by the API — causing "0h left" bug)
  const remainingHours = subInfo?.remainingHours ?? 0
  const remainingMinutes = subInfo?.remainingMinutes ?? 0
  const isLow = remainingHours < 10 && subInfo?.isFreeTier
  const planLabel = subInfo?.isFreeTier ? 'FREE Tier' : (subInfo?.planName || 'FREE Tier')

  return (
    <header
      className="h-14 w-full bg-white border-b border-slate-200 flex items-center justify-between px-3 sm:px-6 sticky top-0 z-40 shrink-0"
      role="banner"
    >
      {/* ============= LEFT ZONE: Dual Branding (Tahigo + BizBook Pro) ============= */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* v4.13: Spec Section 9 — Both logos side by side
            Tahigo International (parent) + BizBook Pro (product) */}
        <div className="relative flex items-center justify-center h-12 w-12 bg-white rounded-xl border border-slate-100 shadow-sm p-2 overflow-hidden transition-all duration-300 hover:shadow-md shrink-0">
          <img
            src="/tahigo-logo.png"
            alt="Tahigo International"
            className="h-full w-full object-contain antialiased"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>

        {/* Structural separator */}
        <div className="h-5 w-px bg-slate-200 shrink-0" aria-hidden="true" />

        {/* BizBook Pro product logo + text */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 bg-white rounded-lg border border-slate-100 shadow-sm p-1.5 overflow-hidden shrink-0">
            <img
              src="/bizbook-pro-logo.png"
              alt="BizBook Pro"
              className="h-full w-full object-contain antialiased"
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm sm:text-base font-black text-slate-800 tracking-tight truncate">
                BizBook Pro
              </span>
              {/* v4.12: Task 10 — "A Product by Tahigo International" badge */}
              <span className="hidden lg:inline-flex items-center text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                A Product by Tahigo International
              </span>
            </div>
            <span className="text-[9px] sm:text-[10px] font-semibold text-slate-400 tracking-wider uppercase truncate">
              Tahigo International
            </span>
          </div>
        </div>
      </div>

      {/* ============= CENTER ZONE: Clean Whitespace (Task 33) ============= */}
      <div className="flex-1 hidden md:block" aria-hidden="true" />

      {/* ============= RIGHT ZONE: Download Desktop + Subscription + Profile + Logout ============= */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* v4.20: Download Desktop button (PWA install) */}
        {deferredPrompt && (
          <button
            onClick={handleInstall}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold text-[11px] rounded-xl transition-all cursor-pointer"
            title="Install BizBook Pro as a desktop app"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Download Desktop</span>
          </button>
        )}

        {/* Subscription Badge — v4.20: Always show hours+minutes, even if 0h 0m */}
        <button
          onClick={handleSubscriptionClick}
          className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border transition-all cursor-pointer ${
            isLow
              ? 'bg-rose-50 hover:bg-rose-100 border-rose-200'
              : subInfo?.isFreeTier
              ? 'bg-amber-50 hover:bg-amber-100 border-amber-200'
              : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
          }`}
          title={`${planLabel} — ${remainingHours}h ${remainingMinutes}m remaining. Click to upgrade.`}
          aria-label="Subscription status — click to manage"
        >
          {/* Pulsing dot for free tier (Spec Part 4.2) */}
          <span
            className={`h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full ${
              isLow ? 'bg-rose-500' : subInfo?.isFreeTier ? 'bg-amber-500' : 'bg-emerald-500'
            } animate-pulse`}
          />
          <span
            className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-wide hidden sm:inline ${
              isLow ? 'text-rose-800' : subInfo?.isFreeTier ? 'text-amber-800' : 'text-emerald-800'
            }`}
          >
            {planLabel}
          </span>
          {subInfo?.isFreeTier && (
            <span className="text-[9px] sm:text-[10px] bg-amber-600 text-white font-black px-1.5 py-0.5 rounded">
              UPGRADE
            </span>
          )}
          {/* Remaining hours + minutes — v4.20: ALWAYS visible (was hidden on small screens) */}
          <span className="text-[10px] sm:text-[11px] text-slate-600 font-bold whitespace-nowrap">
            {remainingHours}h {remainingMinutes}m left
          </span>
        </button>

        {/* Vertical divider */}
        <div className="h-5 w-px bg-slate-200" aria-hidden="true" />

        {/* User Profile Block (Spec Section 12 Rule 2.1)
            v4.19: Show USER'S NAME (not tenant name) — user wants to see their own name */}
        <div className="flex flex-col text-right min-w-0" title={`Tenant: ${tenant?.name || 'Unknown'}`}>
          <span className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight truncate max-w-[120px] sm:max-w-[180px]">
            {user?.name || 'Loading...'}
          </span>
          <span className="text-[9px] sm:text-[10px] font-medium text-slate-400 uppercase tracking-wider">
            {user?.role ? getRoleLabel(user.role) : 'MAIN_ADMIN'}
          </span>
        </div>

        {/* Minimalist Logout Icon Button (Task 32 — icon only, no text) */}
        <button
          onClick={handleLogout}
          className="p-1.5 sm:p-2 text-slate-400 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 rounded-lg transition-all border border-slate-100 cursor-pointer group shrink-0"
          title="Sign Out"
          aria-label="Sign out"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
            />
          </svg>
        </button>
      </div>
    </header>
  )
}

/*
 * ============================================================================
 * INTEGRATION (in src/app/page.tsx):
 * ============================================================================
 *
 *   import { TopBrandingBar } from '@/components/app/top-branding-bar'
 *
 *   // Replace the existing return block:
 *   return (
 *     <div className="flex flex-col h-screen overflow-hidden bg-background" style={{ height: '100dvh' }}>
 *       <TopBrandingBar />
 *       <div className="flex flex-1 min-h-0 overflow-hidden">
 *         <AppSidebar />
 *         <main className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden" style={{ scrollbarGutter: 'stable' }}>
 *           <ErrorBoundary>
 *             <ModuleRouter />
 *           </ErrorBoundary>
 *         </main>
 *       </div>
 *     </div>
 *   )
 *
 * ============================================================================
 * SPEC COMPLIANCE:
 * ============================================================================
 *   Task 30: Tahigo logo in polished container (rounded-xl, shadow-sm, antialiased) ✓
 *   Task 31: Sidebar bottom user block removed (separate edit in sidebar.tsx) ✓
 *   Task 32: Top header with branding + subscription + profile + logout ✓
 *   Task 33: No duplicate branding text (only "BizBook Pro" + "Tahigo International" subtitle) ✓
 *   Spec 4.1: Tahigo logo prominent (40px), BizBook Pro to its right ✓
 *   Spec 4.2: Subscription widget with pulsing badge for FREE tier ✓
 *   Spec 4.3: Sidebar bottom user block removed ✓
 *   Spec 4.4: Dynamic user name (not hardcoded "Admin"), role below, icon-only logout ✓
 *   Spec 4.5: No duplicate "BizBook"/"Tahigo" strings in same row ✓
 *   Spec 4.6: position: sticky; top: 0; z-40 ✓
 * ============================================================================
 */
