// Prospeo Service Worker v4
var CACHE = 'prospeo-v4';
var OFFLINE_URL = '/prospeo/app.html';

var PRECACHE = [
  '/prospeo/index.html',
  '/prospeo/login.html',
  '/prospeo/app.html',
  '/prospeo/invoices.html',
  '/prospeo/clients.html',
  '/prospeo/calendar.html',
  '/prospeo/pricing.html',
  '/prospeo/manifest.json'
];

// Install — precache core pages
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(PRECACHE.map(function(url) {
        return new Request(url, { cache: 'reload' });
      })).catch(function() {});
    }).then(function() { return self.skipWaiting(); })
  );
});

// Activate — clean old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);
  // Don't intercept Supabase API calls
  if (url.hostname.includes('supabase.co') || url.hostname.includes('stripe.com')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request).then(function(resp) {
      if (resp && resp.status === 200) {
        var clone = resp.clone();
        caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
      }
      return resp;
    }).catch(function() {
      return caches.match(e.request).then(function(cached) {
        return cached || caches.match(OFFLINE_URL);
      });
    })
  );
});
