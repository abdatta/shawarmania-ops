-- The manual ledger's boundary, written out rather than inherited.
--
-- The generic sweep in 02_isolation_matrix.sql discovers these two tables from
-- the catalog and proves the ordinary claim: nobody reads across outlets. The
-- claim here is stronger and the sweep cannot express it — **an outlet role is
-- refused its OWN outlet's rows**, because no outlet role has any access to this
-- capability at all. That is the entire authority model of a stopgap the owner
-- alone writes into, so it is asserted directly rather than left to be inferred.
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

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set BILLER_KAL '10000000-0000-4000-a000-000000000004'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- Business dates counted back from the outlets' shared 04:00 cutover. A function
-- rather than a psql variable because `\set` strips the quotes out of
-- `time '04:00'` and leaves a syntax error at the point of use.
--
-- Yesterday rather than today, so nothing here can collide with a row another
-- suite wrote; and a real date rather than a future one, because the
-- no-future-date trigger is itself under test below.
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
-- 4. Every outlet role is refused, at the outlet they actually hold.
--
-- Reads return nothing and writes are refused outright. Both matter: a policy
-- that excluded rows while permitting the insert would let a manager write into
-- a ledger they cannot read, which is worse than either failure alone.

create function pg_temp.refused_everywhere(persona text, p_sub uuid, p_outlet uuid)
returns setof text language plpgsql as $$
declare
  n bigint;
begin
  perform pg_temp.impersonate(p_sub);

  execute 'select count(*) from public.manual_ledger_days' into n;
  return next is(n, 0::bigint,
    format('%s reads no manual-ledger day at all', persona));

  execute format(
    'select count(*) from public.manual_ledger_days where outlet_id = %L', p_outlet)
    into n;
  return next is(n, 0::bigint,
    format('%s reads none of their OWN outlet''s manual-ledger days', persona));

  execute 'select count(*) from public.manual_ledger_expenses' into n;
  return next is(n, 0::bigint,
    format('%s reads no manual-ledger expense at all', persona));

  return next throws_ok(
    format($q$
      insert into public.manual_ledger_days
        (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
         zomato_commission_bp, swiggy_commission_bp, recorded_by)
      values (%L, public.app_business_date(now(), time '04:00') - 4,
              0, 0, 0, 0, %L) $q$, p_outlet, p_sub),
    '42501', null,
    format('%s cannot insert a manual-ledger day at their own outlet', persona));

  return next throws_ok(
    format($q$
      insert into public.manual_ledger_expenses
        (outlet_id, business_date, category, is_cash, amount_paise, description, recorded_by)
      values (%L, public.app_business_date(now(), time '04:00') - 4,
              'Other', false, 100, 'x', %L) $q$, p_outlet, p_sub),
    '42501', null,
    format('%s cannot insert a manual-ledger expense at their own outlet', persona));

  execute 'reset role';
end;
$$;

select * from pg_temp.refused_everywhere('fa_kalyani', :'FA_KAL', :'KAL');
select * from pg_temp.refused_everywhere('device_kalyani', :'BILLER_KAL', :'KAL');
select * from pg_temp.refused_everywhere('employee_kalyani', :'EMPLOYEE_KAL', :'KAL');

-- ---------------------------------------------------------------------------
-- 5. Losing the role, or the account, ends the access on the next request.
--
-- Not at token expiry: `app_is_owner()` reads live assignments and
-- `app_account_active()` reads the profile, so both answers move the moment the
-- row does. This is the only reason those two functions are in the policy rather
-- than a claim baked into the JWT.

reset role;

savepoint before_revocation;

-- A second owner first. `assignments_guard()` refuses ending the LAST live
-- super_admin — the business must never be left with nobody who can grant a role
-- back — so a test that simply revoked the seeded owner's assignment would be
-- testing that guard rather than this capability. Two owners and one stepping
-- down is the real shape of the scenario anyway.
insert into public.assignments (person_id, role, outlet_id, started_on)
values (:'FA_KAL', 'super_admin', null, current_date);

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

savepoint before_deactivation;

update public.profiles set is_active = false where id = :'OWNER';

select pg_temp.impersonate(:'OWNER');

select is(
  (select count(*) from public.manual_ledger_days),
  0::bigint,
  'a deactivated owner reads nothing, while the assignment is still live');

reset role;
rollback to savepoint before_deactivation;

-- The premise of section 5, asserted after the rollbacks so a failure above
-- cannot be mistaken for the owner never having had access.
select pg_temp.impersonate(:'OWNER');
select is(
  (select count(*) from public.manual_ledger_days where business_date = pg_temp.ledger_day(1)),
  2::bigint,
  'with the assignment and the account restored, the owner reads both days again');

reset role;

select * from finish();
rollback;
