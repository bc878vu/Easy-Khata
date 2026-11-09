-- v131 DB migration part 2: hide-lock hybrid fix (same date + created_at tie-break).
-- A record can be hidden unless a settlement exists dated AFTER it, or dated ON it
-- but created at/after it. Missing created_at fails CLOSED (blocked).
CREATE OR REPLACE FUNCTION public.khata_block_hidden_settled()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_tx public.khata_transactions%rowtype;
begin
  select * into v_tx from public.khata_transactions where id = new.txn_id;
  if not found then raise exception 'transaction not found'; end if;
  if coalesce(v_tx.note,'') like 'Settled up%' or exists (
    select 1 from public.khata_transactions s
    where coalesce(s.note,'') like 'Settled up%'
      and ((s.payer_id=v_tx.payer_id and s.receiver_id=v_tx.receiver_id)
        or (s.payer_id=v_tx.receiver_id and s.receiver_id=v_tx.payer_id))
      and (s.txn_date > v_tx.txn_date
        or (s.txn_date = v_tx.txn_date
            and (v_tx.created_at is null or s.created_at is null
                 or s.created_at >= v_tx.created_at)))
  ) then raise exception 'Settled history cannot be hidden'; end if;
  return new;
end;
$function$
