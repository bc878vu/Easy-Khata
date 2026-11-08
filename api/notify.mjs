// Easy Khata — push notify endpoint (Vercel serverless function).
// To deliver a notification even when the app is closed:
//  1. The sender (who saved the record) calls this endpoint.
//  2. The function checks the sender's Supabase JWT, then verifies
//     that a record was just created between the sender and the recipient (last 5 min).
//  3. Then it reads the recipient's push subscriptions (with the service-role key)
//     and sends the notification:
//       - rows with fcm_token  -> Firebase Cloud Messaging (Admin SDK, data-only
//         message; firebase-messaging-sw.js shows it, even when the app is closed)
//       - rows with endpoint   -> web-push (VAPID) — the older path, kept as fallback
//     Expired subs (410 / unregistered FCM token) are deleted.
//
// Env vars (Vercel dashboard, never in the repo):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...),
//   FIREBASE_SERVICE_ACCOUNT (the full service-account JSON string — secret!)
import webpush from "web-push";
import admin from "firebase-admin";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:a.m.a63425@gmail.com",
  process.env.VAPID_PUBLIC_KEY || "",
  process.env.VAPID_PRIVATE_KEY || ""
);

// Firebase Admin SDK — lazy init from the service-account JSON in the env var.
// Never put the service-account key in the repo. If the env var is missing
// the FCM rows are skipped (fcmSkipped) and the VAPID path still works.
let fcmApp = null;
let fcmInitTried = false;
function getFcmMessaging() {
  if (fcmApp) return fcmApp;
  if (fcmInitTried) return null;
  fcmInitTried = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (!sa || sa.type !== "service_account" || !sa.project_id || !sa.client_email || !sa.private_key) return null;
    fcmApp = admin.initializeApp({ credential: admin.credential.cert(sa) }, "easy-khata-notify");
    return fcmApp.messaging();
  } catch (e) {
    return null;
  }
}

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

// v75: per-transaction dedupe — aik record par aik hi push. Vercel functions
// stateless hote hain, is liye ye Map sirf warm instance ke andar kaam karta
// hai; is ke saath txnId-pin (neeche) mil kar abuse ko chand duplicate tak
// mehdood kar deta hai. Map kabhi barhta nahi — purani entries 5 min baad
// saaf ho jati hain (sweep har call par).
const seenNotify = new Map();
function alreadyNotified(key) {
  const now = Date.now();
  for (const [k, t] of seenNotify) { if (now - t > 5 * 60 * 1000) seenNotify.delete(k); }
  if (seenNotify.has(key)) return true;
  seenNotify.set(key, now);
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error: "server_not_configured" });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json(res, 401, { error: "missing_token" });

  let sender = null;
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + token }
    });
    if (!r.ok) return json(res, 401, { error: "bad_token" });
    sender = await r.json();
  } catch (e) {
    return json(res, 502, { error: "auth_check_failed" });
  }
  if (!sender || !sender.id) return json(res, 401, { error: "bad_token" });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch (e) { body = {}; }
  const recipientId = String(body.recipientId || "");
  const title = String(body.title || "Easy Khata").slice(0, 80);
  const text = String(body.body || "A new record arrived.").slice(0, 200);
  // v75: txnId — jis record par push bheja ja raha hai. Dedupe + pinned
  // recent-record check ke liye zaroori hai (aik record → aik push).
  const txnId = String(body.txnId || "");
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  // recipientId is interpolated into a PostgREST filter expression below.
  // Accept only canonical UUID-shaped auth user IDs to prevent filter injection.
  if (!uuidRe.test(recipientId) || recipientId === sender.id) {
    return json(res, 400, { error: "bad_recipient" });
  }
  if (!uuidRe.test(txnId)) return json(res, 400, { error: "bad_txn" });

  // Verify: YEHI record abhi (last 5 min) sender aur recipient ke beech
  // bana ho. Pehle koi bhi recent record kaafi tha — ab sirf wahi txn.
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const q = new URLSearchParams({
    select: "id",
    id: "eq." + txnId,
    created_at: "gte." + since,
    created_by: "eq." + sender.id,
    or: "(and(payer_id.eq." + sender.id + ",receiver_id.eq." + recipientId + "),and(payer_id.eq." + recipientId + ",receiver_id.eq." + sender.id + "))",
    limit: "1"
  });
  let recent = false;
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/khata_transactions?" + q.toString(), {
      headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY }
    });
    if (r.ok) { const rows = await r.json(); recent = Array.isArray(rows) && rows.length > 0; }
  } catch (e) { recent = false; }
  if (!recent) return json(res, 403, { error: "no_recent_record" });
  // Dedupe sirf tab mark karo jab record verify ho gaya ho — warna aik
  // ghalat/early call asli retry ko bhi rok deta.
  if (alreadyNotified(sender.id + ":" + txnId)) return json(res, 200, { sent: 0, reason: "already_notified" });

  // Read the recipient's subscriptions (VAPID rows + FCM token rows).
  let subs = [];
  try {
    const r = await fetch(
      SUPABASE_URL + "/rest/v1/khata_push_subs?select=id,endpoint,p256dh,auth,fcm_token&user_id=eq." + encodeURIComponent(recipientId),
      { headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY } }
    );
    if (r.ok) subs = await r.json();
  } catch (e) { subs = []; }
  if (!subs.length) return json(res, 200, { sent: 0, reason: "recipient_not_subscribed" });

  const deleteSub = async (id) => {
    try {
      await fetch(SUPABASE_URL + "/rest/v1/khata_push_subs?id=eq." + encodeURIComponent(id), {
        method: "DELETE",
        headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY }
      });
    } catch (err) { /* ignore */ }
  };

  const payload = JSON.stringify({ title: title, body: text, url: "/?view=notifs", tag: "easy-khata" });
  // FCM data payload — strings only; the background handler shows the notification.
  const fcmData = { title: title, body: text, url: "/?view=notifs", tag: "easy-khata" };
  const messaging = getFcmMessaging();
  let sent = 0, failed = 0, expired = 0, fcmSent = 0, fcmFailed = 0, fcmSkipped = 0;
  await Promise.all(subs.map(async (s) => {
    // FCM token rows go through Firebase (closed-app delivery).
    if (s.fcm_token) {
      if (!messaging) { fcmSkipped++; return; }
      try {
        await messaging.send({ token: s.fcm_token, data: fcmData });
        fcmSent++; sent++;
      } catch (e) {
        const code = (e && e.code) || "";
        if (code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token" ||
            code === "messaging/invalid-argument") {
          expired++; await deleteSub(s.id);
        } else {
          fcmFailed++; failed++;
        }
      }
      return;
    }
    // VAPID web-push rows (older path, kept as fallback).
    if (!s.endpoint) { failed++; return; }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
      sent++;
    } catch (e) {
      failed++;
      if (e && e.statusCode === 410) {
        expired++;
        await deleteSub(s.id);
      }
    }
  }));
  return json(res, 200, { sent: sent, failed: failed, expired: expired, fcmSent: fcmSent, fcmFailed: fcmFailed, fcmSkipped: fcmSkipped });
}
