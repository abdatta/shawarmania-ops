-- a-check-in-at-the-shop-approves-itself (#81), design D11: the owners' list an
-- expense's category is picked from. Every active account reads it; only an
-- owner changes it, and only through its three commands. A rename moves the
-- recorded expenses and is logged; a removal moves nothing. Nothing here
-- refuses an expense whose category is off the list.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

\set KAL '00000000-0000-4000-a000-000000000001'
\set OWNER '10000000-0000-4000-a000-000000000001'
\set MGR_KAL '10000000-0000-4000-a000-000000000002'
\set EMP_KAL '10000000-0000-4000-a000-000000000006'
\set DEVICE '10000000-0000-4000-a000-000000000004'
\set DEACTIVATED '10000000-0000-4000-a000-000000000008'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'

-- ---------------------------------------------------------------------------
-- The seed, and who reads it.

select is(
  (select string_agg(name, ', ' order by sort_order) from public.expense_category_choices),
  'Chicken, Raw Materials, Gas, Staff Food, Transport, Wages & bonus, Other',
  'the list starts as the seven choices, in order'
);
select is(
  (select string_agg(name, ', ' order by sort_order) from public.expense_category_choices where asks_note),
  'Other', 'only Other asks what it was for');
select is(
  (select string_agg(name, ', ' order by sort_order) from public.expense_category_choices where managers_only),
  'Wages & bonus', 'only Wages & bonus is for managers and owners');

select pg_temp.impersonate(:'EMP_KAL');
select is((select count(*) from public.expense_category_choices), 7::bigint,
  'an Employee reads the list');
select pg_temp.impersonate(:'BILLER_KAL');
select is((select count(*) from public.expense_category_choices), 7::bigint,
  'a Biller reads the list');
-- The tablet's own identity has no profile; it read nothing until the second
-- policy (production, 2026-10-30), which admits it only while the gate is on.
select pg_temp.impersonate(:'DEVICE');
select is((select count(*) from public.expense_category_choices), 0::bigint,
  'the counter tablet, signed in as itself, reads nothing while the gate is off');
reset role;
update public.change_gates set enabled = true
 where key in ('auto-approve-at-the-shop', 'refreshed-staff-screens', 'expense-category-list');
select pg_temp.impersonate(:'DEVICE');
select is((select count(*) from public.expense_category_choices), 7::bigint,
  'the counter tablet, signed in as itself, reads the list while the gate is on');
reset role;
update public.counter_devices set removed_at = now() where id = :'DEVICE';
select pg_temp.impersonate(:'DEVICE');
select is((select count(*) from public.expense_category_choices), 0::bigint,
  'a removed tablet reads nothing');
reset role;
update public.counter_devices set removed_at = null where id = :'DEVICE';
update public.change_gates set enabled = false
 where key in ('auto-approve-at-the-shop', 'refreshed-staff-screens', 'expense-category-list');
select pg_temp.impersonate(:'DEACTIVATED');
select is((select count(*) from public.expense_category_choices), 0::bigint,
  'a deactivated account reads nothing');
reset role;

-- ---------------------------------------------------------------------------
-- Nobody but an owner writes it.

create function pg_temp.refused(p_sub uuid, p_sql text, p_what text)
returns text language plpgsql as $$
declare v_result text;
begin
  perform pg_temp.impersonate(p_sub);
  begin
    execute p_sql;
    v_result := fail(p_what || ' (it was allowed)');
  exception when others then
    v_result := pass(p_what);
  end;
  execute 'reset role';
  return v_result;
end;
$$;

select pg_temp.refused(:'MGR_KAL',
  $q$select public.save_expense_category_choice(null, 'Test Manager', false, false)$q$,
  'a Franchise Admin cannot add a choice');
select pg_temp.refused(:'EMP_KAL',
  $q$select public.save_expense_category_choice(null, 'Test Employee', false, false)$q$,
  'an Employee cannot add a choice');
select pg_temp.refused(:'BILLER_KAL',
  $q$select public.remove_expense_category_choice((select id from public.expense_category_choices where name = 'Gas'))$q$,
  'a Biller cannot remove a choice');
select pg_temp.refused(:'DEVICE',
  $q$select public.move_expense_category_choice((select id from public.expense_category_choices where name = 'Gas'), 'up')$q$,
  'a tablet account cannot move a choice');
select pg_temp.refused(:'OWNER',
  $q$insert into public.expense_category_choices (name, sort_order) values ('Test Direct', 99)$q$,
  'not even an owner writes the table directly');
select pg_temp.refused(:'MGR_KAL',
  $q$update public.expense_category_choices set asks_note = true$q$,
  'a Franchise Admin cannot update the table directly');

select is(
  (select string_agg(name, ', ' order by sort_order) from public.expense_category_choices),
  'Chicken, Raw Materials, Gas, Staff Food, Transport, Wages & bonus, Other',
  'the refused attempts changed nothing'
);

-- ---------------------------------------------------------------------------
-- An owner adds, moves and removes.

select pg_temp.impersonate(:'OWNER');
select public.save_expense_category_choice(null, '  Test  Fuel ', false, false) as fuel_id \gset
reset role;

select is(
  (select name || ' ' || sort_order from public.expense_category_choices where id = :'fuel_id'),
  'Test Fuel 8', 'an added choice is normalised and goes last');
select ok(exists (select 1 from public.expense_categories where name = 'Test Fuel'),
  'an added choice is also a suggestion, so Merge can offer it');

select pg_temp.refused(:'OWNER',
  $q$select public.save_expense_category_choice(null, 'test fuel', false, false)$q$,
  'a name already on the list, in any case, is refused');
select pg_temp.refused(:'OWNER',
  $q$select public.save_expense_category_choice(null, 'Hyperpure', false, false)$q$,
  'a reserved name is refused');
select pg_temp.refused(:'OWNER',
  $q$select public.save_expense_category_choice(null, '   ', false, false)$q$,
  'a blank name is refused');

select pg_temp.impersonate(:'OWNER');
select public.move_expense_category_choice(:'fuel_id', 'up');
reset role;
select is(
  (select string_agg(name, ', ' order by sort_order) from public.expense_category_choices),
  'Chicken, Raw Materials, Gas, Staff Food, Transport, Wages & bonus, Test Fuel, Other',
  'a move up swaps it with the one above');

select pg_temp.impersonate(:'OWNER');
select public.move_expense_category_choice(
  (select id from public.expense_category_choices where name = 'Chicken'), 'up');
reset role;
select is(
  (select name from public.expense_category_choices order by sort_order limit 1),
  'Chicken', 'moving the first choice up does nothing');

-- ---------------------------------------------------------------------------
-- A rename moves the recorded rows and is logged.

insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, recorded_by)
values
  (:'KAL', current_date - 10, 'Test Fuel', true, 10000, :'OWNER'),
  (:'KAL', current_date - 9, 'Test Fuel', true, 12000, :'OWNER');

select pg_temp.impersonate(:'OWNER');
select public.save_expense_category_choice(:'fuel_id', 'Test Petrol', false, true);
reset role;

select is(
  (select name || ' ' || managers_only from public.expense_category_choices where id = :'fuel_id'),
  'Test Petrol true', 'an edit renames the choice and changes who picks it');
select is((select count(*) from public.expenses where category = 'Test Petrol'), 2::bigint,
  'the recorded expenses move to the new name');
select is((select count(*) from public.expenses where category = 'Test Fuel'), 0::bigint,
  'none is left under the old name');
select is(
  (select operation || ' ' || name_before || ' > ' || name_after || ' ' || expense_rows_moved
     from public.expense_category_operations order by performed_at desc, id limit 1),
  'rename Test Fuel > Test Petrol 2', 'the rename is logged with what it moved');

-- A rename onto a name that is already a suggestion is a merge.
insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, recorded_by)
values (:'KAL', current_date - 8, 'Test Tiffin', true, 5000, :'OWNER');

select pg_temp.impersonate(:'OWNER');
select public.save_expense_category_choice(null, 'Test Snacks', false, false) as snacks_id \gset
reset role;
insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, recorded_by)
values (:'KAL', current_date - 8, 'Test Snacks', true, 3000, :'OWNER');

select pg_temp.impersonate(:'OWNER');
select public.save_expense_category_choice(:'snacks_id', 'Test Tiffin', false, false);
reset role;
select is((select count(*) from public.expenses where category = 'Test Tiffin'), 2::bigint,
  'renaming onto an existing suggestion merges the rows into it');
select ok(not exists (select 1 from public.expense_categories where name = 'Test Snacks'),
  'and the old suggestion is gone');

-- ---------------------------------------------------------------------------
-- A removal moves nothing, and nothing refuses a name off the list.

select pg_temp.impersonate(:'OWNER');
select public.remove_expense_category_choice(:'fuel_id');
reset role;
select ok(not exists (select 1 from public.expense_category_choices where id = :'fuel_id'),
  'a removed choice leaves the list');
select is((select count(*) from public.expenses where category = 'Test Petrol'), 2::bigint,
  'its recorded expenses keep their name');
select ok(exists (select 1 from public.expense_categories where name = 'Test Petrol'),
  'and its suggestion stays');

select pg_temp.impersonate(:'OWNER');
select lives_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, recorded_by)
  values ('00000000-0000-4000-a000-000000000001', current_date - 7, 'Test Off The List', true, 100,
          '10000000-0000-4000-a000-000000000001')
$q$, 'an expense under a name off the list is still recorded');
reset role;

-- ---------------------------------------------------------------------------
-- The gate's row, off, depending on the refreshed screens.

select is(
  (select enabled from public.change_gates where key = 'expense-category-list'), false,
  'the gate is declared off');
select is(
  (select depends_on from public.change_gate_dependencies where gate_key = 'expense-category-list'),
  'refreshed-staff-screens', 'and depends on the refreshed screens');

select * from finish();
rollback;
