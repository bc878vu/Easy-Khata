/* Easy Khata service worker — installable + offline shell.
   CACHE v1: app shell cache-first; ledger GETs network-first with
   cache fallback (last-synced balance is visible offline too). Auth, POST and
   DELETE are always network-only — a record written offline is queued in the
   app's outbox (localStorage) and syncs automatically when back online. */
var CACHE = "easy-khata-v113-0";
var SHELL = [
  "./",
  "index.html",
  "styles.css?v=84",
  "config.js?v=4",
  "app.js?v=112",
  "firebase-messaging-sw.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  // v91: report libs self-hosted — install par cache ho jayein, offline
  // export pehli visit se hi chale (pehle CDN se pehli use par aati thiin).
  "vendor/jspdf.umd.min.js",
  "vendor/xlsx.bundle.js",
  // v108: share QR (barcode) lib — share sheet kholne par lazy-load, offline bhi chale.
  "vendor/qrcode.js"
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
];
// v91: jsPDF + xlsx ab CDN_LIBS mein nahi — self-hosted (vendor/) hain, is
// liye woh same-origin SHELL/cache-first path se aate hain, CDN handler se
// nahi. Boot libs (Supabase/Firebase) ab bhi CDN se hain.
var API_HOST = "bewxefxjbvbumajflhfw.supabase.co";

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
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
