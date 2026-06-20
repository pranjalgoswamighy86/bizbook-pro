/**
 * Service Worker — BizBook Pro PWA
 * =================================
 * Spec Section 19 + 20: PWA Architecture + Update Interceptor
 *
 * Features:
 *   1. Network-first caching strategy (always fetch fresh when online)
 *   2. Cache fallback for offline (app shell + static assets)
 *   3. SKIP_WAITING message handler for instant updates
 *   4. Cache versioning — auto-cleanup of old caches
 *
 * REGISTER FROM: src/app/layout.tsx (or page.tsx client component)
 *
 * UPDATE MODAL: src/components/app/sw-update-modal.tsx
 *   - Listens for updatefound event
 *   - Shows "🔒 Critical Security & Version Update Available" modal
 *   - User clicks "Update & Relaunch App" → postMessage SKIP_WAITING
 *   - On controllerchange → window.location.reload()
 */

const CACHE_VERSION = 'bizbook-pro-v4.48-2026-06-20';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Assets to pre-cache on install (app shell)
const PRE_CACHE_URLS = [
  '/',
  '/dashboard',
  '/tahigo-logo.png',
  '/bizbook-pro-logo.png',
  '/logo.png',
  '/manifest.json',
  '/favicon.png',
];

// ---------- Install: pre-cache app shell ----------
self.addEventListener('install', (event) => {
  console.log('[SW] Install — version', CACHE_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Cache individually so one failure doesn't block all
      return Promise.allSettled(
        PRE_CACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Pre-cache failed for ${url}:`, err.message);
          })
        )
      );
    })
  );
  // v4.48: Force skipWaiting — critical updates need to activate immediately
  // Previous behavior waited for user to click "Update" in modal, which led to
  // stale JS bundles causing "Invalid action" errors when API contract changed.
  self.skipWaiting();
});

// ---------- Activate: cleanup old caches ----------
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate — version', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !name.startsWith(CACHE_VERSION))
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// ---------- Fetch: network-first with cache fallback ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and external requests
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Skip API requests — always go to network (don't cache auth POST etc)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first strategy
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Clone the response — one to return, one to cache
        const responseClone = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => {
          cache.put(request, responseClone).catch(() => {
            // Ignore cache write errors
          });
        });
        return response;
      })
      .catch(() => {
        // Network failed — try cache
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // If navigating to a page and offline, serve cached root
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      })
  );
});

// ---------- Message handler: SKIP_WAITING for instant update ----------
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Skipping waiting — taking control immediately');
    self.skipWaiting();
  }
});

// ---------- Notification click (basic PWA notification support) ----------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('/');
    })
  );
});

console.log('[SW] BizBook Pro Service Worker loaded — version', CACHE_VERSION);
