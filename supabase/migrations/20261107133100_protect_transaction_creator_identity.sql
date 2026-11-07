begin;

create or replace function private.prevent_transaction_creator_reassignment()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Transaction creator cannot be changed';
  end if;
  return new;
end;
$function$;

revoke all on function private.prevent_transaction_creator_reassignment() from public, anon, authenticated;

drop trigger if exists trg_khata_transaction_creator_immutable on public.khata_transactions;
create trigger trg_khata_transaction_creator_immutable
before update of created_by on public.khata_transactions
for each row execute function private.prevent_transaction_creator_reassignment();

commit;