/**
 * Service Worker — BizBook Pro (v6.28.22 — SELF-DESTRUCT MODE)
 * =================================================================
 * 
 * This service worker UNREGISTERS ITSELF and deletes ALL caches.
 * It does NOT intercept any fetch requests. It exists solely to
 * replace any previously-installed service worker and clean up.
 * 
 * After this SW activates:
 *   1. All caches are deleted
 *   2. The SW unregisters itself
 *   3. No future SW will be registered (sw-update-modal.tsx disabled)
 *   4. The browser uses its native HTTP cache only
 * 
 * This eliminates the service worker as a variable in debugging
 * the React Error #310 crash.
 */

const CACHE_VERSION = 'bizbook-pro-v6.28.22-self-destruct';

self.addEventListener('install', (event) => {
  console.log('[SW v6.28.22] SELF-DESTRUCT install — deleting all caches');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          console.log('[SW v6.28.22] Deleting cache:', name);
          return caches.delete(name);
        })
      );
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW v6.28.22] SELF-DESTRUCT activate — unregistering');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    }).then(() => {
      // Unregister this service worker
      return self.registration.unregister();
    }).then(() => {
      console.log('[SW v6.28.22] Service Worker unregistered. Browser will use native HTTP cache only.');
      // Notify all clients to reload
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_SELF_DESTRUCTED' });
        });
      });
    })
  );
});

// Do NOT intercept any fetch requests — let browser handle natively
self.addEventListener('fetch', () => {
  // Intentionally empty — no fetch interception
});

console.log('[SW v6.28.22] Self-destruct Service Worker loaded');
