'use client'

/**
 * TopBrandingBar — Sticky Top Header (Spec Part 4)
 * -----------------------------------------------
 * v4.43 UPDATE.pdf A6 + crash fix:
 *   - Mobile: hamburger menu (sidebar drawer)
 *   - "Download Desktop" button: ONLY on desktop (isMobile guard + hidden md:flex)
 *   - FIXED v4.39 bug: 'isDesktop is not defined' was caused by typo.
 *     Now uses `!isMobile` consistently (single source of truth).
 *
 * Layout (left to right):
 *   [MOBILE: hamburger] [Tenant name] <flex spacer> [Download Desktop (DESKTOP ONLY)] [Subscription] [User name + role] [Logout]
 */

import { useAppStore, getRoleLabel } from '@/store/app-store'
import { LogOut, Crown, Sparkles, Download, TrendingUp, Menu } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { Button } from '@/components/ui/button'

interface SubscriptionInfo {
  planName: string
  remainingHours: number
  remainingMinutes: number
  isFreeTier: boolean
  status: string
}

export function TopBrandingBar() {
  const { user, tenant, logout, setView, sidebarOpen, setSidebarOpen } = useAppStore()
  const router = useRouter()
  const [subInfo, setSubInfo] = useState<SubscriptionInfo | null>(null)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile screen size — used to show hamburger menu + hide desktop-only buttons
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 900)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // PWA install prompt — "Download Desktop" button
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
    const interval = setInterval(fetchSub, 60000)
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

  const remainingHours = subInfo?.remainingHours ?? 0
  const remainingMinutes = subInfo?.remainingMinutes ?? 0
  const isLow = remainingHours < 10 && subInfo?.isFreeTier
  const planLabel = subInfo?.isFreeTier ? 'FREE Tier' : (subInfo?.planName || 'FREE Tier')

  return (
    <header
      className="h-14 w-full bg-white border-b border-slate-200 flex items-center justify-between px-3 sm:px-6 sticky top-0 z-40 shrink-0"
      role="banner"
    >
      {/* ============= LEFT ZONE: Mobile hamburger + Tenant Name ============= */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Mobile-only hamburger menu — opens sidebar drawer */}
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="flex-shrink-0 h-9 w-9 -ml-1"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <span className="text-sm sm:text-base font-bold text-slate-800 tracking-tight truncate max-w-[120px] sm:max-w-[250px]">
          {tenant?.name || 'BizBook Pro'}
        </span>
      </div>

      {/* ============= CENTER ZONE: Clean Whitespace ============= */}
      <div className="flex-1 hidden md:block" aria-hidden="true" />

      {/* ============= RIGHT ZONE: Download Desktop (DESKTOP ONLY) + Subscription + Profile + Logout ============= */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* v4.43 UPDATE.pdf A6: Download Desktop button — ONLY on desktop browsing
            Uses !isMobile guard (defense-in-depth) PLUS hidden md:flex CSS. */}
        {!isMobile && (
          <button
            onClick={deferredPrompt ? handleInstall : () => {
              alert('To install BizBook Pro as a desktop app:\n\nChrome/Edge: Click the install icon (⊕) in the address bar\nFirefox: Menu → Install this site as an app\n\nOr use Chrome/Edge for best PWA support.')
            }}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold text-[11px] rounded-xl transition-all cursor-pointer"
            title="Install BizBook Pro as a desktop app"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Download Desktop</span>
          </button>
        )}

        {/* Subscription Badge */}
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
          <span className="text-[10px] sm:text-[11px] text-slate-600 font-bold whitespace-nowrap">
            <span className="sm:hidden">{remainingHours}h{remainingMinutes > 0 ? ` ${remainingMinutes}m` : ''}</span>
            <span className="hidden sm:inline">{remainingHours}h {remainingMinutes}m left</span>
          </span>
        </button>

        {/* Vertical divider */}
        <div className="h-5 w-px bg-slate-200 hidden sm:block" aria-hidden="true" />

        {/* User Profile Block */}
        <div className="hidden sm:flex flex-col text-right min-w-0" title={`Tenant: ${tenant?.name || 'Unknown'}`}>
          <span className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight truncate max-w-[120px] sm:max-w-[180px]">
            {user?.name || 'Loading...'}
          </span>
          <span className="text-[9px] sm:text-[10px] font-medium text-slate-400 uppercase tracking-wider">
            {user?.role ? getRoleLabel(user.role) : 'MAIN_ADMIN'}
          </span>
        </div>

        {/* Logout Icon Button */}
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
