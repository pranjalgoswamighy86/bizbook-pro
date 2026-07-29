/**
 * Service Worker — BizBook Pro (v6.28.23 — NO-OP)
 * =================================================================
 * 
 * This file exists ONLY to replace any previously-installed service worker.
 * It does nothing — no caching, no fetch interception, no self-destruct.
 * 
 * The sw-update-modal.tsx no longer registers any service worker, so
 * this file will never be loaded by new users. It only exists so that
 * browsers with a previously-installed SW will detect a "change" in
 * this file and update to the no-op version.
 * 
 * Once the no-op SW activates, it does nothing and gets out of the way.
 */

self.addEventListener('install', (event) => {
  console.log('[SW v6.28.23] No-op install');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW v6.28.23] No-op activate — deleting all caches');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(cacheNames.map((name) => caches.delete(name)));
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Do NOT intercept any fetch requests
self.addEventListener('fetch', () => {});

console.log('[SW v6.28.23] No-op Service Worker loaded');
