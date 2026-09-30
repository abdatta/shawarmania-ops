-- a-regular-earns-points-and-gold (#62): points an outlet gives, and gold an
-- outlet grants.
--
-- What this file has to prove, and how each claim fails differently:
--
--   * a bill earns in proportion to what it came to before points, rounded
--     down, once however often its command is retried — a trigger that forgot
--     the uniqueness would pass every single-send test;
--   * a points row the boundary accepts reaches the ledger, and one of the
--     wrong shape is refused as malformed while the balance and the cap are
--     deliberately NOT checked — a balance check would refuse a paid sale;
--   * a void reverses both halves in the voiding transaction;
--   * the till is told its own outlet's balance, net of its open orders, and a
--     yes or no for gold eligibility; never another outlet's, never the spend;
--   * gold belongs to one outlet and ends on the date its grant stored;
--   * the counter grants only to the eligible, re-deciding it, and never
--     revokes;
--   * the ledger and the spells are read by the owner and that outlet's
--     managers, and by nobody else;
--   * the settings are written by one narrow function, and only by the owner
--     or that outlet's manager.
--
-- `balance_after` under two bills landing at once is serialised by an advisory
-- lock; a single session cannot race itself, so that claim is exercised in the
-- REST race suite rather than here.

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

create function pg_temp.as_server()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Earning is a deferred trigger that fires at commit, and a test transaction
-- never commits. This fires every pending deferred trigger now, as a commit
-- would, and defers again for whatever follows.
create function pg_temp.commit_point()
returns void language plpgsql as $$
begin
  set constraints all immediate;
  set constraints all deferred;
end;
$$;

--   outlets  00000000-…0001 Kalyani   00000000-…0002 Kanchrapara
--   people   10000000-…0001 owner  …0002 fa_kalyani  …0003 fa_kanchrapara
--            …0004 device_kalyani (live shift 90000000-…0001, biller …000a)
--            …0005 device_kanchrapara (live shift 90000000-…0002)
--            …0006 employee_kalyani  …000a biller_kalyani
--   menu     31000000-…0001 Kalyani's Classic Chicken Shawarma, ₹139
--            32000000-…0001 Kanchrapara's, ₹139

create function pg_temp.id(p_prefix text, p_n integer) returns uuid
language sql immutable as $$
  select (p_prefix || '-0000-4000-a000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
-- c6000000 orders, c6100000 lines, c6200000 commands, c6300000 bills

create function pg_temp.shawarma(
  p_line uuid, p_quantity integer default 1,
  p_item uuid default '31000000-0000-4000-a000-000000000001')
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', p_line, 'menuItemId', p_item,
    'itemName', 'Classic Chicken Shawarma', 'unitPricePaise', 13900,
    'quantity', p_quantity, 'lineTotalPaise', 13900 * p_quantity,
    'discountPaise', 0, 'discountPercentBp', null,
    'categoryName', 'Shawarma', 'kind', 'item')
$$;

-- A version-4 order payload whose figures add up by construction: an optional
-- biller's percentage off the whole bill, then an optional points row, so a
-- refusal below is about the fact under test and never about the arithmetic.
create function pg_temp.order_v4(
  p_order uuid, p_lines jsonb, p_phone text,
  p_points integer default 0, p_bill_bp integer default null,
  p_outlet uuid default '00000000-0000-4000-a000-000000000001')
returns jsonb language plpgsql stable as $$
declare
  v_subtotal bigint;
  v_bill bigint := 0;
  v_discounts jsonb := '[]'::jsonb;
  v_net bigint;
  v_total bigint;
begin
  select coalesce(sum((l ->> 'lineTotalPaise')::bigint), 0) into v_subtotal
    from jsonb_array_elements(p_lines) l;
  if p_bill_bp is not null then
    v_bill := round(v_subtotal * p_bill_bp / 10000.0)::bigint;
    v_discounts := v_discounts || jsonb_build_array(jsonb_build_object(
      'source', 'biller', 'basis', 'percent', 'valueBp', p_bill_bp, 'valuePaise', null,
      'amountPaise', v_bill));
  end if;
  if p_points > 0 then
    v_discounts := v_discounts || jsonb_build_array(jsonb_build_object(
      'source', 'points', 'basis', 'amount', 'valueBp', null,
      'valuePaise', p_points * 100, 'amountPaise', p_points * 100));
  end if;
  v_net := v_subtotal - v_bill - p_points * 100;
  v_total := greatest(100, ceil(v_net::numeric / 100)::bigint * 100);
  return jsonb_build_object(
    'orderId', p_order,
    'businessDate', (select public.app_business_date(now(), business_day_cutover)
                       from public.outlets where id = p_outlet),
    'customerId', null, 'customerName', null, 'customerPhone', p_phone,
    'subtotalPaise', v_subtotal, 'discountPaise', v_bill + p_points * 100,
    'taxPaise', 0, 'roundingPaise', v_total - v_net, 'totalPaise', v_total,
    'pricingMode', 'no_tax', 'discounts', v_discounts, 'lines', p_lines,
    'serviceType', 'takeaway', 'tableNumber', null);
end;
$$;

-- The same content, paid on the spot.
create function pg_temp.sale_v4(p_bill uuid, p_order_payload jsonb)
returns jsonb language sql immutable as $$
  select (p_order_payload - 'orderId') || jsonb_build_object(
    'billId', p_bill,
    'paymentBusinessDate', p_order_payload -> 'businessDate',
    'payments', jsonb_build_array(jsonb_build_object(
      'method', 'cash', 'amountPaise', p_order_payload -> 'totalPaise')))
$$;

create function pg_temp.pay_payload(p_order uuid, p_bill uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'billId', p_bill, 'orderId', p_order,
    'payments', jsonb_build_array(jsonb_build_object(
      'method', 'cash', 'amountPaise', (select total_paise from public.orders where id = p_order))),
    'paidAt', now(),
    'paymentBusinessDate', (select public.app_business_date(now(), o.business_day_cutover)
                              from public.outlets o
                              join public.orders r on r.outlet_id = o.id
                             where r.id = p_order))
$$;

create function pg_temp.send(
  p_fn text, p_command uuid, p_version integer, p_payload jsonb,
  p_shift uuid default '90000000-0000-4000-a000-000000000001')
returns jsonb language plpgsql volatile as $$
declare v jsonb;
begin
  execute format('select public.%I($1, $2, $3, $4, $5, $6)', p_fn)
    into v
    using p_command, p_version, public.billing_payload_hash(p_payload), now(), p_shift, p_payload;
  return v;
end;
$$;

-- A direct sale at Kalyani, as the Kalyani tablet, in version 4.
create function pg_temp.sell(p_n integer, p_lines jsonb, p_phone text, p_points integer default 0)
returns text language sql volatile as $$
  select pg_temp.send('pay_billing_now', pg_temp.id('c6200000', p_n), 4,
    pg_temp.sale_v4(pg_temp.id('c6300000', p_n),
      pg_temp.order_v4(pg_temp.id('c6000000', p_n), p_lines, p_phone, p_points))) ->> 'status'
$$;

-- Security definer so an impersonated session can name a customer it may not
-- read, the way a test hands it an id it learned elsewhere.
create function pg_temp.customer(p_phone text) returns uuid language sql stable
security definer as $$
  select id from public.customers where phone = '+91' || p_phone
$$;

create function pg_temp.balance(p_phone text) returns integer language sql stable
security definer as $$
  select public.customer_points_balance('00000000-0000-4000-a000-000000000001',
                                        pg_temp.customer(p_phone))
$$;

-- ---------------------------------------------------------------------------
-- 0. The version-4 shape hashes in SQL exactly as it does in TypeScript
--    (`src/lib/billing-command.test.ts`): a ₹139 takeaway with 10% off and 20
--    points.

select is(
  public.billing_payload_hash(jsonb_build_object(
    'orderId', '40000000-0000-4000-a000-000000000005', 'businessDate', '2026-09-28',
    'customerId', null, 'customerName', 'Asha', 'customerPhone', '+919876543210',
    'subtotalPaise', 13900, 'discountPaise', 3390, 'taxPaise', 0, 'roundingPaise', 90,
    'totalPaise', 10600, 'pricingMode', 'no_tax',
    'discounts', jsonb_build_array(
      jsonb_build_object('source', 'biller', 'basis', 'percent', 'valueBp', 1000,
        'valuePaise', null, 'amountPaise', 1390),
      jsonb_build_object('source', 'points', 'basis', 'amount', 'valueBp', null,
        'valuePaise', 2000, 'amountPaise', 2000)),
    'serviceType', 'takeaway', 'tableNumber', null,
    'lines', jsonb_build_array(jsonb_build_object(
      'id', '30000000-0000-4000-a000-000000000031',
      'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma', 'unitPricePaise', 13900, 'quantity', 1,
      'lineTotalPaise', 13900, 'discountPaise', 0, 'discountPercentBp', null,
      'categoryName', 'Shawarma', 'kind', 'item')))),
  '961c761f98acbe4988f3b69873fe84f82c0d335a253d9e4de184fb9b90589b58',
  'a version-4 order using points beside a biller discount hashes as it does in TypeScript');

-- ---------------------------------------------------------------------------
-- 1. Every outlet starts with all of it off.

select is(
  (select count(*) from public.outlets
    where points_enabled or gold_enabled or gold_counter_grant),
  0::bigint,
  'no outlet has points or gold on until somebody turns them on');

-- ---------------------------------------------------------------------------
-- 2. The settings: one narrow write, the owner or this outlet's manager.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select throws_ok($q$
  select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
    true, 5, 20000, 1000, true, 200, 5000, 6, true, 50000)
$q$, '42501', null, 'another outlet''s manager cannot set Kalyani''s points');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select throws_ok($q$
  select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
    true, 5, 20000, 1000, true, 200, 5000, 6, true, 50000)
$q$, '42501', null, 'a Biller cannot set them');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$
  select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
    true, 5, 20000, 1000, true, 200, 5000, 6, true, 50000)
$q$, '42501', null, 'an Employee cannot set them');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select throws_ok($q$
  select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
    true, 5, 20000, 1000, true, 200, 5000, 6, true, 50000)
$q$, '42501', null, 'a counter device cannot set them');

with touched as (
  update public.outlets set points_enabled = points_enabled
   where id = '00000000-0000-4000-a000-000000000001'
  returning 1)
select is(count(*), 0::bigint, 'nor write the outlet row directly') from touched;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$
  select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
    true, 5, 20000, 1000, true, 200, 500, 6, true, 50000)
$q$, '23514', null, 'a gold cap below everybody''s is refused by the table');
select throws_ok($q$
  select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
    true, 5, 20050, 1000, false, 100, null, 6, false, null)
$q$, '23514', null, 'a block that is not whole rupees is refused');
select throws_ok($q$
  select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
    false, 5, 20000, 1000, false, 100, null, 6, false, null)
$q$, '23514', null, 'points rules without points on are refused');
select throws_ok($q$
  select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
    true, 5, 20000, 1000, false, 100, null, 6, true, 50000)
$q$, '23514', null, 'billers upgrading to Gold without gold on is refused');
select throws_ok($q$
  select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
    true, 5, 20000, 1000, true, 90, 5000, 6, false, null)
$q$, '23514', null, 'a multiplier below 1x is refused');

-- Kalyani's manager turns it on: 5 points per ₹200, 10%, gold at 1x for now
-- with a 50% cap, six months, and billers may upgrade at ₹500 a month.
select is(
  (select points_enabled from public.set_outlet_loyalty_settings(
     '00000000-0000-4000-a000-000000000001',
     true, 5, 20000, 1000, true, 100, 5000, 6, true, 50000)),
  true,
  'this outlet''s manager turns points and gold on');
reset role;

select is(
  (select points_enabled or gold_enabled from public.outlets
    where id = '00000000-0000-4000-a000-000000000002'),
  false,
  'and the other outlet stays off');

-- ---------------------------------------------------------------------------
-- 3. Earning: proportional, rounded down, once.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.sell(1, jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 1), 2)), '9000000661'),
  'accepted',
  'a ₹278 sale to a customer who gave their number');
select pg_temp.commit_point();
reset role;

select is(
  (select row(kind, points, balance_after, earn_basis_paise, earn_block_paise,
              earn_points_per_block, earn_multiplier_x100)::text
     from public.customer_points_entries where bill_id = pg_temp.id('c6300000', 1)),
  '(earned,6,6,27800,20000,5,100)',
  '₹278 at 5 per ₹200 earns 6 (6.95, rounded down), and stores the rule it used');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.send('pay_billing_now', pg_temp.id('c6200000', 1), 4,
    pg_temp.sale_v4(pg_temp.id('c6300000', 1),
      pg_temp.order_v4(pg_temp.id('c6000000', 1),
        jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 1), 2)), '9000000661')))
    ->> 'status',
  'replay',
  'the outbox sends it again');
select pg_temp.commit_point();
reset role;

select is(
  (select count(*) from public.customer_points_entries
    where customer_id = pg_temp.customer('9000000661')),
  1::bigint,
  'and it earned once');

-- A sale with no number earns nothing and writes nothing.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.sell(2, jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 2), 2)), null),
  'accepted', 'a sale with no number');
select pg_temp.commit_point();
reset role;
select is(
  (select count(*) from public.customer_points_entries where bill_id = pg_temp.id('c6300000', 2)),
  0::bigint,
  'writes no ledger row');

-- ---------------------------------------------------------------------------
-- 4. The till is told the balance here, net of its open orders here.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  (select points_balance from public.customer_lookup_by_phone('9000000661')),
  6,
  'the counter reads the balance it just earned');

-- An order holding 5 points, with a 10% biller discount before them.
select is(
  pg_temp.send('create_billing_order', pg_temp.id('c6200000', 3), 4,
    pg_temp.order_v4(pg_temp.id('c6000000', 3),
      jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 3), 2)), '9000000661', 5, 1000))
    ->> 'status',
  'accepted',
  'an order uses 5 points beside a 10% discount');
select is(
  (select points_balance from public.customer_lookup_by_phone('9000000661')),
  1,
  'while it is open, its points are not offered again');
reset role;

select is(
  (select row(source, basis, value_paise, amount_paise)::text
     from public.order_discounts
    where order_id = pg_temp.id('c6000000', 3) and source = 'points'),
  '(points,amount,500,500)',
  'the order holds the points as its own discount row');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.send('pay_billing_order', pg_temp.id('c6200000', 4), 4,
    pg_temp.pay_payload(pg_temp.id('c6000000', 3), pg_temp.id('c6300000', 3))) ->> 'status',
  'accepted',
  'the order is paid');
select pg_temp.commit_point();
reset role;

select is(
  (select string_agg(kind || ':' || points || ':' || balance_after, ',' order by balance_after)
     from public.customer_points_entries where bill_id = pg_temp.id('c6300000', 3)),
  'used:-5:1,earned:6:7',
  'the bill uses 5, then earns 6 on ₹250.20 — what it came to before points');
select is(
  (select earn_basis_paise from public.customer_points_entries
    where bill_id = pg_temp.id('c6300000', 3) and kind = 'earned'),
  25020::bigint,
  'the basis is after the biller''s discount and before the points');
select is(
  (select source from public.bill_discounts
    where bill_id = pg_temp.id('c6300000', 3) and amount_paise = 500),
  'points'::public.discount_row_source,
  'paying carries the points row onto the bill as points');

-- ---------------------------------------------------------------------------
-- 5. The receipt reads the ledger, and its rows still add up.

select is(
  public.bill_public_points(pg_temp.id('c6300000', 3)),
  '{"used": 5, "earned": 6, "balance": 7}'::jsonb,
  'the receipt carries what the bill used, what it earned and the balance it left');
select is(
  (select count(*) from jsonb_array_elements(public.bill_public_discount_rows(pg_temp.id('c6300000', 3))) r
    where r ->> 'source' = 'points' and (r ->> 'amount_paise')::bigint = 500),
  1::bigint,
  'and prints the points as their own row');
select is(
  (select sum((r ->> 'amount_paise')::bigint)::bigint
     from jsonb_array_elements(public.bill_public_discount_rows(pg_temp.id('c6300000', 3))) r),
  (select discount_paise from public.bills where id = pg_temp.id('c6300000', 3)),
  'the printed rows add up to the discount the bill stored');
select is(
  public.bill_public_points(pg_temp.id('c6300000', 2)),
  null,
  'a bill with no points has no points section');

-- ---------------------------------------------------------------------------
-- 6. A void takes back what the bill earned and returns what it used.

select pg_temp.as_server();
update public.bills
   set status = 'void', voided_at = now(), void_reason = 'test (synthetic)',
       voided_by = '10000000-0000-4000-a000-000000000002', void_kind = 'manager_void'
 where id = pg_temp.id('c6300000', 3);

select is(
  (select string_agg(kind || ':' || points, ',' order by kind)
     from public.customer_points_entries
    where bill_id = pg_temp.id('c6300000', 3) and kind in ('earned_reversed', 'used_returned')),
  'earned_reversed:-6,used_returned:5',
  'the void writes both reversals');
select is(pg_temp.balance('9000000661'), 6, 'and the balance is what it was before the bill');
select is(
  public.bill_public_points(pg_temp.id('c6300000', 3)),
  '{"used": 5, "earned": 6, "balance": 7}'::jsonb,
  'a voided bill''s receipt keeps the figures it was sold with');

-- ---------------------------------------------------------------------------
-- 7. The boundary checks a points row's shape, and deliberately not the
--    balance or the cap.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

-- 10 points against a balance of 6, on a ₹139 bill with a 10% cap of ₹13.
select is(
  pg_temp.sell(5, jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 5))), '9000000661', 10),
  'accepted',
  'points beyond the balance are accepted: refusing them would refuse a paid sale');
select pg_temp.commit_point();
reset role;
select is(
  (select string_agg(kind || ':' || points || ':' || balance_after, ',' order by balance_after)
     from public.customer_points_entries where bill_id = pg_temp.id('c6300000', 5)),
  'used:-10:-4,earned:3:-1',
  'and the ledger records what happened, the balance going negative');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  (select points_balance from public.customer_lookup_by_phone('9000000661')),
  -1,
  'the counter sees the negative balance, and has nothing to use');

create function pg_temp.refused(p_n integer, p_version integer, p_payload jsonb)
returns text language sql volatile as $$
  select pg_temp.send('pay_billing_now', pg_temp.id('c6200000', p_n), p_version,
    pg_temp.sale_v4(pg_temp.id('c6300000', p_n), p_payload)) ->> 'status'
$$;

-- Each case edits a well-formed payload in one place.
create function pg_temp.good(p_n integer) returns jsonb language sql stable as $$
  select pg_temp.order_v4(pg_temp.id('c6000000', p_n),
    jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', p_n), 2)), '9000000661', 5)
$$;

create function pg_temp.with_points_row(p jsonb, p_row jsonb) returns jsonb
language sql immutable as $$
  select p || jsonb_build_object('discounts', jsonb_build_array(p_row))
$$;

select is(
  pg_temp.refused(10, 4, pg_temp.with_points_row(pg_temp.good(10), jsonb_build_object(
    'source', 'points', 'basis', 'percent', 'valueBp', 180, 'valuePaise', null,
    'amountPaise', 500))),
  'malformed_payload', 'a points row given as a percentage is malformed');
select is(
  pg_temp.refused(11, 4, pg_temp.good(11) || jsonb_build_object(
    'discountPaise', 550, 'roundingPaise', 50, 'discounts', jsonb_build_array(jsonb_build_object(
      'source', 'points', 'basis', 'amount', 'valueBp', null,
      'valuePaise', 550, 'amountPaise', 550)))),
  'malformed_payload', 'a points row that is not whole rupees is malformed');
select is(
  pg_temp.refused(12, 4, pg_temp.with_points_row(pg_temp.good(12), jsonb_build_object(
    'source', 'points', 'basis', 'amount', 'valueBp', null,
    'valuePaise', 600, 'amountPaise', 500))),
  'malformed_payload', 'a points row whose value is not its amount is malformed');
select is(
  pg_temp.refused(13, 4, pg_temp.good(13) || jsonb_build_object(
    'discountPaise', 1000, 'discounts', jsonb_build_array(
      jsonb_build_object('source', 'points', 'basis', 'amount', 'valueBp', null,
        'valuePaise', 500, 'amountPaise', 500),
      jsonb_build_object('source', 'points', 'basis', 'amount', 'valueBp', null,
        'valuePaise', 500, 'amountPaise', 500)),
    'roundingPaise', 0, 'totalPaise', 26800)),
  'malformed_payload', 'two points rows on one bill are malformed');
select is(
  pg_temp.refused(14, 4, pg_temp.good(14) || jsonb_build_object('customerPhone', null)),
  'malformed_payload', 'points without a customer are malformed');
select is(
  pg_temp.refused(15, 4, pg_temp.order_v4(pg_temp.id('c6000000', 15),
    jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 15))), '9000000661', 139)),
  'malformed_payload', 'points that would pay the last rupee are malformed');
select is(
  pg_temp.refused(16, 4, pg_temp.with_points_row(pg_temp.good(16), jsonb_build_object(
    'source', 'coupon', 'basis', 'amount', 'valueBp', null,
    'valuePaise', 500, 'amountPaise', 500))),
  'malformed_payload', 'a source nobody has written is malformed');

-- A version-3 envelope is the till before points: an entry naming a source
-- was not written by it.
select is(
  pg_temp.refused(17, 3, pg_temp.good(17)),
  'malformed_payload', 'a version-3 payload carrying a source is malformed');
select is(
  pg_temp.refused(18, 3, pg_temp.order_v4(pg_temp.id('c6000000', 18),
    jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 18))), '9000000661')),
  'accepted', 'while a version-3 payload with no source settles as it always did');
-- And a version-4 entry with no source is the biller's.
select is(
  pg_temp.refused(19, 4, pg_temp.order_v4(pg_temp.id('c6000000', 19),
    jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 19))), '9000000661', 0, 1000)
    #- '{discounts,0,source}'),
  'accepted', 'a version-4 entry without a source is accepted');
select pg_temp.commit_point();
reset role;
select is(
  (select source from public.bill_discounts where bill_id = pg_temp.id('c6300000', 19)),
  'biller'::public.discount_row_source,
  'and recorded as the biller''s');

select is(
  (select count(*) from public.bills
    where id in (pg_temp.id('c6300000', 10), pg_temp.id('c6300000', 11), pg_temp.id('c6300000', 12),
                 pg_temp.id('c6300000', 13), pg_temp.id('c6300000', 14), pg_temp.id('c6300000', 15),
                 pg_temp.id('c6300000', 16), pg_temp.id('c6300000', 17))),
  0::bigint,
  'no refused payload wrote a bill');

-- The table holds the shape even against the server's own writes.
select throws_ok($q$
  insert into public.bill_discounts (bill_id, outlet_id, basis, value_bp, value_paise, amount_paise, source)
  values ('c6300000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
          'percent', 1000, null, 2780, 'points')
$q$, '23514', null, 'the table refuses a points row that is not an amount');

-- ---------------------------------------------------------------------------
-- 8. Points off: nothing earned, and the till told nothing.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000005');
select is(
  pg_temp.send('pay_billing_now', pg_temp.id('c6200000', 30), 4,
    pg_temp.sale_v4(pg_temp.id('c6300000', 30),
      pg_temp.order_v4(pg_temp.id('c6000000', 30),
        jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 30), 2,
          '32000000-0000-4000-a000-000000000001')),
        '9000000661', 0, null, '00000000-0000-4000-a000-000000000002')),
    '90000000-0000-4000-a000-000000000002') ->> 'status',
  'accepted',
  'the same customer buys at Kanchrapara, which has points off');
select pg_temp.commit_point();
select is(
  (select points_balance from public.customer_lookup_by_phone('9000000661')),
  null,
  'Kanchrapara''s till is told no balance at all, not Kalyani''s');
select is(
  (select gold_eligible from public.customer_lookup_by_phone('9000000661')),
  false,
  'and nobody is eligible for gold there');
reset role;
select is(
  (select count(*) from public.customer_points_entries where bill_id = pg_temp.id('c6300000', 30)),
  0::bigint,
  'and that bill earned nothing');

-- ---------------------------------------------------------------------------
-- 9. Only the owner and the outlet's own managers read the ledger.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select is((select count(*) from public.customer_points_entries), 0::bigint,
  'Kanchrapara''s manager reads none of Kalyani''s points');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is((select count(*) from public.customer_points_entries), 0::bigint,
  'a counter device reads none, even its own outlet''s');
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select is((select count(*) from public.customer_points_entries), 0::bigint,
  'nor does a Biller');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select is((select count(*) from public.customer_points_entries), 0::bigint,
  'nor an Employee');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select ok((select count(*) from public.customer_points_entries) > 0,
  'Kalyani''s manager reads Kalyani''s');
select throws_ok($q$
  insert into public.customer_points_entries (outlet_id, customer_id, bill_id, kind, points, balance_after)
  values ('00000000-0000-4000-a000-000000000001',
          (select customer_id from public.bills where id = 'c6300000-0000-4000-a000-000000000001'),
          'c6300000-0000-4000-a000-000000000001', 'used', -1, 5)
$q$, '42501', null, 'and writes none by hand');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select ok((select count(*) from public.customer_points_entries) > 0, 'as does the owner');
reset role;

select pg_temp.as_server();
select throws_ok($q$
  update public.customer_points_entries set points = 100
   where bill_id = 'c6300000-0000-4000-a000-000000000001'
$q$, null, null, 'even the server cannot rewrite a ledger row');
select throws_ok($q$
  delete from public.customer_points_entries
   where bill_id = 'c6300000-0000-4000-a000-000000000001'
$q$, null, null, 'or delete one');

-- ---------------------------------------------------------------------------
-- 10. Gold: eligibility, the counter's grant, the stored end, the multiplier.

-- A new customer spends ₹417 at Kalyani, under the ₹500 threshold.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.sell(40, jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 40), 3)), '9000000671'),
  'accepted', 'a new customer spends ₹417');
select pg_temp.commit_point();
select is(
  (select gold_eligible from public.customer_lookup_by_phone('9000000671')),
  false,
  'which is under the threshold');
select throws_ok(
  format('select * from public.customer_gold_grant_at_counter(%L)', pg_temp.customer('9000000671')),
  '23514', null, 'and the counter cannot upgrade them');
reset role;

-- The threshold at exactly what they have paid.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
  true, 5, 20000, 1000, true, 200, 5000, 6, true, 41700);
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  (select gold_eligible from public.customer_lookup_by_phone('9000000671')),
  true,
  'at exactly the threshold they are eligible');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
  true, 5, 20000, 1000, true, 200, 5000, 6, true, 41800);
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  (select gold_eligible from public.customer_lookup_by_phone('9000000671')),
  false,
  'a rupee under it they are not');
reset role;

-- Another ₹139 takes them past ₹500; the threshold goes back to ₹500.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
  true, 5, 20000, 1000, true, 200, 5000, 6, true, 50000);
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.sell(41, jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 41))), '9000000671'),
  'accepted', 'they spend another ₹139');
select pg_temp.commit_point();
select is(
  (select gold_eligible from public.customer_lookup_by_phone('9000000671')),
  true,
  'and are eligible for gold here');

-- Other callers cannot grant it.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000005');
select throws_ok(
  format('select * from public.customer_gold_grant_at_counter(%L)', pg_temp.customer('9000000671')),
  '23514', null, 'Kanchrapara''s tablet cannot upgrade Kalyani''s regular');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok(
  format('select * from public.customer_gold_grant_at_counter(%L)', pg_temp.customer('9000000671')),
  '42501', null, 'an Employee cannot');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok(
  format('select * from public.customer_gold_grant_at_counter(%L)', pg_temp.customer('9000000671')),
  '42501', null, 'a manager off the counter is not the counter');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  (select is_member from public.customer_gold_grant_at_counter(pg_temp.customer('9000000671'))),
  true,
  'Kalyani''s tablet upgrades them to Gold');
select is(
  (select row(is_member, gold_eligible)::text
     from public.customer_gold_grant_at_counter(pg_temp.customer('9000000671'))),
  '(t,f)',
  'a second tap answers as the first did, and they are no longer "eligible"');
select throws_ok(
  format('select * from public.customer_membership_revoke(%L, %L)',
    '00000000-0000-4000-a000-000000000001', pg_temp.customer('9000000671')),
  '42501', null, 'and no counter can take gold back');
reset role;

select is(
  (select row(granted_via, counter_device_id, granted_by,
              expires_at = granted_at + interval '6 months')::text
     from public.customer_memberships where customer_id = pg_temp.customer('9000000671')),
  '(counter,10000000-0000-4000-a000-000000000004,10000000-0000-4000-a000-00000000000a,t)',
  'the spell records the counter, the tablet, the biller on its shift, and six months');
select is(
  (select count(*) from public.customer_memberships where customer_id = pg_temp.customer('9000000671')),
  1::bigint,
  'and there is one spell, however often it was tapped');

-- A later change to the duration moves no existing grant.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select public.set_outlet_loyalty_settings('00000000-0000-4000-a000-000000000001',
  true, 5, 20000, 1000, true, 200, 5000, 12, true, 50000);
reset role;
select is(
  (select expires_at = granted_at + interval '6 months'
     from public.customer_memberships where customer_id = pg_temp.customer('9000000671')),
  true,
  'the end date is the one the grant stored');

-- A gold member earns at the multiplier (now 2x): ₹139 earns 6, not 3.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.sell(42, jsonb_build_array(pg_temp.shawarma(pg_temp.id('c6100000', 42))), '9000000671'),
  'accepted', 'the gold member buys again');
select pg_temp.commit_point();
reset role;
select is(
  (select row(points, earn_multiplier_x100)::text from public.customer_points_entries
    where bill_id = pg_temp.id('c6300000', 42) and kind = 'earned'),
  '(6,200)',
  'and earns twice the rate, recording the multiplier it used');

-- Gold is Kalyani's: Kanchrapara's till is not told they are gold.
select pg_temp.as_server();
update public.outlets set gold_enabled = true where id = '00000000-0000-4000-a000-000000000002';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000005');
select is(
  (select is_member from public.customer_lookup_by_phone('9000000671')),
  false,
  'another outlet, even with gold on, does not see Kalyani''s gold');
reset role;

-- A spell past its stored end is not gold, and writes nothing to lapse.
select pg_temp.as_server();
insert into public.customer_memberships
  (customer_id, outlet_id, granted_at, granted_by, expires_at)
values (pg_temp.customer('9000000661'), '00000000-0000-4000-a000-000000000001',
        now() - interval '7 months', '10000000-0000-4000-a000-000000000001',
        now() - interval '1 month');
select is(
  public.customer_tier_at(pg_temp.customer('9000000661'), '00000000-0000-4000-a000-000000000001', now()),
  null,
  'gold that ended last month is not gold now');
select is(
  public.customer_tier_at(pg_temp.customer('9000000661'), '00000000-0000-4000-a000-000000000001',
    now() - interval '2 months'),
  'gold'::public.customer_tier,
  'though it was, before its end');

-- Turning gold off makes nobody gold there, and turning it back on restores
-- the spells still inside their own end.
update public.outlets
   set gold_counter_grant = false, gold_threshold_paise = null,
       points_gold_use_cap_bp = null, gold_enabled = false
 where id = '00000000-0000-4000-a000-000000000001';
select is(
  public.customer_is_member(pg_temp.customer('9000000671'), '00000000-0000-4000-a000-000000000001'),
  false,
  'with gold off, nobody is gold at the outlet');
update public.outlets
   set gold_enabled = true, points_gold_use_cap_bp = 5000
 where id = '00000000-0000-4000-a000-000000000001';
select is(
  public.customer_is_member(pg_temp.customer('9000000671'), '00000000-0000-4000-a000-000000000001'),
  true,
  'and back on, the spell still inside its end counts again');

-- ---------------------------------------------------------------------------
-- 11. The management path: one outlet, its spells, its ledger.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is(
  (select row(granted_via, granted_by_name is not null, member_until is not null)::text
     from public.customer_directory_card('00000000-0000-4000-a000-000000000001',
            pg_temp.customer('9000000671'))),
  '(counter,t,t)',
  'the card says gold was given at the counter, by whom, and until when');
select is(
  (select points_balance from public.customer_directory_card('00000000-0000-4000-a000-000000000001',
            pg_temp.customer('9000000671'))),
  pg_temp.balance('9000000671'),
  'and the balance here');
select ok(
  (select count(*) from public.customer_directory_list(
     '00000000-0000-4000-a000-000000000001', 'members', 0, 'visits')) >= 1,
  'the gold list reads in recent-visits order');
select throws_ok($q$
  select * from public.customer_directory_list('00000000-0000-4000-a000-000000000001', 'members', 0, 'money')
$q$, '22023', null, 'and in no order nobody offered');
select is(
  (select count(*) from public.customer_memberships
    where outlet_id = '00000000-0000-4000-a000-000000000002'),
  0::bigint,
  'the manager reads no other outlet''s spells');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select is(
  (select count(*) from public.customer_memberships), 0::bigint,
  'and the other outlet''s manager reads none of Kalyani''s');
reset role;

-- ---------------------------------------------------------------------------
-- 12. A bill outside the thirty days counts for nothing.
--
-- Last, because it is written directly as the server would and never meets a
-- commit point: its deferred checks would ask for payments this test does not
-- write.

select pg_temp.as_server();
insert into public.customers (id, phone, name)
values ('80000000-0000-4000-a000-000000000681', '+919000000681', 'Long Ago');
insert into public.bills
  (id, outlet_id, business_date, biller_profile_id, counter_device_id, shift_id,
   customer_id, subtotal_paise, discount_paise, total_paise, payment_method, status, created_at,
   ordered_at, paid_at)
values ('c6300000-0000-4000-a000-000000000681', '00000000-0000-4000-a000-000000000001',
        public.app_business_date(now() - interval '30 days', time '04:00'),
        '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
        '40000000-0000-4000-a000-000000000002',
        '80000000-0000-4000-a000-000000000681', 100000, 0, 100000, 'cash', 'settled',
        now() - interval '30 days', now() - interval '30 days', now() - interval '30 days');
update public.outlets set gold_counter_grant = true, gold_threshold_paise = 50000
 where id = '00000000-0000-4000-a000-000000000001';
select is(
  public.customer_gold_eligible('00000000-0000-4000-a000-000000000001',
    '80000000-0000-4000-a000-000000000681'),
  false,
  '₹1,000 paid thirty business days ago, just outside the window, makes nobody eligible');

select * from finish();
rollback;
