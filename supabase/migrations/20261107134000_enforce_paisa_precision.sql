begin;

-- PKR is stored to the smallest supported unit: 1 paisa (0.01 Rs).
-- All existing transactions were checked before this constraint was added.
alter table public.khata_transactions
  add constraint khata_transactions_amount_paisa_check
  check (amount > 0 and amount = round(amount, 2)) not valid;

alter table public.khata_transactions
  validate constraint khata_transactions_amount_paisa_check;

commit;