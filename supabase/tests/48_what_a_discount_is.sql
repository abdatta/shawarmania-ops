-- What a discount is, at the database.
--
-- The parts equalling the whole, the two price floors, the preset bounds, and
-- the role boundary on menu discounts. Outlet isolation for these tables is
-- enumerated by `01_schema_coverage.sql` and `02_isolation_matrix.sql`; what is
-- here is the behaviour those two cannot see.

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

create function pg_temp.as_service()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
end;
$$;

-- Seeded Kalyani, and the accounts that can and cannot touch its menu.
create function pg_temp.kalyani() returns uuid language sql immutable as
  $$ select '00000000-0000-4000-a000-000000000001'::uuid $$;
create function pg_temp.kanchrapara() returns uuid language sql immutable as
  $$ select '00000000-0000-4000-a000-000000000002'::uuid $$;

-- ---------------------------------------------------------------------------
-- The parts equal the whole.
--
-- The guard is deferred, so a violation surfaces at commit. Each case runs in
-- its own subtransaction so the failure is attributable rather than poisoning
-- everything after it.

create function pg_temp.order_with_discount(
  p_subtotal bigint,
  p_declared_discount bigint,
  p_line_discount bigint,
  p_record_discount bigint
)
returns void language plpgsql as $$
declare
  v_order uuid := gen_random_uuid();
  v_net bigint := p_subtotal - p_declared_discount;
  v_total bigint := greatest(100, ceil(v_net::numeric / 100)::bigint * 100);
begin
  -- `billing_order_item_guard` refuses every order-item write that does not
  -- declare itself a command write, with no exemption for a session that has no
  -- `auth.uid()`. The real command functions set exactly this, so setting it
  -- here writes the rows the way production writes them rather than around the
  -- guard.
  perform set_config('app.billing_command', '1', true);

  insert into public.orders (
    id, outlet_id, order_number, device_id, created_by, created_shift_id,
    ordered_at, business_date, subtotal_paise, discount_paise, tax_paise,
    rounding_paise, total_paise)
  values (
    v_order, pg_temp.kalyani(),
    (select coalesce(max(order_number), 0) + 1 from public.orders),
    '10000000-0000-4000-a000-000000000004',
    '10000000-0000-4000-a000-00000000000a',
    '90000000-0000-4000-a000-000000000001',
    now(), current_date, p_subtotal, p_declared_discount, 0,
    v_total - v_net, v_total);

  insert into public.order_items (
    id, order_id, item_name, unit_price_paise, quantity, line_total_paise,
    discount_paise)
  values (
    gen_random_uuid(), v_order, 'Chicken Shawarma', p_subtotal, 1, p_subtotal,
    p_line_discount);

  if p_record_discount > 0 then
    insert into public.order_discounts (
      order_id, outlet_id, basis, value_paise, amount_paise)
    values (v_order, pg_temp.kalyani(), 'amount', p_record_discount, p_record_discount);
  end if;

  -- The sum guard is deferred so a multi-statement write can be internally
  -- inconsistent while it is being made. This transaction never commits, so
  -- without forcing them here the assertions below would never see it fire.
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('app.billing_command', '0', true);
end;
$$;

select lives_ok(
  $$select pg_temp.order_with_discount(38900, 5835, 2835, 3000)$$,
  'an order whose line discount and discount record sum to its declared total is accepted');

select throws_ok(
  $$select pg_temp.order_with_discount(38900, 5835, 2835, 0)$$,
  'P0001',
  null,
  'a declared discount larger than its parts is refused');

select throws_ok(
  $$select pg_temp.order_with_discount(38900, 2835, 2835, 3000)$$,
  'P0001',
  null,
  'a declared discount smaller than its parts is refused');

select lives_ok(
  $$select pg_temp.order_with_discount(38900, 0, 0, 0)$$,
  'an order with no discount at all still satisfies the guard');

-- ---------------------------------------------------------------------------
-- A percentage row cannot carry a rupee value, or the reverse.

select throws_ok($$
  insert into public.order_discounts (order_id, outlet_id, basis, value_bp, value_paise, amount_paise)
  select id, pg_temp.kalyani(), 'percent', 1500, 5000, 5835 from public.orders limit 1
  $$,
  '23514', null,
  'a percentage discount carrying a rupee value is refused');

select throws_ok($$
  insert into public.order_discounts (order_id, outlet_id, basis, amount_paise)
  select id, pg_temp.kalyani(), 'percent', 5835 from public.orders limit 1
  $$,
  '23514', null,
  'a percentage discount carrying no percentage is refused');

-- ---------------------------------------------------------------------------
-- A rupee menu discount is bounded by the cheapest item it reaches, both ways.

create function pg_temp.cheapest_in(p_category uuid) returns bigint language sql as $$
  select min(price_paise) from public.menu_items where category_id = p_category and is_active;
$$;

create function pg_temp.a_kalyani_category() returns uuid language sql as $$
  select c.id from public.menu_categories c
   join public.menu_items i on i.category_id = c.id
  where c.outlet_id = pg_temp.kalyani() and c.is_active and i.is_active
  group by c.id
  order by min(i.price_paise) desc
  limit 1;
$$;

create function pg_temp.try_menu_discount(p_value_paise bigint)
returns void language plpgsql as $$
declare v_discount uuid := gen_random_uuid();
begin
  insert into public.menu_discounts (id, outlet_id, basis, value_paise)
  values (v_discount, pg_temp.kalyani(), 'amount', p_value_paise);
  insert into public.menu_discount_categories (discount_id, category_id)
  values (v_discount, pg_temp.a_kalyani_category());

  -- Deferred for the same reason: the discount row exists before its categories
  -- do, so an immediate check would pass trivially on every one of them.
  set constraints all immediate;
  set constraints all deferred;
end;
$$;

select lives_ok(
  format($$select pg_temp.try_menu_discount(%s)$$, (select pg_temp.cheapest_in(pg_temp.a_kalyani_category()))),
  'a rupee discount exactly equal to the cheapest item it covers is allowed');

select throws_ok(
  format($$select pg_temp.try_menu_discount(%s)$$, (select pg_temp.cheapest_in(pg_temp.a_kalyani_category()) + 1)),
  '23514', null,
  'a rupee discount one paisa above the cheapest item it covers is refused');

select lives_ok(
  $$select pg_temp.try_menu_discount(100)$$,
  'a small rupee discount is unaffected');

-- The other direction: the item cannot come down to meet the discount.
select throws_ok(
  format($$
    update public.menu_items set price_paise = %s
     where category_id = %L and is_active
       and price_paise = (select pg_temp.cheapest_in(%L))
    $$,
    50, pg_temp.a_kalyani_category(), pg_temp.a_kalyani_category()),
  '23514', null,
  'an item repriced beneath a rupee discount already covering it is refused');

-- A percentage discount imposes no floor, because a percentage of a price is
-- never more than the price.
select lives_ok($$
  insert into public.menu_discounts (outlet_id, basis, value_bp)
  values (pg_temp.kalyani(), 'percent', 10000)
  $$,
  'a hundred percent menu discount needs no price floor');

-- ---------------------------------------------------------------------------
-- Presets: none to four, each carrying its own unit.
--
-- A preset is a basis and a value rather than a bare percentage, because the
-- counter offers a rupee discount in one tap as readily as a percentage.

select lives_ok($$
  update public.outlets set discount_presets =
    '[{"basis":"percent","value":1000},{"basis":"percent","value":1500}]'::jsonb
   where id = pg_temp.kalyani()
  $$, 'two percentage presets are accepted');

select lives_ok($$
  update public.outlets set discount_presets =
    '[{"basis":"percent","value":1000},{"basis":"amount","value":2000}]'::jsonb
   where id = pg_temp.kalyani()
  $$, 'a rupee preset sits beside a percentage one');

select lives_ok($$
  update public.outlets set discount_presets = '[]'::jsonb where id = pg_temp.kalyani()
  $$, 'no presets at all are accepted');

select lives_ok($$
  update public.outlets set discount_presets =
    '[{"basis":"percent","value":500},{"basis":"percent","value":1000},
      {"basis":"amount","value":2000},{"basis":"amount","value":5000}]'::jsonb
   where id = pg_temp.kalyani()
  $$, 'four presets are accepted');

select throws_ok($$
  update public.outlets set discount_presets =
    '[{"basis":"percent","value":500},{"basis":"percent","value":1000},
      {"basis":"percent","value":1500},{"basis":"percent","value":2000},
      {"basis":"percent","value":2500}]'::jsonb
   where id = pg_temp.kalyani()
  $$, '23514', null,
  'a fifth preset is refused: the counter panel fits four');

select throws_ok($$
  update public.outlets set discount_presets =
    '[{"basis":"percent","value":0}]'::jsonb where id = pg_temp.kalyani()
  $$, '23514', null,
  'a preset of nought is refused');

select throws_ok($$
  update public.outlets set discount_presets =
    '[{"basis":"percent","value":10001}]'::jsonb where id = pg_temp.kalyani()
  $$, '23514', null,
  'a percentage preset above a hundred percent is refused');

-- A rupee preset carries no such ceiling: what it may take off is decided by the
-- order it is applied to, which is the counter's arithmetic rather than this
-- column's business.
select lives_ok($$
  update public.outlets set discount_presets =
    '[{"basis":"amount","value":5000000}]'::jsonb where id = pg_temp.kalyani()
  $$, 'a large rupee preset is accepted, because the bill caps it, not the column');

select throws_ok($$
  update public.outlets set discount_presets =
    '[{"basis":"coupon","value":1000}]'::jsonb where id = pg_temp.kalyani()
  $$, '23514', null,
  'a basis nobody defined is refused');

select throws_ok($$
  update public.outlets set discount_presets =
    '[{"basis":"percent"}]'::jsonb where id = pg_temp.kalyani()
  $$, '23514', null,
  'a preset with no value is refused');

select is(
  (select discount_presets from public.outlets where id = pg_temp.kanchrapara()),
  '[{"basis":"percent","value":1000},{"basis":"percent","value":1500},{"basis":"percent","value":2000}]'::jsonb,
  'an outlet that has never been configured starts at ten, fifteen and twenty percent');

-- ---------------------------------------------------------------------------
-- Only the roles that may edit the menu may set a discount on it.

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');

select throws_ok($$
  insert into public.menu_discounts (outlet_id, basis, value_bp)
  values (pg_temp.kalyani(), 'percent', 1500)
  $$,
  '42501', null,
  'a Biller is refused a menu discount at their own outlet');

select pg_temp.as_service();

-- ---------------------------------------------------------------------------
-- Discounts are written through billing commands, never directly by a client.

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');

select throws_ok($$
  insert into public.bill_discounts (bill_id, outlet_id, basis, value_paise, amount_paise)
  select id, outlet_id, 'amount', 5000, 5000 from public.bills limit 1
  $$,
  '42501', null,
  'a client cannot write a bill discount outside a billing command');

select pg_temp.as_service();

-- A settled bill's discounts are history. The row has to exist before its
-- immutability means anything: an update matching nothing raises nothing, and
-- would have passed this test while proving the opposite of what it claims.
insert into public.bill_discounts (bill_id, outlet_id, basis, value_paise, amount_paise)
select b.id, b.outlet_id, 'amount', 5000, 5000
  from public.bills b
 where b.status = 'settled'
 order by b.created_at
 limit 1;

select is(
  (select count(*) from public.bill_discounts)::bigint,
  1::bigint,
  'the bill discount under test is actually there');

select throws_ok($$
  update public.bill_discounts set amount_paise = 1
  $$,
  'P0001', null,
  'a bill discount cannot be changed once written');

select throws_ok($$
  delete from public.bill_discounts
  $$,
  'P0001', null,
  'nor deleted');

-- That row deliberately breaks its parent's sum, which is the guard's whole
-- job. Proving it here means the guard is load-bearing rather than decorative.
select throws_ok(
  $$set constraints all immediate$$,
  'P0001', null,
  'and the sum guard notices the parent no longer adds up');

-- Deliberately not cleaned up. That row breaks its parent's sum on purpose, and
-- the only ways to remove it are the two this file just proved impossible. The
-- closing rollback discards it along with the pending trigger it left behind,
-- which is the correct end for a transaction that was never going to commit.

select * from finish();
rollback;
