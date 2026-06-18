'use client'

/**
 * Subscription Usage Tracker
 *
 * Tracks active usage time and periodically deducts seconds from the
 * tenant's subscription. Called every 60 seconds while the user is active.
 *
 * Per user requirement: "If someone is taking a plan, their usage should
 * decrease — it keeps showing 100 out of 100. That bug needs to be fixed."
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app-store'
import { authFetch } from '@/lib/auth-fetch'

export function useSubscriptionUsageTracker() {
  const { isAuthenticated, tenant, user } = useAppStore()
  const lastDeductionRef = useRef<number>(Date.now())

  useEffect(() => {
    if (!isAuthenticated || !tenant?.id || !user) return

    // Deduct 60 seconds every 60 seconds (1 minute) while user is active
    const TRACKING_INTERVAL = 60 * 1000 // 1 minute
    const SECONDS_PER_INTERVAL = 60 // 60 seconds used per minute

    const trackUsage = async () => {
      // Only track for non-VIEW_ONLY users
      if (user.role === 'VIEW_ONLY') return

      const now = Date.now()
      const elapsed = Math.floor((now - lastDeductionRef.current) / 1000)

      // Only deduct if at least 55 seconds have passed (avoid double-counting)
      if (elapsed < 55) return

      const secondsToDeduct = Math.min(elapsed, 120) // Cap at 2 minutes per deduction
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
        console.log(`[USAGE] Deducted ${secondsToDeduct}s from subscription`)
      } catch (err) {
        // Silent fail — usage tracking is non-critical
        console.warn('[USAGE] Failed to track usage:', err)
      }
    }

    // Track immediately on mount
    trackUsage()

    // Then track every minute
    const interval = setInterval(trackUsage, TRACKING_INTERVAL)

    return () => clearInterval(interval)
  }, [isAuthenticated, tenant?.id, user])
}
