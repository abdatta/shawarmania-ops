-- Outlet staff reach only the expenses that leave the drawer.
--
-- `staff-see-only-what-leaves-the-drawer` (#65). On the first days of a month the
-- owner records salaries, rent and the vendors billed monthly, and every one of
-- those rows was readable by every Biller and Employee at the outlet. The owner's
-- rule [2026-10-01]: staff need only the expenses that came out of the drawer,
-- because that is the only money a staff member handles.
--
-- This file is its own gate for the same reason 24_counter_tablet_expense.sql
-- is: over-permission here passes every functional test. Each read assertion
-- names the rows seen, so a policy written a clause too wide fails, and so does
-- one written a clause too narrow.

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

create function pg_temp.unimpersonate()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.today(p_outlet uuid)
returns date language sql stable as $$
  select public.app_business_date(now(), o.business_day_cutover)
    from public.outlets o where o.id = p_outlet
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set DEVICE_KAL '10000000-0000-4000-a000-000000000004'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

\set CASH_KAL 'dddddddd-0000-4000-a000-000000000001'
\set SALARY_KAL 'dddddddd-0000-4000-a000-000000000002'
\set HYPERPURE_KAL 'dddddddd-0000-4000-a000-000000000003'
\set CASH_KPA 'dddddddd-0000-4000-a000-000000000004'
\set BILLER_OWN 'dddddddd-0000-4000-a000-000000000005'

-- ---------------------------------------------------------------------------
-- 0. One day at Kalyani holding the three kinds of expense the rule separates,
--    and one cash expense at the other outlet. Seeded as the database owner so
--    nothing here depends on the policies under test.

insert into public.expenses
  (id, outlet_id, business_date, category, is_cash, amount_paise, description, recorded_by)
values
  (:'CASH_KAL', :'KAL', pg_temp.today(:'KAL'), 'Vegetables', true, 18000,
   'Onions', :'FA_KAL'),
  (:'SALARY_KAL', :'KAL', pg_temp.today(:'KAL'), 'Salary', false, 1500000,
   'September salary', :'OWNER'),
  (:'CASH_KPA', :'KPA', pg_temp.today(:'KPA'), 'Vegetables', true, 9000,
   'Tomatoes', :'OWNER');

insert into public.expenses
  (id, outlet_id, business_date, category, is_cash, amount_paise, description,
   recorded_by, source_system, source_ref)
values
  (:'HYPERPURE_KAL', :'KAL', pg_temp.today(:'KAL'), 'Hyperpure', false, 420000,
   'Hyperpure order', null, 'hyperpure', 'test-order-67');

-- Which of the four seeded rows the current session can read, by description.
create function pg_temp.visible()
returns text language sql stable as $$
  select coalesce(string_agg(x.description, ', ' order by x.description), '')
    from public.expenses x
   where x.id in ('dddddddd-0000-4000-a000-000000000001',
                  'dddddddd-0000-4000-a000-000000000002',
                  'dddddddd-0000-4000-a000-000000000003',
                  'dddddddd-0000-4000-a000-000000000004')
$$;

-- ---------------------------------------------------------------------------
-- 1. Reads.

select pg_temp.impersonate(:'BILLER_KAL'::uuid);
select is(pg_temp.visible(), 'Onions',
  'a Biller reads their outlet''s cash expense, and not the salary, the Hyperpure order or the other outlet');

select pg_temp.impersonate(:'EMPLOYEE_KAL'::uuid);
select is(pg_temp.visible(), 'Onions', 'so does an Employee');

select pg_temp.impersonate(:'DEVICE_KAL'::uuid);
select is(pg_temp.visible(), 'Onions', 'and so does a tablet holding a live shift');

-- The view the Ledger and the drawer read is security_invoker, so it must
-- inherit the narrowing rather than route around it.
select pg_temp.impersonate(:'BILLER_KAL'::uuid);
select is(
  (select count(*) from public.effective_expenses
    where id in (:'SALARY_KAL', :'HYPERPURE_KAL')),
  0::bigint,
  'the effective_expenses view shows a Biller no non-cash row either');

select pg_temp.impersonate(:'FA_KAL'::uuid);
select is(pg_temp.visible(), 'Hyperpure order, Onions, September salary',
  'a manager still reads every expense at their outlet, and nothing at the other');

select pg_temp.impersonate(:'OWNER'::uuid);
select is(pg_temp.visible(), 'Hyperpure order, Onions, September salary, Tomatoes',
  'the owner still reads every expense at every outlet');

-- ---------------------------------------------------------------------------
-- 2. Writes. The refusal is the guard's sentence, not the generic RLS one,
--    because the counter's outbox keeps the server's words for the operator.

select pg_temp.impersonate(:'BILLER_KAL'::uuid);
select throws_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'Gas', false, 90000, 'Cylinder by UPI')
$q$, '42501',
  'staff record only what leaves the drawer; a manager or the owner records the rest',
  'a Biller cannot record a non-cash expense');

select pg_temp.impersonate(:'EMPLOYEE_KAL'::uuid);
select throws_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'Gas', false, 90000, 'Cylinder by UPI')
$q$, '42501',
  'staff record only what leaves the drawer; a manager or the owner records the rest',
  'nor can an Employee');

select pg_temp.impersonate(:'DEVICE_KAL'::uuid);
select throws_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'Gas', false, 90000, 'Cylinder by UPI')
$q$, '42501',
  'staff record only what leaves the drawer; a manager or the owner records the rest',
  'nor can a tablet holding a live shift');

-- Not over-narrowed: cash still goes in, and a correction that keeps it cash
-- still goes through.
select pg_temp.impersonate(:'BILLER_KAL'::uuid);
select lives_ok(format($q$
  insert into public.expenses
    (id, outlet_id, business_date, category, is_cash, amount_paise, description)
  values (%L, '00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'Gas', true, 90000, 'Cylinder from the drawer')
$q$, :'BILLER_OWN'), 'a Biller still records a cash expense');

select lives_ok(format($q$
  update public.expenses set amount_paise = 95000 where id = %L
$q$, :'BILLER_OWN'), 'and still corrects its amount on the running day');

select throws_ok(format($q$
  update public.expenses set is_cash = false where id = %L
$q$, :'BILLER_OWN'), '42501',
  'staff record only what leaves the drawer; a manager or the owner records the rest',
  'but cannot turn it into a non-cash expense');

select pg_temp.unimpersonate();
select is(
  (select is_cash from public.expenses where id = :'BILLER_OWN'),
  true,
  'and the row is still cash');

select pg_temp.impersonate(:'FA_KAL'::uuid);
select lives_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'Rent', false, 2750000, 'October rent')
$q$, 'a manager still records a non-cash expense');

select pg_temp.impersonate(:'OWNER'::uuid);
select lives_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000002',
          public.app_business_date(now(), time '04:00'),
          'Salary', false, 1200000, 'October salary')
$q$, 'and so does the owner, at an outlet they hold no assignment at');

-- ---------------------------------------------------------------------------
-- 3. The drawer counts every cash expense, whoever may read it. Its reader is
--    security definer, so the narrowing must not have reached it.

select pg_temp.unimpersonate();
create temp table expected_cash as
  select coalesce(sum(amount_paise), 0)::bigint as paise
    from public.expenses
   where outlet_id = '00000000-0000-4000-a000-000000000001'
     and is_cash and voided_at is null
     and coalesce(occurred_at, created_at) <= now();
grant select on expected_cash to authenticated;

select pg_temp.impersonate(:'FA_KAL'::uuid);
select is(
  public.drawer_cash_expenses_paise(:'KAL'::uuid, null, now()),
  (select paise from expected_cash),
  'the drawer''s expense term is every cash expense at the outlet, including the ones staff recorded');

select ok(
  (select paise from expected_cash) >= 18000 + 95000,
  'and that sum includes the manager''s and the Biller''s cash rows');

select pg_temp.unimpersonate();
select * from finish();
rollback;
