/**
 * Service Worker — BizBook Pro PWA (v4.155)
 * =================================
 * Spec Section 19 + 20: PWA Architecture + Update Interceptor
 *
 * v4.155 Changes:
 *   - Cache API GET responses for offline read access (network-first with cache fallback)
 *   - POST/PUT/DELETE still require network (writes can't be served from cache)
 *   - Background Sync API for queuing writes when offline (where supported)
 *   - Cache versioning — auto-cleanup of old caches
 *
 * Features:
 *   1. Network-first caching strategy (always fetch fresh when online)
 *   2. Cache fallback for offline (app shell + static assets + API GETs)
 *   3. SKIP_WAITING message handler for instant updates
 *   4. Cache versioning — auto-cleanup of old caches
 *   5. v4.155: API GET responses cached for 5 minutes (offline read access)
 *
 * REGISTER FROM: src/app/layout.tsx (or page.tsx client component)
 *
 * UPDATE MODAL: src/components/app/sw-update-modal.tsx
 */

const CACHE_VERSION = 'bizbook-pro-v5.12.0-2026-07-06';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const API_CACHE = `${CACHE_VERSION}-api`;

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

// API paths that are safe to cache for offline reads (GET only)
// Auth, OTP, backup download, and payment endpoints are NEVER cached
const CACHEABLE_API_PREFIXES = [
  '/api/sales',          // list endpoint
  '/api/purchases',      // list endpoint
  '/api/expenses',       // list endpoint
  '/api/inventory',
  '/api/parties',
  '/api/staff',
  '/api/reports',
  '/api/ledger',
  '/api/dashboard',
];

// API paths that must NEVER be cached (even GET)
const NEVER_CACHE_API_PREFIXES = [
  '/api/auth',
  '/api/backup',
  '/api/auto-backup',
  '/api/razorpay',
  '/api/einvoice',
  '/api/ai-import',
  '/api/ai-valuation',
  '/api/help-chat',
];

// Cache TTL for API responses (5 minutes)
const API_CACHE_TTL_MS = 5 * 60 * 1000;

// ---------- Install: pre-cache app shell ----------
self.addEventListener('install', (event) => {
  console.log('[SW] Install — version', CACHE_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.allSettled(
        PRE_CACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Pre-cache failed for ${url}:`, err.message);
          })
        )
      );
    })
  );
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
  self.clients.claim();
});

// ---------- Helper: check if URL is cacheable API GET ----------
function isCacheableApiGet(url, method) {
  if (method !== 'GET') return false;
  // Check never-cache list first
  for (const prefix of NEVER_CACHE_API_PREFIXES) {
    if (url.pathname.startsWith(prefix)) return false;
  }
  // Check cacheable list
  for (const prefix of CACHEABLE_API_PREFIXES) {
    if (url.pathname.startsWith(prefix)) return true;
  }
  return false;
}

// ---------- Fetch: network-first with cache fallback ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests for caching (POST/PUT/DELETE always go to network)
  if (request.method !== 'GET') return;

  // Skip chrome-extension and external requests
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // v4.182: Never cache invoice-print routes — always fetch fresh from server
  if (url.pathname.startsWith('/invoice-print/')) {
    return;
  }

  // v4.155: Cache API GET responses for offline reads
  if (url.pathname.startsWith('/api/')) {
    if (!isCacheableApiGet(url, request.method)) {
      // Non-cacheable API (auth, backup, etc.) — always network
      return;
    }

    // Network-first with cache fallback for cacheable API GETs
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache successful responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(API_CACHE).then((cache) => {
              // Add a custom header to track cache time
              const headers = new Headers(responseClone.headers);
              headers.set('X-Cached-At', String(Date.now()));
              responseClone.blob().then((body) => {
                const cachedResponse = new Response(body, {
                  status: responseClone.status,
                  statusText: responseClone.statusText,
                  headers,
                });
                cache.put(request, cachedResponse).catch(() => {});
              });
            });
          }
          return response;
        })
        .catch(() => {
          // Network failed — try API cache
          return caches.match(request).then((cached) => {
            if (cached) {
              // Check TTL
              const cachedAt = Number(cached.headers.get('X-Cached-At') || 0);
              const age = Date.now() - cachedAt;
              const isStale = age > API_CACHE_TTL_MS;
              // Return cached even if stale (better than nothing when offline)
              // Add a header to indicate staleness
              const headers = new Headers(cached.headers);
              headers.set('X-Served-From', 'offline-cache');
              headers.set('X-Cache-Age-Min', String(Math.round(age / 60000)));
              headers.set('X-Cache-Stale', isStale ? 'true' : 'false');
              return new Response(cached.body, {
                status: cached.status,
                statusText: cached.statusText,
                headers,
              });
            }
            // No cache — return offline response
            return new Response(
              JSON.stringify({
                error: 'You are offline and this data is not cached.',
                offline: true,
              }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          });
        })
    );
    return;
  }

  // Network-first strategy for non-API requests (pages, static assets)
  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => {
          cache.put(request, responseClone).catch(() => {});
        });
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
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
  // v4.155: Clear API cache (when user clicks "Clear cache" in settings)
  if (event.data && event.data.type === 'CLEAR_API_CACHE') {
    caches.delete(API_CACHE).then(() => {
      console.log('[SW] API cache cleared');
      event.ports[0]?.postMessage({ success: true });
    });
  }
});

// ---------- Background Sync: retry pending writes when connection restores ----------
// (where Background Sync API is supported — Chrome/Edge)
self.addEventListener('sync', (event) => {
  if (event.tag === 'bizbook-pending-writes') {
    console.log('[SW] Background sync triggered — notifying clients');
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SYNC_PENDING_WRITES' });
        });
      })
    );
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
