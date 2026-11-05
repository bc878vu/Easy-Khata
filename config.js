/* Easy Khata — Supabase configuration.
   The AI CV Maker Supabase project (bewx) — user decision 2026-10-29:
   Easy Khata's data lives in this project, not the EduNexus one.
   Publishable key by design (the same key is public in Diesel Converter too).
   Security comes from the tables' Row Level Security rules.
   NEVER put a service-role key in this file. */
window.EASY_KHATA_CONFIG = {
  SUPABASE_URL: "https://bewxefxjbvbumajflhfw.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_HcJP12XHbtaBbskA8PwJRA_0GS-xNa3",
  ADMIN_EMAIL: "a.m.a63425@gmail.com",
  // VAPID public key (public by design — browsers need it to subscribe).
  // Private key is only in a Vercel env var (never in the repo).
  VAPID_PUBLIC_KEY: "BMr4ld-Q2KrhdlyHe40iuDBE0WAM9iQfav5-qIJ2VzBlqhCjBkVxg5AZSpzJ660VdrZIVFQS0V_MD_RFY-yXZdA"
};
