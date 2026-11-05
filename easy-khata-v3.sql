-- Easy Khata v3 — admin panel + security hardening
-- BEWX (AI CV Maker wala Supabase project) ke SQL Editor me chalana hai.
-- EduNexus wale project me NAHI chalana.
-- Is me v2 ka phone column bhi shamil hai — sirf ye EK file chalani hai,
-- alag se v2 wali file chalane ki zaroorat nahi.

-- 0) Phone column (v2) — agar pehle se ho to kuch nahi badalta.
alter table public.khata_profiles
  add column if not exists phone text;

-- 1) Admin (Asad) kisi bhi record ko delete kar sake.
drop policy if exists "khata_transactions_delete_admin" on public.khata_transactions;
create policy "khata_transactions_delete_admin" on public.khata_transactions
  for delete to authenticated using ((auth.jwt() ->> 'email') = 'a.m.a63425@gmail.com');

-- 2) Admin (Asad) kisi bhi profile ko delete kar sake.
drop policy if exists "khata_profiles_delete_admin" on public.khata_profiles;
create policy "khata_profiles_delete_admin" on public.khata_profiles
  for delete to authenticated using ((auth.jwt() ->> 'email') = 'a.m.a63425@gmail.com');

-- 3) Insert hardening: koi user doosron ke beech record NAHI bana sakta.
-- Record sirf tab bane ga jab banane wala khud us len den me shamil ho
-- (payer ya receiver me se aik ho). Update/delete pehle se sirf apna hai.
drop policy if exists "khata_transactions_insert_own" on public.khata_transactions;
create policy "khata_transactions_insert_own" on public.khata_transactions
  for insert to authenticated with check (
    created_by = auth.uid()
    and (payer_id = auth.uid() or receiver_id = auth.uid())
  );

-- 4) Admin user delete: profile + tamam records + login account aik sath.
-- Sirf admin email se call ho sakta hai; baqi sab ko 'not admin' mile ga.
create or replace function public.admin_delete_user(target_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if (auth.jwt() ->> 'email') <> 'a.m.a63425@gmail.com' then
    raise exception 'not admin';
  end if;
  delete from public.khata_transactions
    where payer_id = target_id or receiver_id = target_id or created_by = target_id;
  delete from public.khata_profiles where id = target_id;
  delete from auth.users where id = target_id;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;
