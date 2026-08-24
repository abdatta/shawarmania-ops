-- One supplier order, one expense row, whatever reads it and whenever.
--
-- The failure this guards is a purchase counted twice: the same Hyperpure order
-- reaching the ledger from a statement, then a later statement that still lists
-- it, then a person supplying the file by hand. Each is a true-looking write, and
-- three of them for one purchase overstates the cost threefold. The key is the
-- order number, not an amount-and-date match, because two real purchases of
-- similar size on nearby days are ordinary and must both stand.

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

create function pg_temp.day(back int)
returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00') - back
$$;

-- A recorded day, so the books have an opening the fallback can find.
insert into public.manual_ledger_days
  (outlet_id, business_date, opening_cash_paise, counted_cash_paise, recorded_by)
values (:'KAL', pg_temp.day(30), 500000, 500000,
        '10000000-0000-4000-a000-000000000001');

-- ---------------------------------------------------------------------------
-- 1. The same order, three ways, is one row.

create function pg_temp.hyperpure_payload(order_ref text, amount bigint, invoice date)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'contract_version', 1,
    'outlet_id', '00000000-0000-4000-a000-000000000001',
    'source_system', 'hyperpure',
    'category', 'Hyperpure',
    'orders', jsonb_build_array(
      jsonb_build_object('order_ref', order_ref, 'invoice_date', invoice,
                         'amount_paise', amount, 'shared_cost', true)))
$$;

select is(
  pg_temp.ingest(pg_temp.hyperpure_payload('ZHPWB27-OR-1', 931100, pg_temp.day(10))) ->> 'outcome',
  'ok',
  'a Hyperpure statement is ingested');

select is(
  pg_temp.ingest(pg_temp.hyperpure_payload('ZHPWB27-OR-1', 931100, pg_temp.day(10))) ->> 'outcome',
  'ok',
  'and read again from a later statement');

-- Supplied by hand is the same function with the same payload: there is no
-- second path, so there is no second row it could make.
select is(
  pg_temp.ingest(pg_temp.hyperpure_payload('ZHPWB27-OR-1', 931100, pg_temp.day(10))) ->> 'outcome',
  'ok',
  'and supplied by hand a third time');

select is(
  (select count(*) from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and source_ref = 'ZHPWB27-OR-1'),
  1::bigint,
  'and the ledger holds exactly one row for it, keyed on the order number');

select is(
  (select shared_cost from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and source_ref = 'ZHPWB27-OR-1'),
  true,
  'marked shared, because both kitchens draw on one Hyperpure inventory');

-- A revised figure updates the row it already owns rather than adding a second.
select is(
  pg_temp.ingest(pg_temp.hyperpure_payload('ZHPWB27-OR-1', 925000, pg_temp.day(10))) ->> 'outcome',
  'ok',
  'a corrected figure for the same order is accepted');

select is(
  (select amount_paise from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and source_ref = 'ZHPWB27-OR-1'),
  925000::bigint,
  'and it moves the one row rather than adding another');

select is(
  (select count(*) from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and source_ref = 'ZHPWB27-OR-1'),
  1::bigint,
  'still one row');

-- ---------------------------------------------------------------------------
-- 2. Dating: invoice date, with the opening fallback.

select pg_temp.ingest(pg_temp.hyperpure_payload('ZHPWB27-OR-2', 300000, pg_temp.day(5)));
select is(
  (select business_date from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and source_ref = 'ZHPWB27-OR-2'),
  pg_temp.day(5),
  'an order is dated by its invoice date, the day the goods arrived');

-- Invoiced before the books open (day 30 is the earliest recorded day here).
select pg_temp.ingest(pg_temp.hyperpure_payload('ZHPWB27-OR-3', 141990, pg_temp.day(40)));
select is(
  (select business_date from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and source_ref = 'ZHPWB27-OR-3'),
  pg_temp.day(30),
  'an order invoiced before the books open lands on the opening date, so a cost '
  'settled from an in-period payout is recorded rather than lost');

-- ---------------------------------------------------------------------------
-- 3. Two genuine purchases of similar size on nearby days are two rows.

select pg_temp.ingest(jsonb_build_object(
  'contract_version', 1, 'outlet_id', :'KAL', 'source_system', 'hyperpure',
  'category', 'Hyperpure',
  'orders', jsonb_build_array(
    jsonb_build_object('order_ref', 'ZHPWB27-OR-A', 'invoice_date', pg_temp.day(6),
                       'amount_paise', 300100),
    jsonb_build_object('order_ref', 'ZHPWB27-OR-B', 'invoice_date', pg_temp.day(5),
                       'amount_paise', 300000))));
select is(
  (select count(*) from public.manual_ledger_expenses
    where outlet_id = :'KAL'::uuid and source_ref in ('ZHPWB27-OR-A', 'ZHPWB27-OR-B')),
  2::bigint,
  'two similar purchases on nearby days are two rows, because the key is the '
  'order and not a tolerance a real pair would collide on');

-- ---------------------------------------------------------------------------
-- 4. The outlet and category guards.

select throws_ok(
  format($$select public.ingest_supply_statement(
    jsonb_build_object('contract_version', 1, 'outlet_id', %L, 'source_system', 'hyperpure',
      'category', 'Hyperpure', 'orders', '[]'::jsonb),
    array['%s'::uuid])$$, :'KPA', :'KAL'),
  '42501', null,
  'a statement naming an outlet the credential may not write is refused');

select throws_ok(
  format($$select public.ingest_supply_statement(
    jsonb_build_object('contract_version', 1, 'outlet_id', %L, 'source_system', 'hyperpure',
      'category', 'Chicken',
      'orders', jsonb_build_array(jsonb_build_object(
        'order_ref', 'X', 'invoice_date', %L, 'amount_paise', 1000))),
    array['%s'::uuid, '%s'::uuid])$$, :'KAL', pg_temp.day(5), :'KAL', :'KPA'),
  '22023', null,
  'a category the source does not own is refused, rather than dropped by the '
  'reserved-category trigger where its absence would be noticed too late');

select * from finish();
rollback;
