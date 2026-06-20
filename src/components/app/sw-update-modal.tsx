'use client';

/**
 * SW Update Modal — Spec Section 20
 * =================================
 * PWA Lifecycle Service Worker Update Interceptor & Security Warning Modal
 *
 * When a new production build is deployed:
 *   1. Browser detects new SW in background
 *   2. SW goes into 'installed' state but 'waiting' (doesn't activate)
 *   3. This component shows: "🔒 Critical Security & Version Update Available"
 *   4. User clicks "Update & Relaunch App"
 *      → postMessage({ type: 'SKIP_WAITING' }) to waiting SW
 *      → On controllerchange → window.location.reload()
 *   5. Or user clicks "Cancel / Maybe Later" → modal dismisses
 *
 * SESSION PRESERVATION:
 *   - JWT cookie is HTTP-only and persists across reload
 *   - User stays logged in after update
 *
 * MOUNT: in src/app/layout.tsx as a global component (always present)
 */

import { useState, useEffect } from 'react';

export function SWUpdateModal() {
  const [showModal, setShowModal] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    let mounted = true;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });

        console.log('[SW-UPDATE] Service Worker registered', registration.scope);

        // Check if there's already a waiting worker
        if (registration.waiting) {
          setWaitingWorker(registration.waiting);
          setShowModal(true);
        }

        // Listen for new updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          console.log('[SW-UPDATE] Update found — new worker installing');

          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // New version installed, old version still controlling
              console.log('[SW-UPDATE] New version ready — showing modal');
              if (mounted) {
                setWaitingWorker(newWorker);
                setShowModal(true);
              }
            }
          });
        });

        // Listen for controller change (after SKIP_WAITING)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('[SW-UPDATE] Controller changed — reloading');
          if (mounted && !isUpdating) {
            setIsUpdating(true);
            window.location.reload();
          }
        });

        // v4.48: Check for updates every 5 minutes (was 60 min — too slow for critical fixes)
        // Also check immediately on mount (catches updates that happened while tab was closed)
        registration.update().catch(() => {});
        setInterval(() => {
          registration.update().catch(() => {
            // Silent fail — updates are best-effort
          });
        }, 5 * 60 * 1000);
      } catch (err) {
        console.warn('[SW-UPDATE] Registration failed:', err);
      }
    };

    registerSW();

    return () => {
      mounted = false;
    };
  }, []);

  const handleUpdateNow = () => {
    if (!waitingWorker) return;
    console.log('[SW-UPDATE] User clicked Update Now — sending SKIP_WAITING');
    setIsUpdating(true);
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    // controllerchange event will trigger reload
  };

  const handleCancel = () => {
    setShowModal(false);
    // Don't dismiss forever — show again on next page load if SW still waiting
  };

  if (!showModal) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md flex items-center justify-center z-[9999] p-4">
      <div className="bg-white border border-slate-100 max-w-md w-full rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in duration-200 text-left">
        {/* Modal Header Badge */}
        <div className="flex items-center gap-2 text-amber-600 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200 w-fit text-xs font-black uppercase tracking-wider">
          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          Update Available
        </div>

        {/* Warning Title */}
        <h3 className="text-xl font-extrabold text-slate-800 mt-4 tracking-tight">
          🔒 Critical Security &amp; Version Update Available
        </h3>

        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          A new verified system update is ready for BizBook Pro.
        </p>

        {/* Warning Body */}
        <div className="mt-3 text-xs text-slate-500 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-2">
          <p className="font-semibold text-slate-700">
            Important Compliance Notice:
          </p>
          <p>
            Remaining on an outdated software build can cause compatibility issues
            with backend ledger databases, data synchronization errors across devices,
            or security vulnerabilities in your local tax reporting modules.
          </p>
          <p className="text-amber-800 font-bold">
            Highly Recommended Action: Update immediately to preserve structural
            accounting compliance.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={handleCancel}
            disabled={isUpdating}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer border border-slate-200 disabled:opacity-50"
          >
            Cancel / Maybe Later
          </button>

          <button
            onClick={handleUpdateNow}
            disabled={isUpdating}
            className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md shadow-slate-900/20 disabled:opacity-50"
          >
            {isUpdating ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Updating...
              </span>
            ) : (
              'Update &amp; Relaunch App'
            )}
          </button>
        </div>

        {/* Session preservation note */}
        <p className="text-[10px] text-slate-400 text-center mt-3">
          Your session will be preserved — you won&apos;t be logged out.
        </p>
      </div>
    </div>
  );
}
