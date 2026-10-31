// sw.js — keeps the calculator working with no network once it has been
// opened. Every file is cached together under one version, so an update
// arrives whole: change VERSION whenever any listed file changes.

const VERSION = 'bank-v9';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'assets/fx-50fh-ii-generated-transparent.png',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'output/pdf/fx-50fh-ii-s5-program-library.pdf',
  'js/consts.js',
  'js/expr.js',
  'js/font.js',
  'js/format.js',
  'js/formulas.js',
  'js/keymap.js',
  'js/lcd.js',
  'js/machine.js',
  'js/main.js',
  'js/program-catalog.generated.js',
  'js/program-codec.js',
  'js/program.js',
  'js/stats.js',
  'js/studio.js',
  'js/tokens.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Pages ask for files with ?v= cache-busting queries; the cache holds each
// file once, so the query is ignored when matching.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION)
      .then((cache) => cache.match(request, { ignoreSearch: true }))
      .then((hit) => hit || fetch(request))
  );
});
