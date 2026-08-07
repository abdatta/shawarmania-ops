-- Expense categories are business-wide suggestions, while every recorded row
-- snapshots the text it was given. Curation is the only path that rewrites
-- history, and it is an owner-only transaction with one durable log row.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text,
    true);
  execute 'set local role authenticated';
end;
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set BILLER_KPA '10000000-0000-4000-a000-00000000000b'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set EMPLOYEE_KPA '10000000-0000-4000-a000-000000000007'
\set DEACTIVATED '10000000-0000-4000-a000-000000000008'
\set KAL '00000000-0000-4000-a000-000000000001'

-- The same table of inputs as src/domain/expense-category.test.ts.
select is(public.normalize_expense_category('  Chicken'), 'Chicken', 'leading whitespace');
select is(public.normalize_expense_category('Chicken  '), 'Chicken', 'trailing whitespace');
select is(public.normalize_expense_category('Staff   Food'), 'Staff Food', 'internal spaces');
select is(public.normalize_expense_category(E'Staff\tFood'), 'Staff Food', 'a tab');
select is(public.normalize_expense_category('Staff' || chr(160) || 'Food'), 'Staff Food',
  'a non-breaking space');
select is(public.normalize_expense_category('Hyperpure'), 'Hyperpure', 'already normalised');

select pg_temp.impersonate(:'OWNER');
insert into public.expense_categories (name) values ('Chicken') on conflict do nothing;
reset role;

select string_agg(name, ', ' order by name) as expected_categories
  from public.expense_categories \gset

create function pg_temp.same_list(persona text, p_sub uuid, expected text)
returns text language plpgsql as $$
declare actual text;
begin
  perform pg_temp.impersonate(p_sub);
  execute 'select string_agg(name, '', '' order by name) from public.expense_categories'
    into actual;
  execute 'reset role';
  return is(actual, expected, format('%s reads the same business-wide category list', persona));
end;
$$;

select pg_temp.same_list('fa_kalyani', :'FA_KAL', :'expected_categories');
select pg_temp.same_list('fa_kanchrapara', :'FA_KPA', :'expected_categories');
select pg_temp.same_list('biller_kalyani', :'BILLER_KAL', :'expected_categories');
select pg_temp.same_list('biller_kanchrapara', :'BILLER_KPA', :'expected_categories');
select pg_temp.same_list('employee_kalyani', :'EMPLOYEE_KAL', :'expected_categories');
select pg_temp.same_list('employee_kanchrapara', :'EMPLOYEE_KPA', :'expected_categories');

select pg_temp.impersonate(:'DEACTIVATED');
select is((select count(*) from public.expense_categories), 0::bigint,
  'a deactivated account reads no category suggestions');
reset role;

-- The future writer set can mint a word now, before #38 opens the expense rows.
select pg_temp.impersonate(:'BILLER_KAL');
select lives_ok($q$insert into public.expense_categories (name) values ('Biller Minted')$q$,
  'an active biller may mint a category for the expense path #38 opens');
reset role;

select pg_temp.impersonate(:'OWNER');
select throws_ok($q$
  insert into public.expense_categories (name) values ('chicken')
$q$, '23505', null, 'case alone cannot create a second category');
select throws_ok($q$
  insert into public.expense_categories (name) values ('  Chicken  ')
$q$, '23514', null, 'surrounding whitespace is refused by the stored-value check');
select throws_ok($q$
  insert into public.expense_categories (name) values ('Staff  Food')
$q$, '23514', null, 'repeated internal whitespace is refused too');

select throws_ok(
  format($q$
    insert into public.manual_ledger_expenses
      (outlet_id, business_date, category, is_cash, amount_paise, recorded_by)
    values (%L, current_date - 10, '', false, 100, %L)
  $q$, :'KAL', :'OWNER'),
  '23514', null, 'a blank manual-ledger category is refused');

select throws_ok(
  format($q$
    insert into public.expenses
      (outlet_id, business_date, category, amount_paise, payment_method, recorded_by)
    values (%L, current_date - 10, '', 100, 'upi', %L)
  $q$, :'KAL', :'OWNER'),
  '23514', null, 'a blank live-expense category is refused');

-- Build one row in each expense record under the same source word. The words
-- here are deliberately ones the seed does not use: these assertions count
-- rows absolutely, so a category the seed also mints would make them fail for
-- a reason that has nothing to do with merging.
insert into public.manual_ledger_expenses
  (outlet_id, business_date, category, is_cash, amount_paise, recorded_by)
values (:'KAL', current_date - 10, 'Test Poultry', false, 100, :'OWNER');
insert into public.expenses
  (outlet_id, business_date, category, amount_paise, payment_method, recorded_by)
values (:'KAL', current_date - 10, 'Test Poultry', 200, 'upi', :'OWNER');
insert into public.expense_categories (name) values ('Test Larder') on conflict do nothing;
reset role;

select pg_temp.impersonate(:'FA_KAL');
select throws_ok($q$
  select * from public.rename_expense_category('Test Poultry', 'Test Meat', true)
$q$, '42501', null, 'a non-owner cannot rename a category');
select throws_ok($q$
  select * from public.merge_expense_category('Test Poultry', 'Test Larder')
$q$, '42501', null, 'a non-owner cannot merge categories');
reset role;

select is((select count(*) from public.manual_ledger_expenses where category = 'Test Poultry'),
  1::bigint, 'the refused operations changed no manual-ledger row');
select is((select count(*) from public.expenses where category = 'Test Poultry'),
  1::bigint, 'the refused operations changed no live-expense row');

select pg_temp.impersonate(:'OWNER');
select is(
  (select ledger_rows_moved from public.merge_expense_category('Test Poultry', 'Test Larder')),
  1::bigint,
  'merge reports the manual-ledger rows it moved');
reset role;

select is((select count(*) from public.manual_ledger_expenses where category = 'Test Larder'),
  1::bigint, 'merge rewrites the manual-ledger row');
select is((select count(*) from public.expenses where category = 'Test Larder'),
  1::bigint, 'merge rewrites the live-expense row');
select is((select count(*) from public.expense_categories where lower(name) = 'test poultry'),
  0::bigint, 'the merged-away suggestion is gone');
select is((select count(*) from public.expense_category_operations
  where operation = 'merge' and name_before = 'Test Poultry' and name_after = 'Test Larder'
    and ledger_rows_moved = 1 and expense_rows_moved = 1),
  1::bigint, 'one durable operation row records both moved counts');

select pg_temp.impersonate(:'OWNER');
insert into public.expense_categories (name) values ('Temporary');
insert into public.manual_ledger_expenses
  (outlet_id, business_date, category, is_cash, amount_paise, recorded_by)
values (:'KAL', current_date - 11, 'Temporary', false, 300, :'OWNER');
select public.retire_expense_category('Temporary');
reset role;

select is((select count(*) from public.expense_categories where name = 'Temporary'),
  0::bigint, 'retire removes the suggestion');
select is((select count(*) from public.manual_ledger_expenses where category = 'Temporary'),
  1::bigint, 'retire changes no recorded expense');
select is((select count(*) from public.expense_category_operations),
  1::bigint, 'retire writes no operation row because it rewrites no history');

select * from finish();
rollback;
