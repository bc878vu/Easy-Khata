-- Easy Khata v174: Business module Part 1 — businesses + products + stock moves.
-- Boss: Supabase dashboard -> SQL Editor -> ye poora text paste karein -> Run.
-- Idempotent hai — tables/policies pehle se hon to kuch nahi badalta.
-- Part 1 app is SQL ke BAGHAIR bhi chalta hai (business data device-local
-- rehta hai, offline bhi). Ye SQL sirf Part 2 ke cloud sync ke liye hai —
-- jab ye run ho jaye to business data bhi account se sync hoga.
-- RLS: har row apne owner ki hai (owner_id = auth.uid()). Workspace ke
-- andar aik business, us ke products aur un ki stock history.
create table if not exists public.biz_businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  workspace_id text not null default 'default',
  name text not null,
  type text not null default 'General Store',
  currency text not null default 'PKR',
  phone text,
  tax numeric(5,2) not null default 0,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, workspace_id)
);

create table if not exists public.biz_products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  workspace_id text not null default 'default',
  business_id uuid references public.biz_businesses(id) on delete cascade,
  name text not null,
  category text not null default '',
  unit text not null default 'Piece',
  buy_price numeric(12,2) not null default 0,
  sell_price numeric(12,2) not null default 0,
  sku text not null default '',
  stock numeric(12,2) not null default 0,
  reorder_level numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, workspace_id, sku)
);

create table if not exists public.biz_stock_moves (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  workspace_id text not null default 'default',
  product_id uuid references public.biz_products(id) on delete set null,
  product_name text not null default '',
  type text not null check (type in ('in', 'out', 'adjust')),
  qty numeric(12,2) not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists biz_products_owner_ws_idx
  on public.biz_products (owner_id, workspace_id);
create index if not exists biz_stock_moves_product_idx
  on public.biz_stock_moves (product_id, created_at desc);

alter table public.biz_businesses enable row level security;
alter table public.biz_products enable row level security;
alter table public.biz_stock_moves enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'biz_businesses' and policyname = 'biz_businesses_own') then
    create policy biz_businesses_own on public.biz_businesses
      for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'biz_products' and policyname = 'biz_products_own') then
    create policy biz_products_own on public.biz_products
      for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'biz_stock_moves' and policyname = 'biz_stock_moves_own') then
    create policy biz_stock_moves_own on public.biz_stock_moves
      for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
  end if;
end $$;
