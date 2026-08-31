-- The counter tablet's branch into the canonical expense record, and every
-- boundary it must still refuse.
--
-- `counter-expenses` went live in #38, so the Biller shell now carries a real
-- Expenses surface, and a billing-only tablet would strand it. The owner's
-- decision is that the tablet keeps it: the drawer is at the counter and the
-- person spending is usually the person billing.
--
-- This file exists as its own file because over-permission here is silent. The
-- tablet may record only through its live shift and may never edit the row.

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

create function pg_temp.rows_touched(q text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set DEVICE_KAL '10000000-0000-4000-a000-000000000004'
\set DEVICE_KPA '10000000-0000-4000-a000-000000000005'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

create function pg_temp.ledger_day(back int)
returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00') - back
$$;

-- ---------------------------------------------------------------------------
-- 1. The accept.

select pg_temp.impersonate(:'DEVICE_KAL'::uuid);

select lives_ok($q$
  insert into public.expenses
    (id, outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('cccccccc-0000-4000-a000-000000000001',
          '00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'raw_materials', true, 24000, 'Chicken, evening top-up')
$q$, 'a tablet holding a live shift records a cash expense for today at its own outlet');

-- Attribution comes from the shift row. The tablet does not know who is standing
-- at it — the database does, because it is the thing that opened the shift.
select is(
  (select recorded_by from public.expenses
    where id = 'cccccccc-0000-4000-a000-000000000001'),
  :'BILLER_KAL'::uuid,
  'and it is attributed to the person holding that shift, not to the tablet');

select is(
  (select recorded_away from public.expenses
    where id = 'cccccccc-0000-4000-a000-000000000001'),
  false,
  'and not marked from away, because the operator is assigned at that outlet');

-- The body naming somebody else is CORRECTED rather than refused, which is the
-- one place in this schema where that is the right answer: the tablet has no
-- business supplying a recorder at all, so there is nothing for it to learn from
-- a refusal and nothing it could do differently.
select lives_ok($q$
  insert into public.expenses
    (id, outlet_id, business_date, category, is_cash, amount_paise, description, recorded_by)
  values ('cccccccc-0000-4000-a000-000000000002',
          '00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 90000, 'Cylinder', '10000000-0000-4000-a000-000000000006')
$q$, 'a tablet naming a different recorder is accepted');

select is(
  (select recorded_by from public.expenses
    where id = 'cccccccc-0000-4000-a000-000000000002'),
  :'BILLER_KAL'::uuid,
  'and stored against the shift''s operator instead of the name it supplied');

-- The tablet reads its own outlet's expense list, which is what the surface
-- shows after recording one.
select ok(
  (select count(*) from public.expenses where outlet_id = :'KAL') > 0,
  'the tablet reads its own outlet''s expenses');

select is(
  (select count(*) from public.expenses where outlet_id = :'KPA'),
  0::bigint,
  'and none of the other outlet''s');

-- ---------------------------------------------------------------------------
-- 2. The refusals.

select throws_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000002',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 50000, 'Cylinder for the other shop')
$q$, '42501', null, 'a tablet cannot record an expense at another outlet');

select throws_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00') - 1,
          'gas', true, 50000, 'Yesterday''s cylinder')
$q$, 'P0001', null,
  'nor one for a past business date: a purchase noticed later is the manager''s to add');

-- Correcting and withdrawing stay with the person, on their own device. The
-- tablet is a shared surface and the row belongs to whoever recorded it.
select is(
  pg_temp.rows_touched($q$
    update public.expenses set amount_paise = 1
     where id = 'cccccccc-0000-4000-a000-000000000001' $q$),
  0::bigint,
  'a tablet cannot correct even the expense it just recorded');

-- ---------------------------------------------------------------------------
-- 3. No live shift, no ledger.

select pg_temp.unimpersonate();
select is(
  public.end_counter_shift(:'BILLER_KAL', '90000000-0000-4000-a000-000000000001'),
  'ok',
  'the operator steps off the counter');

select pg_temp.impersonate(:'DEVICE_KAL'::uuid);

select throws_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 50000, 'Cylinder')
$q$, '42501', null, 'a tablet with no live shift records nothing');

select is(
  (select count(*) from public.expenses),
  0::bigint,
  'and reads nothing either: the ledger reach is the shift''s, not the tablet''s');

-- ---------------------------------------------------------------------------
-- 4. A removed tablet, in case the shift outlives the hardware.

select pg_temp.unimpersonate();
select is(public.remove_counter_device(:'DEVICE_KPA', :'OWNER'), 'ok', 'the other tablet is removed');

select pg_temp.impersonate(:'DEVICE_KPA'::uuid);

select throws_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000002',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 50000, 'Cylinder')
$q$, '42501', null, 'a removed tablet records nothing, shift or no shift');

-- ---------------------------------------------------------------------------
-- 5. Nothing else moved. The canonical policy set is pinned by name.

select pg_temp.unimpersonate();

select is(
  (select string_agg(policyname, ', ' order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'expenses'),
  'expenses_insert, expenses_select, '
  'expenses_update',
  'the expense record still carries exactly three, with no delete policy');

-- ---------------------------------------------------------------------------
-- 6. The people are untouched.
--
-- The branch is additive: it must not have taken anything away from the staff
-- reach #38 opened. One assertion each, because 21_manual_ledger.sql pins the
-- rest exhaustively and this file only has to prove it did not break it.

select pg_temp.impersonate(:'BILLER_KAL'::uuid);

select lives_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 50000, 'Cylinder, from the phone')
$q$, 'the Biller still records an expense from their own device');

select pg_temp.impersonate(:'EMPLOYEE_KAL'::uuid);

select lives_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 20000, 'Tea')
$q$, 'and so does an Employee');

select * from finish();
rollback;
