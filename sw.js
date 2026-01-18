const CACHE_NAME = 'momentlog-v268-hardened-init';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './story-mode.js',
    './icon.png',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Permanent+Marker&family=Space+Mono&display=swap'
];

// Install Event
self.addEventListener('install', (event) => {
    self.skipWaiting(); // Force the waiting service worker to become the active service worker
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// Activate Event
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => {
            return self.clients.claim(); // Take control of all clients immediately
        })
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
