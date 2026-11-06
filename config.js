/* Easy Khata — Supabase + Firebase configuration.
   The AI CV Maker Supabase project (bewx) — user decision 2026-10-29:
   Easy Khata's data lives in this project, not the EduNexus one.
   Publishable key by design (the same key is public in Diesel Converter too).
   Security comes from the tables' Row Level Security rules.
   NEVER put a service-role key in this file.
   Firebase web config below is also public-by-design (like the Supabase
   publishable key) — it only identifies the project; the SERVICE ACCOUNT
   (private key) lives ONLY in a Vercel env var, never in the repo. */
window.EASY_KHATA_CONFIG = {
  SUPABASE_URL: "https://bewxefxjbvbumajflhfw.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_HcJP12XHbtaBbskA8PwJRA_0GS-xNa3",
  ADMIN_EMAIL: "a.m.a63425@gmail.com",
  // VAPID public key (public by design — browsers need it to subscribe).
  // Private key is only in a Vercel env var (never in the repo).
  VAPID_PUBLIC_KEY: "BMr4ld-Q2KrhdlyHe40iuDBE0WAM9iQfav5-qIJ2VzBlqhCjBkVxg5AZSpzJ660VdrZIVFQS0V_MD_RFY-yXZdA",
  // Firebase project "Easy Khata" (easy-khata-4f59a), created 2026-11-06 on
  // veducator4@gmail.com (a.m.a63425@gmail.com hit Firebase's project limit).
  // Used for Cloud Messaging (FCM) — closed-app push notifications.
  FIREBASE: {
    apiKey: "AIzaSyD3UfPTnSSyrpR80tZEB9mfaykkeG-GP7E",
    authDomain: "easy-khata-4f59a.firebaseapp.com",
    projectId: "easy-khata-4f59a",
    storageBucket: "easy-khata-4f59a.firebasestorage.app",
    messagingSenderId: "182581287824",
    appId: "1:182581287824:web:b40ff640686d942852f115"
  },
  // FCM VAPID public key (generated 2026-11-06 in the Firebase console).
  FCM_VAPID_KEY: "BN6IxRTlpaEDtrJheXUBsbu5nRxfua52po50ewH4ajLhU1SJFXADvbM0h3NKUL_mV8K0mKQ5y3RlaLcSljbzaGU"
};
