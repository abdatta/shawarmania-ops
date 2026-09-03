-- The command boundary, across the change that added discounts.
--
-- The claim being proved is the one that costs a trading day if it is wrong: a
-- till that went offline before this release and reconnects after it settles
-- everything it captured, exactly once, unchanged. Its envelopes carry schema
-- version 1, the payload shape without discounts or rounding, and hashes
-- computed over that shape.
--
-- The TypeScript half of the hash vector is in `src/lib/billing-command.test.ts`.
-- Client and database are two implementations of one canonical rule, and only a
-- shared vector holds them together.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- The cross-runtime vector, both shapes.

create function pg_temp.legacy_payload() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'orderId', '40000000-0000-4000-a000-000000000001',
    'businessDate', '2026-08-09',
    'customerId', null,
    'customerName', null,
    'customerPhone', null,
    'subtotalPaise', 13900,
    'discountPaise', 0,
    'taxPaise', 0,
    'totalPaise', 13900,
    'pricingMode', 'no_tax',
    'lines', jsonb_build_array(jsonb_build_object(
      'id', '30000000-0000-4000-a000-000000000001',
      'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma',
      'unitPricePaise', 13900,
      'quantity', 1,
      'lineTotalPaise', 13900)));
$$;

select is(
  public.billing_payload_hash(pg_temp.legacy_payload()),
  '55d4e33863f19d9cf07d798e5fdc9307c3faeac644963ef106f23527e64ad93a',
  'the version-1 payload hashes in SQL to exactly what it hashes to in TypeScript');

-- ---------------------------------------------------------------------------
-- Both schema versions are accepted, and each names its own shape.

create function pg_temp.envelope(p_version integer, p_payload jsonb)
returns text language sql as $$
  select public.billing_envelope_error(
    '10000000-0000-4000-a000-0000000000f1'::uuid,
    p_version,
    public.billing_payload_hash(p_payload),
    now() - interval '1 minute',
    p_payload,
    array['orderId','businessDate','customerId','customerName','customerPhone',
          'subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','lines'],
    array['roundingPaise','discounts']);
$$;

select is(
  pg_temp.envelope(1, pg_temp.legacy_payload()),
  null,
  'a version-1 envelope carrying the version-1 shape is accepted');

select is(
  pg_temp.envelope(
    2,
    pg_temp.legacy_payload() || jsonb_build_object('roundingPaise', 0, 'discounts', '[]'::jsonb)),
  null,
  'a version-2 envelope carrying the version-2 shape is accepted');

-- The version names the shape. The hash was computed over one of them and only
-- one of them can be right, so a mismatch is malformed rather than tolerated.
select is(
  pg_temp.envelope(
    1,
    pg_temp.legacy_payload() || jsonb_build_object('roundingPaise', 0, 'discounts', '[]'::jsonb)),
  'malformed_payload',
  'a version-1 envelope carrying version-2 keys is refused');

select is(
  pg_temp.envelope(2, pg_temp.legacy_payload()),
  'malformed_payload',
  'a version-2 envelope missing the version-2 keys is refused');

select is(
  pg_temp.envelope(3, pg_temp.legacy_payload()),
  'unsupported_schema',
  'a version nobody has written yet is refused as unsupported, not as malformed');

-- ---------------------------------------------------------------------------
-- The validators read an absent rounding as nought, which is what it meant.

select ok(
  public.billing_validate_discounts(pg_temp.legacy_payload()),
  'a payload with no discounts anywhere reconciles to a discount of nought');

select ok(
  public.billing_validate_discounts(jsonb_build_object(
    'discountPaise', 3085,
    'lines', jsonb_build_array(
      jsonb_build_object('lineTotalPaise', 13900, 'discountPaise', 2085)),
    'discounts', jsonb_build_array(
      jsonb_build_object('basis','amount','valueBp',null,'valuePaise',1000,'amountPaise',1000)))),
  'a line discount and a bill discount summing to the declared total reconcile');

select ok(
  not public.billing_validate_discounts(jsonb_build_object(
    'discountPaise', 5000,
    'lines', jsonb_build_array(
      jsonb_build_object('lineTotalPaise', 13900, 'discountPaise', 2085)),
    'discounts', jsonb_build_array(
      jsonb_build_object('basis','amount','valueBp',null,'valuePaise',1000,'amountPaise',1000)))),
  'a declared discount its parts do not sum to is refused');

select ok(
  not public.billing_validate_discounts(jsonb_build_object(
    'discountPaise', 14000,
    'lines', jsonb_build_array(
      jsonb_build_object('lineTotalPaise', 13900, 'discountPaise', 14000)),
    'discounts', '[]'::jsonb)),
  'a line giving away more than it is worth is refused');

-- ---------------------------------------------------------------------------
-- Typing: the new keys, when present, and the basis naming its own value.

select ok(
  public.billing_content_payload_well_typed(pg_temp.legacy_payload()),
  'a version-1 payload is still well typed, with neither new key present');

select ok(
  public.billing_content_payload_well_typed(
    pg_temp.legacy_payload() || jsonb_build_object(
      'roundingPaise', 35,
      'discounts', jsonb_build_array(jsonb_build_object(
        'basis','percent','valueBp',1500,'valuePaise',null,'amountPaise',2085)))),
  'a version-2 payload with a percentage discount is well typed');

select ok(
  not public.billing_content_payload_well_typed(
    pg_temp.legacy_payload() || jsonb_build_object(
      'roundingPaise', 35,
      'discounts', jsonb_build_array(jsonb_build_object(
        'basis','percent','valueBp',null,'valuePaise',1000,'amountPaise',2085)))),
  'a percentage discount carrying a rupee value instead is refused before it is written');

select ok(
  not public.billing_content_payload_well_typed(
    pg_temp.legacy_payload() || jsonb_build_object(
      'roundingPaise', 35,
      'discounts', jsonb_build_array(jsonb_build_object(
        'basis','coupon','valueBp',1500,'valuePaise',null,'amountPaise',2085)))),
  'a basis nobody defined is refused');

select * from finish();
rollback;
