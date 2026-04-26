// Docline Service Worker v6 — production ready
'use strict';
var CACHE_NAME = 'docline-v6';
var STATIC_CACHE = 'docline-static-v6';
var OFFLINE_PAGE = '/docline/find-doctor.html';

// Core assets to precache for offline
var PRECACHE_URLS = [
  '/docline/find-doctor.html',
  '/docline/app.html',
  '/docline/login.html',
  '/docline/index.html',
  '/docline/clients.html',
  '/docline/invoices.html',
  '/docline/calendar.html',
  '/docline/proposals.html',
  '/docline/shell.js',
  '/docline/config.js',
  '/docline/manifest.json',
  '/docline/icon-192.png',
  '/docline/icon-512.png',
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function(cache) {
        return Promise.allSettled(
          PRECACHE_URLS.map(function(url) {
            return cache.add(url).catch(function(err) {
              console.warn('[SW] Failed to cache:', url, err);
            });
          })
        );
      })
      .then(function() { return self.skipWaiting(); })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(cacheNames) {
        return Promise.all(
          cacheNames
            .filter(function(name) {
              return name !== CACHE_NAME && name !== STATIC_CACHE;
            })
            .map(function(name) { return caches.delete(name); })
        );
      })
      .then(function() { return self.clients.claim(); })
  );
});

// ── FETCH ────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url = new URL(req.url);

  // Never intercept: Supabase, Stripe, Google Fonts, analytics
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('stripe.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('jsdelivr.net') ||
    req.method !== 'GET'
  ) return;

  // HTML pages: network first, cache fallback
  if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then(function(resp) {
          if (resp && resp.status === 200) {
            var clone = resp.clone();
            caches.open(CACHE_NAME).then(function(c) { c.put(req, clone); });
          }
          return resp;
        })
        .catch(function() {
          return caches.match(req)
            .then(function(cached) { return cached || caches.match(OFFLINE_PAGE); });
        })
    );
    return;
  }

  // Static assets: cache first, network fallback
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(resp) {
        if (resp && resp.status === 200) {
          var clone = resp.clone();
          caches.open(STATIC_CACHE).then(function(c) { c.put(req, clone); });
        }
        return resp;
      });
    })
  );
});

// ── PUSH NOTIFICATIONS (future) ──────────────────────────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
