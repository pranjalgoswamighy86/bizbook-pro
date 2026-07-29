'use client';

/**
 * SW Update Modal — v6.28.23 COMPLETELY DISABLED
 * =================================================
 * 
 * The service worker was causing infinite reload loops. The self-destruct
 * SW would unregister itself, then this component would re-register it
 * on the next page load, then it would self-destruct again → infinite loop.
 * 
 * FIX: Do NOT register any service worker at all. The browser's native
 * HTTP cache is sufficient. PWA/offline features are disabled until the
 * React Error #310 issue is fully resolved.
 * 
 * This component is kept in the codebase (it's imported in layout.tsx)
 * but renders null and does nothing.
 */

export function SWUpdateModal() {
  // v6.28.23: Do NOT register any service worker.
  // If a stale SW exists from a previous version, it will eventually
  // be cleaned up by the browser's natural lifecycle. We can't force
  // unregister from here because that requires the SW to be active.
  //
  // Users who have a stale SW should:
  //   1. Open DevTools → Application → Service Workers → Unregister
  //   2. Or clear all site data: DevTools → Application → Clear storage
  //   3. Or use incognito/private browsing mode (no SW)

  return null;
}
