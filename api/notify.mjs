// Easy Khata — push notify endpoint (Vercel serverless function).
// App band ho to bhi notification pohanchane ke liye:
//  1. Sender (jis ne record save kiya) is endpoint ko call karta hai.
//  2. Function sender ka Supabase JWT check karta hai, phir verify karta hai
//     ke sender aur recipient ke darmiyan abhi koi record bana hai (last 5 min).
//  3. Phir recipient ki push subscriptions (service-role key se) parh kar
//     web-push se notification bhejta hai. Expired subs (410) delete ho jati hain.
//
// Env vars (Vercel dashboard, kabhi repo me nahi):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
import webpush from "web-push";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:a.m.a63425@gmail.com",
  process.env.VAPID_PUBLIC_KEY || "",
  process.env.VAPID_PRIVATE_KEY || ""
);

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
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
  const text = String(body.body || "Naya record aaya hai.").slice(0, 200);
  if (!recipientId || recipientId === sender.id) return json(res, 400, { error: "bad_recipient" });

  // Verify: sender aur recipient ke darmiyan abhi (last 5 min) koi record bana ho.
  // Is se koi bhi is endpoint se random users ko spam nahi kar sakta.
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const q = new URLSearchParams({
    select: "id",
    created_at: "gte." + since,
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

  // Recipient ki subscriptions parhein.
  let subs = [];
  try {
    const r = await fetch(
      SUPABASE_URL + "/rest/v1/khata_push_subs?select=id,endpoint,p256dh,auth&user_id=eq." + encodeURIComponent(recipientId),
      { headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY } }
    );
    if (r.ok) subs = await r.json();
  } catch (e) { subs = []; }
  if (!subs.length) return json(res, 200, { sent: 0, reason: "recipient_not_subscribed" });

  const payload = JSON.stringify({ title: title, body: text, url: "/?view=notifs", tag: "easy-khata" });
  let sent = 0, failed = 0, expired = 0;
  await Promise.all(subs.map(async (s) => {
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
        try {
          await fetch(SUPABASE_URL + "/rest/v1/khata_push_subs?id=eq." + encodeURIComponent(s.id), {
            method: "DELETE",
            headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY }
          });
        } catch (err) { /* ignore */ }
      }
    }
  }));
  return json(res, 200, { sent: sent, failed: failed, expired: expired });
}
