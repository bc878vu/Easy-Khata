/* Easy Khata service worker — installable + offline shell.
   CACHE v1: app shell cache-first; ledger GETs network-first with
   cache fallback (last-synced balance is visible offline too). Auth, POST and
   DELETE are always network-only — a record written offline is queued in the
   app's outbox (localStorage) and syncs automatically when back online. */
var CACHE = "easy-khata-v174-0";
var SHELL = [
  "./",
  "index.html",
  "styles.css?v=132",
  "config.js?v=4",
  "app.js?v=171",
  "firebase-messaging-sw.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  // v91: report libs self-hosted — install par cache ho jayein, offline
  // export pehli visit se hi chale (pehle CDN se pehli use par aati thiin).
  "vendor/jspdf.umd.min.js",
  "vendor/xlsx.bundle.js",
  // v108: share QR (barcode) lib — share sheet kholne par lazy-load, offline bhi chale.
  "vendor/qrcode.js",
  // v141: Leaflet map lib LOCAL (vendor/) — CDN par depend nahi; install
  // par cache ho jaye, slow/offline par bhi map library cache se mile.
  "vendor/leaflet.js",
  "vendor/leaflet.css"
];
// v24.8: boot + PDF ke liye zaroori CDN libs (index.html mein pinned versions).
// Ye cross-origin hain — pehle SW inhein bilkul intercept nahi karta tha,
// is liye offline khulte hi jsPDF/Firebase/Supabase libs gayab hoti thiin.
// Sirf YE exact URLs runtime-cache hoti hain (cache-first + background
// refresh); koi aur cross-origin request intercept nahi hoti.
var CDN_LIBS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"
  // v141: Leaflet ab CDN_LIBS mein nahi — local bundle (vendor/) SHELL mein
  // precache hota hai (upar). Tiles ke liye alag TILE_CACHE hai (neeche).
];
// v91: jsPDF + xlsx ab CDN_LIBS mein nahi — self-hosted (vendor/) hain, is
// liye woh same-origin SHELL/cache-first path se aate hain, CDN handler se
// nahi. Boot libs (Supabase/Firebase) ab bhi CDN se hain.
var API_HOST = "bewxefxjbvbumajflhfw.supabase.co";
// v141: map tiles cache — tile.openstreetmap.org, stale-while-revalidate.
// Pehli dafa tiles internet se aati hain aur cache hoti hain; dobara
// kholne par cache se foran dikhti hain (slow link par farq padta hai).
// Alag cache naam hai (version se bandha nahi) taake tiles app update par
// bhi mehfooz rahein. Cap ~80 tiles — purani tiles khud delete hoti hain.
var TILE_CACHE = "easy-khata-tiles-v1";
var TILE_CACHE_MAX = 80;
function trimTileCache() {
  caches.open(TILE_CACHE).then(function (c) {
    c.keys().then(function (keys) {
      if (keys.length > TILE_CACHE_MAX) {
        var extra = keys.slice(0, keys.length - TILE_CACHE_MAX);
        extra.forEach(function (k) { c.delete(k); });
      }
    });
  }).catch(function () {});
}

self.addEventListener("install", function (e) {
  // v131 M6: per-entry cache — aik file 404 ho to bhi baaki 10 cache hon aur
  // skipWaiting() chale (addAll aik fail par sab reject kar deta tha).
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (url) {
      return c.add(url).catch(function () { /* log, keep going */ });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    // v142: TILE_CACHE mehfooz rakho — tiles app update par bhi rehne
    // chahiye (v141 mein activate har cache mitata tha, is liye tile
    // cache har deploy par khaali ho jata tha). Sirf purane app shells
    // aur purane tile-cache versions delete karo.
    return Promise.all(keys.map(function (k) { if (k !== CACHE && k !== TILE_CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data ? e.data.text() : "" }; }
  var title = data.title || "Easy Khata";
  var options = {
    body: data.body || "A new record arrived.",
    vibrate: [180, 90, 180, 90, 260],
    renotify: true,
    icon: "icons/icon.svg",
    badge: "icons/icon.svg",
    tag: data.tag || "easy-khata",
    data: { url: data.url || "/?view=notifs" }
  };
  // v24.4: app icon badge (Badging API) — push aane par home screen ke app
  // icon par badge: payload mein unread count ho to wahi number, warna 1.
  // API na ho to silent skip. Asal count app khulte hi syncAppBadge se set
  // hota hai; server payload mein unread count nahi bhejta (change nahi).
  var badgeWork = (function () {
    try {
      if ("setAppBadge" in navigator) {
        var n = (typeof data.unread === "number" && data.unread > 0) ? data.unread : 1;
        return navigator.setAppBadge(n);
      }
    } catch (err) {}
    return Promise.resolve();
  })();
  e.waitUntil(Promise.all([self.registration.showNotification(title, options), badgeWork]));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/?view=notifs";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (new URL(c.url).origin === self.location.origin) { c.navigate(url); return c.focus(); }
    }
    return clients.openWindow(url);
  }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return; // POST/DELETE/auth: network-only
  var url = new URL(req.url);

  if (url.host === API_HOST) {
    // Tenant API responses are private and user/active-workspace dependent.
    // Never put them in the shared service-worker cache: app.js maintains a
    // per-device localStorage cache for offline use instead.
    return;
  }

  if (CDN_LIBS.indexOf(req.url) !== -1) {
    // v90: NETWORK-first + cache fallback (pehle cache-first tha). Cache-first
    // + SRI nahi milte: koi purani/kharab cached copy (opaque ya truncated
    // bytes) integrity check fail karwa kar export hamesha rok deti thi, aur
    // retry bhi wahi bytes deta tha. Ab online honay par hamesha taaza bytes
    // aate hain (aur cache hotay hain); offline honay par cached copy chalti
    // hai — PDF/Excel offline-after-first-use barkaraar hai.
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return caches.match(req); }));
    return;
  }

  if (url.host === "tile.openstreetmap.org" || url.host === "server.arcgisonline.com") {
    // v142: tiles — cache-first + background refresh (SWR). Cache mein ho to
    // foran dikhe, peeche se taaza ho jaye; na ho to network se le kar cache
    // kare. v141 bug: Leaflet <img> requests no-cors hain, is liye response
    // OPAQUE hoti hai (res.ok false) aur `if (res.ok)` ki wajah se cache
    // kabhi bharta hi nahi tha. Ab opaque responses bhi cache hoti hain
    // (cache.put opaque ko allow karta hai). Dono providers (OSM + Esri
    // fallback) yahi branch use karte hain.
    e.respondWith(caches.open(TILE_CACHE).then(function (c) {
      return c.match(req).then(function (cached) {
        var net = fetch(req).then(function (res) {
          if (res.ok || res.type === "opaque") { var copy = res.clone(); c.put(req, copy).then(function () { trimTileCache(); }); }
          return res;
        }).catch(function () { return cached; });
        return cached || net;
      });
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // Page: network first (fresh HTML), cached shell when offline.
    e.respondWith(fetch(req).catch(function () { return caches.match("index.html"); }));
    return;
  }

  // Other same-origin files: cache-first, refresh in the background.
  e.respondWith(caches.match(req).then(function (cached) {
    var net = fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return cached; });
    return cached || net;
  }));
});
