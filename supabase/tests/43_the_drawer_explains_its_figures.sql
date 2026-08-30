-- The drawer's grouped readers, and the full edit of a count nothing anchored on.
--
-- **The assertion this file exists to make is arithmetic**: each grouped reader
-- sums exactly to its scalar sibling over the same interval. A breakdown that
-- looks right on screen and does not add up to the figure it was opened from is
-- the one failure the whole design is arranged to prevent, and it is not a thing
-- a screenshot can catch (design D8).
--
-- Four more claims here, each a rule that would pass every other gate in this
-- repo if it were quietly wrong:
--
--   * **The partition is of the INTERVAL, never of the calendar day** (D1). The
--     interval is bounded by instants, so its oldest group is routinely a
--     fragment of a business date — the part after the count that cut it. A
--     reader that fetched whole days and trimmed them would agree with this file
--     on a quiet night and disagree the moment a count lands mid-evening, which
--     is the ordinary case.
--
--   * **The cutover is the outlet's own.** The adapter carried
--     `const CUTOVER = '04:00'`, which is right at both outlets today and is
--     exactly the kind of constant that stays right until an outlet opens with a
--     different one. So one test moves an outlet's cutover and asserts the small
--     hours land where THAT outlet puts them; a reintroduced constant fails it.
--
--   * **The row count beside a figure is the true count.**
--     `cashReceiptsSinceCount` was the length of a list capped at twelve and
--     drawn from the last forty settled bills for a different job entirely, so
--     forty cash bills since the last count reported twelve. Thirteen bills here
--     are thirteen.
--
--   * **A moved counted instant recomputes what the count is measured against.**
--     The instant IS the interval's upper bound. `edit_drawer_observation` used
--     to change the amount and leave the expected total alone, so correcting a
--     count recorded at 23:30 to the 22:00 it was taken at kept ninety minutes
--     of bills that were never in the drawer — and the only remaining knob was
--     the physical count.
--
-- Conventions inherited from 41_cash_drawer.sql, and worth knowing before
-- editing: `now()` is fixed for the whole transaction, so every instant is an
-- explicit offset from one base rather than a fresh `now()`. And the seed rings
-- real bills whose instants this file does not control, so every claim that
-- could be poisoned by the seed is written DIFFERENTIALLY or measured against
-- the reader itself rather than against a hardcoded rupee figure.

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
-- Kanchrapara's own biller and tablet, so a bill written here is a bill that
-- outlet could actually have rung.
\set BILLER_KPA '10000000-0000-4000-a000-00000000000b'
\set DEVICE_KPA '10000000-0000-4000-a000-000000000005'
\set KAL_LAT 22.975
\set KAL_LNG 88.4345

-- One base instant. Every offset below is comparable to every other because
-- `now()` does not move inside a transaction.
create function pg_temp.t(p_minutes integer)
returns timestamptz language sql stable as $$
  select now() - make_interval(mins => p_minutes)
$$;

/**
 * A settled cash bill at a stated instant.
 *
 * `prepare_bill_clocks` copies `created_at` onto `paid_at` outside a billing
 * command, and `validate_business_date` insists `business_date` agrees with
 * `created_at` under that outlet's cutover — so the instant is stated once and
 * both derived columns follow it. That is what lets a test place a bill either
 * side of a count instant, or either side of a cutover, on purpose.
 */
create function pg_temp.ring_cash(
  p_outlet uuid, p_biller uuid, p_device uuid, p_at timestamptz, p_paise bigint)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_date date;
begin
  select public.app_business_date(p_at, o.business_day_cutover) into v_date
    from public.outlets o where o.id = p_outlet;

  insert into public.bills (
    id, outlet_id, business_date, biller_profile_id, counter_device_id,
    subtotal_paise, total_paise, payment_method, status, created_at, synced_at)
  values (
    v_id, p_outlet, v_date, p_biller, p_device,
    p_paise, p_paise, 'cash', 'settled', p_at, p_at);

  insert into public.bill_payments (bill_id, outlet_id, method, amount_paise)
  values (v_id, p_outlet, 'cash', p_paise);

  return v_id;
end;
$$;

/** A notebook cash expense, written the way the live Expenses surface writes one. */
create function pg_temp.note_expense(
  p_outlet uuid, p_by uuid, p_at timestamptz, p_paise bigint, p_category text, p_cash boolean)
returns void language plpgsql as $$
declare v_date date;
begin
  select public.app_business_date(p_at, o.business_day_cutover) into v_date
    from public.outlets o where o.id = p_outlet;
  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, amount_paise, is_cash, occurred_at, recorded_by)
  values (p_outlet, v_date, p_category, p_paise, p_cash, p_at, p_by);
end;
$$;

/** Move an outlet's cutover, so "the outlet's own" can be asserted rather than assumed. */
create function pg_temp.set_cutover(p_outlet uuid, p_cutover time)
returns void language sql as $$
  update public.outlets set business_day_cutover = p_cutover where id = p_outlet
$$;

-- ===========================================================================
-- 1. Both readers exist, and neither is reachable by anybody the tables refuse.
--
-- These two functions are `security definer`, so they are a path AROUND the
-- policies every drawer table carries. The three that shipped in #11 took the
-- outlet id from the caller and checked nothing, which is the tenancy defect the
-- 2026-08-28 migration fixed. These are born with the guard.

select has_function('public', 'drawer_cash_receipts_by_day',
  array['uuid', 'timestamptz', 'timestamptz'],
  'drawer_cash_receipts_by_day exists');

select has_function('public', 'drawer_cash_expenses_by_day',
  array['uuid', 'timestamptz', 'timestamptz'],
  'drawer_cash_expenses_by_day exists');

select is(
  (select count(*) from information_schema.role_routine_grants
    where routine_name in ('drawer_cash_receipts_by_day', 'drawer_cash_expenses_by_day')
      and grantee in ('public', 'anon')),
  0::bigint,
  'neither grouped reader is executable by public or anon');

select pg_temp.impersonate(:'BILLER_KAL');

select is(
  (select count(*) from public.drawer_cash_receipts_by_day(:'KAL', null, now())),
  0::bigint,
  'a Biller groups no cash receipts — not even at the outlet they are assigned '
  'to, because no Biller reaches any drawer');

select is(
  (select count(*) from public.drawer_cash_expenses_by_day(:'KAL', null, now())),
  0::bigint,
  'nor any cash expenses');

select pg_temp.impersonate(:'EMPLOYEE_KAL');

select is(
  (select count(*) from public.drawer_cash_receipts_by_day(:'KPA', null, now())),
  0::bigint,
  'and an Employee groups nothing at an outlet they hold no assignment at, '
  'which is the hand-crafted cross-outlet request AGENTS.md names');

select is(
  (select count(*) from public.drawer_cash_expenses_by_day(:'KPA', null, now())),
  0::bigint,
  'in either reader');

-- ===========================================================================
-- 2. The groups sum to the scalar they explain.
--
-- **This is the assertion the design exists to make possible.** Same relation,
-- same predicate, same `(p_from, p_to]` convention, one `group by` apart — so
-- the breakdown and the tile are two views of one selection and cannot disagree.
--
-- The interval deliberately spans more than a day and therefore a cutover, which
-- is the case where a partition computed a different way would drift.

-- **Every fixture write below runs with no session claim.** A bill may only be
-- inserted through a billing command while `auth.uid()` is set, which is
-- `billing_bill_insert_guard` doing its job; who may write a bill is
-- 04_write_contract_billing.sql's question, and these rows exist only to give
-- the readers something to group.
select pg_temp.unimpersonate();

-- Put this test's cutover exactly between t-700 and t-200. A fixed 04:00
-- cutover makes both fixtures land on the same business date during part of
-- every day, turning the partition assertion below into a clock-dependent
-- failure. The production value is restored before the next section.
select pg_temp.set_cutover(
  :'KAL',
  (pg_temp.t(450) at time zone 'Asia/Kolkata')::time);

-- Bills either side of the cutover, and one before the whole interval so that
-- "sums to the scalar" is a claim about a bounded window rather than about
-- everything.
select pg_temp.ring_cash(:'KAL', :'BILLER_KAL', '10000000-0000-4000-a000-000000000004',
  pg_temp.t(2000), 50000);
select pg_temp.ring_cash(:'KAL', :'BILLER_KAL', '10000000-0000-4000-a000-000000000004',
  pg_temp.t(700), 31000);
select pg_temp.ring_cash(:'KAL', :'BILLER_KAL', '10000000-0000-4000-a000-000000000004',
  pg_temp.t(200), 42000);
select pg_temp.ring_cash(:'KAL', :'BILLER_KAL', '10000000-0000-4000-a000-000000000004',
  pg_temp.t(20), 17000);

select pg_temp.note_expense(:'KAL', :'OWNER', pg_temp.t(690), 26000, 'Grouped · vegetables', true);
select pg_temp.note_expense(:'KAL', :'OWNER', pg_temp.t(150), 90000, 'Grouped · gas', true);

select pg_temp.impersonate(:'OWNER');

create temporary table pg_temp.upi_expense_baseline (paise bigint not null);
insert into pg_temp.upi_expense_baseline
select coalesce(sum(paise), 0)::bigint
  from public.drawer_cash_expenses_by_day(:'KAL', pg_temp.t(1440), pg_temp.t(1));

select pg_temp.unimpersonate();
-- Not cash, so it reaches neither the groups nor the scalar.
select pg_temp.note_expense(:'KAL', :'OWNER', pg_temp.t(140), 500000, 'Grouped · UPI', false);
select pg_temp.impersonate(:'OWNER');

select is(
  (select coalesce(sum(paise), 0)::bigint
     from public.drawer_cash_receipts_by_day(:'KAL', pg_temp.t(1440), pg_temp.t(1))),
  public.drawer_cash_receipts_paise(:'KAL', pg_temp.t(1440), pg_temp.t(1)),
  'the receipt groups sum EXACTLY to drawer_cash_receipts_paise over the same '
  'interval, which spans a cutover');

select is(
  (select coalesce(sum(paise), 0)::bigint
     from public.drawer_cash_expenses_by_day(:'KAL', pg_temp.t(1440), pg_temp.t(1))),
  public.drawer_cash_expenses_paise(:'KAL', pg_temp.t(1440), pg_temp.t(1)),
  'and the expense groups sum EXACTLY to drawer_cash_expenses_paise');

select ok(
  (select count(*) from public.drawer_cash_receipts_by_day(:'KAL', pg_temp.t(1440), pg_temp.t(1)))
    >= 2,
  'over more than one business date, so the sum above is a claim about a '
  'partition rather than about a single group');

select is(
  (select coalesce(sum(paise), 0)::bigint
     from public.drawer_cash_receipts_by_day(:'KAL', pg_temp.t(1440), pg_temp.t(1)))
    - (select coalesce(sum(paise), 0)::bigint
         from public.drawer_cash_receipts_by_day(:'KAL', pg_temp.t(600), pg_temp.t(1))),
  31000::bigint,
  'the bill at t-700 is inside the day-long interval and outside the ten-hour '
  'one, so the partition respects the interval''s own lower bound');

select is(
  (select coalesce(sum(paise), 0)::bigint
     from public.drawer_cash_expenses_by_day(:'KAL', pg_temp.t(1440), pg_temp.t(1))),
  (select paise from pg_temp.upi_expense_baseline),
  'the ₹5,000 UPI expense at t-140 reaches no group, because only cash moves '
  'the drawer');

select pg_temp.set_cutover(:'KAL', time '04:00');

-- ===========================================================================
-- 3. The oldest group is a FRAGMENT of its business date (design D1).
--
-- A count at 11:23 pm cuts that business date in half. The interval starts at
-- the count, so the group for that date holds only what came after it — and the
-- surface says so by naming the count. A reader that fetched the whole day and
-- trimmed it would pass every test above and fail this one.

select pg_temp.unimpersonate();
select pg_temp.ring_cash(:'KAL', :'BILLER_KAL', '10000000-0000-4000-a000-000000000004',
  pg_temp.t(180), 11000);
select pg_temp.ring_cash(:'KAL', :'BILLER_KAL', '10000000-0000-4000-a000-000000000004',
  pg_temp.t(120), 13000);
select pg_temp.impersonate(:'OWNER');

select is(
  (select paise from public.drawer_cash_receipts_by_day(:'KAL', pg_temp.t(150), now())
    where business_date = public.app_business_date(pg_temp.t(120), time '04:00')),
  (select coalesce(sum(e.amount_paise), 0)::bigint
     from public.bills b join public.effective_bill_payments e on e.bill_id = b.id
    where b.outlet_id = :'KAL' and b.status = 'settled' and e.method = 'cash'
      and b.paid_at > pg_temp.t(150) and b.paid_at <= now()
      and public.app_business_date(b.paid_at, time '04:00')
          = public.app_business_date(pg_temp.t(120), time '04:00')),
  'the group for the business date the count fell on holds only the part of '
  'that date AFTER the count, never the whole day');

select ok(
  (select paise from public.drawer_cash_receipts_by_day(:'KAL', pg_temp.t(150), now())
    where business_date = public.app_business_date(pg_temp.t(120), time '04:00'))
  < (select paise from public.drawer_cash_receipts_by_day(:'KAL', pg_temp.t(190), now())
      where business_date = public.app_business_date(pg_temp.t(120), time '04:00')),
  'and moving the count earlier grows that same group, which is what makes it a '
  'fragment of a date rather than the date itself');

-- ===========================================================================
-- 4. The cutover is the outlet's own, read from its own row.
--
-- Kanchrapara is moved to an 06:00 cutover inside this transaction — deliberately
-- NOT the 04:00 both outlets carry, measured 2026-08-29 — and a bill rung at
-- 05:00 must then file under the PREVIOUS business date. Under a reintroduced
-- constant it files under the day it was rung on, and this fails.

select pg_temp.unimpersonate();
select pg_temp.set_cutover(:'KPA', time '06:00');

-- 05:00 on a fixed calendar date, expressed in Asia/Kolkata so the assertion is
-- about the rule rather than about whatever time the suite happens to run at.
select pg_temp.ring_cash(:'KPA', :'BILLER_KPA', :'DEVICE_KPA',
  (((current_date - 2)::timestamp + time '05:00') at time zone 'Asia/Kolkata'), 22000);
select pg_temp.impersonate(:'OWNER');

select is(
  (select business_date from public.drawer_cash_receipts_by_day(
     :'KPA',
     (((current_date - 3)::timestamp + time '12:00') at time zone 'Asia/Kolkata'),
     (((current_date - 2)::timestamp + time '12:00') at time zone 'Asia/Kolkata'))),
  current_date - 3,
  'at an outlet whose cutover is 06:00, cash rung at 05:00 groups into the '
  'PREVIOUS business date — the outlet''s own cutover decides it, not a '
  'constant held by the application');

select is(
  public.app_business_date(
    (((current_date - 2)::timestamp + time '05:00') at time zone 'Asia/Kolkata'), time '04:00'),
  current_date - 2,
  'and under the 04:00 constant it would have grouped into the following date, '
  'which is what makes the assertion above a real one');

select pg_temp.unimpersonate();
select pg_temp.set_cutover(:'KPA', time '04:00');

-- ===========================================================================
-- 5. The row count is the TRUE count, not a capped sample's length.
--
-- `cashReceiptsSinceCount` was `nearbyCashBills.filter(...).length`, over a list
-- capped at twelve and drawn from the last forty settled bills for the movable
-- boundary and the coincidence report. That list keeps its cap — it is evidence
-- for a person to recognise rather than an aggregate — but the count stops being
-- derived from it.

do $$
declare i integer;
begin
  for i in 1..13 loop
    perform pg_temp.ring_cash(
      '00000000-0000-4000-a000-000000000002'::uuid,
      '10000000-0000-4000-a000-00000000000b'::uuid,
      '10000000-0000-4000-a000-000000000005'::uuid,
      now() - make_interval(mins => i), 10000 + i);
  end loop;
end;
$$;
select pg_temp.impersonate(:'OWNER');

select is(
  (select coalesce(sum(bills), 0)::int
     from public.drawer_cash_receipts_by_day(:'KPA', now() - interval '14 minutes', now())),
  13,
  'thirteen cash bills in the interval are counted as thirteen, which no window '
  'capped at twelve can report');

select is(
  (select coalesce(sum(paise), 0)::bigint
     from public.drawer_cash_receipts_by_day(:'KPA', now() - interval '14 minutes', now())),
  public.drawer_cash_receipts_paise(:'KPA', now() - interval '14 minutes', now()),
  'and those thirteen still sum to the scalar');

-- ===========================================================================
-- 6. The full edit: the instant, the recomputation, and the note.

-- An anchor, then the count this section edits. Kanchrapara, because Kalyani's
-- seed already carries counts and an anchor assertion there would be about the
-- seed rather than about the command.
select id as anchor_id from public.record_drawer_observation(
  :'KPA', now() - interval '600 minutes', 500000, false, 15,
  22.9345, 88.4200, 10, 'pgTAP probe') \gset

select id as edited_id, expected_paise as expected_before,
       counted_at as counted_before
  from public.record_drawer_observation(
    :'KPA', now() - interval '10 minutes', 900000, false, 15,
    22.9345, 88.4200, 10, 'pgTAP probe', 'the note that must survive') \gset

select is(
  (select note from public.drawer_observations where id = :'edited_id'),
  'the note that must survive',
  'the count was recorded with a note');

-- ── An amount-only edit leaves the expected total AND the note alone ────────

select public.edit_drawer_observation(:'edited_id', 880000) is not null as edited_amount_only \gset

select is(
  (select expected_paise from public.drawer_observations where id = :'edited_id'),
  :'expected_before'::bigint,
  'an edit that changes only the counted total leaves the expected total as it '
  'was — the interval did not move, only what was found in the drawer');

select is(
  (select note from public.drawer_observations where id = :'edited_id'),
  'the note that must survive',
  '**and it leaves the note.** p_note defaulted to null and was assigned '
  'unconditionally, so every amount correction silently wiped a note the '
  'caller never mentioned');

select is(
  (select counted_at from public.drawer_observations where id = :'edited_id'),
  :'counted_before'::timestamptz,
  'and the counted instant does not move when it is not supplied');

-- ── Moving the instant earlier recomputes what the count is measured against ─

-- Thirteen bills sit in the last fourteen minutes, so moving the boundary from
-- t-10 back to t-12 genuinely changes which of them were in the drawer.
select public.edit_drawer_observation(
  :'edited_id', 880000, null, now() - interval '12 minutes') is not null as moved \gset

select is(
  (select counted_at from public.drawer_observations where id = :'edited_id'),
  now() - interval '12 minutes',
  'the counted instant moves');

select is(
  (select expected_paise from public.drawer_observations where id = :'edited_id'),
  (select o.opening_paise
     + public.drawer_cash_receipts_paise(:'KPA', a.counted_at, now() - interval '12 minutes')
     - public.drawer_cash_expenses_paise(:'KPA', a.counted_at, now() - interval '12 minutes')
     - public.drawer_cash_out_paise(:'KPA', a.counted_at, now() - interval '12 minutes', o.id)
     from public.drawer_observations o, public.drawer_observations a
    where o.id = :'edited_id' and a.id = :'anchor_id'),
  '**the expected total is recomputed from the instant it moved to**, by the '
  'same three interval readers record_drawer_observation calls — not left '
  'measuring the count against bills that were never in the drawer');

select isnt(
  (select expected_paise from public.drawer_observations where id = :'edited_id'),
  :'expected_before'::bigint,
  'and it genuinely changed, so the assertion above is not vacuous');

select is(
  (select difference_paise from public.drawer_observations where id = :'edited_id'),
  (select counted_total_paise - expected_paise
     from public.drawer_observations where id = :'edited_id'),
  'the difference is recomputed against the new expected total');

select is(
  (select note from public.drawer_observations where id = :'edited_id'),
  'the note that must survive',
  'and moving the instant still leaves the note alone');

-- An empty string is how a caller clears a note on purpose, which is a thing
-- only a caller who meant it can send.
select public.edit_drawer_observation(:'edited_id', 880000, '') is not null as cleared \gset

select is(
  (select note from public.drawer_observations where id = :'edited_id'),
  null::text,
  'an empty note clears it, so "leave it alone" does not mean "never change it"');

-- ── The moved instant is bounded exactly as a recorded one is ───────────────

select throws_like(
  format($q$select public.edit_drawer_observation(%L, 880000, null, now() + interval '1 hour')$q$,
         :'edited_id'),
  '%future%',
  'a moved instant in the future is refused, naming the clock it collided with');

select throws_like(
  format($q$select public.edit_drawer_observation(%L, 880000, null, now() - interval '900 minutes')$q$,
         :'edited_id'),
  '%already counted%',
  'a moved instant at or before the preceding observation is refused, naming '
  'what it collided with');

-- ── An anchored count is still refused, before any clock is consulted ───────

select id as later_id from public.record_drawer_observation(
  :'KPA', now() - interval '2 minutes', 910000, false, 15,
  22.9345, 88.4200, 10, 'pgTAP probe') \gset

select throws_like(
  format($q$select public.edit_drawer_observation(%L, 700000, null, now() - interval '11 minutes')$q$,
         :'edited_id'),
  '%anchored on this one%',
  'a count a later one has anchored on is refused the edit whatever it asks to '
  'change, and the refusal names the one thing that matters');

select pg_temp.unimpersonate();

select * from finish();
rollback;
