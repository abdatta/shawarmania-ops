-- Expenses are read where they are written, and the drawer's readers ask who
-- is calling.
--
-- Two defects, one found while fixing the other, and both invisible to every
-- other gate in this repo:
--
--   * `drawer_cash_expenses_paise()` and the derived Ledger read
--     `public.expenses`, which nothing writes and never has — every live
--     Expenses surface writes `manual_ledger_expenses`. Measured on production
--     2026-08-28: 0 rows against 118. So the Ledger said "Nothing recorded" on
--     days with real expenses, and the drawer's expected balance was overstated
--     by every cash expense since the last count, which turns into a
--     manufactured shortfall the moment somebody counts.
--
--     The demo could not catch it: the mock store writes and reads one array,
--     so demo mode is self-consistent by construction. Only production has two
--     tables, one written and the other read. **That is the reason this file
--     exists at the database level rather than as a component test.**
--
--   * All three interval readers are `security definer`, granted to
--     `authenticated`, and took `p_outlet_id` from the caller while checking
--     nothing. They are the one path around the policies every drawer table
--     carries, so a Biller could read another outlet's cash totals through them
--     with a valid session — the hard rule in AGENTS.md, stated as a MUST NOT.
--
-- The assertions here are DIFFERENTIAL, following 41_cash_drawer.sql: the seed
-- rings real bills and carries real notebook rows whose instants this file does
-- not control, so each test measures the reader before and after a row it
-- inserts itself. A hardcoded total would be asserting the seed.

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

\set OWNER '10000000-0000-4000-a000-000000000001'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- One base instant, because `now()` is fixed for the transaction and every
-- offset below has to be comparable to every other.
create function pg_temp.t(p_minutes integer)
returns timestamptz language sql stable as $$
  select now() - make_interval(mins => p_minutes)
$$;

-- ===========================================================================
-- 1. The view names the live expense record wherever it lives.

select has_view('public', 'effective_expenses', 'effective_expenses exists');

select ok(
  (select reloptions::text from pg_class
    where oid = 'public.effective_expenses'::regclass) like '%security_invoker=%',
  'it is a security_invoker view — without that, RLS on the base tables is '
  'bypassed and any session reads every outlet''s expenses through it');

-- A notebook cash expense, written the way the live Expenses surface writes one.
insert into public.manual_ledger_expenses
  (outlet_id, business_date, category, amount_paise, is_cash, occurred_at, recorded_by)
values
  (:'KAL', current_date, 'Gas cylinder', 90000, true, pg_temp.t(30), :'OWNER');

select is(
  (select count(*) from public.effective_expenses
    where outlet_id = :'KAL' and category = 'Gas cylinder'),
  1::bigint,
  'a notebook expense reaches the view — this is the row the Ledger reported '
  'as "Nothing recorded"');

select is(
  (select is_cash from public.effective_expenses where category = 'Gas cylinder'),
  true,
  'and the two payment-method shapes are normalised to one boolean');

select is(
  (select source_table from public.effective_expenses where category = 'Gas cylinder'),
  'manual_ledger_expenses',
  'the view says which side a row came from, so #12 can watch the second '
  'branch empty out');

-- A voided expense is a row somebody withdrew.
insert into public.manual_ledger_expenses
  (outlet_id, business_date, category, amount_paise, is_cash, occurred_at,
   recorded_by, voided_at, voided_by, voided_reason)
values
  (:'KAL', current_date, 'Withdrawn cylinder', 77700, true, pg_temp.t(29),
   :'OWNER', now(), :'OWNER', 'entered twice');

select is(
  (select count(*) from public.effective_expenses where category = 'Withdrawn cylinder'),
  0::bigint,
  'a voided expense never reaches a total, a drawer interval or a month');

-- ===========================================================================
-- 2. The drawer's expense term counts it.
--
-- The defect, stated as arithmetic: before the fix this reader summed an empty
-- table, so the difference below was zero however much cash had been spent.

select pg_temp.impersonate(:'OWNER');

select is(
  public.drawer_cash_expenses_paise(:'KAL', pg_temp.t(60), pg_temp.t(1))
    - public.drawer_cash_expenses_paise(:'KAL', pg_temp.t(20), pg_temp.t(1)),
  90000::bigint,
  'the ₹900 cash expense at t-30 is inside the hour-long interval and outside '
  'the twenty-minute one — so the drawer''s expected balance falls by it, and '
  'the count that follows is not short by it');

-- Only cash moves the drawer, which is unchanged and must stay unchanged.
insert into public.manual_ledger_expenses
  (outlet_id, business_date, category, amount_paise, is_cash, occurred_at, recorded_by)
values
  (:'KAL', current_date, 'Supplier by UPI', 500000, false, pg_temp.t(31), :'OWNER');

select is(
  public.drawer_cash_expenses_paise(:'KAL', pg_temp.t(60), pg_temp.t(1))
    - public.drawer_cash_expenses_paise(:'KAL', pg_temp.t(20), pg_temp.t(1)),
  90000::bigint,
  'a ₹5,000 UPI expense in the same interval moves the drawer by nothing');

select is(
  public.drawer_cash_expenses_paise(:'KPA', pg_temp.t(60), pg_temp.t(1))
    - public.drawer_cash_expenses_paise(:'KPA', pg_temp.t(20), pg_temp.t(1)),
  0::bigint,
  'and Kalyani''s expense is not in Kanchrapara''s interval');

-- ===========================================================================
-- 3. The readers ask who is calling.
--
-- Every drawer TABLE carries app_may_reach_drawer() in its policy. These three
-- functions are the one path around those policies, and they shipped without
-- it: a valid session was the whole of the authorisation.

select pg_temp.impersonate(:'BILLER_KAL');

select is(
  public.drawer_cash_expenses_paise(:'KAL', pg_temp.t(60), pg_temp.t(1)),
  0::bigint,
  'a Biller reads no cash expenses through the reader — not even at the outlet '
  'they are assigned to, because no Biller reaches any drawer');

select is(
  public.drawer_cash_receipts_paise(:'KAL', pg_temp.t(600), pg_temp.t(1)),
  0::bigint,
  'nor cash receipts');

select is(
  public.drawer_cash_out_paise(:'KAL', pg_temp.t(600), pg_temp.t(1)),
  0::bigint,
  'nor collections');

select pg_temp.impersonate(:'EMPLOYEE_KAL');

select is(
  public.drawer_cash_receipts_paise(:'KPA', pg_temp.t(600), pg_temp.t(1)),
  0::bigint,
  'and an Employee reads nothing at an outlet they hold no assignment at, '
  'which is the hand-crafted cross-outlet request AGENTS.md names');

-- The owner, unchanged: a guard that refused the person who has to count would
-- be a worse defect than the one it fixed.
select pg_temp.impersonate(:'OWNER');

select ok(
  public.drawer_cash_receipts_paise(:'KAL', null, now()) >= 0,
  'the Super Admin still reads every term at every outlet, holding no assignment');

select ok(
  public.drawer_cash_expenses_paise(:'KAL', pg_temp.t(60), pg_temp.t(1)) >= 90000,
  'and still sees the expenses the count will be measured against');

select pg_temp.unimpersonate();

select * from finish();
rollback;
