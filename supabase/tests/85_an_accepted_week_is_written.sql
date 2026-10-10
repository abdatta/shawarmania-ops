-- An accepted week is written (an-accepted-week-is-written).
--
-- Accept the difference never worked: nothing ever carried the owner's
-- acceptance to the write contract. It now lives on the week's reconciliation,
-- recorded by `accept_aggregator_week`, and every later read honours it while
-- the figures are the ones accepted. A week that ended before an outlet's sync
-- began is no longer recorded against that outlet.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

alter table public.outlet_channel_sync disable trigger outlet_channel_sync_guarded;
insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
values ('00000000-0000-4000-a000-000000000001', 'zomato',
        public.app_business_date(now(), time '04:00') - 60)
on conflict (outlet_id, channel) do update set synced_from = excluded.synced_from;
alter table public.outlet_channel_sync enable trigger outlet_channel_sync_guarded;

insert into public.outlet_channel_restaurants (outlet_id, channel, external_ref, state)
values ('00000000-0000-4000-a000-000000000001', 'zomato', '21917311', 'enabled')
on conflict (channel, external_ref) do update set outlet_id = excluded.outlet_id, state = 'enabled';

\set OWNER '10000000-0000-4000-a000-000000000001'
\set KAL '00000000-0000-4000-a000-000000000001'

create function pg_temp.day(back int)
returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00') - back
$$;

create function pg_temp.at_ist(d date, clock time)
returns timestamptz language sql stable as $$
  select ((d + clock) at time zone 'Asia/Kolkata')
$$;

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- One settled week, its two orders netting 630000 paise, against a stated
-- payout the caller chooses. 637915 leaves it 79.15 short: disputed.
create function pg_temp.week(stated bigint, accepted uuid default null)
returns jsonb language sql as $$
  select public.ingest_aggregator_cycle(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', '00000000-0000-4000-a000-000000000001',
    'channel', 'zomato',
    'cycle_start', pg_temp.day(20),
    'cycle_end', pg_temp.day(19),
    'cycle_state', 'settled',
    'stated_payout_paise', stated,
    'accepted_by', accepted,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'A1', 'placed_at', pg_temp.at_ist(pg_temp.day(20), '13:00'),
                         'gross_paise', 500000, 'commission_paise', 150000, 'net_paise', 350000),
      jsonb_build_object('order_id', 'A2', 'placed_at', pg_temp.at_ist(pg_temp.day(19), '13:00'),
                         'gross_paise', 400000, 'commission_paise', 120000, 'net_paise', 280000))),
    array['00000000-0000-4000-a000-000000000001'::uuid])
$$;

create function pg_temp.accepted_differences()
returns bigint language sql stable as $$
  select count(*) from public.aggregator_cycle_deductions
   where outlet_id = '00000000-0000-4000-a000-000000000001'
     and source_system = 'owner' and kind = 'unexplained_settlement_difference'
$$;

create function pg_temp.settled_days()
returns bigint language sql stable as $$
  select count(*) from public.aggregator_channel_days
   where outlet_id = '00000000-0000-4000-a000-000000000001' and channel = 'zomato'
     and business_date in (pg_temp.day(20), pg_temp.day(19))
     and settlement_state = 'settled'
$$;

-- ---------------------------------------------------------------------------
-- 1. Who may accept.

select is(pg_temp.week(637915) ->> 'outcome', 'reconciliation_failed',
  'a week 79.15 short of its payout is disputed');

create function pg_temp.accept()
returns text language sql as $$
  select public.accept_aggregator_week('00000000-0000-4000-a000-000000000001', 'zomato',
                                       pg_temp.day(20), pg_temp.day(19))
$$;
grant execute on function pg_temp.accept() to authenticated, anon;
grant execute on function pg_temp.day(int) to authenticated, anon;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($$select pg_temp.accept()$$, '42501', null,
  'the outlet''s own Franchise Admin cannot accept a week');
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select throws_ok($$select pg_temp.accept()$$, '42501', null, 'a Biller cannot');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($$select pg_temp.accept()$$, '42501', null, 'an Employee cannot');
reset role;
set local role anon;
select throws_ok($$select pg_temp.accept()$$, '42501', null, 'an anonymous caller cannot');
reset role;

update public.profiles set is_active = false where id = :'OWNER';
select pg_temp.impersonate(:'OWNER');
select throws_ok($$select pg_temp.accept()$$, '42501', null,
  'a deactivated owner cannot, though the assignment lingers');
reset role;
update public.profiles set is_active = true where id = :'OWNER';

select is(
  (select accepted_at from public.aggregator_cycle_reconciliations
    where outlet_id = :'KAL' and cycle_start = pg_temp.day(20)),
  null::timestamptz,
  'and none of them recorded anything');

-- ---------------------------------------------------------------------------
-- 2. The owner accepts; the acceptance alone is recorded.

select pg_temp.impersonate(:'OWNER');
select is(pg_temp.accept(), 'accepted', 'the owner accepts the disputed week');
select is(pg_temp.accept(), 'already_accepted', 'and a second press changes nothing');
reset role;

select results_eq(
  format($$select accepted_by, accepted_computed_paise, accepted_stated_payout_paise
             from public.aggregator_cycle_reconciliations
            where outlet_id = %L and cycle_start = %L$$, :'KAL', pg_temp.day(20)),
  format($$values (%L::uuid, 630000::bigint, 637915::bigint)$$, :'OWNER'),
  'the week records who accepted it and the two figures they saw');

select is(pg_temp.accepted_differences(), 0::bigint,
  'accepting records no difference by itself: the per-order figures live only in the next read');
select is(pg_temp.settled_days(), 0::bigint, 'and settles no day by itself');

-- ---------------------------------------------------------------------------
-- 3. The next read honours it.

select is(pg_temp.week(637915) ->> 'outcome', 'ok',
  'the read after acceptance writes the week instead of disputing it');
select is(pg_temp.settled_days(), 2::bigint, 'its days are settled with the platform''s figures');
select is(
  (select sum(net_paise)::bigint from public.aggregator_channel_days
    where outlet_id = :'KAL' and channel = 'zomato'
      and business_date in (pg_temp.day(20), pg_temp.day(19))),
  630000::bigint,
  'and no day was adjusted to close the gap');
select results_eq(
  format($$select amount_paise, accepted_by from public.aggregator_cycle_deductions
            where outlet_id = %L and source_system = 'owner'
              and kind = 'unexplained_settlement_difference'$$, :'KAL'),
  format($$values (7915::bigint, %L::uuid)$$, :'OWNER'),
  'the gap is recorded as an unexplained settlement difference against the owner');
select is(
  (select d.accepted_at = r.accepted_at
     from public.aggregator_cycle_deductions d, public.aggregator_cycle_reconciliations r
    where d.outlet_id = :'KAL' and d.source_system = 'owner'
      and r.outlet_id = :'KAL' and r.cycle_start = pg_temp.day(20)),
  true,
  'dated to the moment the owner accepted, not to the read');

select is(pg_temp.week(637915) ->> 'outcome', 'ok', 'a scheduled read later still honours it');
select is(pg_temp.accepted_differences(), 1::bigint, 'and records the difference once');

savepoint accepted;

-- ---------------------------------------------------------------------------
-- 4. Figures that move let the acceptance lapse, without refusing the run.

select lives_ok($$select pg_temp.week(640000)$$,
  'a read finding a different payout for an accepted week is not refused');
select is(pg_temp.week(640000) ->> 'outcome', 'reconciliation_failed',
  'the week is disputed afresh at the new figures');
select is(
  (select accepted_at from public.aggregator_cycle_reconciliations
    where outlet_id = :'KAL' and cycle_start = pg_temp.day(20)),
  null::timestamptz,
  'the acceptance lapsed');
select is(pg_temp.accepted_differences(), 0::bigint, 'and its recorded difference is withdrawn');

select pg_temp.impersonate(:'OWNER');
select is(pg_temp.accept(), 'accepted', 'the owner can accept the new figures');
reset role;
select is(pg_temp.week(640000) ->> 'outcome', 'ok', 'and the next read honours that');
select is(
  (select amount_paise from public.aggregator_cycle_deductions
    where outlet_id = :'KAL' and source_system = 'owner'),
  10000::bigint,
  'recording the new difference, not the old one');

rollback to savepoint accepted;

-- ---------------------------------------------------------------------------
-- 5. A re-check that now reconciles an accepted week.

select lives_ok($$select pg_temp.week(630000)$$,
  'a read that reconciles a previously accepted week is not refused');
select results_eq(
  format($$select outcome, accepted_at is null, accepted_by is null
             from public.aggregator_cycle_reconciliations
            where outlet_id = %L and cycle_start = %L$$, :'KAL', pg_temp.day(20)),
  $$values ('reconciled'::text, true, true)$$,
  'the week reads reconciled and carries no acceptance');
select is(pg_temp.accepted_differences(), 0::bigint, 'and no recorded difference');

rollback to savepoint accepted;

-- ---------------------------------------------------------------------------
-- 6. A payload's own accepted_by still works.

select is(
  public.ingest_aggregator_cycle(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(30), 'cycle_end', pg_temp.day(30),
    'cycle_state', 'settled', 'stated_payout_paise', 75000, 'accepted_by', :'OWNER',
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'P1', 'placed_at', pg_temp.at_ist(pg_temp.day(30), '13:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000))),
    array[:'KAL'::uuid]) ->> 'outcome',
  'ok',
  'a payload carrying accepted_by is written as accepted');
select results_eq(
  format($$select accepted_by, accepted_computed_paise, accepted_stated_payout_paise
             from public.aggregator_cycle_reconciliations
            where outlet_id = %L and cycle_start = %L$$, :'KAL', pg_temp.day(30)),
  format($$values (%L::uuid, 70000::bigint, 75000::bigint)$$, :'OWNER'),
  'and records the acceptance the same way the owner''s button does');

-- ---------------------------------------------------------------------------
-- 7. A week before the outlet's sync began is not this outlet's.

select is(
  public.ingest_aggregator_cycle(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(67), 'cycle_end', pg_temp.day(61),
    'cycle_state', 'settled', 'stated_payout_paise', 1,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'B1', 'placed_at', pg_temp.at_ist(pg_temp.day(62), '13:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000)),
    'cycle_deductions', jsonb_build_array(
      jsonb_build_object('source_ref', 'ADS::before', 'kind', 'advertising',
                         'period_start', pg_temp.day(67), 'period_end', pg_temp.day(61),
                         'amount_paise', -5000))),
    array[:'KAL'::uuid]) - 'summary',
  jsonb_build_object('outcome', 'ok', 'before_boundary', true, 'days_written', 0,
                     'days_without_a_recorded_day', '', 'deductions_before_boundary', 0,
                     'computed_paise', null, 'stated_payout_paise', 1,
                     'difference_paise', null),
  'a week ending the day before the sync began reads ok, though its figures would not reconcile');
select is(
  (select count(*) from public.aggregator_cycle_reconciliations
    where outlet_id = :'KAL' and cycle_start = pg_temp.day(67)),
  0::bigint, 'and records no reconciliation against this outlet');
select is(
  (select count(*) from public.aggregator_cycle_deductions
    where outlet_id = :'KAL' and source_ref = 'ADS::before'),
  0::bigint, 'nor its weekly charges');
select is(
  (select count(*) from public.aggregator_channel_days
    where outlet_id = :'KAL' and channel = 'zomato' and business_date = pg_temp.day(62)),
  0::bigint, 'nor any of its days');

select is(
  public.ingest_aggregator_cycle(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(62), 'cycle_end', pg_temp.day(58),
    'cycle_state', 'settled', 'stated_payout_paise', 140000,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'S1', 'placed_at', pg_temp.at_ist(pg_temp.day(61), '13:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000),
      jsonb_build_object('order_id', 'S2', 'placed_at', pg_temp.at_ist(pg_temp.day(59), '13:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000))),
    array[:'KAL'::uuid]) ->> 'outcome',
  'ok',
  'a week straddling the start reconciles against all of its orders');
select is(
  (select outcome from public.aggregator_cycle_reconciliations
    where outlet_id = :'KAL' and cycle_start = pg_temp.day(62)),
  'reconciled', 'and is recorded against this outlet');
select results_eq(
  format($$select business_date from public.aggregator_channel_days
            where outlet_id = %L and channel = 'zomato'
              and business_date between %L and %L order by 1$$,
         :'KAL', pg_temp.day(62), pg_temp.day(58)),
  format($$values (%L::date)$$, pg_temp.day(59)),
  'writing only its days from the start onward');

select pg_temp.impersonate(:'OWNER');
select is(
  public.accept_aggregator_week(:'KAL'::uuid, 'zomato', pg_temp.day(62), pg_temp.day(58)),
  'not_disputed',
  'a week that reconciled has nothing to accept, and nothing is recorded');
reset role;
select is(
  (select accepted_at from public.aggregator_cycle_reconciliations
    where outlet_id = :'KAL' and cycle_start = pg_temp.day(62)),
  null::timestamptz,
  'it stays unaccepted');

-- ---------------------------------------------------------------------------
-- 8. Isolation: an acceptance is the owner's to read.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is(
  (select count(*) from public.aggregator_cycle_reconciliations where outlet_id = :'KAL'),
  0::bigint,
  'even the outlet''s own Franchise Admin reads no week, and so no acceptance');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select is(
  (select count(*) from public.aggregator_cycle_reconciliations where outlet_id = :'KAL'),
  0::bigint,
  'nor does another outlet''s');
select pg_temp.impersonate(:'OWNER');
select ok(
  (select count(*) from public.aggregator_cycle_reconciliations
    where outlet_id = :'KAL' and accepted_by is not null) > 0,
  'the owner reads who accepted');
reset role;

select * from finish();
rollback;
