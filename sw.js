var CACHE_VERSION = 'ndash-v1.0.29';
var SHELL_FILES = [
    '/',
    '/index.html',
    '/manifest.json',
    '/build/icon.png',
    '/css/shared.css',
    '/css/btc.css',
    '/css/weather.css',
    '/css/pc.css',
    '/css/stocks.css',
    '/js/config-base.js',
    '/js/config.js',
    '/js/app.js',
    '/js/btc.js',
    '/js/weather.js',
    '/js/pc.js',
    '/js/stocks.js',
    '/js/settings.js',
    '/js/lib/indicators.js',
    '/js/lib/ws.js',
    '/js/init.js',
    '/btcwallpaper.jpg',
    '/weatherwallpaper.jpg'
];

// Network-only patterns — never serve from cache
var NETWORK_ONLY = [
    /api\.binance\.com/,
    /stream\.binance\.com/,
    /api\.alternative\.me/,
    /api\.coingecko\.com/,
    /api\.open-meteo\.com/,
    /nominatim\.openstreetmap\.org/,
    /\/api\//,
    /\/health/,
    /\/data\.json/,
    /fonts\.googleapis/,
    /fonts\.gstatic/,
    /btct-runtime-config\.json/
];

self.addEventListener('install', function(e) {
    e.waitUntil(
        caches.open(CACHE_VERSION).then(function(cache) {
            return cache.addAll(SHELL_FILES);
        }).then(function() {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('activate', function(e) {
    e.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.filter(function(k) { return k !== CACHE_VERSION; })
                    .map(function(k) { return caches.delete(k); })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', function(e) {
    var url = e.request.url;

    // Network-only for all API/WS/external data requests
    for (var i = 0; i < NETWORK_ONLY.length; i++) {
        if (NETWORK_ONLY[i].test(url)) return;
    }

    // Cache-first for app shell
    e.respondWith(
        caches.match(e.request).then(function(cached) {
            if (cached) return cached;
            return fetch(e.request).then(function(response) {
                // Lazy-cache large assets (e.g. pctempswallpaper.jpg) on first use
                if (response.ok && e.request.method === 'GET') {
                    var clone = response.clone();
                    caches.open(CACHE_VERSION).then(function(cache) {
                        cache.put(e.request, clone);
                    });
                }
                return response;
            });
        })
    );
});
