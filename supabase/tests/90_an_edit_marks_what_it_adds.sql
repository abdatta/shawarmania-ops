-- #74: an edit marks the dish lines it adds (each-dish-is-ticked-off, design
-- R12), so the rail can set them below a divider. Never the lines an order was
-- created with, and never a line an edit kept.
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

create function pg_temp.unimpersonate()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

\set COUNTER '10000000-0000-4000-a000-000000000004'
\set O1 'e9200000-0000-4000-a000-000000000001'
\set O2 'e9200000-0000-4000-a000-000000000002'
\set SHAWARMA '31000000-0000-4000-a000-000000000001'
\set BURGER '31000000-0000-4000-a000-000000000007'

create function pg_temp.today() returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00')
$$;

/** An order of shawarmas and burgers; lines it already holds keep their ids. */
create function pg_temp.payload(p_order uuid, p_shawarmas integer, p_burgers integer)
returns jsonb language plpgsql as $$
declare v_lines jsonb := '[]'::jsonb; v_total integer := 0; v_id uuid;
begin
  if p_shawarmas > 0 then
    select id into v_id from public.order_items
     where order_id = p_order and menu_item_id = '31000000-0000-4000-a000-000000000001';
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', coalesce(v_id, gen_random_uuid()), 'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma', 'unitPricePaise', 13900,
      'quantity', p_shawarmas, 'lineTotalPaise', 13900 * p_shawarmas));
    v_total := v_total + 13900 * p_shawarmas;
  end if;
  v_id := null;
  if p_burgers > 0 then
    select id into v_id from public.order_items
     where order_id = p_order and menu_item_id = '31000000-0000-4000-a000-000000000007';
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', coalesce(v_id, gen_random_uuid()), 'menuItemId', '31000000-0000-4000-a000-000000000007',
      'itemName', 'Fully Loaded Smashed Burger', 'unitPricePaise', 25000,
      'quantity', p_burgers, 'lineTotalPaise', 25000 * p_burgers));
    v_total := v_total + 25000 * p_burgers;
  end if;
  return jsonb_build_object(
    'orderId', p_order, 'businessDate', pg_temp.today(),
    'customerId', null, 'customerName', null, 'customerPhone', null,
    'subtotalPaise', v_total, 'discountPaise', 0, 'taxPaise', 0, 'totalPaise', v_total,
    'pricingMode', 'no_tax', 'lines', v_lines);
end;
$$;

create function pg_temp.send(p_fn text, p jsonb) returns text
language plpgsql as $$
declare r jsonb;
begin
  execute format('select public.%I($1,1,public.billing_payload_hash($2),now(),$3,$2)', p_fn)
    into r using gen_random_uuid(), p, '90000000-0000-4000-a000-000000000001'::uuid;
  return r ->> 'status';
end;
$$;

/**
 * The test is one transaction, so its `now()` never moves; an edit is told from
 * a create by the order being older than the transaction. Make it so, past the
 * order guard, as a later delivery would find it.
 */
create function pg_temp.age(p_order uuid) returns void language plpgsql as $$
begin
  perform pg_temp.unimpersonate();
  set local session_replication_role = replica;
  update public.orders set created_at = now() - interval '5 minutes' where id = p_order;
  set local session_replication_role = origin;
end;
$$;

create function pg_temp.added(p_order uuid) returns text[] language sql as $$
  select coalesce(array_agg(i.menu_item_id::text order by i.menu_item_id), '{}')
    from public.order_line_additions a
    join public.order_items i on i.id = a.order_item_id
   where a.order_id = p_order
$$;

-- ---------------------------------------------------------------------------
-- A create marks nothing; an edit marks what it adds.

select pg_temp.unimpersonate();
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('create_billing_order_v2', pg_temp.payload(:'O1', 1, 0)), 'accepted',
  'an order is created');
select pg_temp.unimpersonate();
select is(pg_temp.added(:'O1'), '{}'::text[], 'its first lines are not additions');

select pg_temp.age(:'O1');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('revise_billing_order_v2', pg_temp.payload(:'O1', 2, 1)), 'accepted',
  'an edit adds a burger and a second shawarma');
select pg_temp.unimpersonate();
select is(pg_temp.added(:'O1'), array[:'BURGER'], 'only the new line is an addition, not the kept one');
select is((select outlet_id from public.order_line_additions where order_id = :'O1'),
  (select outlet_id from public.orders where id = :'O1'), 'recorded at the order''s outlet');

-- Read as the ticks are read: this outlet's people, never another's.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is((select count(*)::integer from public.order_line_additions where order_id = :'O1'), 1,
  'this outlet''s franchise admin reads the addition');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select is((select count(*)::integer from public.order_line_additions where order_id = :'O1'), 0,
  'another outlet''s franchise admin reads nothing');
select pg_temp.impersonate(:'COUNTER');
select is((select count(*)::integer from public.order_line_additions where order_id = :'O1'), 1,
  'the outlet''s counter reads it');
select pg_temp.unimpersonate();

select ok(not has_table_privilege('anon', 'public.order_line_additions', 'select'),
  'anon cannot read additions');
select ok(not has_table_privilege('authenticated', 'public.order_line_additions', 'insert'),
  'no client writes them');

select * from finish();
rollback;
