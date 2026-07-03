'use client'

/**
 * Subscription Countdown Warning Banner
 *
 * Shows a warning banner when the user's subscription is approaching the
 * View Only conversion threshold. Warning levels (per WhatsApp spec):
 *   2Hrs, 30Min, 15Min, 10Min, 5Min, 3Min, 2Min, 1Min
 *
 * The banner appears at the top of the screen and changes color as the
 * countdown progresses:
 *   - 2Hrs / 30Min: amber (informational)
 *   - 15Min / 10Min / 5Min: orange (urgent)
 *   - 3Min / 2Min / 1Min: red (critical)
 *   - EXPIRED: dark red (account converted to View Only)
 *
 * The component polls /api/subscription every 30 seconds to check for updates.
 * When a NEW warning level is reached, it shows a toast notification in
 * addition to the banner.
 */

import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '@/store/app-store'
import { AlertTriangle, Clock, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'
import { cn } from '@/lib/utils'

interface Warning {
  label: string
  message: string
}

interface WarningResponse {
  warning: Warning | null
  remainingSeconds: number
  remainingHours?: number
  remainingMinutes?: number
  status: string
  isNewWarning: boolean
}

const WARNING_STYLES: Record<string, string> = {
  '2H':  'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-200',
  '30M': 'bg-amber-100 border-amber-400 text-amber-900 dark:bg-amber-950/70 dark:border-amber-700 dark:text-amber-100',
  '15M': 'bg-orange-100 border-orange-400 text-orange-900 dark:bg-orange-950/70 dark:border-orange-700 dark:text-orange-100',
  '10M': 'bg-orange-100 border-orange-400 text-orange-900 dark:bg-orange-950/70 dark:border-orange-700 dark:text-orange-100',
  '5M':  'bg-orange-200 border-orange-500 text-orange-900 dark:bg-orange-900/70 dark:border-orange-600 dark:text-orange-50',
  '3M':  'bg-red-100 border-red-500 text-red-900 dark:bg-red-950/70 dark:border-red-700 dark:text-red-100',
  '2M':  'bg-red-200 border-red-600 text-red-950 dark:bg-red-900/80 dark:border-red-600 dark:text-red-50',
  '1M':  'bg-red-300 border-red-700 text-red-950 dark:bg-red-900/90 dark:border-red-500 dark:text-red-50 animate-pulse',
  'EXPIRED': 'bg-red-900 border-red-800 text-white dark:bg-red-950 dark:border-red-700 dark:text-red-50',
}

export function SubscriptionCountdownWarning() {
  const { tenant, isAuthenticated, setView } = useAppStore()
  const { toast } = useToast()
  const [warning, setWarning] = useState<Warning | null>(null)
  const [remaining, setRemaining] = useState<{ hours?: number; minutes?: number; seconds: number }>({ seconds: 0 })
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [expired, setExpired] = useState(false)
  const lastWarningRef = useRef<string | null>(null)

  // Poll for warnings every 30 seconds when authenticated
  useEffect(() => {
    if (!isAuthenticated || !tenant?.id) return

    const checkWarning = async () => {
      try {
        const res = await authFetch('/api/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get-warning', tenantId: tenant.id }),
        })
        if (!res.ok) return
        const data: WarningResponse = await res.json()

        setWarning(data.warning)
        setRemaining({
          hours: data.remainingHours,
          minutes: data.remainingMinutes,
          seconds: data.remainingSeconds,
        })

        if (data.status === 'CONVERTED_TO_VIEW_ONLY') {
          setExpired(true)
        }

        // Show toast on NEW warning (not on every poll)
        if (data.isNewWarning && data.warning && data.warning.label !== lastWarningRef.current) {
          lastWarningRef.current = data.warning.label
          if (data.warning.label === 'EXPIRED') {
            toast({
              title: 'Subscription Ended',
              description: data.warning.message,
              variant: 'destructive',
              duration: 10000,
            })
          } else {
            toast({
              title: `⏰ ${data.warning.message} remaining`,
              description: 'Your subscription is about to expire. Recharge now to avoid being converted to View Only mode.',
              variant: 'destructive',
              duration: 8000,
            })
          }
        }
      } catch (e) {
        // Silent fail — don't disrupt the user
      }
    }

    // Check immediately, then every 30 seconds
    checkWarning()
    const interval = setInterval(checkWarning, 30000)
    return () => clearInterval(interval)
  }, [isAuthenticated, tenant?.id, toast])

  // Don't render if no warning OR user dismissed this specific warning level
  if (!warning) return null
  if (dismissed.has(warning.label)) return null
  if (expired && dismissed.has('EXPIRED')) return null

  const styleClass = WARNING_STYLES[warning.label] || WARNING_STYLES['2H']
  const isExpired = warning.label === 'EXPIRED'

  const handleDismiss = () => {
    setDismissed(prev => new Set(prev).add(warning.label))
  }

  const handleRecharge = () => {
    setView('subscription')
  }

  return (
    <div className={cn('fixed top-0 left-0 right-0 z-50 border-b px-4 py-2 flex items-center justify-between gap-3 shadow-md', styleClass)}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isExpired ? (
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
        ) : (
          <Clock className="h-5 w-5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {isExpired
              ? 'Subscription Ended — View Only Mode'
              : `⏰ ${warning.message} remaining`}
          </p>
          <p className="text-xs opacity-90 truncate">
            {isExpired
              ? 'Your account has been converted to View Only. Recharge to restore full access.'
              : `Your subscription expires in ${warning.message}. Recharge now to keep full access.`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {!isExpired && remaining.seconds > 0 && (
          <div className="text-xs font-mono bg-black/10 px-2 py-1 rounded">
            {String(remaining.hours || 0).padStart(2, '0')}:
            {String(remaining.minutes || 0).padStart(2, '0')}:
            {String(remaining.seconds % 60).padStart(2, '0')}
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleRecharge}
          className={cn('h-7 text-xs border-current bg-white/20 hover:bg-white/30', styleClass)}
        >
          <Zap className="h-3 w-3 mr-1" />
          Recharge
        </Button>
        <button
          onClick={handleDismiss}
          className="p-1 hover:bg-black/10 rounded"
          aria-label="Dismiss warning"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
