-- The one branch this change opens in the manual ledger, and everything it must
-- still refuse.
--
-- `counter-expenses` went live in #38, so the Biller shell now carries a real
-- Expenses surface, and a billing-only tablet would strand it. The owner's
-- decision is that the tablet keeps it: the drawer is at the counter and the
-- person spending is usually the person billing.
--
-- This file exists as its own file, with its own gate, because **over-permission
-- here is silent**. A tablet that could write a day record would look exactly
-- like a tablet that cannot, right up until a drawer reconciled that should not
-- have. So the assertions below are mostly refusals, and the last section pins
-- the policy set on both tables so a future migration that widens one of them
-- has to come through here.
--
-- The month figure the owner reads is derived from `manual_ledger_days` in the
-- client; there is no aggregate object in the database. Refusing the day record
-- IS refusing the month, and that is why there is no separate assertion for it.

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
  insert into public.manual_ledger_expenses
    (id, outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('cccccccc-0000-4000-a000-000000000001',
          '00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'raw_materials', true, 24000, 'Chicken, evening top-up')
$q$, 'a tablet holding a live shift records a cash expense for today at its own outlet');

-- Attribution comes from the shift row. The tablet does not know who is standing
-- at it — the database does, because it is the thing that opened the shift.
select is(
  (select recorded_by from public.manual_ledger_expenses
    where id = 'cccccccc-0000-4000-a000-000000000001'),
  :'BILLER_KAL'::uuid,
  'and it is attributed to the person holding that shift, not to the tablet');

select is(
  (select recorded_away from public.manual_ledger_expenses
    where id = 'cccccccc-0000-4000-a000-000000000001'),
  false,
  'and not marked from away, because the operator is assigned at that outlet');

-- The body naming somebody else is CORRECTED rather than refused, which is the
-- one place in this schema where that is the right answer: the tablet has no
-- business supplying a recorder at all, so there is nothing for it to learn from
-- a refusal and nothing it could do differently.
select lives_ok($q$
  insert into public.manual_ledger_expenses
    (id, outlet_id, business_date, category, is_cash, amount_paise, description, recorded_by)
  values ('cccccccc-0000-4000-a000-000000000002',
          '00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 90000, 'Cylinder', '10000000-0000-4000-a000-000000000006')
$q$, 'a tablet naming a different recorder is accepted');

select is(
  (select recorded_by from public.manual_ledger_expenses
    where id = 'cccccccc-0000-4000-a000-000000000002'),
  :'BILLER_KAL'::uuid,
  'and stored against the shift''s operator instead of the name it supplied');

-- The tablet reads its own outlet's expense list, which is what the surface
-- shows after recording one.
select ok(
  (select count(*) from public.manual_ledger_expenses where outlet_id = :'KAL') > 0,
  'the tablet reads its own outlet''s expenses');

select is(
  (select count(*) from public.manual_ledger_expenses where outlet_id = :'KPA'),
  0::bigint,
  'and none of the other outlet''s');

-- ---------------------------------------------------------------------------
-- 2. The refusals.

select throws_ok($q$
  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000002',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 50000, 'Cylinder for the other shop')
$q$, '42501', null, 'a tablet cannot record an expense at another outlet');

select throws_ok($q$
  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00') - 1,
          'gas', true, 50000, 'Yesterday''s cylinder')
$q$, 'P0001', null,
  'nor one for a past business date: a purchase noticed later is the manager''s to add');

-- The day record, on every verb. This is the assertion the whole file is for.
select is(
  (select count(*) from public.manual_ledger_days where outlet_id = :'KAL'),
  0::bigint,
  'a tablet reads no day record at its own outlet, so it reads no month total either');

select throws_ok($q$
  insert into public.manual_ledger_days
    (outlet_id, business_date, opening_cash_paise, counted_cash_paise)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'), 0, 500000)
$q$, '42501', null, 'and cannot write one');

select is(
  pg_temp.rows_touched($q$
    update public.manual_ledger_days set counted_cash_paise = 1
     where outlet_id = '00000000-0000-4000-a000-000000000001' $q$),
  0::bigint,
  'nor reach one for update');

select is(
  pg_temp.rows_touched($q$
    delete from public.manual_ledger_days
     where outlet_id = '00000000-0000-4000-a000-000000000001' $q$),
  0::bigint,
  'nor for delete');

-- Correcting and withdrawing stay with the person, on their own device. The
-- tablet is a shared surface and the row belongs to whoever recorded it.
select is(
  pg_temp.rows_touched($q$
    update public.manual_ledger_expenses set amount_paise = 1
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
  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 50000, 'Cylinder')
$q$, '42501', null, 'a tablet with no live shift records nothing');

select is(
  (select count(*) from public.manual_ledger_expenses),
  0::bigint,
  'and reads nothing either: the ledger reach is the shift''s, not the tablet''s');

-- ---------------------------------------------------------------------------
-- 4. A removed tablet, in case the shift outlives the hardware.

select pg_temp.unimpersonate();
select is(public.remove_counter_device(:'DEVICE_KPA', :'OWNER'), 'ok', 'the other tablet is removed');

select pg_temp.impersonate(:'DEVICE_KPA'::uuid);

select throws_ok($q$
  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000002',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 50000, 'Cylinder')
$q$, '42501', null, 'a removed tablet records nothing, shift or no shift');

-- ---------------------------------------------------------------------------
-- 5. Nothing else moved.
--
-- The policy sets on both tables, pinned by name. This change adds exactly one
-- branch to one policy; a migration that adds a second, or that quietly widens
-- the day table, fails here and has to argue for it in this file.

select pg_temp.unimpersonate();

select is(
  (select string_agg(policyname, ', ' order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'manual_ledger_days'),
  'manual_ledger_days_delete, manual_ledger_days_insert, '
  'manual_ledger_days_select, manual_ledger_days_update',
  'the day record still carries exactly its four owner-and-manager policies');

select is(
  (select string_agg(policyname, ', ' order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'manual_ledger_expenses'),
  'manual_ledger_expenses_insert, manual_ledger_expenses_select, '
  'manual_ledger_expenses_update',
  'and the expense record still carries exactly three, with no delete policy');

-- The day policies must not mention the counter at all. Read from the catalog
-- rather than asserted by hand, so it stays true of whatever they are rewritten
-- into.
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'manual_ledger_days'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%counter%'),
  0::bigint,
  'and no day policy mentions the counter, in any form');

-- ---------------------------------------------------------------------------
-- 6. The people are untouched.
--
-- The branch is additive: it must not have taken anything away from the staff
-- reach #38 opened. One assertion each, because 21_manual_ledger.sql proves the
-- rest exhaustively and this file only has to prove it did not break it.

select pg_temp.impersonate(:'BILLER_KAL'::uuid);

select lives_ok($q$
  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 50000, 'Cylinder, from the phone')
$q$, 'the Biller still records an expense from their own device');

select pg_temp.impersonate(:'EMPLOYEE_KAL'::uuid);

select lives_ok($q$
  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description)
  values ('00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          'gas', true, 20000, 'Tea')
$q$, 'and so does an Employee');

select * from finish();
rollback;
