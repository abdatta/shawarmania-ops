-- a-customer-name-is-capitalised: the customer-names-capitalised gate, off.
-- change-gate: customer-names-capitalised
--
-- The gate's row and nothing else. The capitalising is the counter's name field
-- alone: no table, column, policy or function changes, and the database keeps
-- storing the name the counter sends. No roadmap row, because it corrects
-- shipped behaviour, so `change_number` is null.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('customer-names-capitalised', 'NC', 'change', 'Customer names capitalised',
   'The counter capitalises a new customer''s name in the box as it is typed, and stops for that name once the biller edits a word it corrected.',
   'The counter saves a new customer''s name exactly as typed, as today.',
   'a-customer-name-is-capitalised', null);
