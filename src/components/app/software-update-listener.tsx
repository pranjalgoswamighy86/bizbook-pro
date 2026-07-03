'use client'

/**
 * Software Update Service Listener
 *
 * Per spec: "PWA Lifecycle Service Worker Update Interceptor & Security Warning Modal"
 *
 * Detects when a new production build is deployed and shows a security
 * warning modal asking the user to update. The user can choose:
 *   - "Update & Relaunch App" → skips waiting SW, reloads page
 *   - "Cancel / Maybe Later" → dismisses modal, continues on old version
 *
 * Session persistence: JWT tokens and localStorage auth state are
 * automatically retained during reload (they're in cookies + localStorage,
 * not in the service worker cache).
 */

import { useState, useEffect } from 'react'

export function SoftwareUpdateServiceListener() {
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    // Check if a service worker is already registered
    navigator.serviceWorker.ready.then((registration) => {
      // If a new worker is already waiting, show the modal
      if (registration.waiting) {
        setWaitingWorker(registration.waiting)
        setShowUpdateModal(true)
      }

      // Listen for future updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setWaitingWorker(newWorker)
              setShowUpdateModal(true)
            }
          })
        }
      })
    })

    // Listen for controller change (after SKIP_WAITING)
    const handleControllerChange = () => {
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
    }
  }, [])

  const executeSystemCoreUpdate = () => {
    if (waitingWorker) {
      // Send SKIP_WAITING message to the waiting service worker
      waitingWorker.postMessage({ type: 'SKIP_WAITING' })
      // The controllerchange listener will reload the page
    } else {
      // No waiting worker — just reload
      window.location.reload()
    }
  }

  if (!showUpdateModal) return null

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md flex items-center justify-center z-[9999] p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 max-w-md w-full rounded-2xl p-6 shadow-2xl text-left">
        
        {/* Modal Header Badge */}
        <div className="flex items-center gap-2 text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 rounded-xl border border-amber-200 dark:border-amber-800 w-fit text-xs font-black uppercase tracking-wider">
          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          Update Available
        </div>

        {/* Warning Copy */}
        <h3 className="text-xl font-extrabold text-slate-800 dark:text-slate-100 mt-4 tracking-tight">
          🔒 Critical Security & Version Update Available
        </h3>
        
        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700 space-y-2">
          <p className="font-semibold text-slate-700 dark:text-slate-300">
            A new verified system update is ready for BizBook Pro.
          </p>
          <p>
            <strong>Important Compliance Notice:</strong> Remaining on an outdated software build can cause
            compatibility issues with backend ledger databases, data synchronization errors across devices,
            or security vulnerabilities in your local tax reporting modules.
          </p>
          <p className="text-amber-800 dark:text-amber-300 font-bold">
            Highly Recommended: Update immediately to preserve structural accounting compliance.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 mt-6">
          {/* Cancel */}
          <button
            onClick={() => setShowUpdateModal(false)}
            className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
          >
            Cancel / Maybe Later
          </button>
          
          {/* Update Now */}
          <button
            onClick={executeSystemCoreUpdate}
            className="flex-1 py-2.5 bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md shadow-slate-900/20"
          >
            Update & Relaunch App
          </button>
        </div>
      </div>
    </div>
  )
}
