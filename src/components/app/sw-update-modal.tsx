'use client';

/**
 * SW Update Modal — v6.28.22 SELF-DESTRUCT MODE
 * ==============================================
 * 
 * This component now ONLY registers the self-destruct service worker
 * and reloads the page when it activates. No modal is shown.
 * 
 * The self-destruct SW will:
 *   1. Delete ALL caches
 *   2. Unregister itself
 *   3. Notify the client to reload
 * 
 * After reload, no service worker will be active. The browser will
 * use its native HTTP cache only, eliminating the SW as a variable
 * in the React Error #310 debugging.
 */

import { useEffect } from 'react';

export function SWUpdateModal() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    let mounted = true;

    const registerSelfDestructSW = async () => {
      try {
        // Register the self-destruct SW
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });

        console.log('[SW-UPDATE] Self-destruct SW registered');

        // Auto-activate if waiting
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        // Listen for new SW installations
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Listen for controller change — reload to get fresh code
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (mounted) {
            window.location.reload();
          }
        });

        // Listen for self-destruct message
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'SW_SELF_DESTRUCTED') {
            console.log('[SW-UPDATE] SW self-destructed — reloading');
            if (mounted) {
              window.location.reload();
            }
          }
        });

        // Check for updates immediately
        registration.update().catch(() => {});
      } catch (err) {
        console.warn('[SW-UPDATE] Registration failed:', err);
      }
    };

    registerSelfDestructSW();

    return () => {
      mounted = false;
    };
  }, []);

  // Render nothing — no modal
  return null;
}
