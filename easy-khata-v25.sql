-- Easy Khata v25.0 — private per-user history, admin record RPCs + audit.
-- Additive migration. Does not rewrite or delete existing transaction rows.
begin;

create table if not exists public.khata_hidden (
  user_id uuid not null references auth.users(id) on delete cascade,
  txn_id uuid not null references public.khata_transactions(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, txn_id)
);
alter table public.khata_hidden enable row level security;
drop policy if exists khata_hidden_select_own on public.khata_hidden;
create policy khata_hidden_select_own on public.khata_hidden
  for select to authenticated using (user_id = auth.uid());
drop policy if exists khata_hidden_insert_own on public.khata_hidden;
create policy khata_hidden_insert_own on public.khata_hidden
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.khata_transactions t
      where t.id = txn_id and (t.payer_id = auth.uid() or t.receiver_id = auth.uid())
    )
  );
drop policy if exists khata_hidden_delete_own on public.khata_hidden;
create policy khata_hidden_delete_own on public.khata_hidden
  for delete to authenticated using (user_id = auth.uid());
create index if not exists khata_hidden_txn_idx on public.khata_hidden(txn_id);

create table if not exists public.khata_admin_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  action text not null check (action in ('transaction_update','transaction_delete')),
  txn_id uuid not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.khata_admin_log enable row level security;
-- No direct client policies: audit rows are written only by SECURITY DEFINER RPCs.

-- The normal UI no longer has a hard-delete path for shared transactions.
-- Admin hard delete is routed through admin_delete_txn() below.
drop policy if exists khata_transactions_delete_admin on public.khata_transactions;

create or replace function public.admin_update_txn(
  p_txn_id uuid, p_amount numeric, p_note text, p_txn_date date
) returns void
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $fn$
declare v_row public.khata_transactions%rowtype;
begin
  if coalesce(auth.jwt() ->> 'email','') <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'note required'; end if;
  select * into v_row from public.khata_transactions where id=p_txn_id for update;
  if not found then raise exception 'record not found'; end if;
  update public.khata_transactions
    set amount=p_amount, note=trim(p_note), txn_date=coalesce(p_txn_date,v_row.txn_date)
    where id=p_txn_id;
  -- trg_khata_settled_lock remains the final server-side lock.
  insert into public.khata_admin_log(admin_id,action,txn_id,snapshot)
    values (auth.uid(),'transaction_update',p_txn_id,
      jsonb_build_object('before',to_jsonb(v_row),'after',jsonb_build_object('amount',p_amount,'note',trim(p_note),'txn_date',coalesce(p_txn_date,v_row.txn_date))));
end;
$fn$;

create or replace function public.admin_delete_txn(p_txn_id uuid) returns void
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $fn$
declare v_row public.khata_transactions%rowtype;
begin
  if coalesce(auth.jwt() ->> 'email','') <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  select * into v_row from public.khata_transactions where id=p_txn_id for update;
  if not found then raise exception 'record not found'; end if;
  insert into public.khata_admin_log(admin_id,action,txn_id,snapshot)
    values (auth.uid(),'transaction_delete',p_txn_id,to_jsonb(v_row));
  delete from public.khata_transactions where id=p_txn_id;
  -- khata_hidden rows are cascade-cleaned by the transaction FK.
end;
$fn$;

create or replace function public.admin_list_txn_hides()
returns table(txn_id uuid, user_id uuid, user_name text)
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $fn$
begin
  if coalesce(auth.jwt() ->> 'email','') <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  return query
    select h.txn_id, h.user_id, coalesce(p.name,p.email,'Unknown')::text
    from public.khata_hidden h
    left join public.khata_profiles p on p.id=h.user_id
    order by h.hidden_at;
end;
$fn$;

revoke all on function public.admin_update_txn(uuid,numeric,text,date) from public, anon;
revoke all on function public.admin_delete_txn(uuid) from public, anon;
revoke all on function public.admin_list_txn_hides() from public, anon;
grant execute on function public.admin_update_txn(uuid,numeric,text,date) to authenticated;
grant execute on function public.admin_delete_txn(uuid) to authenticated;
grant execute on function public.admin_list_txn_hides() to authenticated;

-- Enforce the settled-history lock even for direct REST attempts to hide a row.
create or replace function public.khata_block_hidden_settled()
returns trigger language plpgsql set search_path = pg_catalog, public
as $fn$
declare v_tx public.khata_transactions%rowtype;
begin
  select * into v_tx from public.khata_transactions where id = new.txn_id;
  if not found then raise exception 'transaction not found'; end if;
  if coalesce(v_tx.note,'') like 'Settled up%' or exists (
    select 1 from public.khata_transactions s
    where coalesce(s.note,'') like 'Settled up%'
      and ((s.payer_id=v_tx.payer_id and s.receiver_id=v_tx.receiver_id)
        or (s.payer_id=v_tx.receiver_id and s.receiver_id=v_tx.payer_id))
      and s.txn_date >= v_tx.txn_date
  ) then raise exception 'Settled history cannot be hidden'; end if;
  return new;
end;
$fn$;
drop trigger if exists trg_khata_hidden_settled_lock on public.khata_hidden;
create trigger trg_khata_hidden_settled_lock before insert on public.khata_hidden
for each row execute function public.khata_block_hidden_settled();

commit;
