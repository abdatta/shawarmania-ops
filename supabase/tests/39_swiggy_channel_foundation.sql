-- The Swiggy channel foundation, written out rather than inherited.
--
-- The generic sweep in 02_isolation_matrix.sql discovers the new mapping table
-- from the catalog and proves the ordinary tenancy claim about it. What that
-- sweep cannot express, this file does:
--
--   * a restaurant mapping is one reference to one owner per channel, while one
--     outlet may hold several references — the Swiggy account's active and
--     dormant Kalyani identities both belong to Kalyani without ambiguity;
--
--   * the money tables admit 'swiggy' and STILL refuse 'hyperpure', whose
--     statement books expenses and never payout days;
--
--   * the session machinery admits 'swiggy' independently, so Zomato and Swiggy
--     can each hold an open code request at the same time;
--
--   * a measured day stores all three figures with net + reduction = gross,
--     where a cancelled order at zero gross leaves a negative net that is
--     valid money, not a constraint violation;
--
--   * coincident Zomato and Swiggy cycles do not collide, because cycle
--     identity is the operator's own reference;
--
--   * a Franchise Admin reads daily figures only at assigned outlets and no
--     settlement internal anywhere; outlet staff read none of it; nobody
--     writes any of it from an app session.

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

create function pg_temp.ledger_day(back int)
returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00') - back
$$;

create function pg_temp.refused(sql text)
returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 0. Planted as the service role and migrations would plant them.

select pg_temp.unimpersonate();

insert into public.outlet_channel_restaurants
  (outlet_id, channel, external_ref, state, label)
values
  (:'KAL', 'swiggy', 'RID-ACTIVE', 'enabled', 'Kalyani (active identity)'),
  (:'KAL', 'swiggy', 'RID-DORMANT', 'dormant', 'Kalyani (dormant identity)'),
  (:'KAL', 'zomato', '21917311', 'enabled', null);

insert into public.aggregator_channel_days
  (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
   settlement_state, origin)
values
  -- A settled Zomato day, as today's rows look once net is computed.
  (:'KAL', 'zomato', pg_temp.ledger_day(4), 297003, 83892, 213111,
   'settled', 'settlement'),
  -- A cancelled-order day: zero gross, the fees still owed, negative net.
  (:'KAL', 'swiggy', pg_temp.ledger_day(3), 0, 5000, -5000,
   'settled', 'settlement'),
  -- A provisional Swiggy day with commission undetermined.
  (:'KAL', 'swiggy', pg_temp.ledger_day(20), 88888, null, null,
   'provisional', 'legacy_typed'),
  (:'KPA', 'zomato', pg_temp.ledger_day(2), 412200, null, null,
   'provisional', 'daily_reader');

insert into public.aggregator_cycle_reconciliations
  (outlet_id, channel, operator_cycle_ref, cycle_start, cycle_end,
   computed_paise, stated_payout_paise, outcome, bank_status)
values
  (:'KAL', 'zomato', '2026-08-17', pg_temp.ledger_day(6), pg_temp.ledger_day(1),
   213111, 213100, 'reconciled', null),
  -- Coincident periods: same dates, different operators, different cycles.
  (:'KAL', 'swiggy', 'SW-CYCLE-9', pg_temp.ledger_day(6), pg_temp.ledger_day(1),
   208500, 208500, 'reconciled', 'pending'),
  -- Finality can precede payment; an older cycle can already be paid.
  (:'KAL', 'swiggy', 'SW-CYCLE-8', pg_temp.ledger_day(13), pg_temp.ledger_day(7),
   190000, 190000, 'reconciled', 'paid');

-- ---------------------------------------------------------------------------
-- 1. Restaurant mappings.

select is(
  (select count(*) from public.outlet_channel_restaurants
    where outlet_id = :'KAL' and channel = 'swiggy'),
  2::bigint,
  'one outlet holds several swiggy references without ambiguity');

select is(
  pg_temp.refused(format($$
    insert into public.outlet_channel_restaurants
      (outlet_id, channel, external_ref, state)
    values (%L, 'swiggy', 'RID-ACTIVE', 'enabled')
  $$, :'KPA')),
  true,
  'the same external reference cannot map to two outlets in one channel');

select is(
  pg_temp.refused($$
    insert into public.outlet_channel_restaurants
      (outlet_id, channel, external_ref, state)
    values ('00000000-0000-4000-a000-000000000001', 'swiggy', '   ', 'enabled')
  $$),
  true,
  'an external reference cannot be blank');

select is(
  pg_temp.refused($$
    insert into public.outlet_channel_restaurants
      (outlet_id, channel, external_ref, state)
    values ('00000000-0000-4000-a000-000000000001', 'hyperpure', 'HP-1', 'enabled')
  $$),
  true,
  'the restaurant mapping is for restaurant channels only, never hyperpure');

-- ---------------------------------------------------------------------------
-- 2. Money tables admit swiggy and refuse hyperpure.

select is(
  pg_temp.refused($$
    insert into public.aggregator_channel_days
      (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
       settlement_state, origin)
    values ('00000000-0000-4000-a000-000000000001', 'hyperpure',
            current_date, 1000, 100, 900, 'provisional', 'daily_reader')
  $$),
  true,
  'the measured-day table continues to refuse hyperpure');

select lives_ok(format($$
  insert into public.aggregator_channel_days
    (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
     settlement_state, origin, source_ref, as_of_at)
  values (%L, 'swiggy', %L, 150000, 30000, 120000,
          'provisional', 'daily_reader', 'SW-CYCLE-9', now())
$$, :'KAL', pg_temp.ledger_day(2)),
  'a swiggy day carries all three figures, its source and its capture time');

select is(
  pg_temp.refused($$
    insert into public.aggregator_channel_days
      (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
       settlement_state, origin)
    values ('00000000-0000-4000-a000-000000000001', 'swiggy',
            current_date, 150000, 30000, 999999, 'provisional', 'daily_reader')
  $$),
  true,
  'net plus reduction equals gross or the day is refused');

select is(
  pg_temp.refused($$
    insert into public.aggregator_channel_days
      (outlet_id, channel, business_date, revenue_paise, net_paise,
       settlement_state, origin)
    values ('00000000-0000-4000-a000-000000000001', 'swiggy',
            current_date, 150000, 120000, 'provisional', 'daily_reader')
  $$),
  true,
  'a stated net without its reduction is refused rather than guessed');

select lives_ok(format($$
  insert into public.aggregator_cycle_deductions
    (outlet_id, channel, kind, period_start, period_end, amount_paise,
     source_system, source_ref)
  values (%L, 'swiggy', 'tax_deducted_at_source', %L, %L, -5200,
          'swiggy', 'TDS::SW-CYCLE-8')
$$, :'KAL', pg_temp.ledger_day(13), pg_temp.ledger_day(7)),
  'cycle deductions admit swiggy');

select is(
  pg_temp.refused($$
    insert into public.aggregator_cycle_deductions
      (outlet_id, channel, kind, period_start, period_end, amount_paise,
       source_system, source_ref)
    values ('00000000-0000-4000-a000-000000000001', 'hyperpure',
            'tax_deducted_at_source', current_date, current_date, -5200,
            'hyperpure', 'TDS::HP')
  $$),
  true,
  'cycle deductions continue to refuse hyperpure');

-- ---------------------------------------------------------------------------
-- 3. Cycle identity belongs to the operator.

select is(
  (select count(*) from public.aggregator_cycle_reconciliations
    where outlet_id = :'KAL' and cycle_start = pg_temp.ledger_day(6)),
  2::bigint,
  'coincident zomato and swiggy cycles on the same dates coexist');

select is(
  pg_temp.refused(format($$
    insert into public.aggregator_cycle_reconciliations
      (outlet_id, channel, operator_cycle_ref, cycle_start, cycle_end,
       computed_paise, stated_payout_paise, outcome)
    values (%L, 'swiggy', 'SW-CYCLE-9', %L, %L, 1, 1, 'disputed')
  $$, :'KAL', pg_temp.ledger_day(27), pg_temp.ledger_day(21))),
  true,
  'one conclusion per operator cycle per channel');

select is(
  pg_temp.refused(format($$
    insert into public.aggregator_cycle_reconciliations
      (outlet_id, channel, operator_cycle_ref, cycle_start, cycle_end,
       computed_paise, stated_payout_paise, outcome, bank_status)
    values (%L, 'swiggy', 'SW-CYCLE-7', %L, %L, 1, 1, 'disputed', 'deposited')
  $$, :'KAL', pg_temp.ledger_day(34), pg_temp.ledger_day(28))),
  true,
  'bank status speaks the portal''s vocabulary, not any word at all');

select is(
  (select outcome from public.aggregator_cycle_reconciliations
    where channel = 'zomato' and operator_cycle_ref = '2026-08-17'),
  'reconciled',
  'a reconciled cycle keeps its conclusion whatever the bank later reports');

-- ---------------------------------------------------------------------------
-- 4. Session machinery admits swiggy independently.

insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
values (:'KAL', 'swiggy', pg_temp.ledger_day(-14));

select is(
  pg_temp.refused(format($$
    insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
    values (%L, 'hyperpure', %L)
  $$, :'KAL', pg_temp.ledger_day(-14))),
  true,
  'the sync boundary stays a restaurant-channel boundary');

insert into public.aggregator_channel_credentials (channel) values ('swiggy');

select lives_ok($$
  insert into public.aggregator_sync_runs
    (outlet_id, channel, started_at, finished_at, outcome)
  values ('00000000-0000-4000-a000-000000000001', 'swiggy',
          now() - interval '1 hour', now() - interval '30 minutes', 'ok')
$$,
  'a swiggy run records its outcome like any other channel');

select lives_ok($$
  insert into public.aggregator_auth_requests
    (channel, requested_from_outlet_id, expires_at)
  values ('swiggy', '00000000-0000-4000-a000-000000000001', now() + interval '5 minutes')
$$,
  'swiggy can open its own code request');

select lives_ok($$
  insert into public.aggregator_auth_requests
    (channel, requested_from_outlet_id, expires_at)
  values ('zomato', '00000000-0000-4000-a000-000000000001', now() + interval '5 minutes')
$$,
  'a zomato request stays open independently while swiggy waits');

select is(
  pg_temp.refused($$
    insert into public.aggregator_auth_requests
      (channel, requested_from_outlet_id, expires_at)
    values ('swiggy', '00000000-0000-4000-a000-000000000001', now() + interval '5 minutes')
  $$),
  true,
  'still one open request per channel');

update public.aggregator_auth_requests
   set closed_at = now(), outcome = 'expired'
 where channel = 'swiggy';

-- ---------------------------------------------------------------------------
-- 5. Who reaches what.

select pg_temp.impersonate(:'FA_KAL');

select is(
  (select count(*) from public.aggregator_channel_days where outlet_id = :'KAL'),
  4::bigint,
  'a franchise admin reads daily figures at their assigned outlet');

select is(
  (select count(*) from public.aggregator_channel_days where outlet_id = :'KPA'),
  0::bigint,
  'a franchise admin reads no daily figure across outlets');

select is(
  (select count(*) from public.aggregator_cycle_reconciliations),
  0::bigint,
  'settlement conclusions stay beyond an assigned manager');

select is(
  (select count(*) from public.aggregator_cycle_deductions),
  0::bigint,
  'deductions stay beyond an assigned manager');

select is(
  (select count(*) from public.outlet_channel_restaurants),
  0::bigint,
  'restaurant mappings stay beyond an assigned manager');

select pg_temp.impersonate(:'BILLER_KAL');

select is(
  (select count(*) from public.aggregator_channel_days where outlet_id = :'KAL'),
  0::bigint,
  'a biller reads no measured figure even at their own outlet');

select pg_temp.impersonate(:'EMPLOYEE_KAL');

select is(
  (select count(*) from public.aggregator_channel_days where outlet_id = :'KAL'),
  0::bigint,
  'an employee reads no measured figure even at their own outlet');

-- Deactivation ends even an assigned manager's read on the next request.
savepoint before_deactivation;
select pg_temp.unimpersonate();
update public.profiles set is_active = false where id = :'FA_KAL';
select pg_temp.impersonate(:'FA_KAL');

select is(
  (select count(*) from public.aggregator_channel_days where outlet_id = :'KAL'),
  0::bigint,
  'a deactivated account reads nothing, assignment or no assignment');

select pg_temp.unimpersonate();
rollback to savepoint before_deactivation;

-- Nobody writes money or configuration from an app session, whatever role.
select pg_temp.impersonate(:'OWNER');

select is(
  (select count(*) from public.outlet_channel_restaurants),
  3::bigint,
  'the owner reads the mappings across outlets');

select is(
  pg_temp.refused(format($$
    insert into public.aggregator_channel_days
      (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
       settlement_state, origin)
    values (%L, 'swiggy', %L, 1, null, null, 'provisional', 'daily_reader')
  $$, :'KAL', pg_temp.ledger_day(2))),
  true,
  'even the owner cannot write a measured figure from an app session');

select is(
  pg_temp.refused($$
    update public.outlet_channel_restaurants set state = 'enabled'
     where external_ref = 'RID-DORMANT'
  $$),
  true,
  'mappings are configuration, not something an app session edits');

select * from finish();
rollback;
