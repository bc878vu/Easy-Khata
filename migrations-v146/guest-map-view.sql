-- Easy Khata v146: guest map — public-safe view map_public_locations.
-- Boss order (19 Nov 2026): Map har visitor ko bhi dikhe, bina login ke —
-- guest live pins + info (naam, role, pata, updated time) dekhe, lekin
-- kisi user ka PHONE NUMBER guest ko kabhi na dikhe, na Call/WhatsApp.
-- Call/WhatsApp ke liye login lazmi hai (app mein Login button).
--
-- DATA SAFETY — view mein sirf SAFE columns hain: user_id, display_name,
-- lat, lng, updated_at, name, avatar_url, business_role, address.
-- phone/email view mein HAI HI NAHI — guest phone fetch hi nahi kar sakta
-- (sirf chhupana nahi). View owner (postgres) ke rights se chalta hai, is
-- liye khata_profiles ki authenticated-only RLS ke peeche se sirf ye safe
-- columns milti hain; seedha khata_profiles anon ko kuch nahi deta
-- (anon probe, live verify kiya gaya: select id,name,avatar_url,phone -> []).
-- user_locations ki sharing_enabled=true wali rows anon ko pehle se bhi
-- milti thiin (v140 policy: select where sharing_enabled = true) — view
-- location NAHI kholta, sirf profile fields (naam/photo/role/pata) jodta hai.
--
-- Boss: Supabase dashboard -> SQL Editor -> ye poora text paste karein -> Run.
-- v144 wali file (migrations-v144/profile-role-address.sql) abhi tak run
-- nahi hui ho to bhi ye file kaafi hai — v144 ke columns isi mein idempotent
-- add hain (pehle se hon to kuch nahi badalta). Dono migrations aik hi SQL
-- Editor session mein run ho sakti hain — pehle ye file, ya pehle v144,
-- farq nahi parta (ye file khud-mukammal hai).
-- App migration ke baghair bhi chalta hai: view na ho to guest map khaali
-- rehta hai ("Map ka table abhi nahi bana") — crash nahi; logged-in map
-- waisa hi chalta hai (user_locations + profiles).
alter table public.khata_profiles
  add column if not exists business_role text
    check (business_role is null or business_role in ('Businessman', 'Supplier', 'Customer', 'Dealer')),
  add column if not exists address text
    check (address is null or char_length(address) <= 200);

create or replace view public.map_public_locations as
select l.user_id, l.display_name, l.lat, l.lng, l.updated_at,
       p.name, p.avatar_url, p.business_role, p.address
from public.user_locations l
left join public.khata_profiles p on p.id = l.user_id
where l.sharing_enabled = true;

grant select on public.map_public_locations to anon, authenticated;
