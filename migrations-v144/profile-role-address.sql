-- Easy Khata v144: khata_profiles mein role + address — Map popup card ke liye.
-- Boss: Supabase dashboard -> SQL Editor -> ye poora text paste karein -> Run.
-- Idempotent hai — columns pehle se hon to kuch nahi badalta.
-- RLS change NAHI chahiye: khata_profiles select policy pehle se
-- "authenticated using (true)" hai (har login user sab profiles parh sakta
-- hai — map popup ke liye zaroori), update apni row ka hai.
-- App migration ke baghair bhi chalta hai: naye columns na hon to popup
-- role/address ke baghair dikhta hai (fallback text) aur profile save
-- dobara try karta hai bina un ke — kuch crash nahi hota.
alter table public.khata_profiles
  add column if not exists business_role text
    check (business_role is null or business_role in ('Businessman', 'Supplier', 'Customer', 'Dealer')),
  add column if not exists address text
    check (address is null or char_length(address) <= 200);
