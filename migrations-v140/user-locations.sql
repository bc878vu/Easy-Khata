-- Easy Khata v140: user_locations — Map par location sharing (opt-in only).
-- Boss: Supabase dashboard -> SQL Editor -> ye poora text paste karein -> Run.
-- Table banne se pehle app map ko khaali dikhata hai (koi crash nahi);
-- table banne ke baad jinhon ne "Meri location map par dikhayein" ON kiya
-- hoga, sirf un ke pin map par dikhenge.
create table if not exists public.user_locations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  lat double precision not null check (lat >= -90 and lat <= 90),
  lng double precision not null check (lng >= -180 and lng <= 180),
  updated_at timestamptz not null default now(),
  sharing_enabled boolean not null default true
);

alter table public.user_locations enable row level security;

-- Apni row: insert / update / delete sirf khud kar sakta hai.
drop policy if exists user_locations_insert_own on public.user_locations;
create policy user_locations_insert_own on public.user_locations
  for insert with check (auth.uid() = user_id);

drop policy if exists user_locations_update_own on public.user_locations;
create policy user_locations_update_own on public.user_locations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_locations_delete_own on public.user_locations;
create policy user_locations_delete_own on public.user_locations
  for delete using (auth.uid() = user_id);

-- Parhna: apni row hamesha dikhti hai; doosron ki row sirf jab
-- sharing_enabled = true ho (matlab us bande ne khud ON kiya ho).
drop policy if exists user_locations_select_own on public.user_locations;
create policy user_locations_select_own on public.user_locations
  for select using (auth.uid() = user_id);

drop policy if exists user_locations_select_shared on public.user_locations;
create policy user_locations_select_shared on public.user_locations
  for select using (sharing_enabled = true);

grant select, insert, update, delete on public.user_locations to authenticated;

create index if not exists user_locations_updated_at_idx
  on public.user_locations (updated_at desc);
