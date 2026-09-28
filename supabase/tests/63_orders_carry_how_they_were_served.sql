-- each-outlet-chooses-how-it-serves (#60), section 4: orders and bills carry
-- how they were served.
--
-- What this file has to prove, and how each claim fails differently:
--
--   * the type, the table and each line's kind are snapshots that the command
--     boundary checks for shape only, never against the outlet's current
--     choices — a check against the settings would pass every online test and
--     refuse an offline tablet's real sale;
--   * a packaging line is checked like a menu line: its shape always, and a new
--     one's price against the outlet's charge — an existing one keeps the price
--     it was captured at;
--   * a till holding version-1 and version-2 work across the release settles it
--     exactly once, read as neither, no table, every line an item;
--   * two open orders on one table are recorded, never refused — a refusal
--     would pass every test here and strand a paid sale in the room;
--   * the facts are read exactly where their rows are read.
--
-- The TypeScript half of the version-3 hash vector is in
-- `src/lib/billing-command.test.ts`.

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

--   outlets  00000000-…0001 Kalyani   00000000-…0002 Kanchrapara
--   people   10000000-…0003 fa_kanchrapara
--            …0004 device_kalyani (live shift 90000000-…0001)
--            …0005 device_kanchrapara (live shift 90000000-…0002)
--   menu     31000000-…0001 Classic Chicken Shawarma, ₹139, at Kalyani

create function pg_temp.id(p_prefix text, p_n integer) returns uuid
language sql immutable as $$
  select (p_prefix || '-0000-4000-a000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
-- b6000000 orders, b6100000 lines, b6200000 commands, b6300000 bills

create function pg_temp.shawarma(
  p_line uuid, p_quantity integer default 1,
  p_discount bigint default 0, p_percent_bp integer default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', p_line, 'menuItemId', '31000000-0000-4000-a000-000000000001',
    'itemName', 'Classic Chicken Shawarma', 'unitPricePaise', 13900,
    'quantity', p_quantity, 'lineTotalPaise', 13900 * p_quantity,
    'discountPaise', p_discount, 'discountPercentBp', p_percent_bp,
    'categoryName', 'Shawarma', 'kind', 'item')
$$;

create function pg_temp.bags(
  p_line uuid, p_quantity integer, p_waived boolean default false, p_price bigint default 500)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', p_line, 'menuItemId', null, 'itemName', 'Packaging',
    'unitPricePaise', p_price, 'quantity', p_quantity,
    'lineTotalPaise', p_price * p_quantity,
    'discountPaise', case when p_waived then p_price * p_quantity else 0 end,
    'discountPercentBp', case when p_waived then 10000 end,
    'categoryName', null, 'kind', 'packaging')
$$;

-- A version-3 order payload whose figures add up by construction, so a refusal
-- below is about the fact under test and never about the arithmetic.
create function pg_temp.order_v3(
  p_order uuid, p_service text, p_table integer, p_lines jsonb,
  p_bill_bp integer default null,
  p_outlet uuid default '00000000-0000-4000-a000-000000000001')
returns jsonb language plpgsql stable as $$
declare
  v_subtotal bigint;
  v_line_discount bigint;
  v_bill_discount bigint := 0;
  v_discounts jsonb := '[]'::jsonb;
  v_net bigint;
  v_total bigint;
begin
  select coalesce(sum((l ->> 'lineTotalPaise')::bigint), 0),
         coalesce(sum((l ->> 'discountPaise')::bigint), 0)
    into v_subtotal, v_line_discount
    from jsonb_array_elements(p_lines) l;
  if p_bill_bp is not null then
    v_bill_discount := round(v_subtotal * p_bill_bp / 10000.0)::bigint;
    v_discounts := jsonb_build_array(jsonb_build_object(
      'basis', 'percent', 'valueBp', p_bill_bp, 'valuePaise', null,
      'amountPaise', v_bill_discount));
  end if;
  v_net := v_subtotal - v_line_discount - v_bill_discount;
  v_total := greatest(100, ceil(v_net::numeric / 100)::bigint * 100);
  return jsonb_build_object(
    'orderId', p_order,
    'businessDate', (select public.app_business_date(now(), business_day_cutover)
                       from public.outlets where id = p_outlet),
    'customerId', null, 'customerName', null, 'customerPhone', null,
    'subtotalPaise', v_subtotal, 'discountPaise', v_line_discount + v_bill_discount,
    'taxPaise', 0, 'roundingPaise', v_total - v_net, 'totalPaise', v_total,
    'pricingMode', 'no_tax', 'discounts', v_discounts, 'lines', p_lines,
    'serviceType', p_service, 'tableNumber', p_table);
end;
$$;

-- The same order as a till queued it before this release.
create function pg_temp.as_v2(p jsonb) returns jsonb language sql immutable as $$
  select (p - 'serviceType' - 'tableNumber')
    || jsonb_build_object('lines',
         (select jsonb_agg(l - 'kind') from jsonb_array_elements(p -> 'lines') l))
$$;

create function pg_temp.as_v1(p jsonb) returns jsonb language sql immutable as $$
  select (pg_temp.as_v2(p) - 'roundingPaise' - 'discounts')
    || jsonb_build_object('lines',
         (select jsonb_agg(l - 'kind' - 'discountPaise' - 'discountPercentBp' - 'categoryName')
            from jsonb_array_elements(p -> 'lines') l))
$$;

-- A direct sale: the order's content, paid on the spot.
create function pg_temp.sale_v3(p_bill uuid, p_service text, p_table integer, p_lines jsonb)
returns jsonb language plpgsql stable as $$
declare v jsonb := pg_temp.order_v3(p_bill, p_service, p_table, p_lines);
begin
  return (v - 'orderId') || jsonb_build_object(
    'billId', p_bill,
    'paymentBusinessDate', v -> 'businessDate',
    'payments', jsonb_build_array(jsonb_build_object(
      'method', 'cash', 'amountPaise', v -> 'totalPaise')));
end;
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

-- Any billing command, as whichever device is impersonated.
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

create function pg_temp.create_v3(p_n integer, p_service text, p_table integer, p_lines jsonb)
returns text language sql volatile as $$
  select pg_temp.send('create_billing_order', pg_temp.id('b6200000', p_n), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', p_n), p_service, p_table, p_lines)) ->> 'status'
$$;

create function pg_temp.order_written(p_n integer) returns bigint language sql as $$
  select count(*) from public.orders where id = pg_temp.id('b6000000', p_n)
$$;

-- ---------------------------------------------------------------------------
-- 0. The version-3 shape hashes in SQL exactly as it does in TypeScript
--    (`src/lib/billing-command.test.ts`). Two implementations of one rule, and
--    only a shared vector holds them together.

create function pg_temp.shawarma_vector() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', '30000000-0000-4000-a000-000000000031',
    'menuItemId', '31000000-0000-4000-a000-000000000001',
    'itemName', 'Classic Chicken Shawarma', 'unitPricePaise', 13900, 'quantity', 1,
    'lineTotalPaise', 13900, 'discountPaise', 0, 'discountPercentBp', null,
    'categoryName', 'Shawarma', 'kind', 'item')
$$;

create function pg_temp.takeaway_vector() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'orderId', '40000000-0000-4000-a000-000000000003', 'businessDate', '2026-09-28',
    'customerId', null, 'customerName', 'Asha', 'customerPhone', '+919876543210',
    'subtotalPaise', 14900, 'discountPaise', 1000, 'taxPaise', 0, 'roundingPaise', 0,
    'totalPaise', 13900, 'pricingMode', 'no_tax', 'discounts', '[]'::jsonb,
    'serviceType', 'takeaway', 'tableNumber', null,
    'lines', jsonb_build_array(pg_temp.shawarma_vector(), jsonb_build_object(
      'id', '30000000-0000-4000-a000-000000000032', 'menuItemId', null,
      'itemName', 'Packaging', 'unitPricePaise', 500, 'quantity', 2,
      'lineTotalPaise', 1000, 'discountPaise', 1000, 'discountPercentBp', 10000,
      'categoryName', null, 'kind', 'packaging')))
$$;

select is(
  public.billing_payload_hash(pg_temp.takeaway_vector()),
  'f248fc64bb6b24d3e92bd37fdfdd59bae3b04c97456c2ea6cde61a5489e1535c',
  'a version-3 gold takeaway with its waived bags hashes as it does in TypeScript');

select is(
  public.billing_payload_hash(pg_temp.takeaway_vector() || jsonb_build_object(
    'orderId', '40000000-0000-4000-a000-000000000004',
    'serviceType', 'dine_in', 'tableNumber', 4,
    'subtotalPaise', 13900, 'discountPaise', 0,
    'lines', jsonb_build_array(pg_temp.shawarma_vector()))),
  '213a531bb9610dfb0f1df506528c207835fe4f53a93398d16933c04b94864bae',
  'and so does a version-3 dine-in order at table 4');

-- Kalyani offers everything: both types, keyed tables, ₹5 a bag, free for gold.
select pg_temp.as_server();
update public.outlets
   set dine_in_offered = true, takeaway_offered = true, table_numbers = true,
       packaging_mode = 'per_bag', packaging_price_paise = 500, packaging_free_for_gold = true
 where id = '00000000-0000-4000-a000-000000000001';

-- ---------------------------------------------------------------------------
-- 1. The facts have somewhere to go.

select has_column('public', 'orders', 'service_type', 'an order records how it was served');
select has_column('public', 'orders', 'table_number', 'an order records its table');
select has_column('public', 'orders', 'table_shared', 'an order records that it shared its table');
select has_column('public', 'bills', 'service_type', 'a bill records how it was served');
select has_column('public', 'bills', 'table_number', 'a bill records its table');
select has_column('public', 'order_items', 'kind', 'an order line says what it is');
select has_column('public', 'bill_items', 'kind', 'a bill line says what it is');
select col_not_null('public', 'order_items', 'kind', 'every order line is one kind or the other');
select col_not_null('public', 'orders', 'table_shared', 'an order either shared its table or did not');
select ok(
  (select column_default like '''item''::%line_kind'
     from information_schema.columns
    where table_schema = 'public' and table_name = 'bill_items' and column_name = 'kind'),
  'a line is an item unless it says otherwise');

-- ---------------------------------------------------------------------------
-- 2. A dine-in order at a table, and a takeaway with its bags.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select is(
  pg_temp.create_v3(1, 'dine_in', 4, jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 1)))),
  'accepted', 'a dine-in order for table 4 is accepted');

select is(
  pg_temp.create_v3(18, 'takeaway', null, jsonb_build_array(
    pg_temp.shawarma(pg_temp.id('b6100000', 18)),
    pg_temp.bags(pg_temp.id('b6100000', 180), 2))),
  'accepted', 'a takeaway with two bags is accepted');

select is(
  pg_temp.create_v3(19, 'takeaway', null, jsonb_build_array(
    pg_temp.shawarma(pg_temp.id('b6100000', 19)),
    pg_temp.bags(pg_temp.id('b6100000', 190), 1, true))),
  'accepted', 'a gold member''s takeaway, its bag waived, is accepted');

select pg_temp.as_server();

select is(
  (select row(service_type::text, table_number)::text from public.orders
    where id = pg_temp.id('b6000000', 1)),
  row('dine_in'::text, 4)::text,
  'the order stores dine-in at table 4');

select is(
  (select row(kind::text, menu_item_id, category_name, item_name, unit_price_paise, quantity)::text
     from public.order_items where id = pg_temp.id('b6100000', 180)),
  row('packaging'::text, null::uuid, null::text, 'Packaging'::text, 500::bigint, 2)::text,
  'the bags are one packaging line: no menu item, no category, ₹5 each, two of them');

select is(
  (select kind::text from public.order_items where id = pg_temp.id('b6100000', 18)),
  'item', 'and the shawarma beside them is an item');

select is(
  (select row(i.discount_paise, i.discount_percent_bp, o.discount_paise)::text
     from public.order_items i join public.orders o on o.id = i.order_id
    where i.id = pg_temp.id('b6100000', 190)),
  row(500::bigint, 10000, 500::bigint)::text,
  'the waiver is the bag''s whole discount at 100%, and counts in the order''s discount');

select lives_ok('set constraints all immediate',
  'and the order''s discount still equals its parts, the waiver among them');
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- 3. Shapes the boundary refuses, and nothing is written for any of them.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select is(pg_temp.create_v3(2, 'takeaway', 5,
  jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 2)))),
  'malformed_payload', 'a table on a takeaway is refused');
select is(pg_temp.create_v3(3, 'dine_in', 0,
  jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 3)))),
  'malformed_payload', 'table 0 is refused');
select is(pg_temp.create_v3(4, 'dine_in', 1000,
  jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 4)))),
  'malformed_payload', 'table 1000 is refused');
select is(pg_temp.create_v3(5, 'delivery', null,
  jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 5)))),
  'malformed_payload', 'a type nobody defined is refused');
select is(pg_temp.create_v3(6, 'takeaway', null, jsonb_build_array(
  pg_temp.shawarma(pg_temp.id('b6100000', 6)),
  pg_temp.bags(pg_temp.id('b6100000', 60), 1),
  pg_temp.bags(pg_temp.id('b6100000', 61), 1))),
  'malformed_payload', 'two packaging lines are refused');
select is(pg_temp.create_v3(7, 'takeaway', null, jsonb_build_array(
  pg_temp.bags(pg_temp.id('b6100000', 7), 1)
    || '{"menuItemId":"31000000-0000-4000-a000-000000000001"}')),
  'malformed_payload', 'a packaging line naming a menu item is refused');
select is(pg_temp.create_v3(8, 'takeaway', null, jsonb_build_array(
  pg_temp.bags(pg_temp.id('b6100000', 8), 1) || '{"categoryName":"Shawarma"}')),
  'malformed_payload', 'a packaging line in a category is refused, so no menu discount reaches it');
select is(pg_temp.create_v3(9, 'takeaway', null, jsonb_build_array(
  pg_temp.shawarma(pg_temp.id('b6100000', 9)),
  pg_temp.bags(pg_temp.id('b6100000', 90), 1)
    || '{"discountPaise":250,"discountPercentBp":5000}')),
  'malformed_payload', 'a packaging line discounted by less than its whole is refused');
select is(pg_temp.create_v3(10, 'takeaway', null, jsonb_build_array(
  pg_temp.shawarma(pg_temp.id('b6100000', 10)),
  pg_temp.bags(pg_temp.id('b6100000', 100), 1) || '{"itemName":"Bag"}')),
  'malformed_payload', 'a packaging line under another name is refused');
select is(pg_temp.create_v3(11, 'takeaway', null, jsonb_build_array(
  pg_temp.shawarma(pg_temp.id('b6100000', 11)),
  pg_temp.bags(pg_temp.id('b6100000', 110), 1, true) || '{"discountPercentBp":null}')),
  'malformed_payload', 'a waiver that does not say 100% is refused');
select is(pg_temp.create_v3(12, 'dine_in', null, jsonb_build_array(
  pg_temp.shawarma(pg_temp.id('b6100000', 12), 1, 13900, 10000) || '{"categoryName":null}')),
  'malformed_payload', 'an item given away at 100% with no category, as a waiver would be, is refused');
select is(pg_temp.create_v3(13, null, null, jsonb_build_array(
  pg_temp.shawarma(pg_temp.id('b6100000', 13)) || '{"kind":"gift"}')),
  'malformed_payload', 'a line kind nobody defined is refused');

-- A new packaging line is priced like a new menu line: at what the outlet
-- charges now, or not at all.
select is(pg_temp.create_v3(14, 'takeaway', null, jsonb_build_array(
  pg_temp.shawarma(pg_temp.id('b6100000', 14)),
  pg_temp.bags(pg_temp.id('b6100000', 140), 1, false, 400))),
  'arithmetic_invalid', 'a new bag at a price the outlet does not charge is refused');

select pg_temp.as_server();
select is(
  (select count(*) from public.orders
    where id in (select pg_temp.id('b6000000', n) from generate_series(2, 14) n)),
  0::bigint, 'and not one of the refused orders was written');

update public.outlets set packaging_mode = 'per_order', packaging_price_paise = 1000
 where id = '00000000-0000-4000-a000-000000000001';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(pg_temp.create_v3(15, 'takeaway', null, jsonb_build_array(
  pg_temp.shawarma(pg_temp.id('b6100000', 15)),
  pg_temp.bags(pg_temp.id('b6100000', 150), 2, false, 1000))),
  'arithmetic_invalid', 'a flat charge counted twice is refused');
select is(pg_temp.create_v3(16, 'takeaway', null, jsonb_build_array(
  pg_temp.shawarma(pg_temp.id('b6100000', 16)),
  pg_temp.bags(pg_temp.id('b6100000', 160), 1, false, 1000))),
  'accepted', 'the flat charge, once, is accepted');

select pg_temp.as_server();
update public.outlets set packaging_mode = 'off', packaging_price_paise = null,
       packaging_free_for_gold = false
 where id = '00000000-0000-4000-a000-000000000001';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(pg_temp.create_v3(17, 'takeaway', null, jsonb_build_array(
  pg_temp.shawarma(pg_temp.id('b6100000', 17)),
  pg_temp.bags(pg_temp.id('b6100000', 170), 1))),
  'arithmetic_invalid', 'a new bag where the outlet charges nothing is refused');

select pg_temp.as_server();
update public.outlets set packaging_mode = 'per_bag', packaging_price_paise = 500,
       packaging_free_for_gold = true
 where id = '00000000-0000-4000-a000-000000000001';

-- ---------------------------------------------------------------------------
-- 4. A revision moves what may move, and keeps what was captured.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select is(
  pg_temp.send('revise_billing_order', pg_temp.id('b6200000', 101), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 1), 'dine_in', 5,
      jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 1))))) ->> 'status',
  'accepted', 'an open order moves from table 4 to table 5');

select is(
  pg_temp.send('revise_billing_order', pg_temp.id('b6200000', 102), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 1), 'takeaway', 5,
      jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 1))))) ->> 'status',
  'malformed_payload', 'but not to a takeaway that keeps a table');

select is(
  pg_temp.send('revise_billing_order', pg_temp.id('b6200000', 181), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 18), 'takeaway', null, jsonb_build_array(
      pg_temp.shawarma(pg_temp.id('b6100000', 18)),
      pg_temp.bags(pg_temp.id('b6100000', 180), 3, true)))) ->> 'status',
  'accepted', 'a third bag is added, and the customer turns out to be gold');

-- The owner doubles the bag price while the order is open.
select pg_temp.as_server();
update public.outlets set packaging_price_paise = 1000
 where id = '00000000-0000-4000-a000-000000000001';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select is(
  pg_temp.send('revise_billing_order', pg_temp.id('b6200000', 182), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 18), 'takeaway', null, jsonb_build_array(
      pg_temp.shawarma(pg_temp.id('b6100000', 18)),
      pg_temp.bags(pg_temp.id('b6100000', 180), 3)))) ->> 'status',
  'accepted', 'the bags on the bill keep the ₹5 they were captured at');

select is(
  pg_temp.send('revise_billing_order', pg_temp.id('b6200000', 183), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 18), 'takeaway', null, jsonb_build_array(
      pg_temp.shawarma(pg_temp.id('b6100000', 18)),
      pg_temp.bags(pg_temp.id('b6100000', 181), 3)))) ->> 'status',
  'arithmetic_invalid', 'but a new packaging line at the old price is refused');

select is(
  pg_temp.send('revise_billing_order', pg_temp.id('b6200000', 184), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 18), 'takeaway', null, jsonb_build_array(
      pg_temp.shawarma(pg_temp.id('b6100000', 18)),
      pg_temp.bags(pg_temp.id('b6100000', 180), 3) || '{"kind":"item"}'))) ->> 'status',
  'arithmetic_invalid', 'and the captured bags cannot come back calling themselves an item');

select pg_temp.as_server();
update public.outlets set packaging_price_paise = 500
 where id = '00000000-0000-4000-a000-000000000001';
select is(
  (select row(quantity, unit_price_paise, discount_paise)::text
     from public.order_items where id = pg_temp.id('b6100000', 180)),
  row(3, 500::bigint, 0::bigint)::text,
  'the order holds three bags at ₹5, no longer waived');

-- A revision that moves the rounding. Before #60 the order guard's list of what
-- a revision may change had never learned `rounding_paise`, so this raised
-- and the till read it as a malformed edit.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.send('create_billing_order', pg_temp.id('b6200000', 20), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 20), 'takeaway', null, jsonb_build_array(
      pg_temp.shawarma(pg_temp.id('b6100000', 20)),
      pg_temp.bags(pg_temp.id('b6100000', 200), 1)), 1000)) ->> 'status',
  'accepted', 'a takeaway with 10% off the bill is rung, rounding 40 paise');
select is(
  pg_temp.send('revise_billing_order', pg_temp.id('b6200000', 201), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 20), 'takeaway', null, jsonb_build_array(
      pg_temp.shawarma(pg_temp.id('b6100000', 20)),
      pg_temp.bags(pg_temp.id('b6100000', 200), 2)), 1000)) ->> 'status',
  'accepted', 'and a second bag, which moves the rounding to 90 paise, is accepted');
select pg_temp.as_server();
select is(
  (select rounding_paise from public.orders where id = pg_temp.id('b6000000', 20)),
  90::bigint, 'the revised rounding is stored');
select lives_ok('set constraints all immediate', 'and every revision above reconciles');
set constraints all deferred;
select is(
  (select count(*) from public.order_discounts where order_id = pg_temp.id('b6000000', 20)),
  1::bigint,
  'the revision replaced the bill discount rather than stacking a second one beside it');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.send('revise_billing_order', pg_temp.id('b6200000', 202), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 20), 'takeaway', null, jsonb_build_array(
      pg_temp.shawarma(pg_temp.id('b6100000', 20)),
      pg_temp.bags(pg_temp.id('b6100000', 200), 2)))) ->> 'status',
  'accepted', 'the discount is then taken off the order');
select pg_temp.as_server();
select is(
  (select count(*) from public.order_discounts where order_id = pg_temp.id('b6000000', 20)),
  0::bigint, 'and is gone');
select lives_ok('set constraints all immediate', 'and the order still reconciles without it');
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- 5. Payment copies the facts to the bill and fixes them there.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.send('pay_billing_order', pg_temp.id('b6200000', 1001), 3,
    pg_temp.pay_payload(pg_temp.id('b6000000', 18), pg_temp.id('b6300000', 18))) ->> 'status',
  'accepted', 'the takeaway is paid');
select is(
  pg_temp.send('pay_billing_order', pg_temp.id('b6200000', 1002), 3,
    pg_temp.pay_payload(pg_temp.id('b6000000', 1), pg_temp.id('b6300000', 1))) ->> 'status',
  'accepted', 'the table-5 order is paid');
select is(
  pg_temp.send('pay_billing_order', pg_temp.id('b6200000', 1003), 3,
    pg_temp.pay_payload(pg_temp.id('b6000000', 19), pg_temp.id('b6300000', 19))) ->> 'status',
  'accepted', 'the gold member''s takeaway is paid');
select is(
  pg_temp.send('pay_billing_now', pg_temp.id('b6200000', 50), 3,
    pg_temp.sale_v3(pg_temp.id('b6300000', 50), 'takeaway', null, jsonb_build_array(
      pg_temp.shawarma(pg_temp.id('b6100000', 50)),
      pg_temp.bags(pg_temp.id('b6100000', 500), 1)))) ->> 'status',
  'accepted', 'a takeaway paid on the spot is accepted');

select pg_temp.as_server();
select is(
  (select row(service_type::text, table_number)::text from public.bills
    where id = pg_temp.id('b6300000', 1)),
  row('dine_in'::text, 5)::text, 'the bill copies dine-in at table 5 from its order');
select is(
  (select row(b.service_type::text,
              (select count(*) from public.bill_items i where i.bill_id = b.id and i.kind = 'packaging'),
              (select quantity from public.bill_items i where i.bill_id = b.id and i.kind = 'packaging'))::text
     from public.bills b where b.id = pg_temp.id('b6300000', 18)),
  row('takeaway'::text, 1::bigint, 3)::text,
  'the takeaway''s bill carries one packaging line of three bags');
select is(
  (select row(i.discount_paise, i.discount_percent_bp)::text
     from public.bill_items i where i.bill_id = pg_temp.id('b6300000', 19) and i.kind = 'packaging'),
  row(500::bigint, 10000)::text, 'the waiver is copied to the bill as the line''s own discount');
select is(
  (select row(b.service_type::text, i.kind::text, i.menu_item_id)::text
     from public.bills b join public.bill_items i on i.bill_id = b.id
    where b.id = pg_temp.id('b6300000', 50) and i.item_name = 'Packaging'),
  row('takeaway'::text, 'packaging'::text, null::uuid)::text,
  'a direct sale records its type and its bag');
select lives_ok('set constraints all immediate', 'every bill reconciles, waiver and bags included');
set constraints all deferred;

select pg_temp.as_server();
select set_config('app.billing_command', '1', true);
select throws_ok($q$
  update public.orders set table_number = 6 where id = pg_temp.id('b6000000', 1)
$q$, 'P0001', null, 'a paid order cannot be moved to another table');
select throws_ok($q$
  update public.orders set service_type = 'takeaway' where id = pg_temp.id('b6000000', 1)
$q$, 'P0001', null, 'or re-marked');
select throws_ok($q$
  update public.bills set table_number = 6 where id = pg_temp.id('b6300000', 1)
$q$, null, null, 'and neither can its bill');
select set_config('app.billing_command', '0', true);

-- ---------------------------------------------------------------------------
-- 6. Work queued before the release settles, exactly once, as it was meant.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select is(
  pg_temp.send('create_billing_order', pg_temp.id('b6200000', 30), 2,
    pg_temp.as_v2(pg_temp.order_v3(pg_temp.id('b6000000', 30), null, null,
      jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 30)))))) ->> 'status',
  'accepted', 'a version-2 order queued before the release is accepted');
select is(
  pg_temp.send('create_billing_order', pg_temp.id('b6200000', 31), 1,
    pg_temp.as_v1(pg_temp.order_v3(pg_temp.id('b6000000', 31), null, null,
      jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 31)))))) ->> 'status',
  'accepted', 'and so is a version-1 one');
select is(
  pg_temp.send('pay_billing_order', pg_temp.id('b6200000', 1030), 2,
    pg_temp.pay_payload(pg_temp.id('b6000000', 30), pg_temp.id('b6300000', 30))) ->> 'status',
  'accepted', 'and a version-2 payment of it');
select is(
  pg_temp.send('create_billing_order', pg_temp.id('b6200000', 30), 2,
    pg_temp.as_v2(pg_temp.order_v3(pg_temp.id('b6000000', 30), null, null,
      jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 30)))))) ->> 'status',
  'replay', 'the version-2 order replayed returns its result');
select is(
  pg_temp.send('create_billing_order', pg_temp.id('b6200000', 1), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 1), 'dine_in', 4,
      jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 1))))) ->> 'status',
  'replay', 'and so does a version-3 one');

select is(
  pg_temp.send('create_billing_order', pg_temp.id('b6200000', 32), 2,
    pg_temp.order_v3(pg_temp.id('b6000000', 32), null, null,
      jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 32))))) ->> 'status',
  'malformed_payload', 'a version-2 envelope carrying version-3 keys is refused');
select is(
  pg_temp.send('create_billing_order', pg_temp.id('b6200000', 33), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 33), null, null,
      jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 33)))) - 'serviceType') ->> 'status',
  'malformed_payload', 'a version-3 envelope missing a version-3 key is refused');
select is(
  pg_temp.send('create_billing_order', pg_temp.id('b6200000', 34), 4,
    pg_temp.order_v3(pg_temp.id('b6000000', 34), null, null,
      jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 34))))) ->> 'status',
  'unsupported_schema', 'a version nobody has written yet is unsupported');

select pg_temp.as_server();
select is(
  (select row(o.service_type, o.table_number, i.kind::text)::text
     from public.orders o join public.order_items i on i.order_id = o.id
    where o.id = pg_temp.id('b6000000', 31)),
  row(null::public.service_type, null::smallint, 'item'::text)::text,
  'the version-1 order reads as neither, no table, every line an item');
select is(
  (select row(b.service_type, b.table_number, i.kind::text)::text
     from public.bills b join public.bill_items i on i.bill_id = b.id
    where b.id = pg_temp.id('b6300000', 30)),
  row(null::public.service_type, null::smallint, 'item'::text)::text,
  'and so does the version-2 bill');
select is(
  (select count(*) from public.orders where id = pg_temp.id('b6000000', 1)),
  1::bigint, 'the replays wrote nothing further');

-- The owner stops offering dine-in while a tablet is offline with a dine-in order.
update public.outlets set dine_in_offered = false, table_numbers = false
 where id = '00000000-0000-4000-a000-000000000001';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(pg_temp.create_v3(35, 'dine_in', 12,
  jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 35)))),
  'accepted', 'a dine-in order captured before dine-in was switched off is accepted');
select pg_temp.as_server();
select is(
  (select row(service_type::text, table_number)::text from public.orders
    where id = pg_temp.id('b6000000', 35)),
  row('dine_in'::text, 12)::text, 'and recorded as dine-in at table 12');
update public.outlets set dine_in_offered = true, table_numbers = true
 where id = '00000000-0000-4000-a000-000000000001';

-- ---------------------------------------------------------------------------
-- 7. Two open orders on one table are recorded, never refused (D5, D11).

create function pg_temp.shared(p_n integer) returns boolean language sql as $$
  select table_shared from public.orders where id = pg_temp.id('b6000000', p_n)
$$;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(pg_temp.create_v3(40, 'dine_in', 7,
  jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 40)))), 'accepted', 'table 7 is seated');
select is(pg_temp.create_v3(41, 'dine_in', 7,
  jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 41)))), 'accepted',
  'and seated again, which the database accepts');
select is(pg_temp.create_v3(42, 'dine_in', 8,
  jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 42)))), 'accepted', 'table 8 is seated');
select is(pg_temp.create_v3(43, 'takeaway', null, jsonb_build_array(
  pg_temp.shawarma(pg_temp.id('b6100000', 43)), pg_temp.bags(pg_temp.id('b6100000', 430), 1))),
  'accepted', 'a takeaway is rung');

select pg_temp.as_server();
select ok(pg_temp.shared(40) and pg_temp.shared(41), 'both orders at table 7 are marked shared');
select ok(not pg_temp.shared(42) and not pg_temp.shared(43), 'and nothing else is');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.send('revise_billing_order', pg_temp.id('b6200000', 421), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 42), 'dine_in', 7,
      jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 42))))) ->> 'status',
  'accepted', 'table 8 is moved onto table 7');
select pg_temp.as_server();
select ok(pg_temp.shared(42), 'which marks it shared by revision');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.send('pay_billing_order', pg_temp.id('b6200000', 1040), 3,
    pg_temp.pay_payload(pg_temp.id('b6000000', 40), pg_temp.id('b6300000', 40))) ->> 'status',
  'accepted', 'one table-7 order is paid');
select is(
  pg_temp.send('cancel_billing_order', pg_temp.id('b6200000', 1041), 3,
    jsonb_build_object('orderId', pg_temp.id('b6000000', 41), 'reason', 'left')) ->> 'status',
  'accepted', 'and another cancelled');
select pg_temp.as_server();
select ok(pg_temp.shared(40) and pg_temp.shared(41),
  'paying or cancelling never takes the mark away');

-- The case the owner found: a payment taken back after the table was seated again.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(pg_temp.create_v3(44, 'dine_in', 9,
  jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 44)))), 'accepted', 'table 9 is seated');
select is(
  pg_temp.send('pay_billing_order', pg_temp.id('b6200000', 1044), 3,
    pg_temp.pay_payload(pg_temp.id('b6000000', 44), pg_temp.id('b6300000', 44))) ->> 'status',
  'accepted', 'and paid, freeing the table');
select is(pg_temp.create_v3(45, 'dine_in', 9,
  jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 45)))), 'accepted', 'table 9 is seated again');
select pg_temp.as_server();
select ok(not pg_temp.shared(44) and not pg_temp.shared(45),
  'a paid order and a new one at its table have shared nothing');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  pg_temp.send('unpay_billing_order', pg_temp.id('b6200000', 1045), 3,
    jsonb_build_object('orderId', pg_temp.id('b6000000', 44),
      'billId', pg_temp.id('b6300000', 44), 'reason', 'wrong tender')) ->> 'status',
  'accepted', 'the first order''s payment is taken back');
select pg_temp.as_server();
select ok(pg_temp.shared(44) and pg_temp.shared(45),
  'which leaves two open orders at table 9, and marks both');

-- Table 20 at both outlets is two tables.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(pg_temp.create_v3(46, 'dine_in', 20,
  jsonb_build_array(pg_temp.shawarma(pg_temp.id('b6100000', 46)))), 'accepted',
  'Kalyani seats table 20');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000005');
select is(
  pg_temp.send('create_billing_order', pg_temp.id('b6200000', 47), 3,
    pg_temp.order_v3(pg_temp.id('b6000000', 47), 'dine_in', 20, jsonb_build_array(
      pg_temp.shawarma(pg_temp.id('b6100000', 47)) || '{"menuItemId":null,"itemName":"Chef''s plate"}'),
      null, '00000000-0000-4000-a000-000000000002'),
    '90000000-0000-4000-a000-000000000002') ->> 'status',
  'accepted', 'and so does Kanchrapara');
select pg_temp.as_server();
select ok(not pg_temp.shared(46) and not pg_temp.shared(47),
  'the same number at two outlets marks neither');

-- ---------------------------------------------------------------------------
-- 8. The facts are read where their rows are read (outlet-tenancy).

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  (select table_number from public.orders where id = pg_temp.id('b6000000', 45)),
  9::smallint, 'Kalyani''s tablet reads its own order''s table');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000005');
select is(
  (select count(*) from public.orders
    where id in (pg_temp.id('b6000000', 45), pg_temp.id('b6000000', 40))),
  0::bigint, 'Kanchrapara''s tablet reads nothing of Kalyani''s orders, table or mark');
select is(
  (select count(*) from public.bills where id = pg_temp.id('b6300000', 18)),
  0::bigint, 'or its bills');
select is(
  (select count(*) from public.order_items where id = pg_temp.id('b6100000', 430)),
  0::bigint, 'or their lines'' kind');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select is(
  (select count(*) from public.orders where id = pg_temp.id('b6000000', 45)),
  0::bigint, 'Kanchrapara''s manager reads nothing of Kalyani''s orders');
select is(
  (select count(*) from public.bill_items where bill_id = pg_temp.id('b6300000', 18)),
  0::bigint, 'or its bill lines');

select * from finish();
rollback;
