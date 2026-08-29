-- The drawer's boundary and its arithmetic, written out rather than inherited.
--
-- The generic sweep in 02_isolation_matrix.sql discovers the four new tables
-- from the catalog and proves the ordinary claim: nobody reads across outlets.
-- Three claims here are the ones the sweep cannot express, and each is a rule
-- that silent over-permission or a quiet arithmetic slip would pass every other
-- gate in this repo with:
--
--   * **A Super Admin holding NO assignment reaches every drawer.** Not a
--     convenience. Confirmed against production on 2026-08-26 and again on
--     2026-08-27: both Super Admins had their Franchise Admin rows DELETED
--     rather than ended on 2026-08-01, so no live Franchise Admin assignment
--     exists at either outlet. A drawer reachable only through a Franchise Admin
--     assignment would be reachable by nobody, at both outlets, on day one.
--
--   * **A Biller and an Employee are refused every drawer read and write at
--     every outlet, including their own.** Stronger than outlet isolation, and
--     the reason is on the write side: an account that could set a counted
--     total, an opening or a cash-out could make any drawer reconcile, and the
--     count is the only control the business has over cash.
--
--   * **No client writes these tables at all.** Every derived figure is computed
--     inside the transaction that writes the row, so a client cannot supply an
--     opening, an expected total or a difference — there is no parameter through
--     which it could and no write policy to reach the table directly.
--
-- **Two conventions in here that are worth understanding before editing it.**
--
-- `now()` is fixed for a whole transaction, so every instant below is an
-- explicit offset from a single base rather than a fresh `now()`. Counts at
-- `now()` twice are counts at the SAME instant, and the ordering rule then
-- refuses the second one for a reason the test did not intend.
--
-- The seed rings real bills, whose instants this file does not control. So the
-- receipts term is **measured** by calling the same reader the command uses,
-- and the assertions that carry the weight are DIFFERENTIAL: what a UPI expense
-- contributes (nothing), what an expense after the count contributes (nothing),
-- what the observation's own collection contributes (nothing). A hardcoded
-- expected total would be asserting the seed rather than the arithmetic, and the
-- first version of this file did exactly that and was wrong by ₹1,861.

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
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- Kalyani's surveyed position, so a count is recorded inside or outside the
-- fence deliberately rather than by accident. The radius is 150 m.
\set KAL_LAT 22.975
\set KAL_LNG 88.4345
-- Roughly 8 km south: comfortably outside any plausible fence.
\set AWAY_LAT 22.905
\set AWAY_LNG 88.4345

-- The three count instants and the expense instants between them. All offsets
-- from one transaction-fixed base, so the intervals are known.
create function pg_temp.t(offset_hours numeric)
returns timestamptz language sql stable as $$
  select now() - (interval '1 hour' * offset_hours)
$$;
--   t(5)   anchor
--   t(4.5) gas ₹900 cash, and a UPI expense, and a standalone collection ₹500
--   t(3)   second count, with its own collection ₹2,000
--   t(2.5) gas ₹400 cash — inside the THIRD interval
--   t(1)   third count

-- ===========================================================================
-- 1. The shape of the schema itself.

select has_table('public', 'drawer_observations', 'drawer_observations exists');
select has_table('public', 'drawer_cash_out', 'drawer_cash_out exists');
select has_table('public', 'drawer_observation_adjustments',
  'drawer_observation_adjustments exists');
select has_table('public', 'ledger_day_verifications', 'ledger_day_verifications exists');
select has_table('public', 'drawer_reconciliation_acknowledgements',
  'drawer_reconciliation_acknowledgements exists');

-- Every outlet-scoped table ships its policy in the same change that creates it.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.drawer_observations'::regclass),
  'drawer_observations has row level security enabled');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.drawer_cash_out'::regclass),
  'drawer_cash_out has row level security enabled');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.drawer_observation_adjustments'::regclass),
  'drawer_observation_adjustments has row level security enabled');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ledger_day_verifications'::regclass),
  'ledger_day_verifications has row level security enabled');
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.drawer_reconciliation_acknowledgements'::regclass),
  'drawer_reconciliation_acknowledgements has row level security enabled');

-- Money is integer paise, never a float. `0.1 + 0.2` in a cash-reconciliation
-- app is not a rounding question, it is a wrong answer.
select is(
  (select count(*)::int
     from information_schema.columns
    where table_schema = 'public'
      and table_name in ('drawer_observations', 'drawer_cash_out',
                         'drawer_observation_adjustments')
      and column_name like '%paise%'
      and data_type <> 'bigint'),
  0,
  'every paise column on the new tables is bigint');

-- The additive rule, from the other side: the two nullable instants exist, so
-- no row already stored was broken.
select col_is_null('public', 'expenses', 'occurred_at',
  'expenses.occurred_at is nullable');
select col_is_null('public', 'manual_ledger_expenses', 'occurred_at',
  'manual_ledger_expenses.occurred_at is nullable');

-- Every pre-existing expense row still reads back through the coalesce, which is
-- what makes the new interval membership safe on old data.
select is(
  (select count(*) from public.expenses where coalesce(occurred_at, created_at) is null),
  0::bigint,
  'every existing expense resolves an instant through coalesce(occurred_at, created_at)');

-- The two dead tables. Production holds zero rows in each (read-only query,
-- 2026-08-26 and 2026-08-27); the SEED holds synthetic rows, so what is asserted
-- here is the thing this change could actually break: that nothing in the drawer
-- path writes them. Captured now, compared at the end of the file.
create temporary table pg_temp_dead_counts as
select (select count(*) from public.cash_withdrawals) as withdrawals,
       (select count(*) from public.daily_cash_records) as day_records;
-- Read back while impersonating, so the role needs the grant.
grant select on pg_temp_dead_counts to authenticated;

-- ===========================================================================
-- 2. The anchor. An outlet's first observation carries no arithmetic at all.

select pg_temp.impersonate(:'OWNER');

select lives_ok(
  format($q$
    select public.record_drawer_observation(
      %L, pg_temp.t(5), 500000, true, 15, %s, %s, 12, null, 'the books open here')
  $q$, :'KAL', :KAL_LAT, :KAL_LNG),
  'a Super Admin holding NO assignment records the first count at Kalyani');

select ok(
  (select is_anchor from public.drawer_observations where outlet_id = :'KAL'),
  'that first observation is the anchor');

select is(
  (select opening_paise from public.drawer_observations where outlet_id = :'KAL'),
  null::bigint,
  'the anchor carries NO opening — not a zero, which would be a fabricated figure');
select is(
  (select expected_paise from public.drawer_observations where outlet_id = :'KAL'),
  null::bigint,
  'the anchor carries no expected total');
select is(
  (select difference_paise from public.drawer_observations where outlet_id = :'KAL'),
  null::bigint,
  'the anchor carries no difference, so day one records no phantom variance');
select is(
  (select counted_total_paise from public.drawer_observations where outlet_id = :'KAL'),
  500000::bigint,
  'the drawer simply begins at what was counted');

select ok(
  (select recorded_on_site from public.drawer_observations where outlet_id = :'KAL'),
  'the recorder was inside the fence, so no reason was asked for');

select throws_ok(
  format($q$
    insert into public.drawer_observations
      (outlet_id, counted_at, is_anchor, counted_total_paise, is_approximate, recorded_by,
       recorded_lat, recorded_lng)
    values (%L, pg_temp.t(4), true, 100000, false, %L, %s, %s)
  $q$, :'KAL', :'OWNER', :KAL_LAT, :KAL_LNG),
  '42501',
  null,
  'a hand-crafted second anchor is refused — no client writes this table at all');

-- ===========================================================================
-- 3. The interval arithmetic, on a real second observation.

select pg_temp.unimpersonate();

insert into public.expenses
  (outlet_id, business_date, category, description, amount_paise, payment_method,
   recorded_by, occurred_at)
values
  -- Inside the SECOND interval, t(5) to t(3).
  (:'KAL', public.app_business_date(now(), time '04:00'), 'utilities',
   'Gas, before the second count', 90000, 'cash', :'OWNER', pg_temp.t(4.5)),
  -- Same interval, but UPI: it must move no drawer figure at all.
  (:'KAL', public.app_business_date(now(), time '04:00'), 'packaging',
   'Bags, by UPI', 30000, 'upi', :'OWNER', pg_temp.t(4.5)),
  -- Inside the THIRD interval, t(3) to t(1).
  (:'KAL', public.app_business_date(now(), time '04:00'), 'utilities',
   'Gas, after the second count', 40000, 'cash', :'OWNER', pg_temp.t(2.5));

-- A standalone collection inside the second interval, positive: cash left.
insert into public.drawer_cash_out
  (outlet_id, kind, amount_paise, occurred_at, recorded_by, recorded_lat, recorded_lng)
values (:'KAL', 'collection', 50000, pg_temp.t(4.5), :'OWNER', :KAL_LAT, :KAL_LNG);

-- What the seed's own bills contribute to this interval. Measured, not assumed:
-- the first version of this file assumed nought and was wrong by ₹1,861.
--
-- **Measured as the owner**, not in the unimpersonated window the inserts above
-- use. Since design D26 the three interval readers carry
-- `app_may_reach_drawer()` themselves, so a reader with no session gets nought —
-- which is the point of that guard and would silently zero this baseline.
select pg_temp.impersonate(:'OWNER');
create temporary table pg_temp_receipts as
select public.drawer_cash_receipts_paise(:'KAL', pg_temp.t(5), pg_temp.t(3)) as second_interval,
       public.drawer_cash_receipts_paise(:'KAL', pg_temp.t(3), pg_temp.t(1)) as third_interval;
select pg_temp.unimpersonate();
grant select on pg_temp_receipts to authenticated;

select pg_temp.impersonate(:'OWNER');

select lives_ok(
  format($q$
    select public.record_drawer_observation(
      %L, pg_temp.t(3), 350000, true, 15, %s, %s, 9, null, null, 200000, 'collection')
  $q$, :'KAL', :KAL_LAT, :KAL_LNG),
  'a second count is recorded, with its own ₹2,000 collection in the same transaction');

-- expected = opening 500000 (the anchor's counted total, no own cash out)
--          + receipts (measured)
--          − cash expenses 90000 (the ₹900 gas only: the UPI one and the later
--            one are both outside this term)
--          − cash out 50000 (the standalone collection, NOT this count's own
--            ₹2,000, which is excluded by its observation link)
select is(
  (select expected_paise from public.drawer_observations
    where outlet_id = :'KAL' and not is_anchor),
  (select 500000 + second_interval - 90000 - 50000 from pg_temp_receipts)::bigint,
  'expected = opening + receipts − cash expenses − cash out, every term bounded by instants');

select is(
  (select difference_paise from public.drawer_observations
    where outlet_id = :'KAL' and not is_anchor),
  (select 350000 - (500000 + second_interval - 90000 - 50000) from pg_temp_receipts)::bigint,
  'difference = counted − expected, and a drawer holding less than expected is NEGATIVE');

select ok(
  (select difference_paise from public.drawer_observations
    where outlet_id = :'KAL' and not is_anchor) < 0,
  'which on these figures is a shortfall');

select is(
  (select opening_paise from public.drawer_observations
    where outlet_id = :'KAL' and not is_anchor),
  500000::bigint,
  'the opening came from the anchor''s COUNTED total, never from an expected figure');

select is(
  (select count(*) from public.drawer_cash_out
    where observation_id = (select id from public.drawer_observations
                             where outlet_id = :'KAL' and not is_anchor)),
  1::bigint,
  'the count''s own collection was written in the same transaction and linked to it');

-- The differential claims, which are the ones that carry the weight. Each names
-- a row that exists in the interval and contributes nothing.
select is(
  public.drawer_cash_expenses_paise(:'KAL', pg_temp.t(5), pg_temp.t(3)),
  90000::bigint,
  'the ₹300 UPI expense in the same interval contributes NOTHING: only cash moves the drawer');

select is(
  public.drawer_cash_out_paise(:'KAL', pg_temp.t(5), pg_temp.t(3),
    (select id from public.drawer_observations where outlet_id = :'KAL' and not is_anchor)),
  50000::bigint,
  'and the observation''s own ₹2,000 collection is excluded from its own cash-out term');

select is(
  public.drawer_cash_out_paise(:'KAL', pg_temp.t(5), pg_temp.t(3), null),
  250000::bigint,
  'while without that exclusion the same window sums to ₹2,500 — so the exclusion is doing work');

-- Half-open at the start, closed at the end (decision 2). A movement at exactly
-- the previous count's instant belongs to that count, not to this one.
select pg_temp.unimpersonate();
insert into public.drawer_cash_out
  (outlet_id, kind, amount_paise, occurred_at, recorded_by, recorded_lat, recorded_lng)
values (:'KAL', 'collection', 70000, pg_temp.t(5), :'OWNER', :KAL_LAT, :KAL_LNG),
       (:'KAL', 'collection', 30000, pg_temp.t(3), :'OWNER', :KAL_LAT, :KAL_LNG);

-- Back inside a session before reading: the reader answers nought to a caller
-- who may not reach the drawer, which since D26 includes no caller at all.
select pg_temp.impersonate(:'OWNER');

select is(
  public.drawer_cash_out_paise(:'KAL', pg_temp.t(5), pg_temp.t(3), null),
  280000::bigint,
  'a movement AT the previous instant is excluded and one AT this instant is included');

-- ===========================================================================
-- 4. The carry-forward anchors to the COUNTED figure (decision 3).
--
-- The second observation was short. A third must open on the counted total less
-- that observation's own cash out — ₹3,500 − ₹2,000 = ₹1,500 — and NOT on the
-- expected figure, which would carry the shortfall forward as phantom cash.

select lives_ok(
  format($q$
    select public.record_drawer_observation(
      %L, pg_temp.t(1), 150000, true, 15, %s, %s, 9)
  $q$, :'KAL', :KAL_LAT, :KAL_LNG),
  'a third count is recorded');

select is(
  (select opening_paise from public.drawer_observations
    where outlet_id = :'KAL' order by counted_at desc limit 1),
  150000::bigint,
  'the third opening is counted ₹3,500 less its own ₹2,000 — THE SHORTFALL DID NOT PROPAGATE');

-- And the third difference depends only on the third interval. Whatever the
-- second observation was short by, it appears nowhere in this figure.
select is(
  (select difference_paise from public.drawer_observations
    where outlet_id = :'KAL' order by counted_at desc limit 1),
  (select 150000 - (150000 + third_interval - 40000) from pg_temp_receipts)::bigint,
  'and the third difference is a function of the third interval alone');

-- The ₹300 movement recorded AT t(3) is excluded from the third interval by the
-- same half-open rule, so it appears in neither count. Asserted because the
-- first version of this file subtracted it twice.
select is(
  public.drawer_cash_out_paise(:'KAL', pg_temp.t(3), pg_temp.t(1), null),
  0::bigint,
  'and the movement at exactly t(3) belongs to the SECOND count, not the third');

-- ===========================================================================
-- 5. The clocks, and the bounds the database enforces.

select throws_like(
  format($q$
    select public.record_drawer_observation(%L, now() + interval '1 hour', 100000, true,
      15, %s, %s, 9)
  $q$, :'KAL', :KAL_LAT, :KAL_LNG),
  '%future%',
  'a count claimed in the future is refused, naming the server clock');

select throws_like(
  format($q$
    select public.record_drawer_observation(%L, pg_temp.t(2), 100000, true, 15, %s, %s, 9)
  $q$, :'KAL', :KAL_LAT, :KAL_LNG),
  '%already counted%',
  'a count slotted before the previous one is refused, naming what it collided with');

select throws_like(
  format($q$
    select public.record_drawer_observation(%L, now(), -100, true, 15, %s, %s, 9)
  $q$, :'KAL', :KAL_LAT, :KAL_LNG),
  '%non-negative%',
  'a negative counted total is refused');

-- ===========================================================================
-- 6. Cash out: one table, a signed non-zero amount, a kind.

select throws_like(
  format($q$ select public.record_drawer_cash_out(%L, 0) $q$, :'KAL'),
  '%not a movement%',
  'a cash movement of nought is refused');

select lives_ok(
  format($q$
    select public.record_drawer_cash_out(%L, -100000, now(), 'collection', null, %s, %s, 9)
  $q$, :'KAL', :KAL_LAT, :KAL_LNG),
  'a NEGATIVE collection is accepted — that is cash ADDED to a thin drawer');

-- Scoped to the row just written rather than to the amount. `test:rls`'s REST
-- probe commits its own negative collection at this outlet, so matching on the
-- amount alone made this assertion depend on whether that suite had run — which
-- it had, and the subquery returned two rows.
select is(
  (select reason from public.drawer_cash_out
    where outlet_id = :'KAL' and amount_paise = -100000
    order by created_at desc limit 1),
  null::text,
  'and it needed neither a reason nor an actor: the account recording is the account collecting');

select throws_ok(
  format($q$
    insert into public.drawer_cash_out
      (outlet_id, kind, amount_paise, occurred_at, recorded_by, reason,
       recorded_lat, recorded_lng)
    values (%L, 'spend', -50000, now(), %L, 'a refund?', %s, %s)
  $q$, :'KAL', :'OWNER', :KAL_LAT, :KAL_LNG),
  '42501',
  null,
  'a hand-crafted negative spend never reaches its constraint: no client writes this table');

select pg_temp.unimpersonate();

-- The same refusals with the privilege a client does not have, so the
-- CONSTRAINTS are proved rather than only the missing grant. Coordinates are
-- supplied on every one, because a row with no position needs an away reason and
-- that constraint would otherwise fire first and pass the test for the wrong
-- reason — which is exactly what happened on the first run of this file.
select throws_like(
  format($q$
    insert into public.drawer_cash_out
      (outlet_id, kind, amount_paise, occurred_at, recorded_by, reason,
       recorded_lat, recorded_lng)
    values (%L, 'spend', -50000, now(), %L, 'a refund?', %s, %s)
  $q$, :'KAL', :'OWNER', :KAL_LAT, :KAL_LNG),
  '%drawer_cash_out_spend_is_positive%',
  'a negative spend is refused by constraint: drawer cash cannot un-buy a fridge');

select throws_like(
  format($q$
    insert into public.drawer_cash_out
      (outlet_id, kind, amount_paise, occurred_at, recorded_by, recorded_lat, recorded_lng)
    values (%L, 'spend', 4000000, now(), %L, %s, %s)
  $q$, :'KAL', :'OWNER', :KAL_LAT, :KAL_LNG),
  '%drawer_cash_out_spend_needs_a_reason%',
  'a spend without a reason is refused: it must say what it bought');

select throws_like(
  format($q$
    insert into public.drawer_cash_out
      (outlet_id, kind, amount_paise, occurred_at, recorded_by, recorded_lat, recorded_lng)
    values (%L, 'collection', 0, now(), %L, %s, %s)
  $q$, :'KAL', :'OWNER', :KAL_LAT, :KAL_LNG),
  '%amount_paise%',
  'a zero amount is refused by constraint too');

select lives_ok(
  format($q$
    insert into public.drawer_cash_out
      (outlet_id, kind, amount_paise, occurred_at, recorded_by, reason,
       recorded_lat, recorded_lng)
    values (%L, 'spend', 4000000, now(), %L, 'Chest freezer, paid from the till', %s, %s)
  $q$, :'KAL', :'OWNER', :KAL_LAT, :KAL_LNG),
  'a ₹40,000 spend WITH a reason is accepted');

select is(
  (select count(*) from public.expenses where amount_paise = 4000000),
  0::bigint,
  'and the fridge is nowhere in public.expenses, so the month''s operating figure stays clean');

-- ===========================================================================
-- 7. The anchor's shape, and the constraints that tie it.
--
-- Each insert below violates EXACTLY ONE constraint. Postgres does not promise
-- an evaluation order, so a row breaking three of them proves only that one of
-- the three fired.

select throws_like(
  format($q$
    insert into public.drawer_observations
      (outlet_id, counted_at, is_anchor, opening_paise, counted_total_paise,
       is_approximate, recorded_by, recorded_lat, recorded_lng)
    values (%L, now(), true, 100000, 100000, false, %L, %s, %s)
  $q$, :'KPA', :'OWNER', :KAL_LAT, :KAL_LNG),
  '%anchor_has_no_opening%',
  'an anchor carrying an opening is refused — a half-anchor cannot exist');

select throws_like(
  format($q$
    insert into public.drawer_observations
      (outlet_id, counted_at, is_anchor, opening_paise, expected_paise, difference_paise,
       counted_total_paise, is_approximate, recorded_by, recorded_lat, recorded_lng,
       away_reason)
    values (%L, now(), false, 100000, 200000, 999999, 100000, false, %L, %s, %s,
            'a probe, deliberately away')
  $q$, :'KPA', :'OWNER', :KAL_LAT, :KAL_LNG),
  '%difference_arithmetic%',
  'a difference that is not counted − expected is refused by constraint');

select throws_like(
  format($q$
    insert into public.drawer_observations
      (outlet_id, counted_at, recorded_at, is_anchor, counted_total_paise,
       is_approximate, recorded_by, recorded_lat, recorded_lng, away_reason)
    values (%L, now() + interval '1 day', now(), true, 100000, false, %L, %s, %s,
            'a probe, deliberately away')
  $q$, :'KPA', :'OWNER', :KAL_LAT, :KAL_LNG),
  '%counted_not_after_recorded%',
  'counted_at after recorded_at is refused by constraint as well as by the command');

-- ===========================================================================
-- 8. Being elsewhere is recorded, never refused (decision 11).
--
-- All three attempts are at Kanchrapara, which still has no observation, and the
-- first two fail — so the third is the outlet's anchor and no ordering rule is
-- involved.

select pg_temp.impersonate(:'OWNER');

select throws_like(
  format($q$
    select public.record_drawer_observation(%L, now(), 200000, true, 15, %s, %s, 20)
  $q$, :'KPA', :AWAY_LAT, :AWAY_LNG),
  '%away_needs_a_reason%',
  'a count recorded outside the fence asks for a reason FIRST');

select throws_like(
  format($q$ select public.record_drawer_observation(%L, now(), 200000, true) $q$, :'KPA'),
  '%away_needs_a_reason%',
  'and a count with NO position asks for one too: nobody can tell from the row that '
  'the person was standing there');

select lives_ok(
  format($q$
    select public.record_drawer_observation(
      %L, pg_temp.t(40), 200000, true, 15, %s, %s, 20, 'counted on the spot, typed at home')
  $q$, :'KPA', :AWAY_LAT, :AWAY_LNG),
  'with a reason it is accepted — NOTHING is refused for being elsewhere');

select ok(
  not (select recorded_on_site from public.drawer_observations where outlet_id = :'KPA'),
  'the record says the person was away');
select is(
  (select away_reason from public.drawer_observations where outlet_id = :'KPA'),
  'counted on the spot, typed at home',
  'and carries their reason, which is oversight a refusal would not have produced');
select ok(
  (select recorded_distance_m from public.drawer_observations where outlet_id = :'KPA') > 150,
  'the distance was recomputed from the coordinates, not accepted from the caller');

-- ===========================================================================
-- 8b. A count after skipped days is the ORDINARY path, not a special case.
--
-- Kanchrapara's anchor above sits ~40 hours back, so the next count there spans
-- several business dates. Under the model this change replaces, a skipped date
-- was a hole and the day the collector returned read as enormously over. Here it
-- is simply a longer interval, summed by the same code path as a single evening.

select pg_temp.unimpersonate();

-- What the seed already contributes to this window, captured BEFORE the fixture
-- rows go in. The same lesson as the receipts term: the seed's own expenses are
-- not this file's to assume, and hardcoding ₹800 here was wrong by the ₹100 the
-- seed happens to hold.
select pg_temp.impersonate(:'OWNER');
create temporary table pg_temp_kpa_before as
select public.drawer_cash_expenses_paise(:'KPA', pg_temp.t(40), pg_temp.t(0)) as expenses;
select pg_temp.unimpersonate();
grant select on pg_temp_kpa_before to authenticated;

-- One cash expense on each side of the intervening cutovers, so the sum has to
-- cross a business date to be right.
insert into public.expenses
  (outlet_id, business_date, category, description, amount_paise, payment_method,
   recorded_by, occurred_at)
values
  (:'KPA', public.app_business_date(pg_temp.t(30), time '04:00'), 'utilities',
   'Gas, the evening after the count', 60000, 'cash', :'OWNER', pg_temp.t(30)),
  (:'KPA', public.app_business_date(pg_temp.t(10), time '04:00'), 'utilities',
   'Gas, two evenings later', 20000, 'cash', :'OWNER', pg_temp.t(10));

select pg_temp.impersonate(:'OWNER');
create temporary table pg_temp_kpa as
select public.drawer_cash_receipts_paise(:'KPA', pg_temp.t(40), pg_temp.t(0)) as receipts,
       public.drawer_cash_expenses_paise(:'KPA', pg_temp.t(40), pg_temp.t(0)) as expenses,
       public.app_business_date(pg_temp.t(40), time '04:00') as from_date,
       public.app_business_date(pg_temp.t(0), time '04:00') as to_date;
select pg_temp.unimpersonate();
grant select on pg_temp_kpa to authenticated;

select ok(
  (select to_date - from_date from pg_temp_kpa) >= 1,
  'the interval about to be recorded genuinely spans more than one business date');

select is(
  (select expenses from pg_temp_kpa) - (select expenses from pg_temp_kpa_before),
  80000::bigint,
  'and the expenses term sums BOTH days'' cash expenses, across the cutover between them');

select pg_temp.impersonate(:'OWNER');

select lives_ok(
  format($q$
    select public.record_drawer_observation(
      %L, now(), 300000, true, 15, %s, %s, 20, 'back after a couple of days')
  $q$, :'KPA', :AWAY_LAT, :AWAY_LNG),
  'a count after two skipped days is accepted by the ordinary path, with no special case');

select is(
  (select opening_paise from public.drawer_observations
    where outlet_id = :'KPA' and not is_anchor),
  200000::bigint,
  'its opening is the earlier count''s total, however many days ago that was');

select is(
  (select expected_paise from public.drawer_observations
    where outlet_id = :'KPA' and not is_anchor),
  (select 200000 + receipts - expenses from pg_temp_kpa)::bigint,
  'and its expected total sums every day in the interval, by the same code path as one evening');

select ok(
  (select count(*) from public.drawer_observations where outlet_id = :'KPA') = 2,
  'two observations at Kanchrapara, neither of them a special kind of row');

-- ===========================================================================
-- 9. Who reaches a drawer, on every verb, at both outlets.

select pg_temp.impersonate(:'FA_KAL');

select isnt(
  (select count(*) from public.drawer_observations where outlet_id = :'KAL'),
  0::bigint,
  'an assigned Franchise Admin reads their own outlet''s counts');

select is(
  (select count(*) from public.drawer_observations where outlet_id = :'KPA'),
  0::bigint,
  'and reads NO rows at the outlet they are not assigned to');
select is(
  (select count(*) from public.drawer_cash_out where outlet_id = :'KPA'),
  0::bigint,
  'nor any of its cash movements');

select throws_like(
  format($q$
    select public.record_drawer_observation(%L, now(), 100000, true, 15, %s, %s, 9)
  $q$, :'KPA', :KAL_LAT, :KAL_LNG),
  '%Franchise Admin assigned to this outlet%',
  'a hand-crafted drawer write at an unassigned outlet is refused by the database');

-- A Biller and an Employee: refused everything, everywhere, including their own
-- outlet. The refusal is the absence of a policy branch, not a hidden screen.
select pg_temp.impersonate(:'BILLER_KAL');

select is(
  (select count(*) from public.drawer_observations),
  0::bigint,
  'a Biller reads no observation at any outlet, including the one they work at');
select is(
  (select count(*) from public.drawer_cash_out),
  0::bigint,
  'a Biller reads no cash movement anywhere');
select is(
  (select count(*) from public.drawer_observation_adjustments),
  0::bigint,
  'a Biller reads no adjustment anywhere');
select is(
  (select count(*) from public.ledger_day_verifications),
  0::bigint,
  'a Biller reads no verification anywhere');

select throws_like(
  format($q$
    select public.record_drawer_observation(%L, now(), 100000, true, 15, %s, %s, 9)
  $q$, :'KAL', :KAL_LAT, :KAL_LNG),
  '%Super Admin%',
  'a Biller''s hand-crafted count at their OWN outlet is refused');
select throws_like(
  format($q$ select public.record_drawer_cash_out(%L, 100000) $q$, :'KAL'),
  '%Super Admin%',
  'a Biller''s hand-crafted collection at their own outlet is refused');
select throws_like(
  format($q$ select public.verify_ledger_day(%L, current_date) $q$, :'KAL'),
  '%may not verify%',
  'and a Biller cannot verify a day either');

select pg_temp.impersonate(:'EMPLOYEE_KAL');

select is(
  (select count(*) from public.drawer_observations),
  0::bigint,
  'an Employee reads no observation at any outlet');
select throws_like(
  format($q$ select public.record_drawer_cash_out(%L, 100000) $q$, :'KAL'),
  '%Super Admin%',
  'an Employee''s hand-crafted collection is refused');

-- Deactivating the account ends the reach on the NEXT REQUEST rather than at
-- token expiry. Both checks run inside a savepoint, because the assignments
-- guard refuses to reopen an ended assignment — correctly — and the fixture has
-- to come back for the sections that follow.
savepoint before_revocation;

select pg_temp.unimpersonate();
update public.profiles set is_active = false where id = :'FA_KAL';

select pg_temp.impersonate(:'FA_KAL');
select is(
  (select count(*) from public.drawer_observations),
  0::bigint,
  'a deactivated Franchise Admin reads nothing on their very next request');

-- `rollback to savepoint` also reverts a transaction-local set_config, so the
-- claim comes back as whoever was current AT the savepoint. Clearing it has to
-- happen after the rollback: doing it before left the update below running as an
-- Employee, where RLS silently matched no rows and the test passed nothing.
rollback to savepoint before_revocation;
select pg_temp.unimpersonate();

savepoint before_ending;
update public.assignments set ended_on = current_date - 1
 where person_id = :'FA_KAL' and role = 'franchise_admin' and ended_on is null;

select pg_temp.impersonate(:'FA_KAL');
select is(
  (select count(*) from public.drawer_observations),
  0::bigint,
  'and an ended assignment ends the reach with no token change');

rollback to savepoint before_ending;
select pg_temp.unimpersonate();

-- ===========================================================================
-- 10. Editable until the next observation anchors on it, then append-only.

select pg_temp.impersonate(:'OWNER');

select lives_ok(
  format($q$
    select public.edit_drawer_observation(
      (select id from public.drawer_observations
        where outlet_id = %L order by counted_at desc limit 1),
      160000)
  $q$, :'KAL'),
  'the most recent count is edited with no reason and no trail');

select is(
  (select difference_paise from public.drawer_observations
    where outlet_id = :'KAL' order by counted_at desc limit 1),
  (select 160000 - (150000 + third_interval - 40000) from pg_temp_receipts)::bigint,
  'and the difference is recomputed from the SAME expected total: the interval did not move');

select throws_like(
  format($q$
    select public.edit_drawer_observation(
      (select id from public.drawer_observations where outlet_id = %L and is_anchor), 999999)
  $q$, :'KAL'),
  '%anchored on this one%',
  'an earlier count refuses the edit and names the adjustment as the only path');

select lives_ok(
  format($q$
    select public.adjust_drawer_observation(
      (select id from public.drawer_observations where outlet_id = %L and is_anchor),
      520000, 'miscounted, found a 200 note')
  $q$, :'KAL'),
  'and an adjustment carrying a reason is accepted');

select throws_like(
  format($q$
    select public.adjust_drawer_observation(
      (select id from public.drawer_observations where outlet_id = %L and is_anchor),
      530000, '   ')
  $q$, :'KAL'),
  '%needs a reason%',
  'an adjustment with a blank reason is refused');

-- **The point of the whole design.** Adjusting an earlier observation moves no
-- later stored opening. The later count re-anchored the balance to physical
-- cash, so nothing after it changes, and the break is REPORTED rather than
-- repaired.
select is(
  (select opening_paise from public.drawer_observations
    where outlet_id = :'KAL' and not is_anchor order by counted_at asc limit 1),
  500000::bigint,
  'the following observation''s stored opening is UNCHANGED by the adjustment');

select is(
  (select count(*) from public.drawer_observation_adjustments where outlet_id = :'KAL'),
  1::bigint,
  'the adjustment is its own append-only row');

select is(
  (select original_counted_total_paise from public.drawer_observation_adjustments
    where outlet_id = :'KAL'),
  500000::bigint,
  'and the ORIGINAL figure is still readable — it was never overwritten');
select is(
  (select corrected_counted_total_paise from public.drawer_observation_adjustments
    where outlet_id = :'KAL'),
  520000::bigint,
  'beside the corrected one');
select is(
  (select counted_total_paise from public.drawer_observations
    where outlet_id = :'KAL' and is_anchor),
  500000::bigint,
  'the observation itself is not rewritten by its adjustment');
select is(
  (select corrected_by from public.drawer_observations where outlet_id = :'KAL' and is_anchor),
  :'OWNER'::uuid,
  'but it now names the account that last corrected it');

select throws_like(
  format($q$
    select public.adjust_drawer_observation(
      (select id from public.drawer_observations
        where outlet_id = %L order by counted_at desc limit 1),
      170000, 'but nothing has anchored on this yet')
  $q$, :'KAL'),
  '%edit it instead%',
  'and the newest count refuses an ADJUSTMENT, because that case is an edit');

select pg_temp.unimpersonate();
select throws_ok(
  format($q$
    update public.drawer_observation_adjustments set reason = 'rewritten' where outlet_id = %L
  $q$, :'KAL'),
  null, null,
  'an adjustment cannot be updated by anybody, superuser included');

-- ===========================================================================
-- 10b. Late-arriving work is reported BESIDE an observation, never inside it.

select pg_temp.impersonate(:'OWNER');

-- A real settled bill at this outlet stands in for the late arrival. What makes
-- it an exception is derived — its payment instant falls inside an interval an
-- observation already covered, and it arrived after that observation was
-- recorded — so nothing about the exception itself is written here.
create temporary table pg_temp_late as
select b.id as bill_id,
       (select id from public.drawer_observations
         where outlet_id = :'KAL' and not is_anchor
         order by counted_at asc limit 1) as observation_id,
       (select counted_total_paise from public.drawer_observations
         where outlet_id = :'KAL' and not is_anchor
         order by counted_at asc limit 1) as counted_before
  from public.bills b
 where b.outlet_id = :'KAL' and b.status = 'settled'
 order by b.paid_at desc limit 1;
grant select on pg_temp_late to authenticated;

select lives_ok(
  format($q$
    select public.acknowledge_drawer_exception(
      (select observation_id from pg_temp_late), 'bill',
      (select bill_id from pg_temp_late),
      'the tablet was offline; this is the ₹740 we were over by')
  $q$),
  'a late arrival is acknowledged with a note against the observation it fell inside');

select throws_like(
  format($q$
    select public.acknowledge_drawer_exception(
      (select observation_id from pg_temp_late), 'bill',
      (select bill_id from pg_temp_late), 'again')
  $q$),
  '%already been acknowledged%',
  'and acknowledging the same arrival twice is refused: a second reader is not a second event');

-- **The requirement, asserted directly.** Acknowledging changed no stored figure.
select is(
  (select counted_total_paise from public.drawer_observations
    where id = (select observation_id from pg_temp_late)),
  (select counted_before from pg_temp_late),
  'the observation''s counted total is untouched by the acknowledgement');

select is(
  (select count(*) from public.drawer_reconciliation_acknowledgements
    where outlet_id = :'KAL'),
  1::bigint,
  'the acknowledgement is its own row, beside the observation rather than inside it');

select isnt(
  (select note from public.drawer_reconciliation_acknowledgements where outlet_id = :'KAL'),
  null::text,
  'carrying the note and, by its own instant, the date the excess was explained');

select pg_temp.impersonate(:'BILLER_KAL');
select is(
  (select count(*) from public.drawer_reconciliation_acknowledgements),
  0::bigint,
  'and a Biller reads no acknowledgement anywhere either');

-- ===========================================================================
-- 11. Verification is an acknowledgement, not a freeze.

select pg_temp.impersonate(:'OWNER');

select lives_ok(
  format($q$ select public.verify_ledger_day(%L, %L, 'read it, looks right') $q$,
    :'KAL', public.app_business_date(now(), time '04:00')),
  'a day is verified, with an account, an instant and an optional note');

select throws_like(
  format($q$ select public.verify_ledger_day(%L, %L) $q$,
    :'KAL', public.app_business_date(now(), time '04:00')),
  '%already verified%',
  're-verifying the same day as the same account replaces nothing');

select pg_temp.impersonate(:'FA_KAL');
select lives_ok(
  format($q$ select public.verify_ledger_day(%L, %L, 'and so do I') $q$,
    :'KAL', public.app_business_date(now(), time '04:00')),
  'a second account verifying the same day is its OWN row, not a replacement');

select is(
  (select count(*) from public.ledger_day_verifications where outlet_id = :'KAL'),
  2::bigint,
  'so the day carries two acknowledgements, which is more information than one');

select is(
  (select count(*) from public.drawer_observations where outlet_id = :'KAL'),
  3::bigint,
  'and verification changed no drawer figure, because it freezes nothing');

-- ===========================================================================
-- 12. The dead tables, after everything above.
--
-- Decision 16's revert story in one assertion: three observations, six cash
-- movements, an edit, an adjustment and two verifications later, neither table
-- this change leaves behind has moved.

select pg_temp.unimpersonate();

select is(
  (select count(*) from public.cash_withdrawals),
  (select withdrawals from pg_temp_dead_counts),
  'the whole drawer path wrote nothing to cash_withdrawals');
select is(
  (select count(*) from public.daily_cash_records),
  (select day_records from pg_temp_dead_counts),
  'nor to daily_cash_records: both are left in place, dead, for #12 to drop');

select * from finish();
rollback;
