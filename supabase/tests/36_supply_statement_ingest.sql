-- A supplier order is globally unique where the supplier proves account-level
-- order numbers, and its physical delivery outlet is resolved from dated
-- database configuration rather than a caller assertion.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

create function pg_temp.ingest(payload jsonb, outlets uuid[] default null)
returns jsonb language sql as $$
  select public.ingest_supply_statement(
    payload,
    coalesce(outlets, array['00000000-0000-4000-a000-000000000001'::uuid,
                            '00000000-0000-4000-a000-000000000002'::uuid]))
$$;

create function pg_temp.hyperpure_payload(
  orders jsonb,
  asserted_outlet uuid default '00000000-0000-4000-a000-000000000002'
)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'contract_version', 1,
    'outlet_id', asserted_outlet,
    'source_system', 'hyperpure',
    'category', 'Hyperpure',
    'orders', orders)
$$;

create function pg_temp.order_row(ref text, invoice date, amount bigint)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'order_ref', ref,
    'invoice_date', invoice,
    'amount_paise', amount,
    'description', 'Hyperpure ' || ref,
    'shared_cost', true)
$$;

-- Keep invoice dates visible rather than allowing the existing-books fallback
-- to clamp them. Routing itself always happens before that fallback.
insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, recorded_by)
values
  (:'KAL', date '2026-08-01', 'Other', false, 100,
   '10000000-0000-4000-a000-000000000001'),
  (:'KPA', date '2026-08-01', 'Other', false, 100,
   '10000000-0000-4000-a000-000000000001');

-- ---------------------------------------------------------------------------
-- One statement spans the cutover. Its top-level outlet is deliberately the
-- wrong answer for one order and has no routing authority.

select is(
  pg_temp.ingest(pg_temp.hyperpure_payload(jsonb_build_array(
    pg_temp.order_row('CUTOVER-15', date '2026-09-15', 1500),
    pg_temp.order_row('CUTOVER-16', date '2026-09-16', 1600)
  ), :'KAL')) ->> 'outcome',
  'ok',
  'one statement spanning the cutover is accepted');

select is(
  (select outlet_id from public.expenses
    where source_system = 'hyperpure' and source_ref = 'CUTOVER-15'),
  :'KPA'::uuid,
  'an order invoiced through 15 September routes to Kanchrapara');

select is(
  (select outlet_id from public.expenses
    where source_system = 'hyperpure' and source_ref = 'CUTOVER-16'),
  :'KAL'::uuid,
  'an order invoiced from 16 September routes to Kalyani');

select is(
  (select count(*) from public.expenses
    where source_system = 'hyperpure' and source_ref in ('CUTOVER-15', 'CUTOVER-16')),
  2::bigint,
  'the cross-boundary statement creates exactly one row per order');

-- Authority is checked against every resolved route. A failure on the second
-- order rolls back the first order from the same function call.
select throws_ok(
  format($$select public.ingest_supply_statement(%L::jsonb, array[%L::uuid])$$,
    pg_temp.hyperpure_payload(jsonb_build_array(
      pg_temp.order_row('ONLY-KPA-FIRST', date '2026-09-15', 1000),
      pg_temp.order_row('ONLY-KPA-SECOND', date '2026-09-16', 1000))), :'KPA'),
  '42501', null,
  'a manager missing the Kalyani route is refused');

select is(
  (select count(*) from public.expenses
    where source_ref in ('ONLY-KPA-FIRST', 'ONLY-KPA-SECOND')),
  0::bigint,
  'the refused cross-boundary ingest leaves no partial write');

select throws_ok(
  format($$select public.ingest_supply_statement(%L::jsonb, array[%L::uuid])$$,
    pg_temp.hyperpure_payload(jsonb_build_array(
      pg_temp.order_row('ONLY-KAL', date '2026-09-15', 1000))), :'KAL'),
  '42501', null,
  'a manager missing the Kanchrapara route is refused');

-- A route gap is a configuration error, never an invitation to trust the
-- payload. The deletion is inside this rolled-back pgTAP transaction.
delete from public.supplier_delivery_routes
 where source_system = 'hyperpure' and effective_from = date '0001-01-01';

select throws_ok(
  format($$select public.ingest_supply_statement(%L::jsonb, array[%L::uuid, %L::uuid])$$,
    pg_temp.hyperpure_payload(jsonb_build_array(
      pg_temp.order_row('NO-ROUTE', date '2026-09-15', 1000))), :'KAL', :'KPA'),
  '22023', null,
  'an invoice with no effective route is refused rather than guessed');

insert into public.supplier_delivery_routes (source_system, effective_from, outlet_id)
values ('hyperpure', date '0001-01-01', :'KPA');

-- ---------------------------------------------------------------------------
-- A 28-day account-level replay stays globally idempotent across the cutover.

create temporary table replay_orders as
select format('REPLAY-%s', d)::text as source_ref,
       date '2026-08-20' + d as invoice_date,
       (10000 + d)::bigint as amount_paise
  from generate_series(0, 27) d;

select is(
  pg_temp.ingest(pg_temp.hyperpure_payload((
    select jsonb_agg(pg_temp.order_row(source_ref, invoice_date, amount_paise)
                     order by invoice_date)
      from replay_orders
  ), :'KPA')) ->> 'outcome',
  'ok',
  'the first 28-day statement is ingested');

create temporary table replay_baseline as
select count(*)::bigint as row_count, sum(amount_paise)::bigint as total_paise
  from public.expenses where source_ref like 'REPLAY-%';

select is(
  pg_temp.ingest(pg_temp.hyperpure_payload((
    select jsonb_agg(pg_temp.order_row(source_ref, invoice_date, amount_paise)
                     order by invoice_date)
      from replay_orders
  ), :'KAL')) ->> 'outcome',
  'ok',
  'the same 28 days replay with the opposite asserted outlet');

select is(
  (select count(*) from public.expenses where source_ref like 'REPLAY-%'),
  (select row_count from replay_baseline),
  'the overlapping replay adds no rows');

select is(
  (select sum(amount_paise)::bigint from public.expenses where source_ref like 'REPLAY-%'),
  (select total_paise from replay_baseline),
  'the overlapping replay adds no paise');

select is(
  (select count(*) from (
     select source_ref from public.expenses
      where source_system = 'hyperpure'
      group by source_ref having count(*) > 1
   ) duplicates),
  0::bigint,
  'every Hyperpure order reference is globally unique');

select is(
  (select count(*) from public.expenses e join replay_orders r using (source_ref)
    where r.invoice_date <= date '2026-09-15' and e.outlet_id <> :'KPA'),
  0::bigint,
  'the replay leaves every pre-cutover order at Kanchrapara');

select is(
  (select count(*) from public.expenses e join replay_orders r using (source_ref)
    where r.invoice_date >= date '2026-09-16' and e.outlet_id <> :'KAL'),
  0::bigint,
  'the replay leaves every post-cutover order at Kalyani');

-- ---------------------------------------------------------------------------
-- An existing identity at the wrong outlet must be repaired by an audited
-- migration; ingest cannot silently move it or insert a second copy.

insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, description,
   source_system, source_ref, shared_cost, recorded_by)
values
  (:'KPA', date '2026-09-17', 'Hyperpure', false, 1900,
   'deliberately misattributed fixture', 'hyperpure', 'ATTRIBUTION-CONFLICT', true, null);

select throws_ok(
  format($$select public.ingest_supply_statement(%L::jsonb, array[%L::uuid, %L::uuid])$$,
    pg_temp.hyperpure_payload(jsonb_build_array(
      pg_temp.order_row('ATTRIBUTION-CONFLICT', date '2026-09-17', 1900))), :'KAL', :'KPA'),
  '22023', null,
  'an existing Hyperpure identity at the wrong outlet is refused explicitly');

select is(
  (select count(*) from public.expenses
    where source_system = 'hyperpure' and source_ref = 'ATTRIBUTION-CONFLICT'),
  1::bigint,
  'the attribution conflict neither moves nor duplicates the stored row');

-- Equal date and amount are ordinary; distinct order numbers are distinct
-- purchases and must never be collapsed by a tolerance heuristic.
select pg_temp.ingest(pg_temp.hyperpure_payload(jsonb_build_array(
  pg_temp.order_row('EQUAL-A', date '2026-09-17', 300000),
  pg_temp.order_row('EQUAL-B', date '2026-09-17', 300000))));

select is(
  (select count(*) from public.expenses
    where source_system = 'hyperpure' and source_ref in ('EQUAL-A', 'EQUAL-B')),
  2::bigint,
  'different order numbers with equal dates and amounts remain two purchases');

-- Reserved source/category ownership still rejects a malformed statement.
select throws_ok(
  format($$select public.ingest_supply_statement(
    jsonb_build_object('contract_version', 1, 'outlet_id', %L,
      'source_system', 'hyperpure', 'category', 'Chicken',
      'orders', jsonb_build_array(jsonb_build_object(
        'order_ref', 'WRONG-CATEGORY', 'invoice_date', '2026-09-17',
        'amount_paise', 1000))), array[%L::uuid, %L::uuid])$$,
    :'KPA', :'KAL', :'KPA'),
  '22023', null,
  'a category the source does not own is refused');

select * from finish();
rollback;
