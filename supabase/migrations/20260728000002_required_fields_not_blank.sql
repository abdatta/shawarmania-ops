-- A required text field cannot be blank, anywhere in this schema.
--
-- An outlet reached production with no name. A manager opened Outlets, created
-- an outlet without typing a name, and three layers each declined to check:
-- `required` on the input is inert because every form in this app carries
-- `noValidate`; `onSubmit` went straight to the adapter; and `outlets.name` is
-- `not null`, which stops the column being *absent* and says nothing about it
-- being *empty*. An empty string satisfies a not-null constraint while
-- satisfying nothing a person needs.
--
-- This is the same fix as `20260727000004_employee_code_not_blank.sql`, applied
-- to every remaining `not null` text column a human types and a human later
-- reads to identify something. That migration's comment already stated the
-- principle; this one generalises it so the next `not null` text column is the
-- exception that has to argue for itself.
--
-- The forms refuse it too — that is the convenience. This is the boundary.
--
-- Constraints only: no column changes type, no domain is introduced, no trigger
-- is added. A domain would be the tidier abstraction and would mean twelve
-- columns changing type for no behavioural gain.
--
-- Deliberately excluded: every nullable column. A blank optional field is
-- stored as `null` by `trimmed()` in the adapter, which is the correct
-- representation of "not known". Also excluded: `employees.employee_code`,
-- which already carries `employees_code_not_blank` — this adds instances of
-- that pattern rather than restating it.
--
-- A CHECK is validated against every existing row when it is added, so each of
-- these was measured against production before being written (2026-07-28:
-- zero blanks across all twelve columns).

-- ── Surfaces that exist today ────────────────────────────────────────────────

-- How every surface names the outlet.
alter table public.outlets
  add constraint outlets_name_not_blank
  check (length(btrim(name)) > 0);

-- How a person refers to the outlet in a sentence. Also unique, so note that
-- '' is a value: at most one blank-coded outlet could ever have existed, while
-- a blank name or location label had no such limit.
alter table public.outlets
  add constraint outlets_code_not_blank
  check (length(btrim(code)) > 0);

-- Shown beside the name on every outlet card.
alter table public.outlets
  add constraint outlets_location_label_not_blank
  check (length(btrim(location_label)) > 0);

-- The roster row is a person.
alter table public.employees
  add constraint employees_full_name_not_blank
  check (length(btrim(full_name)) > 0);

-- The account is a person.
alter table public.profiles
  add constraint profiles_full_name_not_blank
  check (length(btrim(full_name)) > 0);

-- ── Surfaces still ahead, guarded before the form that fills them ────────────
--
-- The menu editor, inventory and messaging surfaces are not built yet. Each
-- constraint below is one line in a migration already being written, and the
-- alternative is every future surface rediscovering this bug on its own.

alter table public.menu_categories
  add constraint menu_categories_name_not_blank
  check (length(btrim(name)) > 0);

alter table public.menu_items
  add constraint menu_items_name_not_blank
  check (length(btrim(name)) > 0);

alter table public.inventory_items
  add constraint inventory_items_name_not_blank
  check (length(btrim(name)) > 0);

alter table public.alerts
  add constraint alerts_subject_not_blank
  check (length(btrim(subject)) > 0);

alter table public.alerts
  add constraint alerts_message_not_blank
  check (length(btrim(message)) > 0);

alter table public.alert_responses
  add constraint alert_responses_message_not_blank
  check (length(btrim(message)) > 0);

-- Written by the system as a price-and-name snapshot rather than typed, so it
-- cannot go blank once `menu_items.name` cannot. Included anyway: the
-- constraint costs nothing, and a snapshot column that silently accepted a
-- blank would be the hardest of these to notice — it only surfaces on a
-- historical bill nobody re-reads.
alter table public.bill_items
  add constraint bill_items_item_name_not_blank
  check (length(btrim(item_name)) > 0);
