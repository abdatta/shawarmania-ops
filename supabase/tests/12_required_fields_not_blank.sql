-- A required text field cannot be blank, and the database is what says so.
--
-- Twelve columns across eight tables, each `not null` and each carrying a new
-- `<table>_<column>_not_blank` check. This file asserts the boundary itself —
-- every statement here is hand-crafted and runs with RLS out of the way,
-- because the claim under test is that the *database* refuses a blank, not
-- that a form does. The forms refuse it too, and that is proved in the
-- component tests, where it belongs.
--
-- Two shapes of blank are tested everywhere: `''`, which a `not null` column
-- already accepted, and `'   '`, which is the one a naive
-- `<> ''` guard would still let through. `btrim` is why both fail.
--
-- Insert and update are tested separately on the columns whose forms exist.
-- The create path is not the only way in: clearing a name while editing is the
-- same mistake as never typing one, and one component serves both.
--
-- For the seven columns whose surfaces are still ahead — menu, inventory,
-- messaging, and the bill-item snapshot — insert is tested and update is not.
-- They have no form to guard them until #6, #7 and #11 arrive, so these
-- assertions are the only thing standing behind those constraints today.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- Seeded ids. Nothing here is created except where a row is genuinely needed
-- as a parent, and the whole file rolls back.
--                 outlet Kalyani  00000000-…0001
--                 owner profile   10000000-…0001
--                 menu category   30000000-…0001
--                 a settled bill  50000000-…0001

-- ── outlets.name ─────────────────────────────────────────────────────────────

select throws_ok($$
  insert into public.outlets (code, name, location_label)
  values ('blank-name', '', 'Somewhere')
$$, '23514', null, 'an outlet cannot be inserted with an empty name');

select throws_ok($$
  insert into public.outlets (code, name, location_label)
  values ('ws-name', '   ', 'Somewhere')
$$, '23514', null, 'an outlet cannot be inserted with a whitespace-only name');

-- ── outlets.code ─────────────────────────────────────────────────────────────

select throws_ok($$
  insert into public.outlets (code, name, location_label)
  values ('', 'Blank Code Outlet', 'Somewhere')
$$, '23514', null, 'an outlet cannot be inserted with an empty code');

select throws_ok($$
  insert into public.outlets (code, name, location_label)
  values ('   ', 'Whitespace Code Outlet', 'Somewhere')
$$, '23514', null, 'an outlet cannot be inserted with a whitespace-only code');

-- ── outlets.location_label ───────────────────────────────────────────────────

select throws_ok($$
  insert into public.outlets (code, name, location_label)
  values ('blank-label', 'Blank Label Outlet', '')
$$, '23514', null, 'an outlet cannot be inserted with an empty location label');

select throws_ok($$
  insert into public.outlets (code, name, location_label)
  values ('ws-label', 'Whitespace Label Outlet', '   ')
$$, '23514', null, 'an outlet cannot be inserted with a whitespace-only location label');

-- ── outlets, on update ───────────────────────────────────────────────────────
--
-- The form is one component for create and edit both, so the edit path is a
-- way in that a create-only guard would miss entirely.

select throws_ok($$
  update public.outlets set name = ''
   where id = '00000000-0000-4000-a000-000000000001'
$$, '23514', null, 'an existing outlet cannot have its name cleared');

select throws_ok($$
  update public.outlets set name = '   '
   where id = '00000000-0000-4000-a000-000000000001'
$$, '23514', null, 'an existing outlet cannot have its name blanked with spaces');

select throws_ok($$
  update public.outlets set code = ''
   where id = '00000000-0000-4000-a000-000000000001'
$$, '23514', null, 'an existing outlet cannot have its code cleared');

select throws_ok($$
  update public.outlets set location_label = '   '
   where id = '00000000-0000-4000-a000-000000000001'
$$, '23514', null, 'an existing outlet cannot have its location label blanked');

-- ── The constraint refuses blanks and nothing else ───────────────────────────

select lives_ok($$
  insert into public.outlets (id, code, name, location_label)
  values ('00000000-0000-4000-a000-0000000000b1', 'ordinary', 'Ordinary Outlet', 'Somewhere')
$$, 'an outlet with ordinary values still inserts');

select lives_ok($$
  update public.outlets set name = 'Renamed Outlet'
   where id = '00000000-0000-4000-a000-0000000000b1'
$$, 'an outlet with ordinary values still updates');

-- A single leading space is not a blank. The rule is emptiness after trimming,
-- not the absence of whitespace — this is the case that would fail if someone
-- later "tidied" the check into `name <> btrim(name)`.
select lives_ok($$
  update public.outlets set name = ' Padded Name '
   where id = '00000000-0000-4000-a000-0000000000b1'
$$, 'a name with surrounding whitespace but real content is accepted');

-- ── employees.full_name ──────────────────────────────────────────────────────
--
-- outlet_id and employee_code are supplied and valid throughout, so the check
-- constraint is the only thing that can fail. A test that let the foreign key
-- fire first would assert 23503 and prove nothing about blankness.

select throws_ok($$
  insert into public.employees (outlet_id, employee_code, full_name)
  values ('00000000-0000-4000-a000-000000000001', 'BLANK-1', '')
$$, '23514', null, 'a roster row cannot be inserted with an empty full name');

select throws_ok($$
  insert into public.employees (outlet_id, employee_code, full_name)
  values ('00000000-0000-4000-a000-000000000001', 'BLANK-2', '   ')
$$, '23514', null, 'a roster row cannot be inserted with a whitespace-only full name');

select lives_ok($$
  insert into public.employees (id, outlet_id, employee_code, full_name)
  values ('20000000-0000-4000-a000-0000000000b1',
          '00000000-0000-4000-a000-000000000001', 'BLANK-OK', 'Ordinary Person')
$$, 'a roster row with a real name still inserts');

select throws_ok($$
  update public.employees set full_name = ''
   where id = '20000000-0000-4000-a000-0000000000b1'
$$, '23514', null, 'an existing roster row cannot have its full name cleared');

select throws_ok($$
  update public.employees set full_name = '   '
   where id = '20000000-0000-4000-a000-0000000000b1'
$$, '23514', null, 'an existing roster row cannot have its full name blanked with spaces');

-- ── profiles.full_name ───────────────────────────────────────────────────────
--
-- A profile is keyed to an auth user, so one is created here rather than
-- borrowed. Everything rolls back.

insert into auth.users
  (instance_id, id, aud, role, email, email_confirmed_at, encrypted_password,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change_token_new,
   email_change_token_current, email_change, phone_change,
   phone_change_token, reauthentication_token, is_sso_user)
values
  ('00000000-0000-0000-0000-000000000000',
   '10000000-0000-4000-a000-0000000000b1', 'authenticated', 'authenticated',
   'blank.test@example.com', now(), 'x',
   '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
   now(), now(), '', '', '', '', '', '', '', '', false);

select throws_ok($$
  insert into public.profiles (id, full_name, role, outlet_id)
  values ('10000000-0000-4000-a000-0000000000b1', '', 'franchise_admin',
          '00000000-0000-4000-a000-000000000001')
$$, '23514', null, 'an account cannot be inserted with an empty full name');

select throws_ok($$
  insert into public.profiles (id, full_name, role, outlet_id)
  values ('10000000-0000-4000-a000-0000000000b1', '   ', 'franchise_admin',
          '00000000-0000-4000-a000-000000000001')
$$, '23514', null, 'an account cannot be inserted with a whitespace-only full name');

select lives_ok($$
  insert into public.profiles (id, full_name, role, outlet_id)
  values ('10000000-0000-4000-a000-0000000000b1', 'Ordinary Account',
          'franchise_admin', '00000000-0000-4000-a000-000000000001')
$$, 'an account with a real name still inserts');

select throws_ok($$
  update public.profiles set full_name = ''
   where id = '10000000-0000-4000-a000-0000000000b1'
$$, '23514', null, 'an existing account cannot have its full name cleared');

select throws_ok($$
  update public.profiles set full_name = '   '
   where id = '10000000-0000-4000-a000-0000000000b1'
$$, '23514', null, 'an existing account cannot have its full name blanked with spaces');

-- ── Columns whose surfaces are still ahead ───────────────────────────────────
--
-- No form fills these yet. That is the reason they are guarded now and the
-- reason these assertions matter: when #6, #7 and #11 build those screens,
-- the boundary is already there and already proved.

select throws_ok($$
  insert into public.menu_categories (outlet_id, name)
  values ('00000000-0000-4000-a000-000000000001', '')
$$, '23514', null, 'a menu category cannot be inserted with an empty name');

select throws_ok($$
  insert into public.menu_categories (outlet_id, name)
  values ('00000000-0000-4000-a000-000000000001', '   ')
$$, '23514', null, 'a menu category cannot be inserted with a whitespace-only name');

select throws_ok($$
  insert into public.menu_items (outlet_id, category_id, name, price_paise)
  values ('00000000-0000-4000-a000-000000000001',
          '30000000-0000-4000-a000-000000000001', '', 9900)
$$, '23514', null, 'a menu item cannot be inserted with an empty name');

select throws_ok($$
  insert into public.menu_items (outlet_id, category_id, name, price_paise)
  values ('00000000-0000-4000-a000-000000000001',
          '30000000-0000-4000-a000-000000000001', '   ', 9900)
$$, '23514', null, 'a menu item cannot be inserted with a whitespace-only name');

select throws_ok($$
  insert into public.inventory_items (outlet_id, name, unit)
  values ('00000000-0000-4000-a000-000000000001', '', 'kg')
$$, '23514', null, 'an inventory item cannot be inserted with an empty name');

select throws_ok($$
  insert into public.inventory_items (outlet_id, name, unit)
  values ('00000000-0000-4000-a000-000000000001', '   ', 'kg')
$$, '23514', null, 'an inventory item cannot be inserted with a whitespace-only name');

select throws_ok($$
  insert into public.alerts (outlet_id, raised_by, subject, message, category)
  values ('00000000-0000-4000-a000-000000000001',
          '10000000-0000-4000-a000-000000000001', '', 'Body text', 'other')
$$, '23514', null, 'an alert cannot be inserted with an empty subject');

select throws_ok($$
  insert into public.alerts (outlet_id, raised_by, subject, message, category)
  values ('00000000-0000-4000-a000-000000000001',
          '10000000-0000-4000-a000-000000000001', '   ', 'Body text', 'other')
$$, '23514', null, 'an alert cannot be inserted with a whitespace-only subject');

select throws_ok($$
  insert into public.alerts (outlet_id, raised_by, subject, message, category)
  values ('00000000-0000-4000-a000-000000000001',
          '10000000-0000-4000-a000-000000000001', 'A subject', '', 'other')
$$, '23514', null, 'an alert cannot be inserted with an empty message');

select throws_ok($$
  insert into public.alerts (outlet_id, raised_by, subject, message, category)
  values ('00000000-0000-4000-a000-000000000001',
          '10000000-0000-4000-a000-000000000001', 'A subject', '   ', 'other')
$$, '23514', null, 'an alert cannot be inserted with a whitespace-only message');

select throws_ok($$
  insert into public.alert_responses (alert_id, responder_profile_id, message)
  values ('70000000-0000-4000-a000-000000000001',
          '10000000-0000-4000-a000-000000000001', '')
$$, '23514', null, 'an alert response cannot be inserted with an empty message');

select throws_ok($$
  insert into public.alert_responses (alert_id, responder_profile_id, message)
  values ('70000000-0000-4000-a000-000000000001',
          '10000000-0000-4000-a000-000000000001', '   ')
$$, '23514', null, 'an alert response cannot be inserted with a whitespace-only message');

-- The bill-item snapshot. Written by the system rather than typed, which is
-- exactly why a blank here would be the hardest of all twelve to notice.
-- The line arithmetic is satisfied so that only the name check can fail.

select throws_ok($$
  insert into public.bill_items
    (bill_id, item_name, unit_price_paise, quantity, line_total_paise)
  values ('50000000-0000-4000-a000-000000000001', '', 100, 1, 100)
$$, '23514', null, 'a bill item cannot be inserted with an empty name');

select throws_ok($$
  insert into public.bill_items
    (bill_id, item_name, unit_price_paise, quantity, line_total_paise)
  values ('50000000-0000-4000-a000-000000000001', '   ', 100, 1, 100)
$$, '23514', null, 'a bill item cannot be inserted with a whitespace-only name');

-- ── The constraints exist under the names the convention promises ────────────
--
-- Asserted by name because the naming is the contract: a later migration that
-- drops and re-adds one under a different name would otherwise pass this file
-- while breaking every reference to it.

select bag_eq($$
  select conname::text
    from pg_catalog.pg_constraint
   where conname like '%\_not\_blank'
     and connamespace = 'public'::regnamespace
$$, $$ values
  ('employees_code_not_blank'),
  ('attendance_override_reason_not_blank'),
  ('outlets_name_not_blank'),
  ('outlets_code_not_blank'),
  ('outlets_location_label_not_blank'),
  ('employees_full_name_not_blank'),
  ('profiles_full_name_not_blank'),
  ('menu_categories_name_not_blank'),
  ('menu_items_name_not_blank'),
  ('inventory_items_name_not_blank'),
  ('alerts_subject_not_blank'),
  ('alerts_message_not_blank'),
  ('alert_responses_message_not_blank'),
  ('bill_items_item_name_not_blank')
$$, 'every not-blank constraint in the schema is accounted for, and no others exist');

select * from finish();
rollback;
