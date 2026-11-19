-- Easy Khata v148: proper user profile — business_name + bio.
-- Boss order (19 Nov 2026): Account → Profile mein poori profile bane —
-- photo, naam, business/dukaan ka naam, MAIN business category (business_role:
-- Businessman/Supplier/Customer/Dealer — wahi column, koi doosra type field
-- nahi), phone, address, bio. Category wahi rehti hai jo map popup (v144)
-- aur friend suggestions (v147) use karte hain.
--
-- business_role + address v144/v146 files mein pehle se hain — ye file SIRF
-- business_name + bio add karti hai (merge NAHI — alag file; wahi SQL Editor
-- session mein v146 file ke saath ya us ke baad run karein, order se farq
-- nahi parta).
--
-- App migration ke baghair bhi chalta hai: columns na hon to profile save
-- do-step retry se role/address bhi save karta hai (v148), aur naye fields
-- sirf SQL run hone ke baad save honge — crash/blank nahi.
alter table public.khata_profiles
  add column if not exists business_name text
    check (business_name is null or char_length(business_name) <= 80),
  add column if not exists bio text
    check (bio is null or char_length(bio) <= 200);
