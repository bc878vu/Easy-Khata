# Easy Khata

Khana ka len den — doston ke sath saaf hisab. Public web app: har user apna
account banata hai, record likhta hai, aur apna hisab dekhta hai.

- **Mera hisab:** Maine kitne diye, kitne liye, net lene hain ya dene hain.
- **Har bande se hisab:** har dost ke sath diye/liye aur net.
- **Naya record:** dost chunein, "Maine diye" ya "Maine liye", raqam, khana ki
  tafseel, tareekh.
- **Saara khata:** tamam doston ke record, naya pehle. Apna record delete bhi
  kar sakte hain.

## Stack

Vanilla HTML/CSS/JS (koi framework nahi) + Supabase (GoTrue auth +
PostgREST), Vercel par hosted. Diesel Converter wali proven pattern.

## Setup

1. Supabase SQL Editor me `easy-khata.sql` chalayein (tables + RLS).
   Project: AI CV Maker wala Supabase (`bewxefxjbvbumajflhfw`) — EduNexus
   wale project me nahi.
   **v2 update:** jin ne v1 wali SQL pehle chala li ho, wo sirf
   `easy-khata-v2.sql` chalayein — ye `khata_profiles` me `phone`
   (WhatsApp number) column add karta hai. Naye setup ke liye poori
   `easy-khata.sql` hi kaafi hai (phone column us me bhi hai).
2. `config.js` me `SUPABASE_URL` aur `SUPABASE_ANON_KEY` pehle se set hain
   (AI CV Maker / Diesel wala bewx project; publishable key — security RLS
   se hai, service key kabhi nahi dalni).
3. Vercel project is repo se linked hai — har push par auto-deploy.

## Files

- `index.html` — UI (Roman Urdu)
- `styles.css` — styling, mobile-first
- `app.js` — auth + ledger logic
- `config.js` — Supabase URL/key
- `easy-khata.sql` — tables + RLS policies
