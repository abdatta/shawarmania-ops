-- #72 the-counter-sees-the-kitchen.
--
-- The counter reads, per open order, which of its outlet's kitchens on shift
-- is still waiting to press ACK -- worked out by the kitchen's own rules, and
-- carrying nothing else. Two kitchen tablets, deliberately set up in the
-- opposite order to their labels, so the dots' order is proved to follow the
-- labels: Kitchen 1 shows the shawarmas, Kitchen 2 the burgers.

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

\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set COUNTER '10000000-0000-4000-a000-000000000004'
\set BILLER '10000000-0000-4000-a000-00000000000a'
\set BILLER_TWO '10000000-0000-4000-a000-000000000010'
\set K2 'eeeeeeee-0000-4000-a000-000000000072'
\set K1 'eeeeeeee-0000-4000-a000-000000000073'
\set SHAWARMA_CAT '30000000-0000-4000-a000-000000000001'
\set BURGERS_CAT '30000000-0000-4000-a000-000000000003'
\set O1 'e9000000-0000-4000-a000-000000000001'
\set O2 'e9000000-0000-4000-a000-000000000002'
\set O3 'e9000000-0000-4000-a000-000000000003'

create function pg_temp.today() returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00')
$$;

/**
 * The payload a counter sends for an order of shawarmas and burgers. Lines the
 * order already holds keep their ids, so the same call serves a revision.
 */
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
    'customerId', null, 'customerName', 'Asha Counter', 'customerPhone', '9876501234',
    'subtotalPaise', v_total, 'discountPaise', 0, 'taxPaise', 0, 'totalPaise', v_total,
    'pricingMode', 'no_tax', 'lines', v_lines);
end;
$$;

create function pg_temp.take_order(p_order uuid, p_shawarmas integer, p_burgers integer)
returns text language plpgsql as $$
declare v jsonb := pg_temp.payload(p_order, p_shawarmas, p_burgers);
begin
  return public.create_billing_order(
    gen_random_uuid(), 1, public.billing_payload_hash(v), now(),
    '90000000-0000-4000-a000-000000000001', v) ->> 'status';
end;
$$;

create function pg_temp.revise_order(p_order uuid, p_shawarmas integer, p_burgers integer)
returns text language plpgsql as $$
declare v jsonb := pg_temp.payload(p_order, p_shawarmas, p_burgers);
begin
  return public.revise_billing_order(
    gen_random_uuid(), 1, public.billing_payload_hash(v), now(),
    '90000000-0000-4000-a000-000000000001', v) ->> 'status';
end;
$$;

create function pg_temp.marks() returns jsonb language sql as $$
  select public.counter_kitchen_marks()
$$;

/** One order's answers, in kitchen order, as text: '["waiting", null]'. */
create function pg_temp.answers(p_order uuid) returns text language sql as $$
  select (o -> 'marks')::text
    from jsonb_array_elements(public.counter_kitchen_marks() -> 'orders') o
   where o ->> 'orderId' = p_order::text
$$;

/** Acknowledge as the calling kitchen, at the version its board shows. */
create function pg_temp.ack(p_order uuid, p_kind text) returns text language sql as $$
  select public.kitchen_acknowledge(gen_random_uuid(), p_order, p_kind,
    (select (o ->> 'version')::timestamptz
       from jsonb_array_elements(public.kitchen_board() -> 'orders') o
      where o ->> 'id' = p_order::text)) ->> 'status'
$$;

/** Two kitchen tablets, issued and redeemed as the Tablets list does it. */
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

-- ---------------------------------------------------------------------------
-- Shape, and who may ask.

select has_function('public', 'counter_kitchen_marks', array[]::text[],
  'the counter has one kitchen read');
select ok(not has_function_privilege('anon', 'public.counter_kitchen_marks()', 'EXECUTE'),
  'which anonymous callers cannot call');
select ok(not has_function_privilege('authenticated', 'public.kitchen_same_lines(jsonb, jsonb)', 'EXECUTE'),
  'and whose comparison is internal');

-- The kitchen's "same dishes" rule: the pairs src/domain/kitchen.test.ts pins.
select ok(public.kitchen_same_lines(
  '[{"menuItemId":"a","itemName":"A","quantity":2}]',
  '[{"menuItemId":"a","itemName":"A","quantity":1},{"menuItemId":"a","itemName":"A","quantity":1}]'),
  'two lines of one dish equal one line of their sum');
select ok(not public.kitchen_same_lines(
  '[{"menuItemId":"a","itemName":"A","quantity":2}]',
  '[{"menuItemId":"a","itemName":"A","quantity":3}]'),
  'a changed quantity differs');
select ok(not public.kitchen_same_lines(
  '[{"menuItemId":"a","itemName":"A","quantity":1}]',
  '[{"menuItemId":"a","itemName":"A","quantity":1},{"menuItemId":"b","itemName":"B","quantity":1}]'),
  'an added dish differs');
select ok(public.kitchen_same_lines(
  '[{"menuItemId":null,"itemName":"Off menu","quantity":1}]',
  '[{"menuItemId":null,"itemName":"Off menu","quantity":1}]'),
  'a line with no menu item is matched by its name');
select ok(public.kitchen_same_lines('[]', '[]'), 'nothing equals nothing');

-- An outlet with no kitchen tablet: nothing at all, so the counter never says
-- "Kitchen offline" where there is no kitchen screen.
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.marks(), '{"orders": [], "kitchens": [], "kitchenTablets": 0}'::jsonb,
  'an outlet with no kitchen tablet reads no kitchens and none set up');
select pg_temp.unimpersonate();

-- Kitchen 2 is set up first, so its id is not what puts it second.
select is(pg_temp.kitchen_tablet(:'K2', 'Kitchen 2', 'k72-hash', 'kitchen.72@login.shawarmania.invalid'),
  'ok', 'a kitchen tablet labelled Kitchen 2');
select is(pg_temp.kitchen_tablet(:'K1', 'kitchen 1', 'k73-hash', 'kitchen.73@login.shawarmania.invalid'),
  'ok', 'and one labelled kitchen 1, in lower case');
update public.counter_devices set session_proven_at = now(), proof_expires_at = null
 where id in (:'K1', :'K2');

-- ---------------------------------------------------------------------------
-- No kitchen on shift: nothing to show.

select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.take_order(:'O1', 2, 1), 'accepted', 'O1: shawarmas and a burger');
select is(pg_temp.take_order(:'O2', 1, 0), 'accepted', 'O2: a shawarma alone');
select is(pg_temp.marks(), '{"orders": [], "kitchens": [], "kitchenTablets": 2}'::jsonb,
  'with no kitchen on shift the counter has no answers, and knows two kitchen tablets are set up');
select pg_temp.unimpersonate();

-- A kitchen shift starting bumps the pulse.
delete from public.kitchen_pulses where outlet_id = :'KAL';
select is(pg_temp.open_kitchen(:'K2', 'biller.kalyani', :'BILLER', 'k72-shift'), 'ok',
  'Kitchen 2 opens');
select ok(exists (select 1 from public.kitchen_pulses where outlet_id = :'KAL'),
  'and a kitchen shift starting nudges the counter');
select is(pg_temp.open_kitchen(:'K1', 'biller.kalyani.two', :'BILLER_TWO', 'k73-shift'), 'ok',
  'kitchen 1 opens');

-- Each shows its own food. A filter change bumps the pulse.
select pg_temp.impersonate(:'K1');
select is(public.set_kitchen_filter('include', array[:'SHAWARMA_CAT'::uuid]), 'ok',
  'kitchen 1 shows only shawarmas');
select pg_temp.impersonate(:'K2');
select pg_temp.unimpersonate();
delete from public.kitchen_pulses where outlet_id = :'KAL';
select pg_temp.impersonate(:'K2');
select is(public.set_kitchen_filter('include', array[:'BURGERS_CAT'::uuid]), 'ok',
  'Kitchen 2 shows only burgers');
select pg_temp.unimpersonate();
select ok(exists (select 1 from public.kitchen_pulses where outlet_id = :'KAL'),
  'a kitchen''s filter change nudges the counter');

-- ---------------------------------------------------------------------------
-- The answers.

select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.marks() -> 'kitchens',
  jsonb_build_array(jsonb_build_object('id', :'K1', 'label', 'kitchen 1'),
                    jsonb_build_object('id', :'K2', 'label', 'Kitchen 2')),
  'the kitchens on shift, by label, whatever the case or the order they were set up in');
select is(pg_temp.answers(:'O1'), '["waiting", "waiting"]',
  'O1 waits on both kitchens');
select is(pg_temp.answers(:'O2'), '["waiting", null]',
  'O2 waits on kitchen 1, and Kitchen 2 does not carry it');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.marks()) k),
  array['kitchens', 'kitchenTablets', 'orders'], 'the read carries kitchens, orders and a count of kitchen tablets');
select is((select array_agg(distinct k order by k)
             from jsonb_array_elements(pg_temp.marks() -> 'orders') o, jsonb_object_keys(o) k),
  array['marks', 'orderId'], 'and per order only its id and its answers: no dish, time or person');
select is((select array_agg(distinct k order by k)
             from jsonb_array_elements(pg_temp.marks() -> 'kitchens') o, jsonb_object_keys(o) k),
  array['id', 'label'], 'and per kitchen only its id and label');
select pg_temp.unimpersonate();

-- An ACK bumps the pulse, and answers for that kitchen alone.
delete from public.kitchen_pulses where outlet_id = :'KAL';
select pg_temp.impersonate(:'K1');
select is(pg_temp.ack(:'O1', 'new'), 'accepted', 'kitchen 1 presses ACK on O1');
select pg_temp.unimpersonate();
select ok(exists (select 1 from public.kitchen_pulses where outlet_id = :'KAL'),
  'an ACK nudges the counter');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.answers(:'O1'), '["seen", "waiting"]', 'O1: kitchen 1 has seen it, Kitchen 2 not');
select pg_temp.impersonate(:'K2');
select is(pg_temp.ack(:'O1', 'new'), 'accepted', 'Kitchen 2 presses ACK on O1');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.answers(:'O1'), '["seen", "seen"]', 'O1: every kitchen has seen it');

-- An edit re-arms only the kitchen whose dishes it changed.
select is(pg_temp.revise_order(:'O1', 2, 2), 'accepted', 'the counter adds a burger to O1');
select is(pg_temp.answers(:'O1'), '["seen", "waiting"]',
  'Kitchen 2 is waiting again; kitchen 1''s answer stands');
select pg_temp.impersonate(:'K2');
select is(pg_temp.ack(:'O1', 'edit'), 'accepted', 'Kitchen 2 acknowledges the edit');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.answers(:'O1'), '["seen", "seen"]', 'O1 is seen again');

-- An edit that takes every dish away from a kitchen leaves that kitchen
-- waiting -- its card there reads cancelled until it is acknowledged.
select is(pg_temp.revise_order(:'O1', 2, 0), 'accepted', 'the counter takes O1''s burgers away');
select is(pg_temp.answers(:'O1'), '["seen", "waiting"]',
  'Kitchen 2 still has a cancellation to acknowledge');
select pg_temp.impersonate(:'K2');
select is(pg_temp.ack(:'O1', 'cancel'), 'accepted', 'Kitchen 2 acknowledges it');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.answers(:'O1'), '["seen", null]', 'and no longer carries O1');

-- Prepared at the counter: the food is made.
select is(pg_temp.answers(:'O2'), '["waiting", null]', 'O2 still waits on kitchen 1');
select is(public.prepare_billing_order(
    gen_random_uuid(), 1,
    public.billing_payload_hash(jsonb_build_object('orderId', :'O2', 'prepared', true)), now(),
    '90000000-0000-4000-a000-000000000001',
    jsonb_build_object('orderId', :'O2', 'prepared', true)) ->> 'status',
  'accepted', 'the counter ticks O2 Prepared');
select is(pg_temp.answers(:'O2'), '["seen", null]', 'a prepared order is seen by every kitchen that carries it');
select pg_temp.unimpersonate();

-- A kitchen shift ending bumps the pulse, and the kitchen drops out.
delete from public.kitchen_pulses where outlet_id = :'KAL';
update public.counter_shifts set ended_at = now(), ended_reason = 'operator'
 where device_id = :'K2' and ended_at is null;
select ok(exists (select 1 from public.kitchen_pulses where outlet_id = :'KAL'),
  'a kitchen shift ending nudges the counter');
select pg_temp.impersonate(:'COUNTER');
select is(jsonb_array_length(pg_temp.marks() -> 'kitchens'), 1, 'only kitchen 1 is on shift now');
select is(pg_temp.take_order(:'O3', 0, 1), 'accepted', 'O3: a burger alone');
select is(pg_temp.answers(:'O3'), null, 'no kitchen on shift shows it, so it has no answers');
select pg_temp.unimpersonate();

-- ---------------------------------------------------------------------------
-- Refusals, and the pulse's reach.

select pg_temp.impersonate(:'K1');
select throws_ok('select public.counter_kitchen_marks()', '42501', null,
  'a kitchen shift cannot read the counter''s marks');
select pg_temp.impersonate(:'BILLER');
select throws_ok('select public.counter_kitchen_marks()', '42501', null,
  'nor can a person''s own session, a Biller holding a counter shift included');
select pg_temp.impersonate(:'FA_KAL');
select throws_ok('select public.counter_kitchen_marks()', '42501', null,
  'nor a manager');

select pg_temp.impersonate(:'COUNTER');
select is((select count(*) from public.kitchen_pulses where outlet_id = :'KAL'), 1::bigint,
  'a counter with a live shift reads its own outlet''s pulse');
select pg_temp.unimpersonate();
insert into public.kitchen_pulses (outlet_id) values (:'KPA')
  on conflict (outlet_id) do nothing;
select pg_temp.impersonate(:'COUNTER');
select is((select count(*) from public.kitchen_pulses where outlet_id = :'KPA'), 0::bigint,
  'and not another outlet''s');
select pg_temp.unimpersonate();

-- A counter with no live shift reads no pulse.
update public.counter_shifts set ended_at = now(), ended_reason = 'operator'
 where id = '90000000-0000-4000-a000-000000000001';
select pg_temp.impersonate(:'COUNTER');
select is((select count(*) from public.kitchen_pulses), 0::bigint,
  'a counter without a live shift reads no pulse');
select throws_ok('select public.counter_kitchen_marks()', '42501', null,
  'and no marks');
select pg_temp.unimpersonate();

select * from finish();
rollback;
