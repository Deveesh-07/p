// College Event Registration Management System - Service Worker
// Provides intelligent precaching, offline resiliency, and background synchronization

const CACHE_VERSION = 'cerms-v1';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;
const DATA_CACHE = `data-${CACHE_VERSION}`;

// Core static assets required for standalone offline experience
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.webmanifest',
  '/manifest.json',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/icon.svg',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
];

// Read-only API endpoints eligible for Network-First offline fallback
const CACHABLE_API_ROUTES = [
  '/api/config',
  '/api/dashboard',
  '/api/events',
  '/api/students',
  '/api/registrations'
];

// Install Event: Pre-cache app shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      console.log('[Service Worker] Pre-caching application shell...');
      // Use individual puts so a single remote failure (like fonts) does not abort installation
      await Promise.all(
        STATIC_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response && (response.status === 200 || response.type === 'opaque')) {
              await cache.put(url, response);
            }
          } catch (err) {
            console.warn('[Service Worker] Asset pre-cache warning for', url, err.message);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Purge old cache versions and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== SHELL_CACHE && name !== RUNTIME_CACHE && name !== DATA_CACHE)
          .map((name) => {
            console.log('[Service Worker] Deleting obsolete cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Intelligent routing and caching strategies
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Skip non-GET requests (POST, PUT, DELETE should never be cached)
  if (req.method !== 'GET') {
    return;
  }

  // 2. Skip SSE Realtime stream and Gemini AI analyze calls (always network only)
  if (url.pathname.includes('/api/realtime') || url.pathname.includes('/api/ai/')) {
    return;
  }

  // 3. Navigation Requests (HTML / App Shell): Network-First with cached fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/', clone));
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match('/') || await caches.match('/index.html');
          if (cached) return cached;
          return new Response(
            '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;"><h2>Offline Mode</h2><p>Application shell is available offline once loaded.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // 4. Read-Only API Requests: Network-First with background cache update & offline fallback
  const isCachableApi = CACHABLE_API_ROUTES.some((route) => url.pathname.startsWith(route));
  if (isCachableApi) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(DATA_CACHE).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) {
            console.log('[Service Worker] Serving cached API response for offline:', url.pathname);
            return cached;
          }
          return new Response(JSON.stringify({ offline: true, detail: 'Network disconnected. Offline mode active.' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // 5. Google Fonts & Web Fonts: Cache-First with long lifetime
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((networkRes) => {
          if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
            const clone = networkRes.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        });
      })
    );
    return;
  }

  // 6. Static Assets (CSS, JS, Images, Icons): Stale-While-Revalidate
  const isStatic =
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest') ||
    url.pathname.endsWith('.json');

  if (isStatic) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((networkRes) => {
            if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
              const clone = networkRes.clone();
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, clone));
            }
            return networkRes;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // Default: Fallback to standard fetch
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});

// Message listener (supports prompt skipWaiting)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
