-- Easy Khata v2 migration — jin users ne pehle wali easy-khata.sql chala li hai,
-- un ke liye SIRF ye chhoti file chalani hai (dobara poori file ki zaroorat nahi).
-- Project: AI CV Maker wala Supabase project (bewxefxjbvbumajflhfw) — SQL Editor me chalayein.
-- EduNexus wale project me NAHI chalana.
-- Kaam: khata_profiles me phone (WhatsApp number) column add karta hai.
-- Idempotent hai — agar column pehle se ho to kuch nahi badalta.

alter table public.khata_profiles
  add column if not exists phone text;
