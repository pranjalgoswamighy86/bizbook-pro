'use client'

/**
 * Subscription Usage Tracker (v4.55 — optimized for 1000+ users)
 * =================================================================
 * v4.55: Increased interval from 60s → 300s (5 min) to reduce server load
 *   by 5x. With 1000 users, this reduces usage-tracking requests from
 *   1000/min to 200/min — frees up capacity for actual business operations.
 *   Each request now deducts 300s (5 min) instead of 60s (1 min).
 *
 *   Also added:
 *   - Page visibility check (don't track when tab is in background)
 *   - Network offline check (skip if no internet)
 *   - Jitter (random 0-30s offset) to spread requests evenly over time
 *     (prevents all 1000 users from hitting the server at the same second)
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app-store'
import { authFetch } from '@/lib/auth-fetch'

export function useSubscriptionUsageTracker() {
  const { isAuthenticated, tenant, user } = useAppStore()
  const lastDeductionRef = useRef<number>(Date.now())

  useEffect(() => {
    if (!isAuthenticated || !tenant?.id || !user) return

    // v4.55: 5-minute interval (was 1 minute) — 5x less server load
    const TRACKING_INTERVAL = 5 * 60 * 1000 // 5 minutes
    const SECONDS_PER_INTERVAL = 300 // 5 minutes = 300 seconds

    const trackUsage = async () => {
      // Only track for non-VIEW_ONLY users
      if (user.role === 'VIEW_ONLY') return

      // v4.55: Skip if tab is in background (user not actually using app)
      if (document.visibilityState === 'hidden') return

      // v4.55: Skip if offline (avoid error spam)
      if (!navigator.onLine) return

      const now = Date.now()
      const elapsed = Math.floor((now - lastDeductionRef.current) / 1000)

      // v4.55: Only deduct if at least 4 minutes have passed (was 55s)
      if (elapsed < 240) return

      const secondsToDeduct = Math.min(elapsed, 600) // Cap at 10 minutes per deduction
      lastDeductionRef.current = now

      try {
        await authFetch('/api/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'log-usage',
            tenantId: tenant.id,
            secondsUsed: secondsToDeduct,
            userRole: user.role,
          }),
        })
      } catch (err) {
        // Silent fail — usage tracking is non-critical
      }
    }

    // v4.55: Add random jitter (0-30s) before first track
    // This spreads 1000 users' requests across 30 seconds instead of all hitting at once
    const initialDelay = Math.floor(Math.random() * 30000)
    const initialTimer = setTimeout(trackUsage, initialDelay)

    // Then track every 5 minutes
    const interval = setInterval(trackUsage, TRACKING_INTERVAL)

    // v4.55: Track immediately when user switches back to tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Math.floor((Date.now() - lastDeductionRef.current) / 1000)
        if (elapsed >= 240) trackUsage()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isAuthenticated, tenant?.id, user])
}

