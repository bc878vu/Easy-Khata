-- v131 DB migration part 1: settled-lock hybrid fix (date + created_at tie-break).
-- A record dated ON the latest settlement date is locked ONLY if created at/before
-- the latest settlement ON that date. A record created AFTER the settlement (same
-- date, later created_at) is new balance, not settled history. Earlier dates unchanged.
-- Missing created_at fails CLOSED (locked) — never fail open on legacy rows.
CREATE OR REPLACE FUNCTION public.khata_prevent_settled_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_latest_settlement date; v_latest_created timestamptz;
begin
  -- Allow only the additive tenant backfill to attach a workspace to an
  -- otherwise byte-for-byte unchanged legacy row.
  if tg_op='UPDATE'
     and new.payer_id is not distinct from old.payer_id
     and new.receiver_id is not distinct from old.receiver_id
     and new.amount is not distinct from old.amount
     and new.note is not distinct from old.note
     and new.txn_date is not distinct from old.txn_date
     and new.created_by is not distinct from old.created_by
     and new.created_at is not distinct from old.created_at then
    return new;
  end if;

  if old.note is not null and old.note like 'Settled up%' then
    raise exception 'Settled hisaab ko edit/delete nahi kar sakte — ye history hai.';
  end if;
  if tg_op='UPDATE' and new.note is not null and new.note like 'Settled up%'
     and (old.note is null or old.note not like 'Settled up%') then
    raise exception 'Settlement record sirf Hisaab barabar se banta hai — note edit karke nahi.';
  end if;
  select max(txn_date) into v_latest_settlement
  from public.khata_transactions
  where note like 'Settled up%'
    and ((payer_id=old.payer_id and receiver_id=old.receiver_id)
      or (payer_id=old.receiver_id and receiver_id=old.payer_id));
  if v_latest_settlement is not null then
    select max(created_at) into v_latest_created
    from public.khata_transactions
    where note like 'Settled up%' and txn_date = v_latest_settlement
      and ((payer_id=old.payer_id and receiver_id=old.receiver_id)
        or (payer_id=old.receiver_id and receiver_id=old.payer_id));
    if old.txn_date < v_latest_settlement
       or (old.txn_date = v_latest_settlement
           and (old.created_at is null or v_latest_created is null
                or old.created_at <= v_latest_created)) then
      raise exception 'Settled hisaab ko edit/delete nahi kar sakte — ye history hai.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$
