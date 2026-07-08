'use client'

/**
 * MenuActionBridge — Global Electron Menu Bridge (v6.16)
 * =====================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * Previous versions registered the Electron menu-action handler inside
 * `src/app/app/page.tsx` inside a `useEffect` that was gated by
 * `isAuthenticated === true`. This had three compounding bugs:
 *
 *   1. Menu clicks on the login screen / company-select screen were
 *      silently dropped (handler not registered yet).
 *   2. The `__bizbookMenuAction` global was deleted on every re-render,
 *      creating a race with Electron's `executeJavaScript` fallback.
 *   3. The IPC listener (`electronAPI.onMenuAction`) was never cleaned
 *      up, so multiple listeners accumulated over time.
 *
 * This component fixes all three by:
 *   - Mounting ONCE in the root layout (always present, every page).
 *   - Registering the global `__bizbookMenuAction` immediately on mount
 *     and NEVER deleting it.
 *   - Subscribing to the IPC channel exactly once.
 *   - Queueing actions that arrive before the user is authenticated,
 *     then replaying them once authentication completes.
 *
 * The component renders nothing — it is a pure side-effect bridge.
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'

export function MenuActionBridge() {
  const setView = useAppStore((s) => s.setView)
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  const currentView = useAppStore((s) => s.currentView)
  const { toast } = useToast()

  // Keep latest values in refs so the registered callbacks always see
  // fresh state without needing to re-register (which would leak listeners).
  const stateRef = useRef({ isAuthenticated, setView, currentView, toast })
  stateRef.current = { isAuthenticated, setView, currentView, toast }

  // Pending actions received before the app was ready to handle them.
  const pendingRef = useRef<string[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const processAction = (action: string) => {
      const { isAuthenticated, setView, currentView, toast } = stateRef.current

      // Not authenticated yet — queue for replay once user logs in.
      // This covers the case where the user clicks a menu item on the
      // login screen (Electron menu is always visible at the top).
      if (!isAuthenticated) {
        pendingRef.current.push(action)
        console.log('[MenuBridge] Queued (not authenticated):', action)
        return
      }

      // On the company-select screen — ignore navigation; the user must
      // pick a company first.
      if (currentView === 'company-select') {
        toast({
          title: 'Select a company first',
          description: 'Please choose a company before using menu shortcuts.',
        })
        return
      }

      switch (action) {
        case 'new-sale':
          setView('sales')
          break
        case 'new-purchase':
          setView('purchases')
          break
        case 'export-backup':
          setView('backup')
          break
        case 'navigate-dashboard':
          setView('dashboard')
          break
        case 'navigate-sales':
          setView('sales')
          break
        case 'navigate-purchases':
          setView('purchases')
          break
        case 'navigate-inventory':
          setView('inventory')
          break
        case 'navigate-gst':
          setView('gst-reports')
          break
        case 'help-chat':
          setView('help-support-management')
          break
        case 'check-updates':
          toast({
            title: 'Updates',
            description: 'BizBook Pro updates automatically when you restart the app.',
          })
          break
        default:
          console.warn('[MenuBridge] Unknown action:', action)
      }
    }

    // ---- Register the global handler (Electron executeJavaScript fallback) ----
    // This is set ONCE and never deleted, so Electron's main process can
    // always reach it via `webContents.executeJavaScript("window.__bizbookMenuAction('...')")`.
    ;(window as any).__bizbookMenuAction = processAction

    // ---- Process any actions queued by Electron before this bridge mounted ----
    // Electron's main.ts pushes to `window.__pendingMenuActions` when the
    // handler isn't ready yet. Drain that queue now.
    const pending = (window as any).__pendingMenuActions as string[] | undefined
    if (pending && pending.length > 0) {
      console.log(`[MenuBridge] Draining ${pending.length} pending action(s)`)
      pending.forEach(processAction)
      ;(window as any).__pendingMenuActions = []
    }

    // ---- Subscribe to the IPC channel (primary method) ----
    // v2.3.0: onMenuAction now returns an unsubscribe function so we can
    // cleanly detach. The effect runs exactly once on mount (empty deps),
    // so this listener lives for the entire page lifetime — but we still
    // return the unsubscribe in case React strict-mode double-invokes.
    const electronAPI = (window as any).electron
    let unsubscribe: (() => void) | undefined
    if (electronAPI?.onMenuAction) {
      unsubscribe = electronAPI.onMenuAction((action: string) => {
        console.log('[MenuBridge] IPC action:', action)
        processAction(action)
      })
    }

    // No cleanup of `__bizbookMenuAction` — it must persist for the entire
    // page lifetime. Deleting it would recreate the original bug.
    // We DO unsubscribe the IPC listener on unmount (mainly for strict mode).
    return () => {
      if (unsubscribe) {
        try { unsubscribe() } catch {}
      }
    }
  }, [])

  // ---- Replay queued actions once the user authenticates ----
  useEffect(() => {
    if (!isAuthenticated) return
    if (pendingRef.current.length === 0) return

    const queued = pendingRef.current.splice(0)
    console.log(`[MenuBridge] Replaying ${queued.length} queued action(s) after auth`)
    queued.forEach((action) => {
      const { setView, currentView, toast } = stateRef.current
      if (currentView === 'company-select') return // still not ready
      switch (action) {
        case 'new-sale': setView('sales'); break
        case 'new-purchase': setView('purchases'); break
        case 'export-backup': setView('backup'); break
        case 'navigate-dashboard': setView('dashboard'); break
        case 'navigate-sales': setView('sales'); break
        case 'navigate-purchases': setView('purchases'); break
        case 'navigate-inventory': setView('inventory'); break
        case 'navigate-gst': setView('gst-reports'); break
        case 'help-chat': setView('help-support-management'); break
      }
    })
  }, [isAuthenticated])

  // Renders nothing — pure side-effect component.
  return null
}
