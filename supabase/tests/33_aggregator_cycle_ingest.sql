-- The settlement write contract: one payout cycle, accepted or refused whole.
--
-- Every assertion here is about a way the sync could produce a true-looking
-- number that is wrong, because that is the only failure mode this capability
-- has. A cycle that half-wrote, a late-night order booked to the wrong trading
-- day, a settled figure quietly overwritten by a later live read, a difference
-- spread across days until the total looked right: each passes a functional test
-- and each corrupts the month.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

/*
 * The sync boundary, planted in the past.
 *
 * `ingest_aggregator_cycle` refuses to touch a day before the date its outlet was
 * switched on, so every case below needs a boundary earlier than the days it writes.
 * The trigger is disabled to plant it, because it deliberately refuses a date that
 * has already started: switching a sync on is a scheduled act, and applying one
 * retrospectively over days somebody already typed is the thing it exists to stop.
 */
alter table public.outlet_channel_sync disable trigger outlet_channel_sync_guarded;
insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
values ('00000000-0000-4000-a000-000000000001', 'zomato',
        public.app_business_date(now(), time '04:00') - 60),
       ('00000000-0000-4000-a000-000000000002', 'zomato',
        public.app_business_date(now(), time '04:00') - 60),
       ('00000000-0000-4000-a000-000000000001', 'swiggy',
        public.app_business_date(now(), time '04:00') - 60)
on conflict (outlet_id, channel) do update set synced_from = excluded.synced_from;
alter table public.outlet_channel_sync enable trigger outlet_channel_sync_guarded;

-- The restaurant mapping, as migrations would plant it. Kalyani holds an
-- enabled and a dormant Swiggy identity, and one reference deliberately mapped
-- to Kanchrapara so a payload naming it against Kalyani can be refused by name.
-- Kanchrapara itself gets no swiggy sync row, exactly as the real rollout will
-- leave it until evidence arrives.
insert into public.outlet_channel_restaurants
  (outlet_id, channel, external_ref, state)
values ('00000000-0000-4000-a000-000000000001', 'swiggy', 'RID-ACTIVE', 'enabled'),
       ('00000000-0000-4000-a000-000000000001', 'swiggy', 'RID-DORMANT', 'dormant'),
       ('00000000-0000-4000-a000-000000000002', 'swiggy', 'RID-KPA', 'enabled'),
       -- The zomato scalars, mirrored: a legacy payload without a reference
       -- resolves through them, and must find an enabled mapping waiting.
       ('00000000-0000-4000-a000-000000000001', 'zomato', '21917311', 'enabled'),
       ('00000000-0000-4000-a000-000000000002', 'zomato', '22675834', 'enabled');


\set OWNER '10000000-0000-4000-a000-000000000001'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- Both outlets cut over at 04:00.
create function pg_temp.day(back int)
returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00') - back
$$;

-- A timestamp at a given wall-clock time on a given trading day, in the outlets'
-- own timezone. Written out rather than hand-rolled, because the whole point of
-- the cutover assertions is that the conversion is not eyeballed.
create function pg_temp.at_ist(d date, clock time)
returns timestamptz language sql stable as $$
  select ((d + clock) at time zone 'Asia/Kolkata')
$$;

create function pg_temp.ingest(payload jsonb, outlets uuid[] default null)
returns jsonb language sql as $$
  select public.ingest_aggregator_cycle(
    payload,
    coalesce(outlets, array['00000000-0000-4000-a000-000000000001'::uuid,
                            '00000000-0000-4000-a000-000000000002'::uuid]))
$$;

-- A day the owner recorded: a drawer count and nothing else. It no longer
-- carries aggregator figures, and it no longer needs to exist before the sync
-- can write one, which is the whole point of the move. Kept in the tests because
-- several cases below assert that writing figures leaves the drawer alone.
create function pg_temp.recorded_day(p_outlet uuid, d date)
returns void language plpgsql as $$
begin
  insert into public.manual_ledger_days
    (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
     cash_revenue_paise, recorded_by)
  values (p_outlet, d, 500000, 500000, 0,
          '10000000-0000-4000-a000-000000000001')
  on conflict (outlet_id, business_date) do nothing;
end;
$$;

-- A figure some earlier origin already wrote, for the cases about replacing one.
create function pg_temp.sourced_day(p_outlet uuid, d date, revenue bigint,
                                    commission bigint, state text default 'provisional',
                                    origin text default 'daily_reader')
returns void language plpgsql as $$
begin
  insert into public.aggregator_channel_days
    (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
     settlement_state, origin)
  values (p_outlet, 'zomato', d, revenue, commission,
          revenue - commission, state, origin)
  on conflict (outlet_id, channel, business_date) do update
    set revenue_paise = excluded.revenue_paise,
        commission_paise = excluded.commission_paise,
        net_paise = excluded.net_paise,
        settlement_state = excluded.settlement_state,
        origin = excluded.origin;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. A reconciling cycle is written, and each day gets its own triple.

select pg_temp.recorded_day(:'KAL', pg_temp.day(9));
select pg_temp.recorded_day(:'KAL', pg_temp.day(8));

-- Figures an earlier read already wrote, so this cycle replaces something and the
-- retention assertions below have a replacement to be about. They used to be
-- about the owner's typed estimate; typed figures are gone, and the property is
-- the same one: nothing changes without what it replaced staying readable.
select pg_temp.sourced_day(:'KAL', pg_temp.day(9), 295000, 2825);
select pg_temp.sourced_day(:'KAL', pg_temp.day(8), 180000, 2825);

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', :'KAL',
    'channel', 'zomato',
    'cycle_start', pg_temp.day(9),
    'cycle_end', pg_temp.day(8),
    'cycle_state', 'provisional',
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'A1', 'placed_at', pg_temp.at_ist(pg_temp.day(9), '13:20'),
                         'gross_paise', 200000, 'commission_paise', 56000, 'net_paise', 144000),
      jsonb_build_object('order_id', 'A2', 'placed_at', pg_temp.at_ist(pg_temp.day(9), '21:05'),
                         'gross_paise', 97003, 'commission_paise', 27892, 'net_paise', 69111),
      jsonb_build_object('order_id', 'A3', 'placed_at', pg_temp.at_ist(pg_temp.day(8), '19:40'),
                         'gross_paise', 180000, 'commission_paise', 50000, 'net_paise', 130000))
  )) ->> 'outcome',
  'ok',
  'a provisional cycle is accepted');

-- Net is selected as the subtraction it is, not read from a column. There is no
-- stored net any more: with commission exact it would be a third figure able to
-- disagree with the two it came from.
select results_eq(
  format($$select business_date, revenue_paise, commission_paise,
                  revenue_paise - commission_paise, settlement_state
             from public.aggregator_channel_days
            where outlet_id = %L and business_date in (%L, %L)
            order by business_date$$,
    :'KAL', pg_temp.day(9), pg_temp.day(8)),
  $$values (public.app_business_date(now(), time '04:00') - 9,
            297003::bigint, 83892::bigint, 213111::bigint, 'provisional'),
           (public.app_business_date(now(), time '04:00') - 8,
            180000::bigint, 50000::bigint, 130000::bigint, 'provisional')$$,
  'each trading day carries its own measured figures, summed from its own orders');

-- The old version of this asserted that the typed pair had been zeroed, because a
-- synced day used to hold a second pair of columns and summing both would have
-- double-counted. There is one pair now, so the claim worth making is that it holds
-- Zomato's figures rather than the owner's: 297003 measured where 295000 was typed.
select isnt(
  (select revenue_paise from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(9)),
  295000::bigint,
  'and the day now reads Zomato''s figure rather than the one the owner typed');

select results_eq(
  format($$select superseded_revenue_paise, superseded_commission_paise
             from public.aggregator_channel_days
            where outlet_id = %L and business_date = %L$$, :'KAL', pg_temp.day(9)),
  $$values (295000::bigint, 2825::bigint)$$,
  'what the owner had typed is retained beside it, so the estimate can be '
  'compared against the settled truth');

select isnt(
  (select superseded_at from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(9)),
  null,
  'with the moment it was superseded');

-- ---------------------------------------------------------------------------
-- 2. Running it again changes nothing.

create function pg_temp.day_fingerprint(p_outlet uuid)
returns text language sql as $$
  select coalesce(string_agg(
    format('%s|%s|%s|%s|%s', business_date, revenue_paise, commission_paise,
           settlement_state, superseded_at),
    ' ' order by business_date), '')
    from public.aggregator_channel_days where outlet_id = p_outlet
$$;

savepoint before_rerun;

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(9), 'cycle_end', pg_temp.day(8),
    'cycle_state', 'provisional',
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'A1', 'placed_at', pg_temp.at_ist(pg_temp.day(9), '13:20'),
                         'gross_paise', 200000, 'commission_paise', 56000, 'net_paise', 144000),
      jsonb_build_object('order_id', 'A2', 'placed_at', pg_temp.at_ist(pg_temp.day(9), '21:05'),
                         'gross_paise', 97003, 'commission_paise', 27892, 'net_paise', 69111),
      jsonb_build_object('order_id', 'A3', 'placed_at', pg_temp.at_ist(pg_temp.day(8), '19:40'),
                         'gross_paise', 180000, 'commission_paise', 50000, 'net_paise', 130000))
  )) ->> 'outcome',
  'ok',
  'the same cycle read again is accepted again');

select is(
  (select count(*) from public.manual_ledger_days where outlet_id = :'KAL'::uuid),
  2::bigint,
  'and creates no second row for a day it already wrote');

select is(
  (select superseded_revenue_paise from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(9)),
  295000::bigint,
  'nor supersedes the typed figure a second time with the zero it wrote itself, '
  'which would destroy the only record of what the owner had estimated');

rollback to savepoint before_rerun;

-- ---------------------------------------------------------------------------
-- 3. The cutover: a late-night order belongs to the shift that cooked it.

select pg_temp.recorded_day(:'KAL', pg_temp.day(7));
select pg_temp.recorded_day(:'KAL', pg_temp.day(6));

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(7), 'cycle_end', pg_temp.day(6),
    'cycle_state', 'provisional',
    'orders', jsonb_build_array(
      -- 00:30 on the calendar day AFTER day(7): still day(7)'s trading day.
      jsonb_build_object('order_id', 'L1',
                         'placed_at', pg_temp.at_ist(pg_temp.day(7) + 1, '00:30'),
                         'gross_paise', 50000, 'commission_paise', 15000, 'net_paise', 35000),
      -- 04:00 exactly opens the new trading day.
      jsonb_build_object('order_id', 'L2',
                         'placed_at', pg_temp.at_ist(pg_temp.day(6), '04:00'),
                         'gross_paise', 70000, 'commission_paise', 20000, 'net_paise', 50000))
  )) ->> 'outcome',
  'ok',
  'a cycle spanning the cutover is accepted');

select is(
  (select revenue_paise - commission_paise from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(7)),
  35000::bigint,
  'an order placed at 00:30 lands on the trading day that cooked it, not on the '
  'calendar day the clock had already moved to');

select is(
  (select revenue_paise - commission_paise from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(6)),
  50000::bigint,
  'and an order at exactly 04:00 opens the new one, the cutover being an '
  'inclusive start');

-- ---------------------------------------------------------------------------
-- 4. Settlement replaces the estimate in place, and says what it replaced.

select pg_temp.recorded_day(:'KPA', pg_temp.day(12));

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KPA', 'channel', 'zomato',
    'cycle_start', pg_temp.day(12), 'cycle_end', pg_temp.day(12),
    'cycle_state', 'provisional',
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'S1', 'placed_at', pg_temp.at_ist(pg_temp.day(12), '14:00'),
                         'gross_paise', 300000, 'commission_paise', 90000, 'net_paise', 210000))
  )) ->> 'outcome',
  'ok', 'the week reads provisional while it is unpaid');

-- The settled read is larger by a cancellation refund the live dashboard never
-- showed. This is the measured behaviour that makes the two sources disagree by
-- design, and the reason a provisional figure is an estimate.
select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KPA', 'channel', 'zomato',
    'cycle_start', pg_temp.day(12), 'cycle_end', pg_temp.day(12),
    'cycle_state', 'settled', 'stated_payout_paise', 217915,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'S1', 'placed_at', pg_temp.at_ist(pg_temp.day(12), '14:00'),
                         'gross_paise', 300000, 'commission_paise', 82085, 'net_paise', 217915))
  )) ->> 'outcome',
  'ok', 'and is rewritten when the week pays');

select is(
  (select count(*) from public.manual_ledger_days
    where outlet_id = :'KPA'::uuid and business_date = pg_temp.day(12)),
  1::bigint,
  'in place, staying one row per outlet per business date');

select results_eq(
  format($$select revenue_paise - commission_paise, settlement_state,
                  provisional_revenue_paise - provisional_commission_paise
             from public.aggregator_channel_days
            where outlet_id = %L and business_date = %L$$, :'KPA', pg_temp.day(12)),
  $$values (217915::bigint, 'settled', 210000::bigint)$$,
  'marked settled, carrying the provisional figure it grew from');

select isnt(
  (select revised_at from public.aggregator_channel_days
    where outlet_id = :'KPA'::uuid and business_date = pg_temp.day(12)),
  null,
  'and stamped with the moment it was revised');

-- A settled day is terminal. A later run reading the live dashboard finds the
-- smaller figure again and must not put it back.
select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KPA', 'channel', 'zomato',
    'cycle_start', pg_temp.day(12), 'cycle_end', pg_temp.day(12),
    'cycle_state', 'provisional',
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'S1', 'placed_at', pg_temp.at_ist(pg_temp.day(12), '14:00'),
                         'gross_paise', 300000, 'commission_paise', 90000, 'net_paise', 210000))
  )) ->> 'outcome',
  'ok', 'a later live read of an already settled week is accepted');

select is(
  (select revenue_paise - commission_paise from public.aggregator_channel_days
    where outlet_id = :'KPA'::uuid and business_date = pg_temp.day(12)),
  217915::bigint,
  'but changes nothing, because a settled figure has already reconciled and the '
  'live dashboard omits the refund that made it larger');

-- A day that settles unchanged is not marked revised: the marker describes a
-- movement, and claiming one that did not happen is its own small lie.
select pg_temp.recorded_day(:'KPA', pg_temp.day(13));

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KPA', 'channel', 'zomato',
    'cycle_start', pg_temp.day(13), 'cycle_end', pg_temp.day(13),
    'cycle_state', 'provisional',
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'U1', 'placed_at', pg_temp.at_ist(pg_temp.day(13), '12:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000))
  )) ->> 'outcome', 'ok', 'an unremarkable day is read provisionally');

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KPA', 'channel', 'zomato',
    'cycle_start', pg_temp.day(13), 'cycle_end', pg_temp.day(13),
    'cycle_state', 'settled', 'stated_payout_paise', 70000,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'U1', 'placed_at', pg_temp.at_ist(pg_temp.day(13), '12:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000))
  )) ->> 'outcome', 'ok', 'and settles with the same figures');

select is(
  (select revised_at from public.aggregator_channel_days
    where outlet_id = :'KPA'::uuid and business_date = pg_temp.day(13)),
  null,
  'a day that settled unchanged is not marked revised');

-- ---------------------------------------------------------------------------
-- 5. Rounding noise is accepted, and the stored figures stay Zomato's own.

select pg_temp.recorded_day(:'KAL', pg_temp.day(14));

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(14), 'cycle_end', pg_temp.day(14),
    'cycle_state', 'settled',
    -- Six paise adrift: the aggregator rendering every figure to two decimals.
    'stated_payout_paise', 139994,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'R1', 'placed_at', pg_temp.at_ist(pg_temp.day(14), '15:00'),
                         'gross_paise', 200000, 'commission_paise', 60000, 'net_paise', 140000))
  )) ->> 'outcome',
  'ok',
  'a cycle a few paise adrift reconciles, because zero tolerance would cry wolf '
  'nightly on displayed figures');

select is(
  (select revenue_paise - commission_paise from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(14)),
  140000::bigint,
  'and the stored figure is the aggregator''s own, not adjusted to close the gap');

-- ---------------------------------------------------------------------------
-- 6. A week that does not reconcile is refused whole and marked disputed.

select pg_temp.recorded_day(:'KAL', pg_temp.day(20));
select pg_temp.recorded_day(:'KAL', pg_temp.day(19));

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(20), 'cycle_end', pg_temp.day(19),
    'cycle_state', 'provisional',
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'D1', 'placed_at', pg_temp.at_ist(pg_temp.day(20), '13:00'),
                         'gross_paise', 500000, 'commission_paise', 150000, 'net_paise', 350000),
      jsonb_build_object('order_id', 'D2', 'placed_at', pg_temp.at_ist(pg_temp.day(19), '13:00'),
                         'gross_paise', 400000, 'commission_paise', 120000, 'net_paise', 280000))
  )) ->> 'outcome', 'ok', 'the week is first read provisionally');

create function pg_temp.disputed_cycle(accepted uuid default null)
returns jsonb language sql as $$
  select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', '00000000-0000-4000-a000-000000000001',
    'channel', 'zomato',
    'cycle_start', public.app_business_date(now(), time '04:00') - 20,
    'cycle_end', public.app_business_date(now(), time '04:00') - 19,
    'cycle_state', 'settled',
    -- 79.15 rupees short, which is the real discrepancy this gate was built from.
    'stated_payout_paise', 637915,
    'accepted_by', accepted,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'D1',
        'placed_at', ((public.app_business_date(now(), time '04:00') - 20 + time '13:00')
                      at time zone 'Asia/Kolkata'),
        'gross_paise', 500000, 'commission_paise', 150000, 'net_paise', 350000),
      jsonb_build_object('order_id', 'D2',
        'placed_at', ((public.app_business_date(now(), time '04:00') - 19 + time '13:00')
                      at time zone 'Asia/Kolkata'),
        'gross_paise', 400000, 'commission_paise', 120000, 'net_paise', 280000))))
$$;

savepoint before_dispute;

select is(
  pg_temp.disputed_cycle() ->> 'outcome',
  'reconciliation_failed',
  'a week 79.15 short of the payout is refused');

select is(
  (pg_temp.disputed_cycle() ->> 'difference_paise')::bigint,
  -7915::bigint,
  'and the difference is reported, naming both totals');

select is(
  (select count(*) from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid
      and business_date in (pg_temp.day(20), pg_temp.day(19))
      and settlement_state = 'disputed'),
  2::bigint,
  'its days read disputed, so a paid week that does not add up cannot be '
  'mistaken for the current week awaiting payment');

select is(
  (select sum(revenue_paise - commission_paise)::bigint
     from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid
      and business_date in (pg_temp.day(20), pg_temp.day(19))),
  630000::bigint,
  'and every previously stored figure is exactly as it was, because the cycle '
  'was refused whole rather than half-written');

-- Re-checking. Zomato''s own figures move after a payout, so most disputes
-- should clear here without anybody deciding anything.
select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(20), 'cycle_end', pg_temp.day(19),
    'cycle_state', 'settled', 'stated_payout_paise', 637915,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'D1', 'placed_at', pg_temp.at_ist(pg_temp.day(20), '13:00'),
                         'gross_paise', 507915, 'commission_paise', 150000, 'net_paise', 357915),
      jsonb_build_object('order_id', 'D2', 'placed_at', pg_temp.at_ist(pg_temp.day(19), '13:00'),
                         'gross_paise', 400000, 'commission_paise', 120000, 'net_paise', 280000))
  )) ->> 'outcome',
  'ok', 're-checking a disputed week that now reconciles is accepted');

select is(
  (select count(*) from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid
      and business_date in (pg_temp.day(20), pg_temp.day(19))
      and settlement_state = 'settled'),
  2::bigint,
  'and it stops reading disputed');

rollback to savepoint before_dispute;

-- Accepting instead: the gap is recorded, not absorbed.
select is(pg_temp.disputed_cycle() ->> 'outcome', 'reconciliation_failed',
  'the week is disputed again, for the acceptance path');

select is(
  pg_temp.disputed_cycle(:'OWNER') ->> 'outcome',
  'ok',
  'the owner accepts it');

select results_eq(
  format($$select kind, amount_paise, accepted_by
             from public.aggregator_cycle_deductions
            where outlet_id = %L and kind = 'unexplained_settlement_difference'$$, :'KAL'),
  format($$values ('unexplained_settlement_difference', 7915::bigint, %L::uuid)$$, :'OWNER'),
  'the difference is recorded against the cycle with the name of whoever accepted '
  'it, rather than spread across the days until the total looked right');

select is(
  (select sum(revenue_paise - commission_paise)::bigint
     from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid
      and business_date in (pg_temp.day(20), pg_temp.day(19))),
  630000::bigint,
  'and no day''s figures were adjusted to close it');

select is(pg_temp.disputed_cycle(:'OWNER') ->> 'outcome', 'ok',
  'accepting the same week again is accepted');

select is(
  (select count(*) from public.aggregator_cycle_deductions
    where outlet_id = :'KAL'::uuid and kind = 'unexplained_settlement_difference'),
  1::bigint,
  'and records no second difference for the same cycle');

-- ---------------------------------------------------------------------------
-- 7. Deductions land on the day the money was spent.

select pg_temp.recorded_day(:'KAL', pg_temp.day(30));

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(30), 'cycle_end', pg_temp.day(30),
    'cycle_state', 'settled',
    'stated_payout_paise', 70000 - 374777 - 31124,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'E1', 'placed_at', pg_temp.at_ist(pg_temp.day(30), '12:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000)),
    'deductions', jsonb_build_array(
      jsonb_build_object('source_ref', 'HP-88213',
                         -- Spent eleven days before the payout that collected it.
                         'spent_on', pg_temp.day(41),
                         'amount_paise', 374777,
                         'description', 'Hyperpure invoice HP-88213',
                         'category', 'Other')),
    'cycle_deductions', jsonb_build_array(
      jsonb_build_object('source_ref', 'TDS::21917311::20260719',
                         'kind', 'tax_deducted_at_source',
                         'period_start', pg_temp.day(55), 'period_end', pg_temp.day(49),
                         'amount_paise', -31124))
  )) ->> 'outcome',
  'ok',
  'a cycle carrying a supply deduction and a tax deduction reconciles');

select results_eq(
  format($$select business_date, is_cash, source_system
             from public.manual_ledger_expenses
            where outlet_id = %L and source_ref = 'HP-88213'$$, :'KAL'),
  $$values (public.app_business_date(now(), time '04:00') - 41, false, 'zomato')$$,
  'the supply bill lands on its purchase date, not on the payout that collected '
  'it eleven days later, and is non-cash because it never passed the drawer');

select is(
  (select count(*) from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(41)),
  0::bigint,
  'and dating an expense to a day creates no ledger day row for it');

select results_eq(
  format($$select kind, amount_paise, period_start
             from public.aggregator_cycle_deductions
            where outlet_id = %L and source_ref = 'TDS::21917311::20260719'$$, :'KAL'),
  $$values ('tax_deducted_at_source', -31124::bigint,
            public.app_business_date(now(), time '04:00') - 55)$$,
  'the tax deduction is stored against the period it names, which is not the '
  'cycle that paid it');

select is(
  (select count(*) from public.manual_ledger_days where business_date = date '1970-01-01'),
  0::bigint,
  'and the epoch date the aggregator renders for it never reaches the ledger');

-- Re-running does not double the cost. This is the assertion that makes the
-- four-cycle deduction re-read window safe.
select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(30), 'cycle_end', pg_temp.day(30),
    'cycle_state', 'settled',
    'stated_payout_paise', 70000 - 374777 - 31124,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'E1', 'placed_at', pg_temp.at_ist(pg_temp.day(30), '12:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000)),
    'deductions', jsonb_build_array(
      jsonb_build_object('source_ref', 'HP-88213', 'spent_on', pg_temp.day(41),
                         'amount_paise', 374777,
                         'description', 'Hyperpure invoice HP-88213', 'category', 'Other')),
    'cycle_deductions', jsonb_build_array(
      jsonb_build_object('source_ref', 'TDS::21917311::20260719',
                         'kind', 'tax_deducted_at_source',
                         'period_start', pg_temp.day(55), 'period_end', pg_temp.day(49),
                         'amount_paise', -31124))
  )) ->> 'outcome', 'ok', 'the same deductions arrive again on the next run');

select is(
  (select count(*) from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and source_ref = 'HP-88213'),
  1::bigint,
  'and update in place rather than doubling the month''s costs');

-- A row the owner withdrew stays withdrawn. Withdrawn in character, because the
-- guard stamps the withdrawing account from the session and refuses to have it
-- attributed elsewhere.
select set_config('request.jwt.claims',
  json_build_object('sub', :'OWNER', 'role', 'authenticated')::text, true);
set local role authenticated;

update public.manual_ledger_expenses set voided_at = now()
 where outlet_id = :'KAL'::uuid and source_ref = 'HP-88213';

reset role;
select set_config('request.jwt.claims', '', true);

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(30), 'cycle_end', pg_temp.day(30),
    'cycle_state', 'provisional',
    'orders', '[]'::jsonb,
    'deductions', jsonb_build_array(
      jsonb_build_object('source_ref', 'HP-88213', 'spent_on', pg_temp.day(41),
                         'amount_paise', 999999,
                         'description', 'Hyperpure invoice HP-88213', 'category', 'Other'))
  )) ->> 'outcome', 'ok', 'a later run carrying a withdrawn deduction is accepted');

select is(
  (select amount_paise from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and source_ref = 'HP-88213'),
  374777::bigint,
  'but does not resurrect it: the owner withdrew that row for a reason');

-- ---------------------------------------------------------------------------
-- 8. What the contract refuses.

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'zomato',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'provisional',
    'orders', jsonb_build_array(jsonb_build_object(
      'order_id', 'N1', 'gross_paise', 100, 'commission_paise', 30, 'net_paise', 70))))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(9)),
  '22023', null,
  'an order with no placement time is refused by name rather than dated by guess');

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'zomato',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'settled', 'orders', '[]'::jsonb))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(9)),
  '22023', null,
  'a settled cycle that states no payout has nothing to reconcile against');

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 2, 'outlet_id', %L, 'channel', 'zomato',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'provisional'))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(9)),
  '22023', null,
  'an unrecognised contract version breaks the job rather than the database, '
  'which is the point of versioning it');

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'hyperpure',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'provisional'))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(9)),
  '22023', null,
  'a supply channel is refused by name before any money can move');

select throws_ok(
  format($$select pg_temp.ingest(
    jsonb_build_object(
      'contract_version', 1, 'outlet_id', %L, 'channel', 'zomato',
      'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'provisional'),
    array[%L]::uuid[])$$,
    :'KPA', pg_temp.day(9), pg_temp.day(9), :'KAL'),
  '42501', null,
  'and a payload naming an outlet this credential may not write is refused, '
  'because the function writes past Row-Level Security and cannot trust the '
  'outlet it is handed');

-- ---------------------------------------------------------------------------
-- 9. A day the owner has not recorded yet is reported, never invented.

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', :'KAL', 'channel', 'zomato',
    'cycle_start', pg_temp.day(60), 'cycle_end', pg_temp.day(60),
    'cycle_state', 'provisional',
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'P1', 'placed_at', pg_temp.at_ist(pg_temp.day(60), '12:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000))
  )) ->> 'days_without_a_recorded_day',
  (pg_temp.day(60))::text,
  'a trading day with no ledger row is named in the answer');

-- This is the part that used to be impossible, and the reason the figures moved.
-- The date is written now: the refusal existed only because a figure needed a day
-- row to live on, and a day row needs a drawer count nobody took.
select is(
  (select revenue_paise from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(60)),
  100000::bigint,
  'and its figures are written rather than withheld, because they no longer need '
  'a day row to live on');

select is(
  (select count(*) from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(60)),
  0::bigint,
  'while still no day row is invented for it, because a fabricated opening '
  'balance and a drawer count of zero would reconcile and mean nothing');

-- ---------------------------------------------------------------------------
-- The sync boundary: everything before it is the owner's, forever.
--
-- The cycle window this reader asks for is thirty-one days wide, so without this
-- the first real run would reach back past any plausible go-live and restate
-- months of typed history. "Switching it on" would have quietly meant "rewriting
-- the past", which is the one thing a ledger must never do to a figure somebody
-- entered and has already acted on.

select pg_temp.recorded_day(:'KAL', pg_temp.day(50));

-- Move the boundary forward so day 20 sits behind it, and day 9 in front.
alter table public.outlet_channel_sync disable trigger outlet_channel_sync_guarded;
update public.outlet_channel_sync
   set synced_from = public.app_business_date(now(), time '04:00') - 45
 where outlet_id = :'KAL'::uuid and channel = 'zomato';
alter table public.outlet_channel_sync enable trigger outlet_channel_sync_guarded;

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', :'KAL',
    'channel', 'zomato',
    'cycle_start', pg_temp.day(51),
    'cycle_end', pg_temp.day(49),
    'cycle_state', 'provisional',
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'behind-the-boundary',
                         'placed_at', (pg_temp.day(50) + time '13:00')::timestamptz,
                         'gross_paise', 999999, 'commission_paise', 111111,
                         'net_paise', 888888))
  )) ->> 'outcome',
  'ok',
  'a cycle reaching behind the boundary is accepted rather than refused');

-- The claim is now an absence rather than a preserved pair. There is nothing to
-- preserve: a day behind the boundary has no measured figure at all, and the
-- boundary's job is to see that it never gains one. Asserting the absence is the
-- stronger of the two, because a row written with the owner's old numbers would
-- have satisfied the previous version of this.
select is(
  (select count(*) from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(50)),
  0::bigint,
  'but the day behind the boundary gains no measured figure at all');

select is(
  (select count(*) from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(50)),
  1::bigint,
  'while the day the owner recorded behind it is left exactly where it was');

select is(
  (select (pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', :'KAL',
    'channel', 'zomato',
    'cycle_start', pg_temp.day(51),
    'cycle_end', pg_temp.day(49),
    'cycle_state', 'provisional',
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'behind-the-boundary-2',
                         'placed_at', (pg_temp.day(50) + time '13:00')::timestamptz,
                         'gross_paise', 999999, 'commission_paise', 111111,
                         'net_paise', 888888))
  )) ->> 'days_written')::int),
  0,
  'and nothing is counted as written, so a run says plainly that it did nothing');

-- Nor is it reported as pending. A day behind the boundary is not waiting for a
-- ledger row; it already has one, and it is not this reader's to fill.
select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', :'KAL',
    'channel', 'zomato',
    'cycle_start', pg_temp.day(56),
    'cycle_end', pg_temp.day(55),
    'cycle_state', 'provisional',
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'far-behind',
                         'placed_at', (pg_temp.day(55) + time '13:00')::timestamptz,
                         'gross_paise', 5000, 'commission_paise', 1000,
                         'net_paise', 4000))
  )) ->> 'days_without_a_recorded_day',
  '',
  'a day behind the boundary is not named there either, because it was never a candidate');

-- An outlet nobody switched on is refused outright rather than silently ignored.
alter table public.outlet_channel_sync disable trigger outlet_channel_sync_guarded;
delete from public.outlet_channel_sync where outlet_id = :'KPA'::uuid and channel = 'zomato';
alter table public.outlet_channel_sync enable trigger outlet_channel_sync_guarded;

select throws_ok(
  format($$select public.ingest_aggregator_cycle(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'zomato',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'provisional',
    'orders', '[]'::jsonb), array[%L::uuid, %L::uuid])$$,
    :'KPA', pg_temp.day(9), pg_temp.day(8), :'KAL', :'KPA'),
  '22023', null,
  'and an outlet with no sync date at all is refused, not quietly skipped');


-- Both outlets switched on again. A case above removes a sync date on purpose,
-- to prove an unconfigured outlet is refused rather than quietly skipped, and
-- everything below needs one.
alter table public.outlet_channel_sync disable trigger outlet_channel_sync_guarded;
insert into public.outlet_channel_sync (outlet_id, channel, synced_from)
values ('00000000-0000-4000-a000-000000000001', 'zomato',
        public.app_business_date(now(), time '04:00') - 60),
       ('00000000-0000-4000-a000-000000000002', 'zomato',
        public.app_business_date(now(), time '04:00') - 60)
on conflict (outlet_id, channel) do update set synced_from = excluded.synced_from;
alter table public.outlet_channel_sync enable trigger outlet_channel_sync_guarded;

/*
 * A collection is not a purchase.
 *
 * Every assertion below exists because of one row pair in production. Order
 * ZHPWB27-OR-0028753023, worth Rs 9,311.11, was typed once by the owner and
 * written again by the sync as two payout recoveries, Rs 2,555.24 at Kalyani and
 * Rs 2,981.29 at Kanchrapara, with a third slice of Rs 3,774.58 still to arrive.
 * The purchase was booked twice because collecting a debt looked like incurring
 * one.
 *
 * The property that must hold, and the one a functional test would miss: the
 * recovery still counts toward what the payout is measured against, while
 * writing nothing. Drop it from the sum and the cycle stops reconciling against
 * a payout that really was reduced; write it as an expense and the cost is
 * counted twice. Both are wrong, and they are wrong in opposite directions.
 */

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', '00000000-0000-4000-a000-000000000001'::uuid,
    'channel', 'zomato',
    'cycle_start', pg_temp.day(31), 'cycle_end', pg_temp.day(31),
    'cycle_state', 'settled',
    -- The recovery is subtracted here. If the sum stopped counting it, this
    -- stated payout would no longer be the one the arithmetic produces.
    'stated_payout_paise', 70000 - 255524,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'REC1', 'placed_at', pg_temp.at_ist(pg_temp.day(31), '12:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000)),
    'deductions', jsonb_build_array(
      jsonb_build_object('source_ref', 'HPREC-1',
                         'spent_on', pg_temp.day(33),
                         'amount_paise', 255524,
                         'description', 'Zomato Hyperpure 72669988',
                         'category', 'Hyperpure'))
  )) ->> 'outcome',
  'ok',
  'a cycle carrying a supply recovery still reconciles, because the money did '
  'leave the payout and the sum still counts it');

select is(
  (select count(*) from public.manual_ledger_expenses where source_ref = 'HPREC-1'),
  0::bigint,
  'and the recovery writes no expense, because the supplier''s own statement '
  'already recorded that purchase');

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', '00000000-0000-4000-a000-000000000001'::uuid,
    'channel', 'zomato',
    'cycle_start', pg_temp.day(31), 'cycle_end', pg_temp.day(31),
    'cycle_state', 'settled',
    'stated_payout_paise', 70000 - 255524,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'REC1', 'placed_at', pg_temp.at_ist(pg_temp.day(31), '12:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000)),
    'deductions', jsonb_build_array(
      jsonb_build_object('source_ref', 'HPREC-1', 'spent_on', pg_temp.day(33),
                         'amount_paise', 255524,
                         'description', 'Zomato Hyperpure 72669988',
                         'category', 'Hyperpure'))
  )) ->> 'outcome',
  'ok',
  'and re-running the identical cycle stays reconciled, so recognising a '
  'recovery is not a one-time effect of the first write');

-- The production case in full: one purchase, two outlets, two cycles.
select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', '00000000-0000-4000-a000-000000000002'::uuid,
    'channel', 'zomato',
    'cycle_start', pg_temp.day(31), 'cycle_end', pg_temp.day(31),
    'cycle_state', 'settled',
    'stated_payout_paise', 70000 - 298129,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'REC2', 'placed_at', pg_temp.at_ist(pg_temp.day(31), '12:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000)),
    'deductions', jsonb_build_array(
      jsonb_build_object('source_ref', 'HPREC-2', 'spent_on', pg_temp.day(33),
                         'amount_paise', 298129,
                         'description', 'Zomato Hyperpure 72669988',
                         'category', 'Hyperpure'))
  )) ->> 'outcome',
  'ok',
  'the second outlet''s slice of the same purchase reconciles too');

select is(
  (select count(*) from public.manual_ledger_expenses
    where source_ref in ('HPREC-1', 'HPREC-2')),
  0::bigint,
  'and neither outlet gains an expense, so one purchase recovered in slices '
  'across two outlets is still not counted at all here');

-- A deduction that is nobody else's record still becomes an expense. Without
-- this, the split would have quietly stopped recording advertising.
select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', '00000000-0000-4000-a000-000000000001'::uuid,
    'channel', 'zomato',
    'cycle_start', pg_temp.day(32), 'cycle_end', pg_temp.day(32),
    'cycle_state', 'settled',
    'stated_payout_paise', 70000 - 50000,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'ADS1', 'placed_at', pg_temp.at_ist(pg_temp.day(32), '12:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000)),
    'deductions', jsonb_build_array(
      jsonb_build_object('source_ref', 'ADS-1', 'spent_on', pg_temp.day(32),
                         'amount_paise', 50000,
                         'description', 'Zomato Advertising ADS-1',
                         'category', 'Advertising'))
  )) ->> 'outcome',
  'ok',
  'an advertising deduction reconciles');

select is(
  (select count(*) from public.manual_ledger_expenses where source_ref = 'ADS-1'),
  1::bigint,
  'and still becomes an expense, because no other origin sees it');

-- A recovery dated before the boundary is still Zomato taking money out of this
-- cycle's payout, so it counts toward what the cycle is measured against; and it
-- is still a collection of a purchase Hyperpure invoiced, so it writes nothing.
-- The stated payout is set as if the recovery were subtracted, which only
-- reconciles if the sum counted it despite its date.
select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', '00000000-0000-4000-a000-000000000001'::uuid,
    'channel', 'zomato',
    'cycle_start', pg_temp.day(34), 'cycle_end', pg_temp.day(34),
    'cycle_state', 'settled',
    'stated_payout_paise', 70000 - 255524,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'RECOLD', 'placed_at', pg_temp.at_ist(pg_temp.day(34), '12:00'),
                         'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000)),
    'deductions', jsonb_build_array(
      jsonb_build_object('source_ref', 'HPREC-OLD',
                         -- Dated 100 days back, far behind any boundary here.
                         'spent_on', pg_temp.day(100),
                         'amount_paise', 255524,
                         'description', 'Zomato Hyperpure old', 'category', 'Hyperpure'))
  )) ->> 'outcome',
  'ok',
  'a recovery dated before the boundary is counted in the cycle sum, so the '
  'cycle still reconciles');

select is(
  (select count(*) from public.manual_ledger_expenses where source_ref = 'HPREC-OLD'),
  0::bigint,
  'and writes no expense, because it is a collection Hyperpure already recorded');

/*
 * A reserved category is refused to a person, and refused to their second
 * spelling.
 *
 * This is the one place the free-text rule's usual defence does not apply. That
 * rule accepts a warned category because a refusal is defeated by a different
 * spelling; here a different spelling would recreate the exact duplicate the
 * reservation exists to prevent, so the refusal has to survive one.
 */
select throws_ok(
  format($$insert into public.manual_ledger_expenses
             (outlet_id, business_date, category, is_cash, amount_paise, recorded_by)
           values (%L, public.app_business_date(now(), time '04:00'), 'Hyperpure',
                   false, 100000, null)$$,
    '00000000-0000-4000-a000-000000000001'),
  '42501', null,
  'a person may not type the reserved category at all');

select throws_ok(
  format($$insert into public.manual_ledger_expenses
             (outlet_id, business_date, category, is_cash, amount_paise, recorded_by)
           values (%L, public.app_business_date(now(), time '04:00'), 'hyper pure',
                   false, 100000, null)$$,
    '00000000-0000-4000-a000-000000000001'),
  '42501', null,
  'nor a differently spaced spelling of it');

select throws_ok(
  format($$insert into public.manual_ledger_expenses
             (outlet_id, business_date, category, is_cash, amount_paise, recorded_by)
           values (%L, public.app_business_date(now(), time '04:00'), 'HyperPure Goods',
                   false, 100000, null)$$,
    '00000000-0000-4000-a000-000000000001'),
  '42501', null,
  'nor a spelling that merely contains it, which is how a second category is '
  'usually created by accident');

select lives_ok(
  format($$insert into public.manual_ledger_expenses
             (outlet_id, business_date, category, is_cash, amount_paise,
              source_system, source_ref, recorded_by)
           values (%L, public.app_business_date(now(), time '04:00'), 'Hyperpure',
                   false, 100000, 'hyperpure', 'ORDER-OWNED-1', null)$$,
    '00000000-0000-4000-a000-000000000001'),
  'while the origin that owns the category writes it freely, which is the point '
  'of reserving it');

select is(
  (select count(*) from public.manual_ledger_expenses where source_ref = 'ORDER-OWNED-1'),
  1::bigint,
  'and that row is really there, so the owning path was not silently dropped '
  'along with the relayed ones');
-- ---------------------------------------------------------------------------
-- 9. The Swiggy contract: same arithmetic, its own identity.
--
-- Everything the zomato cases prove about cutover, reconciliation and
-- monotonicity applies unchanged; what is Swiggy's own is the restaurant
-- reference, the operator's cycle identity, bank status, and the rule that a
-- settled cycle arrives complete. Kanchrapara has no swiggy sync row planted,
-- so an unconfigured outlet is refused through the same door as above.

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'swiggy',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'provisional',
    'orders', '[]'::jsonb))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(8)),
  '22023', null,
  'a swiggy payload without a restaurant reference is refused rather than guessed');

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'swiggy',
    'restaurant_ref', 'RID-UNKNOWN',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'provisional',
    'orders', '[]'::jsonb))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(8)),
  '22023', null,
  'an unmapped swiggy restaurant is refused with the reference named');

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'swiggy',
    'restaurant_ref', 'RID-KPA',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'provisional',
    'orders', '[]'::jsonb))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(8)),
  '22023', null,
  'a reference mapped to another outlet never writes this one''s money');

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'swiggy',
    'restaurant_ref', 'RID-DORMANT',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'provisional',
    'orders', '[]'::jsonb))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(8)),
  '22023', null,
  'a dormant reference stays dormant for automation too');

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'zomato',
    'restaurant_ref', '21917311',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'settled',
    'stated_payout_paise', 144000, 'operator_cycle_ref', 'Z-1',
    'orders', jsonb_build_array(jsonb_build_object(
      'order_id', 'S1', 'placed_at', pg_temp.at_ist(pg_temp.day(9), '13:00'),
      'gross_paise', 100.5, 'commission_paise', 30, 'net_paise', 70))))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(8)),
  '22023', null,
  'a decimal order figure is refused by name before any sum can hide it');

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'zomato',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'settled',
    'stated_payout_paise', 144.5, 'operator_cycle_ref', 'Z-2',
    'orders', jsonb_build_array(jsonb_build_object(
      'order_id', 'S2', 'placed_at', pg_temp.at_ist(pg_temp.day(9), '13:00'),
      'gross_paise', 100000, 'commission_paise', 30000, 'net_paise', 70000))))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(8)),
  '22023', null,
  'and so is a decimal stated payout');

-- A full valid swiggy cycle commits: days carry all three figures plus source
-- provenance, and its deductions name their channel.
select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', :'KAL',
    'channel', 'swiggy',
    'restaurant_ref', 'RID-ACTIVE',
    'operator_cycle_ref', 'SW-CYCLE-9',
    'bank_status', 'pending',
    'source_ref', 'SW-PAYOUT-9',
    'as_of_at', pg_temp.at_ist(pg_temp.day(0), '11:00'),
    'cycle_start', pg_temp.day(9),
    'cycle_end', pg_temp.day(8),
    'cycle_state', 'settled',
    'stated_payout_paise', 199_000,
    'cycle_deductions', jsonb_build_array(
      jsonb_build_object('kind', 'tax_deducted_at_source',
                         'period_start', pg_temp.day(9), 'period_end', pg_temp.day(8),
                         'amount_paise', -7000, 'source_ref', 'TDS::SW-CYCLE-9')),
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'SW1', 'placed_at', pg_temp.at_ist(pg_temp.day(9), '13:20'),
                         'gross_paise', 150_000, 'commission_paise', 30_000, 'net_paise', 120_000),
      -- A post-midnight order belongs to the shift that started the day before:
      -- 03:59 on day(8) is still business date day(9) under the 04:00 cutover.
      jsonb_build_object('order_id', 'SW2', 'placed_at', pg_temp.at_ist(pg_temp.day(8), '03:59'),
                         'gross_paise', 80_000, 'commission_paise', 10_000, 'net_paise', 70_000),
      jsonb_build_object('order_id', 'SW3', 'placed_at', pg_temp.at_ist(pg_temp.day(8), '19:40'),
                         'gross_paise', 20_000, 'commission_paise', 4_000, 'net_paise', 16_000))
  )) ->> 'outcome',
  'ok',
  'a complete reconciling swiggy cycle is written whole');

select is(
  (select count(*) from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and channel = 'swiggy'
      and business_date between pg_temp.day(9) and pg_temp.day(8)
      and net_paise + commission_paise = revenue_paise),
  2::bigint,
  'every swiggy day stores net plus reduction equal to gross');

-- 230_000 of gross landed on two dates; the 03:59 order joined the earlier one.
select is(
  (select revenue_paise from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and channel = 'swiggy'
      and business_date = pg_temp.day(9)),
  230_000::bigint,
  'the 03:59 order settles into the trading shift that started the day before');

select is(
  (select outcome || ':' || coalesce(bank_status, 'none')
     from public.aggregator_cycle_reconciliations
    where channel = 'swiggy' and operator_cycle_ref = 'SW-CYCLE-9'),
  'reconciled:pending',
  'a FINAL Pending payout settles the accounting record while the transfer waits');

select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', :'KAL',
    'channel', 'swiggy',
    'restaurant_ref', 'RID-ACTIVE',
    'operator_cycle_ref', 'SW-CYCLE-9',
    'bank_status', 'paid',
    'cycle_start', pg_temp.day(9),
    'cycle_end', pg_temp.day(8),
    'cycle_state', 'settled',
    'stated_payout_paise', 199_000,
    'cycle_deductions', jsonb_build_array(
      jsonb_build_object('kind', 'tax_deducted_at_source',
                         'period_start', pg_temp.day(9), 'period_end', pg_temp.day(8),
                         'amount_paise', -7000, 'source_ref', 'TDS::SW-CYCLE-9')),
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'SW1', 'placed_at', pg_temp.at_ist(pg_temp.day(9), '13:20'),
                         'gross_paise', 150_000, 'commission_paise', 30_000, 'net_paise', 120_000),
      jsonb_build_object('order_id', 'SW2', 'placed_at', pg_temp.at_ist(pg_temp.day(8), '03:59'),
                         'gross_paise', 80_000, 'commission_paise', 10_000, 'net_paise', 70_000),
      jsonb_build_object('order_id', 'SW3', 'placed_at', pg_temp.at_ist(pg_temp.day(8), '19:40'),
                         'gross_paise', 20_000, 'commission_paise', 4_000, 'net_paise', 16_000))
  )) ->> 'outcome',
  'ok',
  'payment news arrives as information on a later read');

select is(
  (select bank_status from public.aggregator_cycle_reconciliations
    where channel = 'swiggy' and operator_cycle_ref = 'SW-CYCLE-9'),
  'paid',
  'and updates only the bank status, leaving every figure exactly where it was');

-- The channel-scoped TDS row is Swiggy's own fact, distinct from any Zomato
-- deduction in the same week.
select is(
  (select source_system || ':' || amount_paise::text
     from public.aggregator_cycle_deductions
    where outlet_id = :'KAL'::uuid and source_ref = 'TDS::SW-CYCLE-9'),
  'swiggy:-7000',
  'a swiggy cycle''s deductions name their channel');

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'swiggy',
    'restaurant_ref', 'RID-ACTIVE', 'operator_cycle_ref', 'SW-INCOMPLETE',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'settled',
    'stated_payout_paise', 1000,
    'orders', jsonb_build_array(jsonb_build_object(
      'order_id', 'NOC', 'placed_at', pg_temp.at_ist(pg_temp.day(9), '13:00'),
      'gross_paise', 1000, 'commission_paise', 300))))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(8)),
  '22023', null,
  'a settled swiggy cycle needs every order''s payout present; undetermined is '
  'not a settled answer');

select throws_ok(
  format($$select pg_temp.ingest(jsonb_build_object(
    'contract_version', 1, 'outlet_id', %L, 'channel', 'swiggy',
    'restaurant_ref', 'RID-ACTIVE',
    'bank_status', 'deposited',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'provisional',
    'orders', '[]'::jsonb))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(8)),
  '22023', null,
  'bank status speaks the portal''s three words or none');

-- A disputed swiggy week leaves prior money untouched and names the gap in its
-- own identity, distinct from any zomato decision about the same dates.
select is(
  pg_temp.ingest(jsonb_build_object(
    'contract_version', 1,
    'outlet_id', :'KAL',
    'channel', 'swiggy',
    'restaurant_ref', 'RID-ACTIVE',
    'operator_cycle_ref', 'SW-CYCLE-BAD',
    'cycle_start', pg_temp.day(6),
    'cycle_end', pg_temp.day(5),
    'cycle_state', 'settled',
    'stated_payout_paise', 500_000,
    'orders', jsonb_build_array(
      jsonb_build_object('order_id', 'BAD1', 'placed_at', pg_temp.at_ist(pg_temp.day(6), '12:00'),
                         'gross_paise', 90_000, 'commission_paise', 10_000, 'net_paise', 80_000))
  )) ->> 'outcome',
  'reconciliation_failed',
  'a swiggy week that does not add up refuses to write');

select is(
  (select count(*) from public.aggregator_channel_days
    where outlet_id = :'KAL'::uuid and channel = 'swiggy'
      and business_date between pg_temp.day(6) and pg_temp.day(5)),
  0::bigint,
  'and no day of it was written, not even provisional');

select * from finish();
rollback;
