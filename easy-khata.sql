-- Easy Khata — Supabase SQL
-- Project: EduNexus (cprpndovdfnkvekewstv) — SQL Editor me chalayein.
-- Tables: khata_profiles (users) + khata_transactions (len den).
-- Auth: Supabase GoTrue (email + password, self-signup) — app khud use karta hai.

create table if not exists public.khata_profiles (
  id uuid primary key,
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.khata_transactions (
  id uuid primary key default gen_random_uuid(),
  payer_id uuid not null,
  receiver_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  note text not null default 'Khana',
  txn_date date not null default current_date,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (payer_id <> receiver_id)
);

create index if not exists khata_transactions_payer_idx on public.khata_transactions (payer_id);
create index if not exists khata_transactions_receiver_idx on public.khata_transactions (receiver_id);
create index if not exists khata_transactions_date_idx on public.khata_transactions (txn_date desc);

alter table public.khata_profiles enable row level security;
alter table public.khata_transactions enable row level security;

-- Profiles: har login user sab profiles dekh sakta hai (khata shared hai);
-- apni profile khud bana/update kar sakta hai.
drop policy if exists "khata_profiles_select" on public.khata_profiles;
create policy "khata_profiles_select" on public.khata_profiles
  for select to authenticated using (true);

drop policy if exists "khata_profiles_upsert_own" on public.khata_profiles;
create policy "khata_profiles_upsert_own" on public.khata_profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "khata_profiles_update_own" on public.khata_profiles;
create policy "khata_profiles_update_own" on public.khata_profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Transactions: har login user sara khata dekh sakta hai (shared ledger);
-- naya record sirf apne naam se (created_by = khud); edit/delete sirf apna record.
drop policy if exists "khata_transactions_select" on public.khata_transactions;
create policy "khata_transactions_select" on public.khata_transactions
  for select to authenticated using (true);

drop policy if exists "khata_transactions_insert_own" on public.khata_transactions;
create policy "khata_transactions_insert_own" on public.khata_transactions
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists "khata_transactions_update_own" on public.khata_transactions;
create policy "khata_transactions_update_own" on public.khata_transactions
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists "khata_transactions_delete_own" on public.khata_transactions;
create policy "khata_transactions_delete_own" on public.khata_transactions
  for delete to authenticated using (created_by = auth.uid());
