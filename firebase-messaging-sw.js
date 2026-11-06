/* Easy Khata — Firebase Cloud Messaging service worker.
   Background handler: shows the notification popup even when the app is
   CLOSED (the browser wakes this worker when an FCM message arrives).
   Registered by the app with the FCM push scope; the app's main sw.js
   keeps handling the VAPID web-push path. The two workers never clash:
   this one only handles FCM data messages (sent by /api/notify).
   The firebaseConfig below is PUBLIC-by-design (same as the Supabase
   publishable key) — it only identifies the project. No secrets here. */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

var firebaseConfig = {
  apiKey: "AIzaSyD3UfPTnSSyrpR80tZEB9mfaykkeG-GP7E",
  authDomain: "easy-khata-4f59a.firebaseapp.com",
  projectId: "easy-khata-4f59a",
  storageBucket: "easy-khata-4f59a.firebasestorage.app",
  messagingSenderId: "182581287824",
  appId: "1:182581287824:web:b40ff640686d942852f115"
};

firebase.initializeApp(firebaseConfig);
var messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var d = (payload && payload.data) || {};
  var title = d.title || "Easy Khata";
  var options = {
    body: d.body || "A new record arrived.",
    icon: "icons/icon.svg",
    badge: "icons/icon.svg",
    tag: d.tag || "easy-khata",
    data: { url: d.url || "/?view=notifs" }
  };
  // v24.4: app icon badge (Badging API) — FCM push aane par home screen ke
  // app icon par badge (unread count ho to wahi, warna 1). API na ho to
  // silent skip; asal count app khulte hi syncAppBadge se set hota hai.
  try {
    if ("setAppBadge" in navigator) {
      var n = 1;
      var u = parseInt(d.unread, 10); // FCM data values hamesha string hoti hain
      if (!isNaN(u) && u > 0) n = u;
      var bp = navigator.setAppBadge(n);
      if (bp && bp.catch) bp.catch(function () {});
    }
  } catch (err) {}
  return self.registration.showNotification(title, options);
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
