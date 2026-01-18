const CACHE_NAME = 'momentlog-v311-deploy-fix';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './firebase-config.js',
    './firebase-service.js',
    './cloudinary-service.js',
    './manifest.json',
    './icon.png'
];

// Install Event
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// Activate Event - Aggressive Cleanup
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Delete EVERY cache that isn't the current one
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event - Network First Strategy
self.addEventListener('fetch', (event) => {
    // Skip cross-origin requests (like fonts) for simple network fallback
    if (event.request.url.startsWith(self.location.origin)) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Update cache with new version
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
    } else {
        // External assets (like fonts) use Cache First
        event.respondWith(
            caches.match(event.request).then((res) => res || fetch(event.request))
        );
    }
});
