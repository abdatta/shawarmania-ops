-- The bill's arithmetic, once a discount and a rounding line exist.
--
-- The identity `total = subtotal - discount + tax + rounding` is written in
-- three places that must agree: the check constraints exercised here, the pure
-- function in `src/domain/billing.ts`, and `billing_validate_totals` below.
-- A drift between them refuses live bills at the counter rather than failing a
-- test, which is why all three are asserted rather than one.
--
-- Everything here asserts on INSERT rather than UPDATE, deliberately. The
-- `bills_append_only` trigger refuses every update that is not a void, and it
-- refuses it before any check constraint is evaluated — so an update-based test
-- would go green on the trigger's refusal while saying nothing whatever about
-- the constraint it claims to cover.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- The columns exist and carry the bounds the model depends on.

select has_column('public', 'orders', 'rounding_paise', 'an order carries its rounding');
select has_column('public', 'bills', 'rounding_paise', 'a bill carries its rounding');
select col_not_null('public', 'orders', 'rounding_paise', 'an order always states its rounding');
select col_not_null('public', 'bills', 'rounding_paise', 'a bill always states its rounding');

select has_column('public', 'order_items', 'discount_paise', 'an order line carries its discount');
select has_column('public', 'bill_items', 'discount_paise', 'a bill line carries its discount');
select has_column(
  'public', 'order_items', 'discount_percent_bp',
  'an order line remembers the percentage it was given');
select has_column(
  'public', 'bill_items', 'discount_percent_bp',
  'a bill line remembers the percentage it was given');
select has_column(
  'public', 'bill_items', 'category_name',
  'a bill line snapshots its category, so a settled bill reads without the menu');

-- ---------------------------------------------------------------------------
-- One bill, parameterised on the figures under test. The outlet, till, shift
-- and operator are the seed's Kalyani counter; the business date is resolved
-- through that outlet's own cutover rather than assumed, because
-- `validate_business_date` refuses anything else.

create function pg_temp.try_bill(
  p_subtotal bigint,
  p_discount bigint,
  p_rounding bigint,
  p_total bigint
)
returns void language plpgsql as $$
declare
  v_created timestamptz := now() - interval '30 minutes';
begin
  insert into public.bills (
    id, outlet_id, bill_number, business_date, biller_profile_id,
    counter_device_id, shift_id, subtotal_paise, discount_paise, tax_paise,
    rounding_paise, total_paise, payment_method, created_at)
  select
    gen_random_uuid(),
    o.id,
    0,
    public.app_business_date(v_created, o.business_day_cutover),
    '10000000-0000-4000-a000-00000000000a'::uuid,
    '10000000-0000-4000-a000-000000000004'::uuid,
    '40000000-0000-4000-a000-000000000001'::uuid,
    p_subtotal, p_discount, 0, p_rounding, p_total, 'cash', v_created
  from public.outlets o
  where o.id = '00000000-0000-4000-a000-000000000001';
end;
$$;

-- ---------------------------------------------------------------------------
-- The identity holds, and refuses arithmetic that does not add up.

select lives_ok(
  $$select pg_temp.try_bill(38900, 5835, 35, 33100)$$,
  'a bill whose parts add up is accepted: 389 less 15% is 330.65, rounded to 331');

-- `lives_ok` is equally happy with an insert that matched nothing and wrote
-- nothing, so the row is counted rather than assumed.
select is(
  (select count(*) from public.bills where subtotal_paise = 38900 and rounding_paise = 35)::bigint,
  1::bigint,
  'and that bill is actually on the table, not an insert that quietly matched nothing');

select throws_ok(
  $$select pg_temp.try_bill(38900, 5835, 36, 33100)$$,
  '23514', null,
  'a rounding that breaks the identity is refused');

select throws_ok(
  $$select pg_temp.try_bill(38900, 40000, 0, 0)$$,
  '23514', null,
  'a discount larger than the subtotal is refused');

select throws_ok(
  $$select pg_temp.try_bill(38900, 5835, -1, 33064)$$,
  '23514', null,
  'a rounding in the customer''s favour is refused: a bill only ever rounds up');

select throws_ok(
  $$select pg_temp.try_bill(38900, 5835, 101, 33166)$$,
  '23514', null,
  'a rounding beyond a whole rupee is refused');

-- ---------------------------------------------------------------------------
-- The total is always a whole rupee, and never below one.

select throws_ok(
  $$select pg_temp.try_bill(38900, 5835, 0, 33065)$$,
  '23514', null,
  'a total carrying paise is refused: nobody at this counter is handed 65 paise');

select throws_ok(
  $$select pg_temp.try_bill(13900, 13900, 0, 0)$$,
  '23514', null,
  'a bill of nought is refused; a fully discounted order comes to the floor instead');

select lives_ok(
  $$select pg_temp.try_bill(13900, 13900, 100, 100)$$,
  'a fully discounted order records the whole giveaway and totals a rupee');

-- ---------------------------------------------------------------------------
-- A line cannot give away more than it is worth.

create function pg_temp.try_line(
  p_line_total bigint,
  p_discount bigint,
  p_percent_bp integer
)
returns void language plpgsql as $$
declare
  v_bill uuid;
begin
  select id into v_bill from public.bills order by created_at desc limit 1;
  insert into public.bill_items (
    bill_id, item_name, unit_price_paise, quantity, line_total_paise,
    discount_paise, discount_percent_bp, category_name)
  values (
    v_bill, 'Chicken Shawarma', p_line_total, 1, p_line_total,
    p_discount, p_percent_bp, 'Shawarma');
end;
$$;

select throws_ok(
  $$select pg_temp.try_line(13900, 14000, null)$$,
  '23514', null,
  'a line discount above the line total is refused');

select throws_ok(
  $$select pg_temp.try_line(13900, -1, null)$$,
  '23514', null,
  'a negative line discount is refused');

select lives_ok(
  $$select pg_temp.try_line(13900, 2085, 1500)$$,
  'a line records its discount, the percentage that produced it, and its category');

select is(
  (select count(*) from public.bill_items
    where discount_paise = 2085 and discount_percent_bp = 1500
      and category_name = 'Shawarma')::bigint,
  1::bigint,
  'and that line is on the table carrying all three facts');

select lives_ok(
  $$select pg_temp.try_line(13900, 2000, null)$$,
  'a line discount given in rupees records no percentage');

select is(
  (select count(*) from public.bill_items
    where discount_paise = 2000 and discount_percent_bp is null)::bigint,
  1::bigint,
  'a rupee discount leaves the percentage null rather than inventing one');

-- ---------------------------------------------------------------------------
-- billing_validate_totals agrees with the constraints above.

create function pg_temp.totals(
  p_subtotal bigint,
  p_discount bigint,
  p_rounding jsonb,
  p_total bigint
)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'subtotalPaise', p_subtotal,
    'discountPaise', p_discount,
    'taxPaise', 0,
    'roundingPaise', p_rounding,
    'totalPaise', p_total,
    'pricingMode', 'no_tax',
    'lines', jsonb_build_array(jsonb_build_object('lineTotalPaise', p_subtotal))));
$$;

select ok(
  public.billing_validate_totals(pg_temp.totals(38900, 5835, to_jsonb(35), 33100)),
  'the validator accepts a payload whose parts add up');

select ok(
  not public.billing_validate_totals(pg_temp.totals(38900, 5835, to_jsonb(0), 33065)),
  'the validator refuses a total carrying paise');

select ok(
  not public.billing_validate_totals(pg_temp.totals(38900, 40000, to_jsonb(0), 0)),
  'the validator refuses a discount larger than the subtotal');

select ok(
  not public.billing_validate_totals(pg_temp.totals(13900, 13900, to_jsonb(0), 0)),
  'the validator refuses a bill of nought');

select ok(
  public.billing_validate_totals(pg_temp.totals(13900, 13900, to_jsonb(100), 100)),
  'the validator accepts a fully discounted order at the floor');

-- A payload written before this change carries no rounding key at all, and a
-- till that was offline across the release is still holding some.
select ok(
  public.billing_validate_totals(pg_temp.totals(13900, 0, null, 13900)),
  'the validator still accepts a payload written before rounding existed');

-- ---------------------------------------------------------------------------
-- The shared case table: the constraints and the validator, over the same rows
-- `billTotals()` is held to in `src/domain/billing-totals-agree.test.ts`.
--
-- The block below is generated from `shared/billing-totals-cases.json`, and
-- `scripts/check-totals-cases.mjs` fails the lint when it drifts. Do not edit
-- it by hand: add the case to the JSON and paste what the check prints.

create table pg_temp.totals_cases (
  subtotal bigint,
  discount bigint,
  rounding bigint,
  total bigint,
  name text
);

insert into pg_temp.totals_cases (subtotal, discount, rounding, total, name) values
-- BEGIN GENERATED TOTALS CASES
  (27800, 0, 0, 27800, 'nothing discounted'),
  (27800, 5000, 0, 22800, 'a flat amount off'),
  (38900, 5835, 35, 33100, '15% of an odd subtotal'),
  (13900, 1390, 90, 12600, '10% of a round subtotal'),
  (13900, 1738, 38, 12200, '12.5%, which divides into no whole paisa'),
  (33099, 0, 1, 33100, 'a rupee short of the next rupee'),
  (33001, 0, 99, 33100, 'a paisa past a whole rupee'),
  (27800, 27800, 100, 100, 'stacked to more than the order is worth'),
  (13900, 13900, 100, 100, 'a free meal, recorded in full'),
  (50, 0, 50, 100, 'lines cheaper than the floor'),
  (13900, 13851, 51, 100, 'discounted to just under a rupee')
-- END GENERATED TOTALS CASES
;

select is(
  (select count(*) from pg_temp.totals_cases
    where not public.billing_validate_totals(
      pg_temp.totals(subtotal, discount, to_jsonb(rounding), total)))::bigint,
  0::bigint,
  'the validator accepts every case the pure function accepts');

-- And the constraints, over the same rows. A case the validator waves through
-- but the table refuses is the drift this whole file exists to catch.
do $$
declare
  r record;
begin
  for r in select * from pg_temp.totals_cases loop
    begin
      perform pg_temp.try_bill(r.subtotal, r.discount, r.rounding, r.total);
    exception when others then
      raise exception 'the constraints refused a case the validator accepted: % (%)',
        r.name, sqlerrm;
    end;
  end loop;
end;
$$;

select pass('the check constraints accept every case the validator accepts');

select * from finish();
rollback;
