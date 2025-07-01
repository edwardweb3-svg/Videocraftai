// A simple, cache-first service worker for PWA functionality.

const CACHE_NAME = 'gemini-video-explainer-v1';

// Add all essential assets for the app shell to work offline.
// Note: For a real-world app with a build step, these paths would be more robust.
const URLS_TO_CACHE = [
  '.',
  './index.html',
  './manifest.json'
];

// Install event: opens a cache and adds the core app shell files to it.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(URLS_TO_CACHE);
      })
      .catch(err => {
        console.error('Service Worker: Failed to cache app shell', err);
      })
  );
});

// Activate event: cleans up old caches.
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event: serves requests from the cache first, falling back to the network.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass service worker for scripts from CDNs (esm.sh, unpkg.com) and API calls.
  // This prevents issues with opaque responses and ensures API calls go through.
  if (url.hostname === 'esm.sh' || url.hostname === 'unpkg.com' || event.request.url.includes('/api/')) {
    return;
  }

  // We only want to cache GET requests.
  if (event.request.method !== 'GET') {
      return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return the cached response.
        if (response) {
          return response;
        }

        // Not in cache - fetch from the network, then cache and return the response.
        return fetch(event.request).then(
          (networkResponse) => {
            // Check if we received a valid response to cache
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            
            // IMPORTANT: Clone the response. A response is a stream
            // and because we want the browser to consume the response
            // as well as the cache consuming the response, we need
            // to clone it so we have two streams.
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        );
      }).catch(() => {
          // If both cache and network fail, you could provide a fallback page.
          // For this app, we'll just let the browser handle the error.
      })
  );
});