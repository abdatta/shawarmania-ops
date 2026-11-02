-- delivery-orders-are-made-not-billed (#83): a delivery order is made and
-- handed over, never billed. What this file proves, and how each claim fails
-- differently:
--
--   * the three new tables are invisible across outlets, to the kitchen and to
--     anonymous callers, and nobody writes them directly;
--   * the replaced order guard refuses `handed_over` from anywhere but the two
--     delivery commands, and a handed-over order from everything but its
--     take-back;
--   * `_v3` create and revise are their `_v2`s without `delivery`, and with it
--     refuse a service, table, packaging, bill discount or customer;
--   * a handover ticks only what is owed, a take-back puts back only that, and
--     the window is a payment take-back's five minutes;
--   * paying a delivery order is refused while the gate is on, and allowed off;
--   * a label is kept when an order leaves the rail, the last one wins, and
--     nothing is kept while the gate is off;
--   * the reads leave delivery orders out of counter figures, count them alone
--     in delivery figures, and never carry their money.
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

create function pg_temp.gate(p_on boolean)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  update public.change_gates set enabled = p_on where key = 'delivery-orders';
end;
$$;

\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'
\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set COUNTER '10000000-0000-4000-a000-000000000004'
\set COUNTER_KPA '10000000-0000-4000-a000-000000000005'
\set BILLER '10000000-0000-4000-a000-00000000000a'
\set BILLER_TWO '10000000-0000-4000-a000-000000000010'
\set K1 'eeeeeeee-0000-4000-a000-000000000083'
\set SHAWARMA '31000000-0000-4000-a000-000000000001'
\set BURGER '31000000-0000-4000-a000-000000000007'
\set D1 'd8300000-0000-4000-a000-000000000001'
\set D2 'd8300000-0000-4000-a000-000000000002'
\set D3 'd8300000-0000-4000-a000-000000000003'
\set D4 'd8300000-0000-4000-a000-000000000004'
\set D5 'd8300000-0000-4000-a000-000000000005'
\set C1 'd8300000-0000-4000-a000-000000000011'
\set C2 'd8300000-0000-4000-a000-000000000012'

create function pg_temp.today() returns date language sql stable as $$
  select public.app_business_date(now(), o.business_day_cutover)
    from public.outlets o where o.id = '00000000-0000-4000-a000-000000000001'
$$;

/** An order of shawarmas and burgers; lines it already holds keep their ids. */
create function pg_temp.payload(p_order uuid, p_shawarmas integer, p_burgers integer,
                                p_at timestamptz default now())
returns jsonb language plpgsql as $$
declare v_lines jsonb := '[]'::jsonb; v_total integer := 0; v_id uuid;
begin
  if p_shawarmas > 0 then
    select id into v_id from public.order_items
     where order_id = p_order and menu_item_id = '31000000-0000-4000-a000-000000000001';
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', coalesce(v_id, gen_random_uuid()), 'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma', 'unitPricePaise', 13900,
      'quantity', p_shawarmas, 'lineTotalPaise', 13900 * p_shawarmas,
      'discountPaise', 0, 'discountPercentBp', null, 'categoryName', 'Shawarma', 'kind', 'item'));
    v_total := v_total + 13900 * p_shawarmas;
  end if;
  v_id := null;
  if p_burgers > 0 then
    select id into v_id from public.order_items
     where order_id = p_order and menu_item_id = '31000000-0000-4000-a000-000000000007';
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', coalesce(v_id, gen_random_uuid()), 'menuItemId', '31000000-0000-4000-a000-000000000007',
      'itemName', 'Fully Loaded Smashed Burger', 'unitPricePaise', 25000,
      'quantity', p_burgers, 'lineTotalPaise', 25000 * p_burgers,
      'discountPaise', 0, 'discountPercentBp', null, 'categoryName', 'Burgers', 'kind', 'item'));
    v_total := v_total + 25000 * p_burgers;
  end if;
  return jsonb_build_object(
    'orderId', p_order,
    'businessDate', (select public.app_business_date(p_at, o.business_day_cutover)
                       from public.outlets o where o.id = '00000000-0000-4000-a000-000000000001'),
    'customerId', null, 'customerName', null, 'customerPhone', null,
    'subtotalPaise', v_total, 'discountPaise', 0, 'taxPaise', 0, 'roundingPaise', 0,
    'totalPaise', v_total, 'pricingMode', 'no_tax', 'discounts', '[]'::jsonb,
    'serviceType', null, 'tableNumber', null, 'lines', v_lines);
end;
$$;

/** A billing command as the impersonated tablet: the whole result. */
create function pg_temp.call(p_fn text, p jsonb, p_id uuid default gen_random_uuid(),
                             p_at timestamptz default now(),
                             p_shift uuid default '90000000-0000-4000-a000-000000000001')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute format('select public.%I($1,4,public.billing_payload_hash($2),$3,$4,$2)', p_fn)
    into r using p_id, p, p_at, p_shift;
  return r;
end;
$$;

create function pg_temp.send(p_fn text, p jsonb, p_id uuid default gen_random_uuid(),
                             p_at timestamptz default now())
returns text language sql as $$
  select pg_temp.call(p_fn, p, p_id, p_at) ->> 'status'
$$;

create function pg_temp.line(p_order uuid, p_menu uuid) returns uuid language sql as $$
  select id from public.order_items where order_id = p_order and menu_item_id = p_menu
$$;

create function pg_temp.ticked(p_order uuid, p_menu uuid) returns integer language sql as $$
  select coalesce((select quantity from public.order_line_preparations
                    where order_item_id = pg_temp.line(p_order, p_menu)), 0)
$$;

create function pg_temp.tick(p_order uuid, p_menu uuid) returns text language sql as $$
  select pg_temp.send('prepare_order_lines_v2', jsonb_build_object('orderId', p_order, 'lines',
    jsonb_build_array(jsonb_build_object('id', pg_temp.line(p_order, p_menu), 'prepared', true))))
$$;

create function pg_temp.pay(p_order uuid) returns text language sql as $$
  select pg_temp.send('pay_billing_order', jsonb_build_object('orderId', p_order, 'billId', gen_random_uuid(),
    'paidAt', now(), 'paymentBusinessDate', pg_temp.today(), 'payments',
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amountPaise', o.total_paise))))
  from public.orders o where o.id = p_order
$$;

create function pg_temp.cancel(p_order uuid) returns text language sql as $$
  select pg_temp.send('cancel_billing_order',
    jsonb_build_object('orderId', p_order, 'reason', 'Customer left'))
$$;

create function pg_temp.hand_over(p_order uuid, p_id uuid default gen_random_uuid(),
                                  p_at timestamptz default now())
returns text language sql as $$
  select pg_temp.send('hand_over_delivery_order', jsonb_build_object('orderId', p_order), p_id, p_at)
$$;

create function pg_temp.take_back(p_order uuid, p_reason text default 'Rider not here yet',
                                  p_at timestamptz default now())
returns text language sql as $$
  select pg_temp.send('take_back_delivery_handover',
    jsonb_build_object('orderId', p_order, 'reason', p_reason), gen_random_uuid(), p_at)
$$;

create function pg_temp.delivery(p jsonb, p_on boolean default true) returns jsonb language sql as $$
  select p || jsonb_build_object('delivery', p_on)
$$;

/** A kitchen tablet, issued and redeemed as the Tablets list does it. */
create function pg_temp.kitchen_tablet(p_id uuid, p_label text, p_hash text, p_email text)
returns text language plpgsql as $$
begin
  perform public.issue_counter_device_setup_code(
    '00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000002',
    p_label, p_hash, interval '15 minutes', 'kitchen');
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new,
                          email_change_token_current, email_change, phone_change,
                          phone_change_token, reauthentication_token, is_sso_user)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
          p_email, now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
          '', '', '', '', '', '', '', '', false);
  return (select status from public.redeem_counter_device_setup_code(p_hash, p_id));
end;
$$;

create function pg_temp.open_kitchen(p_device uuid, p_username text, p_person uuid, p_hash text)
returns text language plpgsql as $$
begin
  perform public.request_counter_shift(p_device, p_username, p_hash, interval '2 minutes');
  return (select status from public.confirm_counter_shift(p_person,
    (select id from public.counter_shift_requests
      where device_id = p_device and resolution is null), p_hash));
end;
$$;

create function pg_temp.card(p_order uuid) returns jsonb language sql as $$
  select o from jsonb_array_elements(public.kitchen_board_v3() -> 'orders') o
   where coalesce(o ->> 'sourceOrderId', o ->> 'id') = p_order::text
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- 1. The gate, the shapes, off.

select is((select enabled from public.change_gates where key = 'delivery-orders'), false,
  'delivery-orders is declared, off');
select is((select code from public.change_gates where key = 'delivery-orders'), 'DO',
  'its code is DO');
select ok('handed_over' = any(enum_range(null::public.order_status)::text[]),
  'an order can be handed over');
select col_not_null('public', 'outlets', 'delivery_offered', 'an outlet offers Delivery or not');
select col_default_is('public', 'outlets', 'delivery_offered', 'false', 'Delivery is off by default');
select is((select count(*) from public.outlets where delivery_offered)::integer, 0,
  'no outlet offers Delivery after the migration');
select ok((select relrowsecurity from pg_class where oid = 'public.delivery_orders'::regclass),
  'delivery_orders has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.delivery_handover_takebacks'::regclass),
  'delivery_handover_takebacks has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.kept_order_labels'::regclass),
  'kept_order_labels has RLS');

select pg_temp.gate(true);
select pg_temp.impersonate(:'COUNTER');

-- ---------------------------------------------------------------------------
-- 2. Creating a delivery order, and what it may not carry.

select is(pg_temp.send('create_billing_order_v3', pg_temp.payload(:'C1', 1, 0)), 'accepted',
  'a _v2 payload through _v3 is accepted');
select is((select count(*) from public.delivery_orders where order_id = :'C1')::integer, 0,
  'and is not a delivery order');

select is(pg_temp.send('create_billing_order_v3',
  pg_temp.delivery(pg_temp.payload(:'D1', 1, 0) || '{"serviceType":"takeaway"}')),
  'malformed_payload', 'a delivery order with a service is refused');
select is(pg_temp.send('create_billing_order_v3',
  pg_temp.delivery(pg_temp.payload(:'D1', 1, 0) || '{"customerPhone":"9876501234"}')),
  'malformed_payload', 'a delivery order with a customer is refused');
select is(pg_temp.send('create_billing_order_v3',
  pg_temp.delivery(jsonb_set(pg_temp.payload(:'D1', 1, 0), '{discounts}',
    '[{"basis":"amount","valueBp":null,"valuePaise":1000,"amountPaise":1000}]'))),
  'malformed_payload', 'a delivery order with a bill discount is refused');
select is(pg_temp.send('create_billing_order_v3',
  pg_temp.delivery(jsonb_set(pg_temp.payload(:'D1', 1, 0), '{lines,0,kind}', '"packaging"'))),
  'malformed_payload', 'a delivery order with packaging is refused');
select is(pg_temp.send('create_billing_order_v3',
  pg_temp.payload(:'D1', 1, 0) || '{"delivery":"yes"}'),
  'malformed_payload', 'delivery must be a boolean');
select is((select count(*) from public.orders where id = :'D1')::integer, 0,
  'no refusal wrote an order');

select is(pg_temp.send('create_billing_order_v3',
  pg_temp.delivery(pg_temp.payload(:'D1', 2, 1)) || '{"label":"ZMT 4821"}',
  'd8310000-0000-4000-a000-000000000001'), 'accepted', 'a delivery order is saved');
select ok((select order_number from public.orders where id = :'D1') is not null,
  'and takes the day''s next number');
select is((select count(*) from public.delivery_orders where order_id = :'D1')::integer, 1,
  'and is a delivery order');
select is((select service_type::text from public.orders where id = :'D1'), null,
  'with no service');
select is(pg_temp.send('create_billing_order_v3',
  pg_temp.delivery(pg_temp.payload(:'D1', 2, 1)) || '{"label":"ZMT 4821"}',
  'd8310000-0000-4000-a000-000000000001'), 'replay', 'its replay is a replay');
select is((select count(*) from public.delivery_orders where order_id = :'D1')::integer, 1,
  'and adds nothing');
select is(pg_temp.send('create_billing_order_v3',
  pg_temp.delivery(pg_temp.payload(:'D1', 2, 1), false) || '{"label":"ZMT 4821"}',
  'd8310000-0000-4000-a000-000000000001'), 'identity_conflict',
  'a replay that disagrees about delivery is an identity conflict');

-- ---------------------------------------------------------------------------
-- 3. Revising: Delivery moves while the order is open.

select is(pg_temp.send('revise_billing_order_v3', pg_temp.delivery(pg_temp.payload(:'C1', 1, 0))),
  'accepted', 'an open order can be made a delivery order');
select is((select count(*) from public.delivery_orders where order_id = :'C1')::integer, 1,
  'and gains its row');
select is(pg_temp.send('revise_billing_order_v3',
  pg_temp.delivery(pg_temp.payload(:'C1', 1, 0) || '{"serviceType":"dine_in","tableNumber":3}')),
  'malformed_payload', 'a revision cannot make a delivery order dine-in');
select is(pg_temp.send('revise_billing_order_v3',
  pg_temp.delivery(pg_temp.payload(:'C1', 1, 0) || '{"serviceType":"takeaway"}', false)),
  'accepted', 'and back to takeaway');
select is((select count(*) from public.delivery_orders where order_id = :'C1')::integer, 0,
  'which drops its row');
select is((select service_type::text from public.orders where id = :'C1'), 'takeaway',
  'and it is takeaway');

-- ---------------------------------------------------------------------------
-- 4. A delivery order is not paid while the gate is on.

select throws_ok($$ select pg_temp.pay('d8300000-0000-4000-a000-000000000001') $$, '42501',
  'a delivery order is handed over, not paid', 'paying a delivery order is refused');
select is((select status::text from public.orders where id = :'D1'), 'open', 'it stays open');

-- ---------------------------------------------------------------------------
-- 5. The guard: handed_over only from the delivery commands.

select pg_temp.unimpersonate();
select throws_ok($$
  select set_config('app.billing_command', '1', true);
  update public.orders set status = 'handed_over' where id = 'd8300000-0000-4000-a000-000000000011'
$$, 'P0001', 'invalid order transition', 'a direct handover is refused');
select throws_ok($$
  select set_config('app.billing_command', '1', true);
  update public.orders set status = 'handed_over' where id = 'd8300000-0000-4000-a000-000000000001'
$$, 'P0001', 'invalid order transition',
  'a handover outside the command is refused, even of a delivery order');
select throws_ok($$
  select set_config('app.billing_command', '1', true);
  select set_config('app.delivery_handover', '1', true);
  update public.orders set status = 'handed_over' where id = 'd8300000-0000-4000-a000-000000000011'
$$, 'P0001', 'invalid order transition', 'a non-delivery order is never handed over');
select set_config('app.billing_command', '', true);
select set_config('app.delivery_handover', '', true);

-- ---------------------------------------------------------------------------
-- 6. Handing over ticks what is owed, and closes the order.

select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.tick(:'D1', :'SHAWARMA'), 'accepted', 'the shawarmas are ticked first');
select is(pg_temp.hand_over(:'C1'), 'malformed_payload', 'a counter order is not handed over');

select pg_temp.impersonate(:'COUNTER_KPA');
select is(pg_temp.call('hand_over_delivery_order', jsonb_build_object('orderId', :'D1'),
  gen_random_uuid(), now(), '90000000-0000-4000-a000-000000000002') ->> 'status',
  'authorization_refused', 'another outlet''s tablet cannot hand it over');

select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.hand_over(:'D1', 'd8320000-0000-4000-a000-000000000001'), 'accepted',
  'the owning tablet hands it over');
select is((select status::text from public.orders where id = :'D1'), 'handed_over', 'it is handed over');
select is(pg_temp.ticked(:'D1', :'BURGER'), 1, 'the burger still owed is ticked');
select is(pg_temp.ticked(:'D1', :'SHAWARMA'), 2, 'the shawarmas stay ticked');
select isnt((select prepared_at from public.orders where id = :'D1'), null, 'the order is prepared');
select is((select handed_over_by from public.delivery_orders where order_id = :'D1'),
  :'BILLER'::uuid, 'the handover names who did it');
select is((select handed_over_shift_id from public.delivery_orders where order_id = :'D1'),
  '90000000-0000-4000-a000-000000000001'::uuid, 'and the shift');
select is((select count(*) from public.bills where order_id = :'D1')::integer, 0, 'no bill is made');
select is(pg_temp.hand_over(:'D1', 'd8320000-0000-4000-a000-000000000001'), 'replay',
  'its replay is a replay');
select is(pg_temp.hand_over(:'D1'), 'order_not_open', 'a second handover is refused');
select is(pg_temp.cancel(:'D1'), 'order_not_open', 'a handed-over order is not cancelled');
select is(pg_temp.send('revise_billing_order_v3', pg_temp.delivery(pg_temp.payload(:'D1', 3, 1))),
  'order_not_open', 'nor revised');
select ok(not exists (
  select 1 from jsonb_array_elements(public.billing_day_readiness(:'KAL', pg_temp.today()) -> 'blockers') b
   where b::text like '%' || :'D1' || '%'), 'readiness does not wait for it');

select pg_temp.unimpersonate();
-- Each command is its own transaction in use; this file is one, so the flags
-- the handover just set are cleared before probing the guard by hand.
select set_config('app.billing_command', '', true);
select set_config('app.delivery_handover', '', true);
select throws_ok($$
  select set_config('app.billing_command', '1', true);
  select set_config('app.delivery_handover', '1', true);
  update public.orders set status = 'open', customer_name = 'Someone'
   where id = 'd8300000-0000-4000-a000-000000000001'
$$, 'P0001', 'handed-over orders are immutable', 'a take-back that changes anything else is refused');
select throws_ok($$
  select set_config('app.billing_command', '1', true);
  update public.orders set status = 'open' where id = 'd8300000-0000-4000-a000-000000000001'
$$, 'P0001', 'handed-over orders are immutable', 'a take-back outside the command is refused');
select set_config('app.billing_command', '', true);
select set_config('app.delivery_handover', '', true);

-- ---------------------------------------------------------------------------
-- 7. Taking it back: inside the window, only what the handover ticked.

select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.take_back(:'D1', '   '), 'malformed_payload', 'a take-back needs a reason');
select is(pg_temp.take_back(:'D1'), 'accepted', 'a take-back inside five minutes is accepted');
select is((select status::text from public.orders where id = :'D1'), 'open', 'the order is open again');
select is(pg_temp.ticked(:'D1', :'BURGER'), 0, 'the burger the handover ticked is unticked');
select is(pg_temp.ticked(:'D1', :'SHAWARMA'), 2, 'the shawarmas ticked before it stay');
select is((select prepared_at from public.orders where id = :'D1'), null, 'the order is not prepared');
select is((select handed_over_at from public.delivery_orders where order_id = :'D1'), null,
  'the handover is cleared');
select is((select count(*) from public.delivery_handover_takebacks where order_id = :'D1')::integer, 1,
  'the take-back is recorded');
select is((select reason from public.delivery_handover_takebacks where order_id = :'D1'),
  'Rider not here yet', 'with its reason');
select is(pg_temp.take_back(:'D1'), 'order_not_open', 'an open order cannot be taken back');

-- A handover six minutes ago is past the window.
select is(pg_temp.send('create_billing_order_v3', pg_temp.delivery(pg_temp.payload(:'D2', 1, 0, now() - interval '10 minutes')),
  gen_random_uuid(), now() - interval '10 minutes'), 'accepted', 'an older delivery order');
select is(pg_temp.hand_over(:'D2', gen_random_uuid(), now() - interval '6 minutes'), 'accepted',
  'handed over six minutes ago');
select is(pg_temp.take_back(:'D2'), 'payment_edit_expired', 'is too late to take back');
select is((select status::text from public.orders where id = :'D2'), 'handed_over', 'and stays handed over');

-- ---------------------------------------------------------------------------
-- 8. Labels are kept, and the last one wins.

select is(pg_temp.send('revise_billing_order_v3',
  pg_temp.delivery(pg_temp.payload(:'D1', 2, 1)) || '{"label":"SWG 77"}'), 'accepted',
  'the label is changed while it is back on the rail');
select is(pg_temp.hand_over(:'D1'), 'accepted', 'and it is handed over again');
select is((select label from public.kept_order_labels where order_id = :'D1'), 'SWG 77',
  'the label kept is the last one');

select is(pg_temp.send('create_billing_order_v3', pg_temp.payload(:'C2', 1, 0) || '{"label":"Asha"}'),
  'accepted', 'a counter order with a label');
select is(pg_temp.cancel(:'C2'), 'accepted', 'is cancelled');
select is((select label from public.kept_order_labels where order_id = :'C2'), 'Asha',
  'its label is kept');
select is((select count(*) from public.order_labels where order_id = :'C2')::integer, 0,
  'and still leaves the rail''s table');
select ok(not exists (select 1 from public.bills b join public.bill_items i on i.bill_id = b.id
                       where b.order_id in (:'C1', :'C2', :'D1') and i.item_name in ('Asha', 'SWG 77')),
  'no label reaches a bill');

select pg_temp.gate(false);
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('create_billing_order_v3', pg_temp.payload(:'D3', 1, 0) || '{"label":"Off"}'),
  'accepted', 'with the gate off, a labelled order');
select is(pg_temp.cancel(:'D3'), 'accepted', 'is cancelled');
select is((select count(*) from public.kept_order_labels where order_id = :'D3')::integer, 0,
  'and its label is not kept');

-- Off, the off path may bill an open delivery order, as the proposal says.
select is(pg_temp.send('create_billing_order_v3', pg_temp.delivery(pg_temp.payload(:'D4', 1, 0))),
  'accepted', 'a delivery order queued while on lands with the gate off');
select is(pg_temp.pay(:'D4'), 'accepted', 'and the off path may bill it');
select is(pg_temp.send('create_billing_order_v3', pg_temp.delivery(pg_temp.payload(:'D5', 1, 0))),
  'accepted', 'another lands off');
select is(pg_temp.hand_over(:'D5'), 'accepted', 'and a handover queued while on lands off too');
select pg_temp.gate(true);

-- ---------------------------------------------------------------------------
-- 9. Who sees the three tables.

select pg_temp.impersonate(:'COUNTER');
select ok((select count(*) from public.delivery_orders where outlet_id = :'KAL') > 0,
  'the outlet''s counter sees its delivery orders');
select ok((select count(*) from public.kept_order_labels where outlet_id = :'KAL') > 0,
  'and its kept labels');
select ok((select count(*) from public.delivery_handover_takebacks where outlet_id = :'KAL') > 0,
  'and its take-backs');
select throws_ok($$ insert into public.delivery_orders (order_id, outlet_id, marked_at)
                    values ('d8300000-0000-4000-a000-000000000011', '00000000-0000-4000-a000-000000000001', now()) $$,
  '42501', null, 'a counter cannot write a delivery row');
select throws_ok($$ update public.kept_order_labels set label = 'x' $$, '42501', null,
  'nor change a kept label');
select throws_ok($$ delete from public.delivery_handover_takebacks $$, '42501', null,
  'nor delete a take-back');

select pg_temp.impersonate(:'FA_KAL');
select ok((select count(*) from public.delivery_orders) > 0, 'the outlet''s manager sees them');
select pg_temp.impersonate(:'OWNER');
select ok((select count(*) from public.delivery_orders) > 0, 'the owner sees them');

select pg_temp.impersonate(:'FA_KPA');
select is((select count(*) from public.delivery_orders)::integer, 0,
  'another outlet''s manager sees no delivery order');
select is((select count(*) from public.delivery_handover_takebacks)::integer, 0, 'nor take-back');
select is((select count(*) from public.kept_order_labels)::integer, 0, 'nor kept label');
select pg_temp.impersonate(:'COUNTER_KPA');
select is((select count(*) from public.delivery_orders)::integer, 0,
  'another outlet''s counter sees no delivery order');
select is((select count(*) from public.delivery_handover_takebacks)::integer, 0, 'nor take-back');
select is((select count(*) from public.kept_order_labels)::integer, 0, 'nor kept label');

select pg_temp.unimpersonate();
select is(pg_temp.kitchen_tablet(:'K1', 'Delivery kitchen', 'do-k1', 'do.k1@login.shawarmania.invalid'),
  'ok', 'a kitchen tablet is set up');
-- Its session proven, as signing in on the tablet would.
update public.counter_devices set session_proven_at = now(), proof_expires_at = null where id = :'K1';
select is(pg_temp.open_kitchen(:'K1', 'biller.kalyani.two', :'BILLER_TWO', 'do-shift1'), 'ok',
  'and opens');
select pg_temp.impersonate(:'K1');
select is((select count(*) from public.delivery_orders)::integer, 0, 'the kitchen sees no delivery row');
select is((select count(*) from public.delivery_handover_takebacks)::integer, 0, 'nor take-back');
select is((select count(*) from public.kept_order_labels)::integer, 0, 'nor kept label');

select pg_temp.unimpersonate();
set local role anon;
select throws_ok($$ select count(*) from public.delivery_orders $$, '42501', null,
  'anonymous callers cannot read delivery orders');
select throws_ok($$ select count(*) from public.delivery_handover_takebacks $$, '42501', null,
  'nor take-backs');
select throws_ok($$ select count(*) from public.kept_order_labels $$, '42501', null,
  'nor kept labels');
select pg_temp.unimpersonate();

-- ---------------------------------------------------------------------------
-- 10. The kitchen board says Delivery, and a handed-over order leaves it.

select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('create_billing_order_v3', pg_temp.delivery(pg_temp.payload(:'D3' ::uuid, 0, 0) - 'lines' ||
  jsonb_build_object('lines', '[]'::jsonb))), 'arithmetic_invalid', 'an empty order is still refused by _v2');
select is(pg_temp.send('create_billing_order_v3',
  pg_temp.delivery(pg_temp.payload('d8300000-0000-4000-a000-000000000021', 1, 0)) || '{"label":"ZMT 9"}'),
  'accepted', 'a cooking delivery order');
select pg_temp.impersonate(:'K1');
select is((pg_temp.card('d8300000-0000-4000-a000-000000000021') ->> 'delivery')::boolean, true,
  'reads Delivery on the kitchen board');
select is(pg_temp.card('d8300000-0000-4000-a000-000000000021') ? 'label', false,
  'without its label');
select ok(not (pg_temp.card('d8300000-0000-4000-a000-000000000021')::text ~* 'paise'),
  'and without money');
select is((pg_temp.card(:'C1') ->> 'delivery')::boolean, false,
  'a counter order on the board is not Delivery');
select is(public.kitchen_board_v3() - 'orders' - 'readAt', public.kitchen_board_v2() - 'orders' - 'readAt',
  'the board is the _v2 board apart from its cards');
select is(pg_temp.card(:'D1'), null, 'a handed-over order is not on the board');
select ok(not exists (select 1 from jsonb_array_elements(public.kitchen_board_v3() -> 'orders') o
                       where o ->> 'status' = 'cancelled'
                         and coalesce(o ->> 'sourceOrderId', o ->> 'id') = :'D1'),
  'and rings no cancellation');

-- ---------------------------------------------------------------------------
-- 11. The figures: counter without delivery, delivery alone, no money.

select pg_temp.impersonate(:'FA_KAL');
select ok((public.overview_today_v3(:'KAL') ->> 'openPaise')::bigint
          < (public.overview_today_v2(:'KAL') ->> 'openPaise')::bigint,
  'Overview''s open total leaves out open delivery orders');
select is(public.overview_today_v3(:'KAL') - 'openPaise', public.overview_today_v2(:'KAL') - 'openPaise',
  'and is otherwise today''s');

select is((public.billing_day_stats_v2(:'KAL', pg_temp.today(), 'delivery') ->> 'handedOver')::integer,
  (select count(*)::integer from public.orders o join public.delivery_orders d on d.order_id = o.id
    where o.outlet_id = :'KAL' and o.business_date = pg_temp.today() and o.status::text = 'handed_over'),
  'Stats → Delivery counts the handovers');
select is((public.billing_day_stats_v2(:'KAL', pg_temp.today(), 'counter') ->> 'placed')::integer
          + (public.billing_day_stats_v2(:'KAL', pg_temp.today(), 'delivery') ->> 'placed')::integer,
  (public.billing_day_stats(:'KAL', pg_temp.today()) ->> 'placed')::integer,
  'counter and delivery split the day''s orders between them');
select ok(not (public.billing_day_stats_v2(:'KAL', pg_temp.today(), 'delivery') ? 'paid'),
  'Stats → Delivery has no paid figure');
select is(public.billing_day_numbers_v2(:'KAL', pg_temp.today()) -> 'deliveryStats',
  public.billing_day_stats_v2(:'KAL', pg_temp.today(), 'delivery'),
  'the day''s numbers carry the delivery Stats');

select ok(jsonb_array_length(public.billing_history_delivery_orders(:'KAL', pg_temp.today())) >= 2,
  'Billing history lists the handed-over and cancelled delivery orders');
select is((select x ->> 'label' from jsonb_array_elements(
             public.billing_history_delivery_orders(:'KAL', pg_temp.today())) x
            where x ->> 'orderId' = :'D1'), 'SWG 77', 'with the label kept');
select is((select jsonb_array_length(x -> 'takeBacks') from jsonb_array_elements(
             public.billing_history_delivery_orders(:'KAL', pg_temp.today())) x
            where x ->> 'orderId' = :'D1'), 1, 'and its take-back');
select ok(not (public.billing_history_delivery_orders(:'KAL', pg_temp.today())::text ~* 'paise|total|price'),
  'and no money');
select ok(exists (select 1 from jsonb_array_elements(
                   public.billing_history_bills_v2(:'KAL', pg_temp.today()) -> 'rows') r
                   where r ? 'order_label'), 'a bill carries its order''s label');
select is((public.billing_history_bills_v2(:'KAL', pg_temp.today()) -> 'matching'),
  (public.billing_history_bills(:'KAL', pg_temp.today()) -> 'matching'), 'and the same bills');

select is(public.sales_analytics_v3(:'KAL', pg_temp.today() - 6, pg_temp.today(), 'all', 2, 'equal', null, 'counter'),
  public.sales_analytics_v2(:'KAL', pg_temp.today() - 6, pg_temp.today(), 'all', 2, 'equal', null),
  'Analytics → Counter is _v2 exactly');
select is((select (t ->> 'orders')::integer from jsonb_array_elements(
             public.sales_analytics_v3(:'KAL', pg_temp.today() - 6, pg_temp.today(), 'all', 2, 'equal', null, 'delivery')
               -> 'totals') t where (t ->> 'period')::integer = 0),
  (select count(*)::integer from public.orders o join public.delivery_orders d on d.order_id = o.id
    where o.outlet_id = :'KAL' and o.status::text = 'handed_over'
      and o.business_date between pg_temp.today() - 6 and pg_temp.today()),
  'Analytics → Delivery counts the handed-over orders');
select is((select (i ->> 'units')::integer from jsonb_array_elements(
             public.sales_analytics_v3(:'KAL', pg_temp.today() - 6, pg_temp.today(), 'items', 2, 'equal', null, 'delivery')
               -> 'items') i where i ->> 'key' = :'BURGER'),
  (select coalesce(sum(i.quantity), 0)::integer from public.order_items i
     join public.orders o on o.id = i.order_id join public.delivery_orders d on d.order_id = o.id
    where o.outlet_id = :'KAL' and o.status::text = 'handed_over'
      and i.menu_item_id = :'BURGER'),
  'and the dishes they carried');
select ok(not exists (
  select 1 from jsonb_array_elements(
    public.sales_analytics_v3(:'KAL', pg_temp.today() - 6, pg_temp.today(), 'all', 2, 'equal', null, 'delivery')
      -> 'items') i where i -> 'revenue' <> 'null'::jsonb),
  'and no dish revenue');
select ok(not exists (
  select 1 from jsonb_array_elements(
    public.sales_analytics_v3(:'KAL', pg_temp.today() - 6, pg_temp.today(), 'all', 2, 'equal', null, 'delivery')
      -> 'days') d where d -> 'revenue' <> 'null'::jsonb),
  'nor daily revenue');
select is(public.sales_analytics_series_v3(:'KAL', pg_temp.today() - 6, pg_temp.today(), 2, :'BURGER', null, null, 'delivery') -> 'revenue',
  'null'::jsonb, 'a dish''s delivery series has no revenue');
select is(public.sales_analytics_series_v3(:'KAL', pg_temp.today() - 6, pg_temp.today(), 2, :'BURGER', null, null, 'counter'),
  public.sales_analytics_series_v2(:'KAL', pg_temp.today() - 6, pg_temp.today(), 2, :'BURGER', null, null),
  'and its counter series is _v2 exactly');

-- Another outlet's manager is refused every read.
select pg_temp.impersonate(:'FA_KPA');
select throws_ok($$ select public.billing_day_stats_v2('00000000-0000-4000-a000-000000000001', current_date, 'delivery') $$,
  '42501', null, 'another outlet''s manager cannot read its Stats');
select throws_ok($$ select public.billing_history_delivery_orders('00000000-0000-4000-a000-000000000001', current_date) $$,
  '42501', null, 'nor its delivery orders');
select throws_ok($$ select public.sales_analytics_v3('00000000-0000-4000-a000-000000000001', current_date - 1, current_date, 'all', 2, 'equal', null, 'delivery') $$,
  '42501', null, 'nor its analytics');
select throws_ok($$ select public.overview_today_v3('00000000-0000-4000-a000-000000000001') $$,
  null, null, 'nor its overview');

-- ---------------------------------------------------------------------------
-- 12. Offering Delivery: the owner and the outlet's managers only.

create function pg_temp.offer(p_on boolean) returns boolean language sql as $$
  select (public.set_outlet_service_settings_v2('00000000-0000-4000-a000-000000000001',
    o.dine_in_offered, o.takeaway_offered, o.table_numbers, o.packaging_mode,
    o.packaging_price_paise, o.packaging_free_for_gold, null, p_on)).delivery_offered
    from public.outlets o where o.id = '00000000-0000-4000-a000-000000000001'
$$;

select pg_temp.impersonate(:'FA_KAL');
select is(pg_temp.offer(true), true, 'the outlet''s manager turns Delivery on');
select pg_temp.impersonate(:'OWNER');
select is(pg_temp.offer(false), false, 'the owner turns it off');
select pg_temp.impersonate(:'BILLER');
select throws_ok($$ select pg_temp.offer(true) $$, '42501', null, 'a Biller cannot');
select pg_temp.impersonate(:'FA_KPA');
-- Directly: they cannot read Kalyani's row to copy its other choices.
select throws_ok($$ select public.set_outlet_service_settings_v2('00000000-0000-4000-a000-000000000001',
  true, true, false, 'off', null, false, null, true) $$, '42501', null, 'nor another outlet''s manager');
select pg_temp.unimpersonate();
set local role anon;
select throws_ok($$ select public.set_outlet_service_settings_v2('00000000-0000-4000-a000-000000000001',
  true, true, false, 'off', 0, false, null, true) $$, '42501', null, 'nor anonymous callers');
select pg_temp.unimpersonate();

select * from finish();
rollback;
