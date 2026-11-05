/* Easy Khata service worker — installable + offline shell.
   CACHE v1: app shell cache-first; khata ledger GETs network-first with
   cache fallback (last-synced hisab offline bhi nazar aaye). Auth, POST aur
   DELETE hamesha network-only — offline likha record sync nahi hota, is
   liye naya record likhne ke liye internet chahiye. */
var CACHE = "easy-khata-v4";
var SHELL = [
  "./",
  "index.html",
  "styles.css?v=3",
  "config.js?v=2",
  "app.js?v=10",
  "manifest.webmanifest",
  "icons/icon.svg"
];
var API_HOST = "bewxefxjbvbumajflhfw.supabase.co";

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return; // POST/DELETE/auth: network-only
  var url = new URL(req.url);

  if (url.host === API_HOST) {
    // Khata data: pehle network, offline ho to last-synced cache.
    if (url.pathname.indexOf("/rest/v1/khata_") === 0) {
      e.respondWith(fetch(req).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () { return caches.match(req); }));
    }
    return; // baqi API calls (auth waghera): network-only
  }

  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // Page: pehle network (taaza HTML), offline ho to cached shell.
    e.respondWith(fetch(req).catch(function () { return caches.match("index.html"); }));
    return;
  }

  // Baqi same-origin files: cache-first, background me taaza karein.
  e.respondWith(caches.match(req).then(function (cached) {
    var net = fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return cached; });
    return cached || net;
  }));
});
