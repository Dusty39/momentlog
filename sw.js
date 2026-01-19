const CACHE_NAME = 'momentlog-v823-PREMIUM-UI';
const ASSETS = [
    './',
    './index.html',
    './style.v1.css',
    './app.v1.js',
    './firebase-config.js',
    './firebase-service.js',
    './cloudinary-service.js',
    './manifest.json',
    './icon.png'
];

// URLs that should NEVER be cached (Auth related)
const AUTH_BYPASS_PATTERNS = [
    'googleapis.com',
    'firebaseapp.com',
    'identitytoolkit',
    'securetoken',
    'accounts.google.com',
    '__/auth/'
];

// Listen for message to skip waiting
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

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
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event - CRITICAL: Bypass Auth requests completely
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // BYPASS: Never intercept auth-related requests
    const isAuthRequest = AUTH_BYPASS_PATTERNS.some(pattern => url.includes(pattern));
    if (isAuthRequest) {
        // Let it go directly to network, no caching, no interception
        return;
    }

    // For same-origin requests: Network First
    if (url.startsWith(self.location.origin)) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
    } else {
        // External assets: Cache First
        event.respondWith(
            caches.match(event.request).then((res) => res || fetch(event.request))
        );
    }
});
