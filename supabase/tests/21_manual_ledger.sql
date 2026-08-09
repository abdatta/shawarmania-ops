-- The manual ledger's boundary, written out rather than inherited.
--
-- The generic sweep in 02_isolation_matrix.sql discovers these two tables from
-- the catalog and proves the ordinary claim: nobody reads across outlets. The
-- claims here are the ones the sweep cannot express, and after
-- `the-ledger-opens-to-the-outlet` there are two of them rather than one:
--
--   * **An outlet role is refused its OWN outlet's DAY row**, on every verb.
--     Stronger than outlet isolation, and the reason it exists is on the write
--     side: an account that could set the counted cash, the opening cash or the
--     cash removed could make any drawer reconcile, and the nightly count is the
--     only control the business has over cash. The read side comes free from the
--     same predicate and protects past days, month aggregates, the other outlet
--     and every commission-net figure.
--
--   * **An outlet role reaches its own outlet's EXPENSES**, reads every one of
--     them whoever recorded it, writes only against the current business date,
--     and corrects only its own rows and only while that day is still running.
--
-- Silent over-permission passes every functional test in this repo. This file is
-- the only thing that catches it, which is why all four roles are asserted on
-- both tables, on every verb, at their own outlet and at the other one.
--
-- Every constraint is also exercised by a hand-crafted violation, because this
-- ledger's only value is that the figures in it are possible: a negative drawer
-- count or an expense nobody can identify is not a record.

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

-- Back to `postgres` with **no session identity at all**. `reset role` alone is
-- not enough: the claim is transaction-local rather than role-local, so it
-- survives the role change and `auth.uid()` keeps answering with whoever was
-- last impersonated. Any setup written as the superuser has to clear it, or the
-- guard's staff rules fire against rows nobody is pretending to write.
create function pg_temp.unimpersonate()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set BILLER_KAL '10000000-0000-4000-a000-000000000004'
\set BILLER_KPA '10000000-0000-4000-a000-000000000005'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set EMPLOYEE_KPA '10000000-0000-4000-a000-000000000007'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- Business dates counted back from the outlets' shared 04:00 cutover. A function
-- rather than a psql variable because `\set` strips the quotes out of
-- `time '04:00'` and leaves a syntax error at the point of use.
--
-- `ledger_day(0)` is the current trading day and is load-bearing now rather than
-- merely convenient: staff may only write against it, so a test that used
-- yesterday for a staff write would be asserting the refusal by accident.
create function pg_temp.ledger_day(back int)
returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00') - back
$$;

-- ---------------------------------------------------------------------------
-- 1. The owner records a full day at each outlet, and reads both back.

select pg_temp.impersonate(:'OWNER');

select lives_ok(
  format($q$
    insert into public.manual_ledger_days
      (outlet_id, business_date, opening_cash_paise,
       cash_revenue_paise, upi_revenue_paise, zomato_revenue_paise, swiggy_revenue_paise,
       cash_added_paise, cash_added_reason, cash_removed_paise, cash_removed_reason,
       counted_cash_paise, zomato_commission_bp, swiggy_commission_bp, note, recorded_by)
    values (%L, %L, 500000,
            1200000, 400000, 300000, 250000,
            100000, 'Float topped up', 400000, 'Banked on the way home',
            1350000, 2250, 2100, 'Counted twice', %L) $q$,
    :'KAL', pg_temp.ledger_day(1), :'OWNER'),
  'the owner records a trading day at Kalyani');

select lives_ok(
  format($q$
    insert into public.manual_ledger_days
      (outlet_id, business_date, opening_cash_paise, cash_revenue_paise,
       counted_cash_paise, zomato_commission_bp, swiggy_commission_bp, recorded_by)
    values (%L, %L, 200000, 700000, 900000, 2400, 2200, %L) $q$,
    :'KPA', pg_temp.ledger_day(1), :'OWNER'),
  'the owner records a trading day at Kanchrapara too, on the same date');

select is(
  (select count(*) from public.manual_ledger_days where business_date = pg_temp.ledger_day(1)),
  2::bigint,
  'both outlets keep their own day row for the same business date');

select lives_ok(
  format($q$
    insert into public.manual_ledger_expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description, recorded_by)
    values (%L, %L, 'Chicken', true, 50000,
            'Chicken from Nadia Poultry', %L) $q$,
    :'KAL', pg_temp.ledger_day(1), :'OWNER'),
  'the owner records a cash expense with a description');

select lives_ok(
  format($q$
    insert into public.manual_ledger_expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description, recorded_by)
    values (%L, %L, 'Electricity', false, 180000,
            'WBSEDCL bill paid by UPI', %L) $q$,
    :'KAL', pg_temp.ledger_day(1), :'OWNER'),
  'and a non-cash one, which the drawer never sees');

-- A day with no earlier row still needs a stored opening and stored rates. Both
-- columns are `not null`, so the first tracked day cannot inherit silently.
select col_not_null('public', 'manual_ledger_days', 'opening_cash_paise',
  'opening cash is stored on the row, never derived on read');
select col_not_null('public', 'manual_ledger_days', 'zomato_commission_bp',
  'the Zomato rate is stored per day, so editing one day moves no other');
select col_not_null('public', 'manual_ledger_days', 'swiggy_commission_bp',
  'the Swiggy rate is stored per day for the same reason');

-- No capital marker exists on the expense table, by owner decision. Asserted as
-- a catalog fact so a later migration cannot quietly reintroduce a field that
-- would always be false.
select is(
  coalesce(
    (select string_agg(a.attname, ', ' order by a.attname)
       from pg_attribute a
      where a.attrelid = 'public.manual_ledger_expenses'::regclass
        and a.attnum > 0 and not a.attisdropped
        and a.attname like '%capital%'),
    ''),
  '',
  'the expense table carries no capital marker');

-- `is_cash` is still a boolean. Pending expenses and settlement were cut in full
-- (design D4), and this is the catalog fact that makes their absence a decision
-- rather than something a later reader has to infer from silence.
select col_type_is('public', 'manual_ledger_expenses', 'is_cash', 'boolean',
  'an expense still asks one question of the drawer, not three');

-- The owner holds no assignment at either outlet, so every row above was
-- recorded from away. It is stamped at insert, never derived on read: an
-- assignment that ends later must not rewrite what was true when the row was
-- written.
select is(
  (select bool_and(recorded_away) from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(1)),
  true,
  'the owner''s expenses are stamped as recorded from away');

-- ---------------------------------------------------------------------------
-- 2. One day per outlet per business date, enforced by the database.

select throws_ok(
  format($q$
    insert into public.manual_ledger_days
      (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
       zomato_commission_bp, swiggy_commission_bp, recorded_by)
    values (%L, %L, 0, 0, 0, 0, %L) $q$,
    :'KAL', pg_temp.ledger_day(1), :'OWNER'),
  '23505',
  null,
  'a second day row for the same outlet and business date is refused');

-- ---------------------------------------------------------------------------
-- 3. Every constraint, against a hand-crafted violation.

create function pg_temp.bad_day(cols text, vals text)
returns text language sql as $$
  select format(
    'insert into public.manual_ledger_days (outlet_id, business_date, recorded_by, %s) '
    'values (''00000000-0000-4000-a000-000000000001'', '
    'public.app_business_date(now(), time ''04:00'') - 2, '
    '''10000000-0000-4000-a000-000000000001'', %s)',
    cols, vals)
$$;

select throws_ok(
  pg_temp.bad_day(
    'opening_cash_paise, counted_cash_paise, zomato_commission_bp, swiggy_commission_bp',
    '-1, 0, 0, 0'),
  '23514', null, 'a negative opening cash is refused');

select throws_ok(
  pg_temp.bad_day(
    'opening_cash_paise, counted_cash_paise, zomato_commission_bp, swiggy_commission_bp',
    '0, -1, 0, 0'),
  '23514', null, 'a negative drawer count is refused');

select throws_ok(
  pg_temp.bad_day(
    'opening_cash_paise, counted_cash_paise, cash_added_paise, cash_added_reason, '
    'zomato_commission_bp, swiggy_commission_bp',
    '0, 0, -1, ''x'', 0, 0'),
  '23514', null, 'a negative cash-in is refused');

select throws_ok(
  pg_temp.bad_day(
    'opening_cash_paise, counted_cash_paise, cash_removed_paise, cash_removed_reason, '
    'zomato_commission_bp, swiggy_commission_bp',
    '0, 0, -1, ''x'', 0, 0'),
  '23514', null, 'a negative cash-out is refused');

select throws_ok(
  pg_temp.bad_day(
    'opening_cash_paise, counted_cash_paise, cash_added_paise, '
    'zomato_commission_bp, swiggy_commission_bp',
    '0, 0, 50000, 0, 0'),
  '23514', null, 'cash brought in without a reason is refused');

select throws_ok(
  pg_temp.bad_day(
    'opening_cash_paise, counted_cash_paise, cash_removed_paise, cash_removed_reason, '
    'zomato_commission_bp, swiggy_commission_bp',
    '0, 0, 50000, ''   '', 0, 0'),
  '23514', null, 'cash taken out with a whitespace-only reason is refused');

select throws_ok(
  pg_temp.bad_day(
    'opening_cash_paise, counted_cash_paise, note, zomato_commission_bp, swiggy_commission_bp',
    '0, 0, ''  '', 0, 0'),
  '23514', null, 'a whitespace-only note is refused, where a note is given at all');

select throws_ok(
  pg_temp.bad_day(
    'opening_cash_paise, counted_cash_paise, zomato_commission_bp, swiggy_commission_bp',
    '0, 0, 10001, 0'),
  '23514', null, 'a commission rate above 100% is refused');

select throws_ok(
  pg_temp.bad_day(
    'opening_cash_paise, counted_cash_paise, zomato_commission_bp, swiggy_commission_bp',
    '0, 0, 0, -1'),
  '23514', null, 'a negative commission rate is refused');

-- Negative revenue is the one figure that must be ACCEPTED: a cash refund is
-- recorded by lowering that day's cash revenue.
select lives_ok(
  pg_temp.bad_day(
    'opening_cash_paise, counted_cash_paise, cash_revenue_paise, '
    'zomato_commission_bp, swiggy_commission_bp',
    '0, 0, -25000, 0, 0'),
  'negative cash revenue is accepted, because that is how a refund is recorded');

-- The future-date trigger, on both tables.
select throws_ok(
  format($q$
    insert into public.manual_ledger_days
      (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
       zomato_commission_bp, swiggy_commission_bp, recorded_by)
    values (%L, public.app_business_date(now(), time '04:00') + 1,
            0, 0, 0, 0, %L) $q$,
    :'KAL', :'OWNER'),
  'P0001', null, 'a day dated after the outlet''s own trading day is refused');

select throws_ok(
  format($q$
    insert into public.manual_ledger_expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description, recorded_by)
    values (%L, public.app_business_date(now(), time '04:00') + 1,
            'Other', false, 100, 'x', %L) $q$,
    :'KAL', :'OWNER'),
  'P0001', null, 'an expense dated in the future is refused too');

-- Expense constraints.
create function pg_temp.bad_expense(cols text, vals text)
returns text language sql as $$
  select format(
    'insert into public.manual_ledger_expenses '
    '(outlet_id, business_date, recorded_by, category, is_cash, %s) '
    'values (''00000000-0000-4000-a000-000000000001'', '
    'public.app_business_date(now(), time ''04:00'') - 2, '
    '''10000000-0000-4000-a000-000000000001'', ''Other'', false, %s)',
    cols, vals)
$$;

select throws_ok(
  pg_temp.bad_expense('amount_paise, description', '0, ''x'''),
  '23514', null, 'a zero-amount expense is refused');

select throws_ok(
  pg_temp.bad_expense('amount_paise, description', '-100, ''x'''),
  '23514', null, 'a negative expense is refused');

select throws_ok(
  pg_temp.bad_expense('amount_paise, description', '100, ''   '''),
  '23514', null, 'an expense whose description is whitespace is refused');

select lives_ok(
  pg_temp.bad_expense('amount_paise', '100'),
  'an expense with no note at all is accepted');

-- The void columns travel together, and a reason may only exist beside a void.
-- The reason itself is OPTIONAL [owner, 2026-08-09]: voiding is the fastest
-- correction on a thumb-driven surface, and the moment and the account answer
-- the failure the trace exists for.
select throws_ok(
  pg_temp.bad_expense('amount_paise, description, voided_at', '100, ''x'', now()'),
  '23514', null, 'a void time with no actor is refused');

select throws_ok(
  pg_temp.bad_expense(
    'amount_paise, description, voided_by',
    '100, ''x'', ''10000000-0000-4000-a000-000000000001'''),
  '23514', null, 'and an actor with no void time is refused');

select throws_ok(
  pg_temp.bad_expense(
    'amount_paise, description, voided_reason', '100, ''x'', ''typo'''),
  '23514', null, 'a reason without a void has nothing to explain and is refused');

select throws_ok(
  pg_temp.bad_expense(
    'amount_paise, description, voided_at, voided_by, voided_reason',
    '100, ''x'', now(), ''10000000-0000-4000-a000-000000000001'', ''   '''),
  '23514', null, 'a whitespace-only void reason is refused, where one is given at all');

-- ---------------------------------------------------------------------------
-- 3b. A day is corrected in place; its identity is not.
--
-- Correcting a figure is the whole purpose of a notebook. Moving a day to
-- another date or outlet is not a correction — it is a second row wearing the
-- first one's history, and it would walk straight past the uniqueness
-- constraint.

select lives_ok(
  format($q$
    update public.manual_ledger_days
       set counted_cash_paise = 1300000, note = 'Recounted, ₹500 short'
     where outlet_id = %L and business_date = %L $q$,
    :'KAL', pg_temp.ledger_day(1)),
  'the owner corrects a recorded day in place');

select throws_ok(
  format($q$
    update public.manual_ledger_days
       set business_date = business_date - 1
     where outlet_id = %L and business_date = %L $q$,
    :'KAL', pg_temp.ledger_day(1)),
  'P0001', null,
  'a recorded day cannot be moved to another business date');

select throws_ok(
  format($q$
    update public.manual_ledger_days
       set outlet_id = %L
     where outlet_id = %L and business_date = %L $q$,
    :'KPA', :'KAL', pg_temp.ledger_day(1)),
  'P0001', null,
  'nor to the other outlet');

select throws_ok(
  format($q$
    update public.manual_ledger_days
       set recorded_by = %L
     where outlet_id = %L and business_date = %L $q$,
    :'FA_KAL', :'KAL', pg_temp.ledger_day(1)),
  'P0001', null,
  'and who recorded it cannot be rewritten afterwards');

-- Attribution is stamped from the session, so no screen has to supply it and a
-- write that omits it is still attributed.
select lives_ok(
  format($q$
    insert into public.manual_ledger_expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description)
    values (%L, %L, 'Packaging', true, 30000, 'Paper bags, 500') $q$,
    :'KAL', pg_temp.ledger_day(1)),
  'an expense written without naming a recorder is accepted');

select is(
  (select recorded_by from public.manual_ledger_expenses
    where description = 'Paper bags, 500'),
  :'OWNER'::uuid,
  'and the database stamped the session that wrote it');

-- Attribution cannot be forged, even by the one person who may write here.
select throws_ok(
  format($q$
    insert into public.manual_ledger_days
      (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
       zomato_commission_bp, swiggy_commission_bp, recorded_by)
    values (%L, public.app_business_date(now(), time '04:00') - 3,
            0, 0, 0, 0, %L) $q$,
    :'KAL', :'FA_KAL'),
  '42501', null, 'the owner cannot record a day as somebody else');

-- ---------------------------------------------------------------------------
-- 3c. `updated_by`: who corrected it, beside who recorded it.
--
-- The correction the owner made above was the first one on that row, so the
-- column moved from null to the owner. Null-until-corrected is what lets the
-- reading name one account for an untouched row rather than implying a second
-- party (design D6).

select is(
  (select updated_by from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(1)),
  :'OWNER'::uuid,
  'correcting a day stamps the correcting account');

select is(
  (select updated_by from public.manual_ledger_days
    where outlet_id = :'KPA'::uuid and business_date = pg_temp.ledger_day(1)),
  null::uuid,
  'a day nobody has corrected names no correcting account at all');

select throws_ok(
  format($q$
    insert into public.manual_ledger_days
      (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
       zomato_commission_bp, swiggy_commission_bp, recorded_by, updated_by)
    values (%L, public.app_business_date(now(), time '04:00') - 6,
            0, 0, 0, 0, %L, %L) $q$,
    :'KAL', :'OWNER', :'OWNER'),
  'P0001', null,
  'a row cannot be recorded as though it had already been corrected');

select throws_ok(
  format($q$
    update public.manual_ledger_days
       set counted_cash_paise = 1310000, updated_by = %L
     where outlet_id = %L and business_date = %L $q$,
    :'FA_KAL', :'KAL', pg_temp.ledger_day(1)),
  'P0001', null,
  'and the correcting account cannot be attributed to somebody else');

-- ---------------------------------------------------------------------------
-- 4. The authority matrix: four roles, both tables, every verb, both outlets.
--
-- Two helpers rather than one sweep, because the day table and the expense table
-- now answer differently for the same person at the same outlet, and that
-- difference is the whole change.
--
-- Update and delete need a different shape from insert. RLS filters rows rather
-- than raising, so a refused UPDATE is a no-op and not an error: the assertion
-- has to be that nothing moved, not that something threw. An insert is the
-- opposite — `with check` raises 42501 — and asserting the wrong one of these
-- is how a policy hole gets a passing test.

create function pg_temp.rows_changed(sql text)
returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute format('with attempted as (%s returning 1) select count(*) from attempted', sql)
    into n;
  return n;
end;
$$;

-- Every verb on the DAY table refused, at whichever outlet is named.
create function pg_temp.day_refused(persona text, p_sub uuid, p_outlet uuid, whose text)
returns setof text language plpgsql as $$
declare
  n bigint;
begin
  perform pg_temp.impersonate(p_sub);

  execute format(
    'select count(*) from public.manual_ledger_days where outlet_id = %L', p_outlet)
    into n;
  return next is(n, 0::bigint,
    format('%s reads no manual-ledger day at %s outlet', persona, whose));

  return next throws_ok(
    format($q$
      insert into public.manual_ledger_days
        (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
         zomato_commission_bp, swiggy_commission_bp, recorded_by)
      values (%L, public.app_business_date(now(), time '04:00') - 4,
              0, 0, 0, 0, %L) $q$, p_outlet, p_sub),
    '42501', null,
    format('%s cannot insert a manual-ledger day at %s outlet', persona, whose));

  n := pg_temp.rows_changed(format(
    'update public.manual_ledger_days set counted_cash_paise = 1 where outlet_id = %L',
    p_outlet));
  return next is(n, 0::bigint,
    format('%s changes no manual-ledger day at %s outlet', persona, whose));

  n := pg_temp.rows_changed(format(
    'delete from public.manual_ledger_days where outlet_id = %L', p_outlet));
  return next is(n, 0::bigint,
    format('%s deletes no manual-ledger day at %s outlet', persona, whose));

  execute 'reset role';
end;
$$;

-- Every verb on the EXPENSE table refused, at whichever outlet is named. Delete
-- is refused for everybody everywhere now, so it is asserted separately below
-- rather than here.
create function pg_temp.expenses_refused(persona text, p_sub uuid, p_outlet uuid, whose text)
returns setof text language plpgsql as $$
declare
  n bigint;
begin
  perform pg_temp.impersonate(p_sub);

  execute format(
    'select count(*) from public.manual_ledger_expenses where outlet_id = %L', p_outlet)
    into n;
  return next is(n, 0::bigint,
    format('%s reads no manual-ledger expense at %s outlet', persona, whose));

  return next throws_ok(
    format($q$
      insert into public.manual_ledger_expenses
        (outlet_id, business_date, category, is_cash, amount_paise, description, recorded_by)
      values (%L, public.app_business_date(now(), time '04:00'),
              'Other', false, 100, 'x', %L) $q$, p_outlet, p_sub),
    '42501', null,
    format('%s cannot insert a manual-ledger expense at %s outlet', persona, whose));

  n := pg_temp.rows_changed(format(
    'update public.manual_ledger_expenses set amount_paise = 1 where outlet_id = %L',
    p_outlet));
  return next is(n, 0::bigint,
    format('%s changes no manual-ledger expense at %s outlet', persona, whose));

  execute 'reset role';
end;
$$;

-- 4a. The day table refuses every outlet role at its OWN outlet.
--
-- This is the claim the gate makes, and both directions of it are load-bearing:
-- the write verbs protect the drawer, and the read verb protects any past day's
-- revenue and any month's aggregate (design D5).

select * from pg_temp.day_refused('biller_kalyani', :'BILLER_KAL', :'KAL', 'their own');
select * from pg_temp.day_refused('biller_kalyani', :'BILLER_KAL', :'KPA', 'the other');
select * from pg_temp.day_refused('employee_kalyani', :'EMPLOYEE_KAL', :'KAL', 'their own');
select * from pg_temp.day_refused('employee_kalyani', :'EMPLOYEE_KAL', :'KPA', 'the other');
select * from pg_temp.day_refused('biller_kanchrapara', :'BILLER_KPA', :'KPA', 'their own');
select * from pg_temp.day_refused('employee_kanchrapara', :'EMPLOYEE_KPA', :'KPA', 'their own');

-- 4b. And a manager is refused everything at an outlet they are not assigned to.

select * from pg_temp.day_refused('fa_kalyani', :'FA_KAL', :'KPA', 'the other');
select * from pg_temp.expenses_refused('fa_kalyani', :'FA_KAL', :'KPA', 'the other');
select * from pg_temp.day_refused('fa_kanchrapara', :'FA_KPA', :'KAL', 'the other');
select * from pg_temp.expenses_refused('fa_kanchrapara', :'FA_KPA', :'KAL', 'the other');

-- 4c. Staff read their own outlet's expenses and none of the other's.

select * from pg_temp.expenses_refused('biller_kalyani', :'BILLER_KAL', :'KPA', 'the other');
select * from pg_temp.expenses_refused('employee_kalyani', :'EMPLOYEE_KAL', :'KPA', 'the other');
select * from pg_temp.expenses_refused('biller_kanchrapara', :'BILLER_KPA', :'KAL', 'the other');

-- 4d. Each of the three drawer figures, named individually.
--
-- A blanket "the table refuses you" already passed above. These three are named
-- one at a time anyway, because they are what the gate actually claims and a
-- future policy that opened a single column would still pass the blanket test.

create function pg_temp.drawer_column_refused(persona text, p_sub uuid, col text)
returns setof text language plpgsql as $$
declare
  n bigint;
  before_value bigint;
  after_value bigint;
begin
  execute format(
    'select %I from public.manual_ledger_days where outlet_id = %L and business_date = %L',
    col,
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00') - 1)
    into before_value;

  perform pg_temp.impersonate(p_sub);

  n := pg_temp.rows_changed(format(
    'update public.manual_ledger_days set %I = 999999 where outlet_id = %L',
    col, '00000000-0000-4000-a000-000000000001'));
  return next is(n, 0::bigint,
    format('%s cannot set %s on a day at their own outlet', persona, col));

  execute 'reset role';

  execute format(
    'select %I from public.manual_ledger_days where outlet_id = %L and business_date = %L',
    col,
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00') - 1)
    into after_value;

  return next is(after_value, before_value,
    format('and %s is unchanged after %s tried', col, persona));
end;
$$;

select * from pg_temp.drawer_column_refused('biller_kalyani', :'BILLER_KAL', 'counted_cash_paise');
select * from pg_temp.drawer_column_refused('biller_kalyani', :'BILLER_KAL', 'opening_cash_paise');
select * from pg_temp.drawer_column_refused('biller_kalyani', :'BILLER_KAL', 'cash_removed_paise');
select * from pg_temp.drawer_column_refused('employee_kalyani', :'EMPLOYEE_KAL', 'counted_cash_paise');
select * from pg_temp.drawer_column_refused('employee_kalyani', :'EMPLOYEE_KAL', 'opening_cash_paise');
select * from pg_temp.drawer_column_refused('employee_kalyani', :'EMPLOYEE_KAL', 'cash_removed_paise');

-- ---------------------------------------------------------------------------
-- 5. A manager reaches the full ledger at the outlet they are assigned to.

select pg_temp.impersonate(:'FA_KAL');

select is(
  (select count(*) from public.manual_ledger_days where outlet_id = :'KAL'::uuid),
  (select count(*) from public.manual_ledger_days where outlet_id = :'KAL'::uuid),
  'a manager reads their own outlet''s days');

select isnt(
  (select count(*) from public.manual_ledger_days where outlet_id = :'KAL'::uuid),
  0::bigint,
  'and there is something there to read, so the count above is not vacuous');

select is(
  (select counted_cash_paise from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(1)),
  1300000::bigint,
  'including the full day: revenue, drawer and commission, not a staff subset');

select lives_ok(
  format($q$
    update public.manual_ledger_days
       set counted_cash_paise = 1320000
     where outlet_id = %L and business_date = %L $q$,
    :'KAL', pg_temp.ledger_day(1)),
  'a manager corrects a day the owner recorded');

select is(
  (select recorded_by from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(1)),
  :'OWNER'::uuid,
  'the recording account is unchanged by that correction');

select is(
  (select updated_by from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.ledger_day(1)),
  :'FA_KAL'::uuid,
  'and the correcting account is the manager, so the reading can name both');

select lives_ok(
  format($q$
    insert into public.manual_ledger_expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description)
    values (%L, %L, 'Gas', true, 190000, 'Cylinder, refilled') $q$,
    :'KAL', pg_temp.ledger_day(2)),
  'a manager records an expense against an earlier day, which staff may not');

select is(
  (select recorded_away from public.manual_ledger_expenses
    where description = 'Cylinder, refilled'),
  false,
  'and it is not marked as recorded from away, because they are assigned there');

reset role;

-- ---------------------------------------------------------------------------
-- 6. The staff write contract.
--
-- Read every row at their outlet, write only today, correct only their own, and
-- only while the day is still running.

select pg_temp.impersonate(:'BILLER_KAL');

select isnt(
  (select count(*) from public.manual_ledger_expenses where outlet_id = :'KAL'::uuid),
  0::bigint,
  'a biller reads their own outlet''s expenses');

select is(
  (select count(*) from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and recorded_by <> :'BILLER_KAL'::uuid),
  (select count(*) from public.manual_ledger_expenses where outlet_id = :'KAL'::uuid),
  'including every row somebody else recorded, which is the point of the surface');

-- The two-business-day window is where the staff surface OPENS, not a boundary.
-- No select policy carries a date predicate, and this is the assertion that
-- stops one being added quietly (design D2).
select isnt(
  (select count(*) from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and business_date <= pg_temp.ledger_day(2)),
  0::bigint,
  'an expense older than the surface''s window is still readable, because the '
  'window is a presentation default and not a rule the database enforces');

select lives_ok(
  format($q$
    insert into public.manual_ledger_expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description)
    values (%L, %L, 'Packaging', true, 12000, 'Foil rolls from the market') $q$,
    :'KAL', pg_temp.ledger_day(0)),
  'a biller records a cash expense at their own outlet against today');

select is(
  (select recorded_by from public.manual_ledger_expenses
    where description = 'Foil rolls from the market'),
  :'BILLER_KAL'::uuid,
  'attributed to them by the database rather than by the form');

select is(
  (select recorded_away from public.manual_ledger_expenses
    where description = 'Foil rolls from the market'),
  false,
  'and never marked from away, because they are standing in the shop');

select throws_ok(
  format($q$
    insert into public.manual_ledger_expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description)
    values (%L, %L, 'Packaging', true, 12000, 'Noticed the next morning') $q$,
    :'KAL', pg_temp.ledger_day(1)),
  'P0001', null,
  'but not against yesterday: a purchase noticed later is the manager''s to add');

select lives_ok(
  format($q$
    update public.manual_ledger_expenses
       set amount_paise = 12500
     where description = 'Foil rolls from the market' $q$),
  'a biller corrects their own expense while today is still running');

-- Somebody else's row, at their own outlet, on the same day.
select is(
  pg_temp.rows_changed(
    'update public.manual_ledger_expenses set amount_paise = 1 '
    'where description = ''Cylinder, refilled'''),
  0::bigint,
  'and changes nothing on a row somebody else recorded');

reset role;

-- An expense the biller recorded on an EARLIER day, to test the freeze. It has
-- to be planted rather than written in character: every insert policy carries
-- `recorded_by = auth.uid()`, so nobody — not even the owner — can attribute a
-- row to somebody else, and the biller's own insert against yesterday is exactly
-- what the rule above refuses. Planting it as `postgres` bypasses RLS.
--
-- The JWT claim has to be cleared as well as the role. `set_config(..., true)`
-- is transaction-local, not role-local, so a bare `reset role` would leave
-- `auth.uid()` still answering "the biller" and the staff date rule would fire
-- against the very row being planted.
select pg_temp.unimpersonate();

select lives_ok(
  format($q$
    insert into public.manual_ledger_expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description, recorded_by)
    values (%L, %L, 'Chicken', true, 40000, 'Yesterday''s chicken run', %L) $q$,
    :'KAL', pg_temp.ledger_day(1), :'BILLER_KAL'),
  'an expense the biller recorded yesterday is planted, since no policy lets one '
  'account attribute a row to another');

select pg_temp.impersonate(:'BILLER_KAL');

select throws_ok(
  format($q$
    update public.manual_ledger_expenses
       set amount_paise = 45000
     where description = 'Yesterday''s chicken run' $q$),
  'P0001', null,
  'a row that outlived its own business date is frozen even to its author');

reset role;

-- The same row is still the manager's to fix, which is what makes the freeze a
-- routing rule rather than a dead end.
select pg_temp.impersonate(:'FA_KAL');
select lives_ok(
  format($q$
    update public.manual_ledger_expenses
       set amount_paise = 45000
     where description = 'Yesterday''s chicken run' $q$),
  'and the manager at that outlet can still correct it');
reset role;

-- ---------------------------------------------------------------------------
-- 7. Void, and the delete that no longer exists.

select pg_temp.impersonate(:'BILLER_KAL');

select lives_ok(
  format($q$
    update public.manual_ledger_expenses
       set voided_at = now()
     where description = 'Foil rolls from the market' $q$),
  'a biller withdraws their own expense with no reason at all');

select is(
  (select voided_by from public.manual_ledger_expenses
    where description = 'Foil rolls from the market'),
  :'BILLER_KAL'::uuid,
  'and the database stamps who withdrew it, so the trace answers who and when');

select is(
  (select count(*) from public.manual_ledger_expenses
    where description = 'Foil rolls from the market'),
  1::bigint,
  'the row is still there, which is the whole reason void replaced delete');

select throws_ok(
  format($q$
    update public.manual_ledger_expenses
       set amount_paise = 99999
     where description = 'Foil rolls from the market' $q$),
  'P0001', null,
  'a withdrawn expense cannot be edited afterwards');

select throws_ok(
  format($q$
    update public.manual_ledger_expenses
       set voided_at = null, voided_by = null
     where description = 'Foil rolls from the market' $q$),
  'P0001', null,
  'nor un-withdrawn');

select throws_ok(
  format($q$
    update public.manual_ledger_expenses
       set voided_at = now(), voided_reason = 'again'
     where description = 'Foil rolls from the market' $q$),
  'P0001', null,
  'nor withdrawn a second time');

reset role;

-- Delete is gone from the expense table for everybody: the grant is revoked, so
-- the verb is refused before any policy is consulted.
create function pg_temp.delete_refused(persona text, p_sub uuid)
returns setof text language plpgsql as $$
begin
  perform pg_temp.impersonate(p_sub);
  return next throws_ok(
    'delete from public.manual_ledger_expenses',
    '42501', null,
    format('%s cannot delete a manual-ledger expense', persona));
  execute 'reset role';
end;
$$;

select * from pg_temp.delete_refused('the owner', :'OWNER');
select * from pg_temp.delete_refused('a manager', :'FA_KAL');
select * from pg_temp.delete_refused('a biller', :'BILLER_KAL');
select * from pg_temp.delete_refused('an employee', :'EMPLOYEE_KAL');

select is(
  has_table_privilege('authenticated', 'public.manual_ledger_expenses', 'DELETE'),
  false,
  'and the grant itself is gone, not merely unreachable through a policy');

-- The day table keeps DELETE: a day typed against the wrong date is a mistake
-- with no story worth keeping, and only owners and managers can reach it.
select is(
  has_table_privilege('authenticated', 'public.manual_ledger_days', 'DELETE'),
  true,
  'a mis-dated day is still deletable');

select pg_temp.impersonate(:'FA_KAL');
select is(
  pg_temp.rows_changed(format(
    'delete from public.manual_ledger_days where outlet_id = %L and business_date = %L',
    :'KAL', pg_temp.ledger_day(2))),
  1::bigint,
  'and a manager deletes one at the outlet they are assigned to');
reset role;

-- The owner, at an outlet they hold no assignment at, which is every outlet.
-- Written and removed in place rather than reusing a row above, so this asserts
-- the delete reach without quietly changing what section 8 counts.
select pg_temp.impersonate(:'OWNER');
select lives_ok(
  format($q$
    insert into public.manual_ledger_days
      (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
       zomato_commission_bp, swiggy_commission_bp)
    values (%L, %L, 0, 0, 0, 0) $q$,
    :'KPA', pg_temp.ledger_day(7)),
  'the owner records a day at the other outlet, typed against the wrong date');
select is(
  pg_temp.rows_changed(format(
    'delete from public.manual_ledger_days where outlet_id = %L and business_date = %L',
    :'KPA', pg_temp.ledger_day(7))),
  1::bigint,
  'and removes it, because a mis-dated day has no story worth keeping');
reset role;

-- ---------------------------------------------------------------------------
-- 7b. The names behind the attribution.
--
-- "Every expense names the account that recorded it" is a requirement, and
-- `profiles` cannot answer it for either reader this change adds: its select
-- policy needs a shared outlet assignment and a caller whose own role is
-- `franchise_admin` or `biller`, so an Employee sees nobody and **nobody at an
-- outlet sees an owner**, whose assignment carries no outlet at all. Since the
-- owner recorded most of the rows already stored, that gap is the common case
-- rather than an edge one.
--
-- `manual_ledger_people()` closes exactly that gap and nothing wider. Its
-- predicates duplicate the policies above, which is a maintenance hazard nothing
-- in the database enforces, so the drift is asserted here: a row the caller can
-- read whose recorder they cannot name is the failure to catch.

create function pg_temp.names_cover_readable_rows(persona text, p_sub uuid)
returns setof text language plpgsql as $$
declare
  unnamed text;
begin
  perform pg_temp.impersonate(p_sub);

  select string_agg(distinct e.description, ', ')
    into unnamed
    from public.manual_ledger_expenses e
   where e.recorded_by not in (select id from public.manual_ledger_people());

  return next is(coalesce(unnamed, ''), '',
    format('%s can name the recorder of every expense they can read', persona));

  select string_agg(distinct d.business_date::text, ', ')
    into unnamed
    from public.manual_ledger_days d
   where d.recorded_by not in (select id from public.manual_ledger_people());

  return next is(coalesce(unnamed, ''), '',
    format('%s can name the recorder of every day they can read', persona));

  execute 'reset role';
end;
$$;

select * from pg_temp.names_cover_readable_rows('the owner', :'OWNER');
select * from pg_temp.names_cover_readable_rows('a manager', :'FA_KAL');
select * from pg_temp.names_cover_readable_rows('a biller', :'BILLER_KAL');
select * from pg_temp.names_cover_readable_rows('an employee', :'EMPLOYEE_KAL');

-- The gap it closes, stated directly rather than only implied by the sweep
-- above: an employee reads the owner's name here and cannot read the owner's
-- profile row at all.
select pg_temp.impersonate(:'EMPLOYEE_KAL');

select isnt(
  (select full_name from public.manual_ledger_people() where id = :'OWNER'::uuid),
  null,
  'an employee can name the owner who recorded an expense at their outlet');

select is(
  (select count(*) from public.profiles where id = :'OWNER'::uuid),
  0::bigint,
  'while the owner''s profile row itself stays unreadable to them, so this '
  'grants a caption and not a directory');

-- And it grants nothing across outlets: a Kanchrapara employee cannot name
-- somebody who only ever wrote at Kalyani.
reset role;
select pg_temp.impersonate(:'EMPLOYEE_KPA');

select is(
  (select count(*) from public.manual_ledger_people() where id = :'BILLER_KAL'::uuid),
  0::bigint,
  'and an employee at the other outlet cannot name a biller who only wrote here');

reset role;

-- ---------------------------------------------------------------------------
-- 8. Losing the role, or the account, ends the access on the next request.
--
-- Not at token expiry: `app_is_owner()`, `app_outlets_for()` and
-- `app_has_role_at()` all read live assignments and `app_account_active()` reads
-- the profile, so every answer moves the moment the row does. This is the only
-- reason those functions are in the policy rather than a claim baked into the
-- JWT — and it now has to hold for the manager and staff branches too, not only
-- the owner's.

reset role;

savepoint before_revocation;

-- A second owner first. `assignments_guard()` refuses ending the LAST live
-- super_admin — the business must never be left with nobody who can grant a role
-- back — so a test that simply revoked the seeded owner's assignment would be
-- testing that guard rather than this capability. Two owners and one stepping
-- down is the real shape of the scenario anyway.
insert into public.assignments (person_id, role, outlet_id, started_on)
values (:'FA_KPA', 'super_admin', null, current_date);

update public.assignments
   set ended_on = current_date
 where person_id = :'OWNER' and role = 'super_admin' and ended_on is null;

select pg_temp.impersonate(:'OWNER');

select is(
  (select count(*) from public.manual_ledger_days),
  0::bigint,
  'an owner whose Super Admin assignment has ended reads nothing on the next request');

select throws_ok(
  format($q$
    insert into public.manual_ledger_days
      (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
       zomato_commission_bp, swiggy_commission_bp, recorded_by)
    values (%L, public.app_business_date(now(), time '04:00') - 5, 0, 0, 0, 0, %L) $q$,
    :'KAL', :'OWNER'),
  '42501', null,
  'and cannot write either');

reset role;
rollback to savepoint before_revocation;

savepoint before_manager_revocation;

update public.assignments
   set ended_on = current_date
 where person_id = :'FA_KAL' and role = 'franchise_admin' and ended_on is null;

select pg_temp.impersonate(:'FA_KAL');

select is(
  (select count(*) from public.manual_ledger_days),
  0::bigint,
  'a manager whose assignment has ended reads no day on the next request');

select is(
  (select count(*) from public.manual_ledger_expenses),
  0::bigint,
  'and no expense either');

reset role;
rollback to savepoint before_manager_revocation;

savepoint before_staff_revocation;

update public.assignments
   set ended_on = current_date
 where person_id = :'BILLER_KAL' and role = 'biller' and ended_on is null;

select pg_temp.impersonate(:'BILLER_KAL');

select is(
  (select count(*) from public.manual_ledger_expenses),
  0::bigint,
  'a biller whose assignment has ended reads no expense on the next request');

select throws_ok(
  format($q$
    insert into public.manual_ledger_expenses
      (outlet_id, business_date, category, is_cash, amount_paise, description)
    values (%L, public.app_business_date(now(), time '04:00'),
            'Other', true, 100, 'x') $q$, :'KAL'),
  '42501', null,
  'and cannot record one');

reset role;
rollback to savepoint before_staff_revocation;

savepoint before_deactivation;

update public.profiles set is_active = false where id = :'BILLER_KAL';

select pg_temp.impersonate(:'BILLER_KAL');

select is(
  (select count(*) from public.manual_ledger_expenses),
  0::bigint,
  'a deactivated biller reads nothing, while the assignment is still live');

reset role;
rollback to savepoint before_deactivation;

-- The premise of section 8, asserted after the rollbacks so a failure above
-- cannot be mistaken for these accounts never having had access.
select pg_temp.impersonate(:'OWNER');
select is(
  (select count(*) from public.manual_ledger_days where business_date = pg_temp.ledger_day(1)),
  2::bigint,
  'with the assignments and the accounts restored, the owner reads both days again');
reset role;

select pg_temp.impersonate(:'BILLER_KAL');
select isnt(
  (select count(*) from public.manual_ledger_expenses),
  0::bigint,
  'and the biller reads their outlet''s expenses again');
reset role;

select * from finish();
rollback;
