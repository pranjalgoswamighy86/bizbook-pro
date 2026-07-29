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
  // v6.28.13: Use individual selectors to prevent cascading re-renders
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  const tenantId = useAppStore((s) => s.tenant?.id)
  const userRole = useAppStore((s) => s.user?.role)
  const lastDeductionRef = useRef<number>(Date.now())

  useEffect(() => {
    if (!isAuthenticated || !tenantId || !userRole) return

    const TRACKING_INTERVAL = 5 * 60 * 1000

    const trackUsage = async () => {
      if (userRole === 'VIEW_ONLY') return
      if (document.visibilityState === 'hidden') return
      if (!navigator.onLine) return

      const now = Date.now()
      const elapsed = Math.floor((now - lastDeductionRef.current) / 1000)
      if (elapsed < 240) return

      const secondsToDeduct = Math.min(elapsed, 600)
      lastDeductionRef.current = now

      try {
        await authFetch('/api/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'log-usage',
            tenantId: tenantId,
            secondsUsed: secondsToDeduct,
            userRole: userRole,
          }),
        })
      } catch (err) {
        // Silent fail — usage tracking is non-critical
      }
    }

    const initialDelay = Math.floor(Math.random() * 30000)
    const initialTimer = setTimeout(trackUsage, initialDelay)
    const interval = setInterval(trackUsage, TRACKING_INTERVAL)

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
  }, [isAuthenticated, tenantId, userRole])
}

