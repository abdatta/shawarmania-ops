-- The server links the sale to the customer, from the phone it was given.
--
-- `bills.customer_id` and `orders.customer_id` existed for six weeks and were
-- never once set: every caller passed `customerId: null` and the functions
-- stored the null they were handed. The first assertion below is the one that
-- fails against every row ever written before this change.
--
-- The rest is the boundary. Two functions now read the customer directory from
-- inside billing, and each is dangerous in a different way: the resolve carries
-- no rate bound, so it must be unreachable by any client; the outlet-scoped
-- suggestion is reachable, so it must never return a second row or a customer
-- this outlet has not served.

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

--   ...0004 device_kalyani (live shift 90000000-…0001)
--   ...000a biller_kalyani        ...0002 fa_kalyani
--   80000000-…0001 +919000000001 'Test Customer (Synthetic)'
--   80000000-…0002 +919000000002 no name

create function pg_temp.order_payload(
  p_order_id uuid, p_line_id uuid, p_business_date date,
  p_phone text default null, p_name text default null)
returns jsonb language sql volatile as $$
  select jsonb_build_object(
    'orderId', p_order_id,
    'businessDate', p_business_date,
    -- **Always null, and that is the design.** A till cannot know a customer's
    -- id for a number it has never seen.
    'customerId', null,
    'customerName', p_name,
    'customerPhone', p_phone,
    'subtotalPaise', 13900, 'discountPaise', 0, 'taxPaise', 0,
    'totalPaise', 13900, 'pricingMode', 'no_tax',
    'lines', jsonb_build_array(jsonb_build_object(
      'id', p_line_id,
      'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma',
      'unitPricePaise', 13900, 'quantity', 1, 'lineTotalPaise', 13900)));
$$;

create function pg_temp.ring(
  p_command uuid, p_order uuid, p_line uuid,
  p_phone text default null, p_name text default null)
returns text language sql volatile as $$
  select public.create_billing_order(
    p_command, 2,
    public.billing_payload_hash(pg_temp.order_payload(
      p_order, p_line, public.app_business_date(now(), time '04:00'),
      p_phone, p_name) || jsonb_build_object('roundingPaise', 0, 'discounts', '[]'::jsonb)),
    now(), '90000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      p_order, p_line, public.app_business_date(now(), time '04:00'),
      p_phone, p_name) || jsonb_build_object('roundingPaise', 0, 'discounts', '[]'::jsonb)
  ) ->> 'status';
$$;

-- ---------------------------------------------------------------------------
-- 1. The resolve is not a client surface, and cannot become one by accident.

select has_function('public', 'customer_resolve_for_sale', array['text','text'],
  'the internal resolve exists');

select ok(
  not has_function_privilege('authenticated', 'public.customer_resolve_for_sale(text,text)', 'execute'),
  'an authenticated session cannot execute the unbounded resolve');
select ok(
  not has_function_privilege('anon', 'public.customer_resolve_for_sale(text,text)', 'execute'),
  'an anonymous session cannot execute the unbounded resolve');

-- The bound is the reason this separation exists. If someone ever merges the
-- two functions, the merged one will be reachable and this will fail.
select ok(
  has_function_privilege('authenticated', 'public.customer_lookup_by_phone(text)', 'execute'),
  'the bounded interactive lookup is still the one clients may call');

-- ---------------------------------------------------------------------------
-- 2. The link that was never made.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select is(
  pg_temp.ring('a1000000-0000-4000-a000-0000000000c1',
               'a2000000-0000-4000-a000-0000000000c1',
               'a3000000-0000-4000-a000-0000000000c1',
               '9000000001', 'Whatever The Till Typed'),
  'accepted',
  'an order rung against a saved number is accepted');

-- THE assertion. Before this change every bill and order ever written failed it.
select is(
  (select customer_id from public.orders
    where id = 'a2000000-0000-4000-a000-0000000000c1'),
  '80000000-0000-4000-a000-000000000001'::uuid,
  'the order points at the customer holding that phone, resolved by the server');

select is(
  (select customer_phone from public.orders
    where id = 'a2000000-0000-4000-a000-0000000000c1'),
  '9000000001',
  'and still carries the snapshot the till sent, which is what a receipt prints');

-- The saved profile is history's, not the till's. #32's rule, still standing
-- now that billing itself creates customers. Read with the role reset, because
-- no client may select this table at all -- which is the point of the next
-- section.
reset role;
select is(
  (select name from public.customers where id = '80000000-0000-4000-a000-000000000001'),
  'Test Customer (Synthetic)',
  'a different name at the counter does not rewrite the saved profile');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

-- ---------------------------------------------------------------------------
-- 3. A number nobody has used creates exactly one customer, linked.

select is(
  pg_temp.ring('a1000000-0000-4000-a000-0000000000c2',
               'a2000000-0000-4000-a000-0000000000c2',
               'a3000000-0000-4000-a000-0000000000c2',
               '9000000777', 'Brand New'),
  'accepted',
  'an order rung against an unknown number is accepted');

reset role;
select is(
  (select count(*) from public.customers where phone = '+919000000777'),
  1::bigint,
  'exactly one customer row is created for it');

select is(
  (select c.name from public.customers c where c.phone = '+919000000777'),
  'Brand New',
  'and it is created with the name the till supplied, which is its only chance');

select is(
  (select o.customer_id from public.orders o
    where o.id = 'a2000000-0000-4000-a000-0000000000c2'),
  (select c.id from public.customers c where c.phone = '+919000000777'),
  'the order points at the customer it just created');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

-- ---------------------------------------------------------------------------
-- 4. Skipping creates nothing, and needs no special case.

select is(
  pg_temp.ring('a1000000-0000-4000-a000-0000000000c3',
               'a2000000-0000-4000-a000-0000000000c3',
               'a3000000-0000-4000-a000-0000000000c3',
               null, 'Blue cap'),
  'accepted',
  'an order rung with no number at all is accepted');

select is(
  (select customer_id from public.orders
    where id = 'a2000000-0000-4000-a000-0000000000c3'),
  null,
  'a sale carrying no phone is linked to nobody');

-- ---------------------------------------------------------------------------
-- 5. Nothing about identifying a customer may refuse a sale.

select is(
  pg_temp.ring('a1000000-0000-4000-a000-0000000000c4',
               'a2000000-0000-4000-a000-0000000000c4',
               'a3000000-0000-4000-a000-0000000000c4',
               'not a phone number at all', 'Still Selling'),
  'accepted',
  'a phone the rule refuses does not refuse the money');

select is(
  (select customer_id from public.orders
    where id = 'a2000000-0000-4000-a000-0000000000c4'),
  null,
  'it simply carries no link');

-- ---------------------------------------------------------------------------
-- 6. The bound is not in front of the money.
--
-- A tablet offline all day drains hundreds of queued commands at once. The
-- interactive bound is 120 per caller per fifteen minutes, so the 121st would
-- have been refused and a privacy guardrail would have destroyed a sale.

reset role;
select is(
  (select count(*) from generate_series(1, 300) g
    where public.customer_resolve_for_sale('90000005' || lpad(g::text, 2, '0')) is not null),
  300::bigint,
  'three hundred resolves in one window all succeed, well past the interactive bound');

-- ---------------------------------------------------------------------------
-- 7. The outlet-scoped suggestion: one match or none, never a list.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select is(
  (select count(*) from public.customer_suggest_at_outlet('900')),
  0::bigint,
  'three digits suggest nobody, whatever this outlet has served');

select is(
  (select count(*) from public.customer_suggest_at_outlet('9000')),
  1::bigint,
  'four digits suggest at most one customer, never a list');

-- Both seeded customers and the one created above open `9000`, so the count is
-- the only thing about the others that ever leaves the function.
select ok(
  (select other_matches from public.customer_suggest_at_outlet('9000')) >= 1,
  'and say how many it is not showing');

select ok(
  (select c.phone from public.customer_suggest_at_outlet('9000') c) like '+919000%',
  'the one it shows actually matches what was typed');

-- A number this outlet has never served is not discoverable, even though the
-- customer exists in the business-wide directory.
reset role;
insert into public.customers (id, phone, name)
values ('80000000-0000-4000-a000-0000000000ff', '+918888888888', 'Another Outlet Only');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select is(
  (select count(*) from public.customer_suggest_at_outlet('8888')),
  0::bigint,
  'a customer this outlet has never served cannot be surfaced by a prefix');

-- ---------------------------------------------------------------------------
-- 8. And no browse path was opened anywhere.

select ok(
  not has_table_privilege('authenticated', 'public.customers', 'select'),
  'the directory itself is still unreadable by any client role');

select * from finish();
rollback;
