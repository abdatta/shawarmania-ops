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

-- A typed day, as the owner records one. Every cycle below lands on days that
-- already exist, which is the contract: the sync attaches figures, it does not
-- invent trading days.
create function pg_temp.typed_day(p_outlet uuid, d date, revenue bigint, bp int)
returns void language plpgsql as $$
begin
  insert into public.manual_ledger_days
    (outlet_id, business_date, opening_cash_paise, counted_cash_paise,
     cash_revenue_paise, zomato_revenue_paise, zomato_commission_bp,
     swiggy_commission_bp, recorded_by)
  values (p_outlet, d, 500000, 500000, 0, revenue, bp, 2100,
          '10000000-0000-4000-a000-000000000001')
  on conflict (outlet_id, business_date) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. A reconciling cycle is written, and each day gets its own triple.

select pg_temp.typed_day(:'KAL', pg_temp.day(9), 295000, 2825);
select pg_temp.typed_day(:'KAL', pg_temp.day(8), 180000, 2825);

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

select results_eq(
  format($$select business_date, zomato_gross_paise, zomato_commission_paise,
                  zomato_net_paise, zomato_settlement_state
             from public.manual_ledger_days
            where outlet_id = %L and business_date in (%L, %L)
            order by business_date$$,
    :'KAL', pg_temp.day(9), pg_temp.day(8)),
  $$values (public.app_business_date(now(), time '04:00') - 9,
            297003::bigint, 83892::bigint, 213111::bigint, 'provisional'),
           (public.app_business_date(now(), time '04:00') - 8,
            180000::bigint, 50000::bigint, 130000::bigint, 'provisional')$$,
  'each trading day carries its own measured triple, summed from its own orders');

select is(
  (select zomato_revenue_paise + zomato_commission_bp from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(9)),
  0::bigint,
  'and the typed inputs are zeroed, so no path can add a typed figure to a '
  'measured one');

select results_eq(
  format($$select zomato_typed_revenue_paise, zomato_typed_commission_bp
             from public.manual_ledger_days
            where outlet_id = %L and business_date = %L$$, :'KAL', pg_temp.day(9)),
  $$values (295000::bigint, 2825)$$,
  'what the owner had typed is retained beside it, so the estimate can be '
  'compared against the settled truth');

select isnt(
  (select zomato_superseded_at from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(9)),
  null,
  'with the moment it was superseded');

-- ---------------------------------------------------------------------------
-- 2. Running it again changes nothing.

create function pg_temp.day_fingerprint(p_outlet uuid)
returns text language sql as $$
  select coalesce(string_agg(
    format('%s|%s|%s|%s|%s|%s', business_date, zomato_gross_paise, zomato_commission_paise,
           zomato_net_paise, zomato_settlement_state, zomato_superseded_at),
    ' ' order by business_date), '')
    from public.manual_ledger_days where outlet_id = p_outlet
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
  (select zomato_typed_revenue_paise from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(9)),
  295000::bigint,
  'nor supersedes the typed figure a second time with the zero it wrote itself, '
  'which would destroy the only record of what the owner had estimated');

rollback to savepoint before_rerun;

-- ---------------------------------------------------------------------------
-- 3. The cutover: a late-night order belongs to the shift that cooked it.

select pg_temp.typed_day(:'KAL', pg_temp.day(7), 0, 0);
select pg_temp.typed_day(:'KAL', pg_temp.day(6), 0, 0);

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
  (select zomato_net_paise from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(7)),
  35000::bigint,
  'an order placed at 00:30 lands on the trading day that cooked it, not on the '
  'calendar day the clock had already moved to');

select is(
  (select zomato_net_paise from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(6)),
  50000::bigint,
  'and an order at exactly 04:00 opens the new one, the cutover being an '
  'inclusive start');

-- ---------------------------------------------------------------------------
-- 4. Settlement replaces the estimate in place, and says what it replaced.

select pg_temp.typed_day(:'KPA', pg_temp.day(12), 0, 0);

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
  format($$select zomato_net_paise, zomato_settlement_state, zomato_provisional_net_paise
             from public.manual_ledger_days
            where outlet_id = %L and business_date = %L$$, :'KPA', pg_temp.day(12)),
  $$values (217915::bigint, 'settled', 210000::bigint)$$,
  'marked settled, carrying the provisional figure it grew from');

select isnt(
  (select zomato_revised_at from public.manual_ledger_days
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
  (select zomato_net_paise from public.manual_ledger_days
    where outlet_id = :'KPA'::uuid and business_date = pg_temp.day(12)),
  217915::bigint,
  'but changes nothing, because a settled figure has already reconciled and the '
  'live dashboard omits the refund that made it larger');

-- A day that settles unchanged is not marked revised: the marker describes a
-- movement, and claiming one that did not happen is its own small lie.
select pg_temp.typed_day(:'KPA', pg_temp.day(13), 0, 0);

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
  (select zomato_revised_at from public.manual_ledger_days
    where outlet_id = :'KPA'::uuid and business_date = pg_temp.day(13)),
  null,
  'a day that settled unchanged is not marked revised');

-- ---------------------------------------------------------------------------
-- 5. Rounding noise is accepted, and the stored figures stay Zomato's own.

select pg_temp.typed_day(:'KAL', pg_temp.day(14), 0, 0);

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
  (select zomato_net_paise from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(14)),
  140000::bigint,
  'and the stored figure is the aggregator''s own, not adjusted to close the gap');

-- ---------------------------------------------------------------------------
-- 6. A week that does not reconcile is refused whole and marked disputed.

select pg_temp.typed_day(:'KAL', pg_temp.day(20), 0, 0);
select pg_temp.typed_day(:'KAL', pg_temp.day(19), 0, 0);

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
  (select count(*) from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid
      and business_date in (pg_temp.day(20), pg_temp.day(19))
      and zomato_settlement_state = 'disputed'),
  2::bigint,
  'its days read disputed, so a paid week that does not add up cannot be '
  'mistaken for the current week awaiting payment');

select is(
  (select sum(zomato_net_paise)::bigint from public.manual_ledger_days
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
  (select count(*) from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid
      and business_date in (pg_temp.day(20), pg_temp.day(19))
      and zomato_settlement_state = 'settled'),
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
  (select sum(zomato_net_paise)::bigint from public.manual_ledger_days
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

select pg_temp.typed_day(:'KAL', pg_temp.day(30), 0, 0);

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
    'contract_version', 1, 'outlet_id', %L, 'channel', 'swiggy',
    'cycle_start', %L, 'cycle_end', %L, 'cycle_state', 'provisional'))$$,
    :'KAL', pg_temp.day(9), pg_temp.day(9)),
  '22023', null,
  'a channel this capability does not cover is refused');

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
  )) ->> 'days_pending',
  (pg_temp.day(60))::text,
  'a trading day with no ledger row is reported as pending');

select is(
  (select count(*) from public.manual_ledger_days
    where outlet_id = :'KAL'::uuid and business_date = pg_temp.day(60)),
  0::bigint,
  'and no day row is invented for it, because a fabricated opening balance and '
  'a drawer count of zero would reconcile and mean nothing');

select * from finish();
rollback;
