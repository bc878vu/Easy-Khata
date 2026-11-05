/* Easy Khata — Supabase configuration.
   AI CV Maker wala Supabase project (bewx) — user decision 2026-10-29:
   Easy Khata ka data isi project me rehta hai, EduNexus wale me nahi.
   Publishable key by design (Diesel Converter me bhi yehi key public hai).
   Security comes from the tables' Row Level Security rules.
   NEVER put a service-role key in this file. */
window.EASY_KHATA_CONFIG = {
  SUPABASE_URL: "https://bewxefxjbvbumajflhfw.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_HcJP12XHbtaBbskA8PwJRA_0GS-xNa3",
  ADMIN_EMAIL: "a.m.a63425@gmail.com",
  // VAPID public key (public by design — browsers need it to subscribe).
  // Private key sirf Vercel env var me hai (kabhi repo me nahi).
  VAPID_PUBLIC_KEY: "BMr4ld-Q2KrhdlyHe40iuDBE0WAM9iQfav5-qIJ2VzBlqhCjBkVxg5AZSpzJ660VdrZIVFQS0V_MD_RFY-yXZdA"
};
