/**
 * Service Worker — BizBook Pro PWA (v6.28.21 — NUCLEAR CACHE RESET)
 * =================================================================
 * 
 * PROBLEM: The old service worker (v6.15.0-v6.28.20) was caching
 * the main JS bundle (/) and serving the STALE version even after
 * 20+ new deployments. The browser never fetched the new code because
 * the service worker's network-first strategy had a race condition:
 * if the network was slow (>2s), the SW fell back to the cached
 * (stale) bundle, which still had the old `useAppStore()` code
 * causing React Error #310.
 * 
 * SOLUTION: This service worker version:
 *   1. Does NOT cache navigation requests (HTML pages) AT ALL
 *   2. Does NOT cache JS chunks (_next/static/*)
 *   3. Only caches API GET responses for offline use (5-min TTL)
 *   4. On install, DELETES ALL existing caches from ALL previous versions
 *   5. Uses skipWaiting + clients.claim for immediate activation
 * 
 * This ensures the browser ALWAYS fetches fresh HTML and JS from the
 * server, while still providing offline API data access.
 */

const CACHE_VERSION = 'bizbook-pro-v6.28.21-nuclear-reset';
const API_CACHE = `${CACHE_VERSION}-api`;

// API paths that are safe to cache for offline reads (GET only)
const CACHEABLE_API_PREFIXES = [
  '/api/sales',
  '/api/purchases',
  '/api/expenses',
  '/api/inventory',
  '/api/parties',
  '/api/staff',
  '/api/reports',
  '/api/ledger',
];

// API paths that must NEVER be cached
const NEVER_CACHE_API_PREFIXES = [
  '/api/auth',
  '/api/backup',
  '/api/auto-backup',
  '/api/razorpay',
  '/api/einvoice',
  '/api/ai-import',
  '/api/ai-valuation',
  '/api/help-chat',
  '/api/upload-logo',
  '/api/admin',
];

const API_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------- Install: DELETE ALL old caches, skip waiting ----------
self.addEventListener('install', (event) => {
  console.log('[SW v6.28.21] Install — NUCLEAR CACHE RESET');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      // DELETE EVERY cache from EVERY previous version
      console.log('[SW v6.28.21] Deleting ALL caches:', cacheNames);
      return Promise.all(
        cacheNames.map((name) => {
          console.log('[SW v6.28.21] Deleting cache:', name);
          return caches.delete(name);
        })
      );
    }).then(() => {
      // Open the new API cache (empty)
      return caches.open(API_CACHE);
    }).then(() => {
      console.log('[SW v6.28.21] All old caches deleted. New cache ready.');
      return self.skipWaiting();
    })
  );
});

// ---------- Activate: claim all clients immediately ----------
self.addEventListener('activate', (event) => {
  console.log('[SW v6.28.21] Activate — claiming all clients');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      // Delete any caches that don't match our version
      return Promise.all(
        cacheNames
          .filter((name) => !name.startsWith(CACHE_VERSION))
          .map((name) => {
            console.log('[SW v6.28.21] Deleting stale cache on activate:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Force the new SW to take control of ALL open tabs immediately
      return self.clients.claim();
    }).then(() => {
      console.log('[SW v6.28.21] All clients claimed. Fresh code will be served.');
      // Notify all clients to reload
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      });
    })
  );
});

// ---------- Helper: check if URL is cacheable API GET ----------
function isCacheableApiGet(url, method) {
  if (method !== 'GET') return false;
  for (const prefix of NEVER_CACHE_API_PREFIXES) {
    if (url.pathname.startsWith(prefix)) return false;
  }
  for (const prefix of CACHEABLE_API_PREFIXES) {
    if (url.pathname.startsWith(prefix)) return true;
  }
  return false;
}

// ---------- Fetch: NEVER cache HTML/JS/CSS — only API GETs ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // v6.28.21: NEVER intercept navigation requests — always go to network
  // This is the KEY fix. Previously the SW cached the HTML page and served
  // stale HTML which loaded stale JS bundles.
  if (request.mode === 'navigate') {
    return; // Let the browser handle it natively (always network)
  }

  // v6.28.21: NEVER intercept _next/static/* requests — always go to network
  // These are hashed JS/CSS chunks. The browser's HTTP cache handles them
  // efficiently with the immutable Cache-Control header we set in next.config.ts
  if (url.pathname.startsWith('/_next/static/')) {
    return; // Let the browser handle it natively
  }

  // v6.28.21: NEVER intercept _next/data/* requests (RSC payloads)
  if (url.pathname.startsWith('/_next/data/')) {
    return;
  }

  // v6.28.21: Only intercept cacheable API GET requests
  if (url.pathname.startsWith('/api/')) {
    if (!isCacheableApiGet(url, request.method)) {
      return; // Non-cacheable API — always network
    }

    // Network-first with cache fallback for cacheable API GETs
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(API_CACHE).then((cache) => {
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
          return caches.match(request).then((cached) => {
            if (cached) {
              const headers = new Headers(cached.headers);
              headers.set('X-Served-From', 'offline-cache');
              return new Response(cached.body, {
                status: cached.status,
                statusText: cached.statusText,
                headers,
              });
            }
            return new Response(
              JSON.stringify({ error: 'You are offline.', offline: true }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
    return;
  }

  // For all other requests (images, fonts, etc.) — let browser handle natively
  // v6.28.21: We do NOT cache these in the SW anymore. The browser's HTTP
  // cache with our Cache-Control headers (1 year for _next/static, 1 day for
  // public assets) handles this far more efficiently than the SW ever could.
});

// ---------- Message handler ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_API_CACHE') {
    caches.delete(API_CACHE).then(() => {
      event.ports[0]?.postMessage({ success: true });
    });
  }
  // v6.28.21: Handle SW_UPDATED message — force client reload
  if (event.data && event.data.type === 'SW_UPDATED') {
    // The client should reload to get the fresh code
  }
});

// ---------- Background Sync ----------
self.addEventListener('sync', (event) => {
  if (event.tag === 'bizbook-pending-writes') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SYNC_PENDING_WRITES' });
        });
      })
    );
  }
});

// ---------- Notification click ----------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});

console.log('[SW v6.28.21] Nuclear Cache Reset Service Worker loaded');
