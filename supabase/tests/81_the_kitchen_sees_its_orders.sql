-- #70 the-kitchen-sees-its-orders.
--
-- A tablet is a counter or a kitchen. A kitchen shift opens through the
-- counter's own handshake and reaches exactly one thing -- a board of its
-- outlet's unfinished orders, without a customer, price or payment fact --
-- plus its own filter and acknowledgements. Everything else a tablet could
-- reach through a live shift is refused it, by narrowing the shared helpers
-- to counter shifts. Each refusal here is a hand-crafted request, never an
-- adapter call: the database is the only reader that decides.

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
\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set COUNTER '10000000-0000-4000-a000-000000000004'
\set COUNTER_SHIFT '90000000-0000-4000-a000-000000000001'
\set KITCHEN 'eeeeeeee-0000-4000-a000-000000000070'
\set SPARE 'eeeeeeee-0000-4000-a000-000000000071'
\set BILLER '10000000-0000-4000-a000-00000000000a'
\set BILLER_TWO '10000000-0000-4000-a000-000000000010'
\set EMPLOYEE '10000000-0000-4000-a000-000000000006'
\set SHAWARMA_CAT '30000000-0000-4000-a000-000000000001'
\set SALADS_CAT '30000000-0000-4000-a000-000000000002'
\set BURGERS_CAT '30000000-0000-4000-a000-000000000003'
\set CLASSIC '31000000-0000-4000-a000-000000000001'
\set BURGER '31000000-0000-4000-a000-000000000007'

create function pg_temp.today() returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00')
$$;

/** An order on the counter's live shift: shawarmas and burgers, and a customer. */
create function pg_temp.take_order(p_order uuid, p_shawarmas integer, p_burgers integer)
returns text language plpgsql as $$
declare v jsonb; v_lines jsonb := '[]'::jsonb; v_total integer := 0;
begin
  if p_shawarmas > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma', 'unitPricePaise', 13900,
      'quantity', p_shawarmas, 'lineTotalPaise', 13900 * p_shawarmas));
    v_total := v_total + 13900 * p_shawarmas;
  end if;
  if p_burgers > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'menuItemId', '31000000-0000-4000-a000-000000000007',
      'itemName', 'Fully Loaded Smashed Burger', 'unitPricePaise', 25000,
      'quantity', p_burgers, 'lineTotalPaise', 25000 * p_burgers));
    v_total := v_total + 25000 * p_burgers;
  end if;
  v := jsonb_build_object(
    'orderId', p_order, 'businessDate', pg_temp.today(),
    'customerId', null, 'customerName', 'Asha Kitchen', 'customerPhone', '9876501234',
    'subtotalPaise', v_total, 'discountPaise', 0, 'taxPaise', 0, 'totalPaise', v_total,
    'pricingMode', 'no_tax', 'lines', v_lines);
  return public.create_billing_order(
    gen_random_uuid(), 1, public.billing_payload_hash(v), now(),
    '90000000-0000-4000-a000-000000000001', v) ->> 'status';
end;
$$;

create function pg_temp.cancel_order(p_order uuid)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object('orderId', p_order, 'reason', 'Customer left');
  return public.cancel_billing_order(
    gen_random_uuid(), 1, public.billing_payload_hash(v), now(),
    '90000000-0000-4000-a000-000000000001', v) ->> 'status';
end;
$$;

create function pg_temp.board() returns jsonb language sql as $$
  select public.kitchen_board()
$$;

create function pg_temp.card(p_order uuid) returns jsonb language sql as $$
  select o from jsonb_array_elements(public.kitchen_board() -> 'orders') o
   where o ->> 'id' = p_order::text
$$;

create function pg_temp.version(p_order uuid) returns timestamptz language sql as $$
  select (pg_temp.card(p_order) ->> 'version')::timestamptz
$$;

-- ---------------------------------------------------------------------------
-- Shape.

select has_column('public', 'counter_devices', 'kind', 'a tablet has a kind');
select has_column('public', 'counter_shifts', 'kind', 'a shift has a kind');
select has_column('public', 'counter_device_setup_codes', 'kind', 'a setup code carries a kind');
select ok(has_column_privilege('authenticated', 'public.counter_shift_requests', 'kind', 'SELECT'),
  'a phone may read whether a request is for a counter or a kitchen');
select ok(not has_column_privilege('authenticated', 'public.counter_shift_requests', 'code_hash', 'SELECT'),
  'and still never the code');
select is((select count(*) from public.counter_devices where kind <> 'counter'), 0::bigint,
  'every tablet set up before this change is a counter');

-- ---------------------------------------------------------------------------
-- The setup code carries the kind, and the tablet it sets up is that kind.

select is((select status from public.issue_counter_device_setup_code(
    :'KAL', :'FA_KAL', 'Kitchen two', 'kitchen-setup-hash', interval '15 minutes', 'kitchen')),
  'ok', 'an FA issues a setup code for a kitchen');
select is((select kind from public.counter_device_setup_codes where code_hash = 'kitchen-setup-hash'),
  'kitchen', 'and the code carries it');
select is((select status from public.issue_counter_device_setup_code(
    :'KAL', :'FA_KAL', 'Billing two', 'billing-setup-hash', interval '15 minutes')),
  'ok', 'a code issued without a kind');
select is((select kind from public.counter_device_setup_codes where code_hash = 'billing-setup-hash'),
  'counter', 'is for billing, exactly as before');
select is((select status from public.issue_counter_device_setup_code(
    :'KAL', :'FA_KAL', 'Nonsense', 'nonsense-hash', interval '15 minutes', 'grill')),
  'invalid', 'an unknown kind is refused');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new,
                        email_change_token_current, email_change, phone_change,
                        phone_change_token, reauthentication_token, is_sso_user)
values ('00000000-0000-0000-0000-000000000000',
        'eeeeeeee-0000-4000-a000-000000000070', 'authenticated', 'authenticated',
        'kitchen.two.kalyani@login.shawarmania.invalid', now(),
        '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false);
select is((select status from public.redeem_counter_device_setup_code(
    'kitchen-setup-hash', 'eeeeeeee-0000-4000-a000-000000000070')),
  'ok', 'the kitchen code is redeemed');
select is((select kind from public.counter_devices where id = 'eeeeeeee-0000-4000-a000-000000000070'),
  'kitchen', 'and the tablet it set up is a kitchen');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new,
                        email_change_token_current, email_change, phone_change,
                        phone_change_token, reauthentication_token, is_sso_user)
values ('00000000-0000-0000-0000-000000000000',
        'eeeeeeee-0000-4000-a000-000000000071', 'authenticated', 'authenticated',
        'billing.two.kalyani@login.shawarmania.invalid', now(),
        '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false);
select is((select status from public.redeem_counter_device_setup_code(
    'billing-setup-hash', 'eeeeeeee-0000-4000-a000-000000000071')),
  'ok', 'the billing code is redeemed');
select is((select kind from public.counter_devices where id = 'eeeeeeee-0000-4000-a000-000000000071'),
  'counter', 'and its tablet is a counter');

-- Both prove their sessions, as a real tablet does on first sign-in.
update public.counter_devices set session_proven_at = now(), proof_expires_at = null
 where id in ('eeeeeeee-0000-4000-a000-000000000070', 'eeeeeeee-0000-4000-a000-000000000071');

-- ---------------------------------------------------------------------------
-- Changing a kind from the Tablets list.

update public.counter_devices
   set last_seen_at = now(), last_reported_unsent = 0,
       last_reported_oldest_unresolved_at = null
 where id in (:'COUNTER', :'KITCHEN', :'SPARE');

select is(public.edit_counter_device(:'SPARE', :'FA_KPA', 'Billing two', :'KAL', 'kitchen'),
  'not_authorised', 'another outlet''s FA cannot change a tablet''s kind');
select is(public.edit_counter_device(:'SPARE', :'FA_KAL', 'Kitchen 2', :'KAL', 'kitchen'),
  'ok', 'the outlet''s FA makes the spare counter a kitchen, renaming it in the same edit');
select is((select kind from public.counter_devices where id = :'SPARE'), 'kitchen',
  'it is a kitchen');
select is((select label from public.counter_devices where id = :'SPARE'), 'Kitchen 2',
  'and carries its new name');
select is(public.edit_counter_device(:'KITCHEN', :'FA_KAL', 'Kitchen 1', :'KAL'),
  'ok', 'renaming without naming a kind keeps the kind');
select is((select kind from public.counter_devices where id = :'KITCHEN'), 'kitchen',
  'still a kitchen');

-- ---------------------------------------------------------------------------
-- A kitchen shift, through the counter's own handshake. Biller two holds
-- nothing else, so their phone proves the person-side helpers.

select is((select status from public.request_counter_shift(
    :'KITCHEN', 'biller.kalyani.two', 'kitchen-shift-hash', interval '2 minutes')),
  'ok', 'the kitchen tablet asks for a shift');
select is((select kind from public.counter_shift_requests
            where device_id = :'KITCHEN' and resolution is null),
  'kitchen', 'the request is a kitchen request');
select is((select status from public.confirm_counter_shift(:'BILLER_TWO',
    (select id from public.counter_shift_requests where device_id = :'KITCHEN' and resolution is null),
    'kitchen-shift-hash')),
  'ok', 'a Biller confirms it from their own phone');
select is((select kind from public.counter_shifts where device_id = :'KITCHEN' and ended_at is null),
  'kitchen', 'and holds a kitchen shift');

-- Orders taken at the counter tablet while the kitchen shift is live.
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.take_order('e7000000-0000-4000-a000-000000000001', 2, 1), 'accepted',
  'O1: two shawarmas and a burger, for a named customer with a phone');
select is(pg_temp.take_order('e7000000-0000-4000-a000-000000000002', 0, 1), 'accepted',
  'O2: a burger alone');
select is(pg_temp.take_order('e7000000-0000-4000-a000-000000000003', 1, 0), 'accepted',
  'O3: a shawarma alone');
select pg_temp.unimpersonate();

select ok((select bumped_at is not null from public.kitchen_pulses where outlet_id = :'KAL'),
  'an order write bumps the outlet''s kitchen pulse');

-- ---------------------------------------------------------------------------
-- The authority split: a kitchen shift reaches the board and nothing billing.

select pg_temp.impersonate(:'KITCHEN');
select is((select count(*) from public.orders), 0::bigint,
  'a kitchen shift selects no order row: orders carry the customer');
select is((select count(*) from public.order_items), 0::bigint, 'nor any order line');
select is((select count(*) from public.bills), 0::bigint, 'nor any bill');
select is((select count(*) from public.menu_items), 0::bigint, 'nor the priced menu');
select is((select count(*) from public.expenses), 0::bigint, 'nor any expense');
select is((select count(*) from public.billing_commands), 0::bigint, 'nor any billing receipt');
select is((select count(*) from public.menu_categories), 3::bigint,
  'but it reads its outlet''s three categories, to choose its filter');
select is(public.app_may_look_up_customer(), false, 'it may not look up a customer');
select is(public.app_counter_shift_outlet(), null::uuid, 'it is not a counter shift');
select is(public.app_kitchen_shift_outlet(), :'KAL'::uuid, 'it is a kitchen shift at Kalyani');
select is(public.create_billing_order(gen_random_uuid(), 1, 'x', now(),
    (select id from public.counter_shifts where device_id = :'KITCHEN' and ended_at is null),
    jsonb_build_object('orderId', gen_random_uuid())) ->> 'status',
  'malformed_payload', 'a hand-crafted billing command is refused before it reaches an order');
select is((
  select public.prepare_billing_order(gen_random_uuid(), 1,
    public.billing_payload_hash(jsonb_build_object('orderId', 'e7000000-0000-4000-a000-000000000001', 'prepared', true)),
    now(), (select id from public.counter_shifts where device_id = :'KITCHEN' and ended_at is null),
    jsonb_build_object('orderId', 'e7000000-0000-4000-a000-000000000001', 'prepared', true)) ->> 'status'),
  'authorization_refused', 'a kitchen shift cannot tick Prepared');
select pg_temp.unimpersonate();

-- The person holding only a kitchen shift gains nothing on their own phone.
select pg_temp.impersonate(:'BILLER_TWO');
select is(public.app_may_look_up_customer(), false,
  'a Biller holding only a kitchen shift cannot look up customers from their phone');
select is(public.app_billing_outlet(), null::uuid, 'nor reach billing from it');
select pg_temp.unimpersonate();

-- A counter tablet cannot read the board.
select pg_temp.impersonate(:'COUNTER');
select throws_ok($$select public.kitchen_board()$$, '42501', null,
  'a counter shift cannot read the kitchen board');
-- Since #72 the counter reads its own outlet's pulse -- the nudge that a
-- kitchen's ACK may have changed its bells -- and nothing of the board.
select is((select count(*) from public.kitchen_pulses), 1::bigint,
  'it reads only its own outlet''s kitchen pulse (#72)');
select is((select count(*) from public.kitchen_pulses where outlet_id <> :'KAL'), 0::bigint,
  'and no other outlet''s');
select pg_temp.unimpersonate();

-- ---------------------------------------------------------------------------
-- The board.

select pg_temp.impersonate(:'KITCHEN');
select is(public.set_kitchen_filter('exclude', array[:'BURGERS_CAT'::uuid]), 'ok',
  'the kitchen hides burgers');
select is(public.set_kitchen_filter('exclude', array['30000000-0000-4000-a000-000000000011'::uuid]),
  'invalid', 'another outlet''s category is refused');

select is(jsonb_array_length(pg_temp.board() -> 'orders'), 2,
  'everything except burgers: O1 and O3, not the burger-only O2');
select is((pg_temp.board() -> 'orders' -> 0 ->> 'id'), 'e7000000-0000-4000-a000-000000000001',
  'oldest first');
select is(pg_temp.card('e7000000-0000-4000-a000-000000000001') -> 'lines' -> 0 ->> 'itemName',
  'Classic Chicken Shawarma', 'O1 shows its shawarmas');
select is((pg_temp.card('e7000000-0000-4000-a000-000000000001') -> 'lines' -> 0 ->> 'quantity')::int, 2,
  'with their quantity');
select is(jsonb_array_length(pg_temp.card('e7000000-0000-4000-a000-000000000001') -> 'lines'), 1,
  'and not the burger');
select is((pg_temp.card('e7000000-0000-4000-a000-000000000001') ->> 'otherItemCount')::int, 1,
  'which it counts as one item for another kitchen');
select is(pg_temp.board()::text ~ '9876501234|Asha Kitchen|Paise|paise', false,
  'no customer name, phone or amount anywhere on the board');
select is((select count(*) from jsonb_object_keys(pg_temp.card('e7000000-0000-4000-a000-000000000001')) k
            where k not in ('id', 'orderNumber', 'serviceType', 'tableNumber', 'orderedAt',
                            'version', 'status', 'cancelledAt', 'lines', 'otherItemCount',
                            'acknowledged', 'latestAck')),
  0::bigint, 'a card carries exactly the kitchen''s fields');

select is(public.set_kitchen_filter('include', array[:'BURGERS_CAT'::uuid]), 'ok',
  'the other kitchen shows only burgers');
select is(jsonb_array_length(pg_temp.board() -> 'orders'), 2, 'O1 and O2');
select is(pg_temp.card('e7000000-0000-4000-a000-000000000003'), null::jsonb,
  'and not the shawarma-only O3');
select is(public.set_kitchen_filter('exclude', array[:'BURGERS_CAT'::uuid]), 'ok', 'back to the shawarma kitchen');

-- The sort rides with the filter and is the tablet's own choice.
select is(pg_temp.board() ->> 'sort', 'oldest_first', 'a kitchen lists oldest first by default');
select is(public.set_kitchen_filter('exclude', array[:'BURGERS_CAT'::uuid], 'newest_first'), 'ok',
  'the kitchen can turn its board round');
select is(pg_temp.board() ->> 'sort', 'newest_first', 'and the board says so');
select is(public.set_kitchen_filter('exclude', array[:'BURGERS_CAT'::uuid]), 'ok',
  'saving the filter alone');
select is(pg_temp.board() ->> 'sort', 'newest_first', 'leaves the sort as it was');
select is(public.set_kitchen_filter('exclude', array[:'BURGERS_CAT'::uuid], 'sideways'), 'invalid',
  'an unknown sort is refused');
select is(public.set_kitchen_filter('exclude', array[:'BURGERS_CAT'::uuid], 'oldest_first'), 'ok',
  'back to oldest first');
select pg_temp.unimpersonate();

select is((select kitchen_filter_changed_by from public.counter_devices where id = :'KITCHEN'),
  :'BILLER_TWO'::uuid, 'the filter records who set it');

-- ---------------------------------------------------------------------------
-- Acknowledgements.

select pg_temp.impersonate(:'KITCHEN');
select is(pg_temp.card('e7000000-0000-4000-a000-000000000001') ->> 'acknowledged', 'false',
  'an unacknowledged order is new to this kitchen');
select is(public.kitchen_acknowledge('e8000000-0000-4000-a000-000000000001',
    'e7000000-0000-4000-a000-000000000001', 'new',
    pg_temp.version('e7000000-0000-4000-a000-000000000001')) ->> 'status',
  'accepted', 'the cook acknowledges O1');
select is(public.kitchen_acknowledge('e8000000-0000-4000-a000-000000000001',
    'e7000000-0000-4000-a000-000000000001', 'new',
    pg_temp.version('e7000000-0000-4000-a000-000000000001')) ->> 'replay',
  'true', 'an exact replay returns the stored acknowledgement');
select is(public.kitchen_acknowledge('e8000000-0000-4000-a000-000000000001',
    'e7000000-0000-4000-a000-000000000003', 'new',
    pg_temp.version('e7000000-0000-4000-a000-000000000003')) ->> 'status',
  'identity_conflict', 'the same identity for another order is a conflict');
select is(public.kitchen_acknowledge(gen_random_uuid(),
    'e7000000-0000-4000-a000-000000000003', 'new', now() - interval '1 day') ->> 'status',
  'stale', 'acknowledging a version that is no longer current is refused');
select is(pg_temp.card('e7000000-0000-4000-a000-000000000001') ->> 'acknowledged', 'true',
  'O1 is acknowledged here');
select is(pg_temp.card('e7000000-0000-4000-a000-000000000001') -> 'latestAck' -> 'lines' -> 0 ->> 'itemName',
  'Classic Chicken Shawarma', 'and the server snapshotted what was acknowledged');

-- A filter change that leaves O1 with nothing here: it reads as a cancellation
-- until acknowledged, because this kitchen had acknowledged it with a line.
select is(public.set_kitchen_filter('include', array[:'SALADS_CAT'::uuid]), 'ok',
  'the kitchen now shows only salads');
select is(jsonb_array_length(pg_temp.card('e7000000-0000-4000-a000-000000000001') -> 'lines'), 0,
  'O1 has nothing left here');
select ok(pg_temp.card('e7000000-0000-4000-a000-000000000001') is not null,
  'but stays on the board until the cook acknowledges losing it');
select is(public.kitchen_acknowledge(gen_random_uuid(),
    'e7000000-0000-4000-a000-000000000001', 'cancel',
    pg_temp.version('e7000000-0000-4000-a000-000000000001')) ->> 'status',
  'accepted', 'the cook acknowledges it');
select is(pg_temp.card('e7000000-0000-4000-a000-000000000001'), null::jsonb, 'and it leaves');
select is(public.set_kitchen_filter('exclude', array[:'BURGERS_CAT'::uuid]), 'ok', 'back to the shawarma kitchen');
select pg_temp.unimpersonate();

-- A cancellation stays until acknowledged.
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.cancel_order('e7000000-0000-4000-a000-000000000003'), 'accepted',
  'the counter cancels O3');
select pg_temp.unimpersonate();
select pg_temp.impersonate(:'KITCHEN');
select is(pg_temp.card('e7000000-0000-4000-a000-000000000003') ->> 'status', 'cancelled',
  'the kitchen still shows O3, as cancelled');
select is(public.kitchen_acknowledge(gen_random_uuid(),
    'e7000000-0000-4000-a000-000000000003', 'cancel',
    pg_temp.version('e7000000-0000-4000-a000-000000000003')) ->> 'status',
  'accepted', 'the cook acknowledges the cancellation');
select is(pg_temp.card('e7000000-0000-4000-a000-000000000003'), null::jsonb,
  'and it leaves the board');
select pg_temp.unimpersonate();

-- An unpaid order the counter ticks Prepared is done as far as the kitchen goes.
select pg_temp.impersonate(:'KITCHEN');
select is(public.set_kitchen_filter('include', array[:'BURGERS_CAT'::uuid]), 'ok',
  'the burger kitchen');
select ok(pg_temp.card('e7000000-0000-4000-a000-000000000002') is not null,
  'shows the unpaid burger order O2');
select pg_temp.unimpersonate();
select pg_temp.impersonate(:'COUNTER');
select is((select public.prepare_billing_order(gen_random_uuid(), 1,
    public.billing_payload_hash(jsonb_build_object('orderId', 'e7000000-0000-4000-a000-000000000002', 'prepared', true)),
    now(), :'COUNTER_SHIFT',
    jsonb_build_object('orderId', 'e7000000-0000-4000-a000-000000000002', 'prepared', true)) ->> 'status'),
  'accepted', 'the counter ticks O2 Prepared, still unpaid');
select pg_temp.unimpersonate();
select pg_temp.impersonate(:'KITCHEN');
select is(pg_temp.card('e7000000-0000-4000-a000-000000000002'), null::jsonb,
  'and it leaves the kitchen board though it stays on the counter''s rail');
select is(public.set_kitchen_filter('exclude', array[:'BURGERS_CAT'::uuid]), 'ok', 'back to the shawarma kitchen');
select pg_temp.unimpersonate();

select throws_ok($$update public.kitchen_acknowledgements set kind = 'edit'$$,
  '42501', null, 'acknowledgements are append-only, even to a privileged writer');
select throws_ok($$delete from public.kitchen_acknowledgements$$,
  '42501', null, 'and cannot be deleted');

-- Isolation of the two new tables.
select pg_temp.impersonate(:'FA_KPA');
select is((select count(*) from public.kitchen_acknowledgements), 0::bigint,
  'another outlet''s FA reads no Kalyani acknowledgement');
select is((select count(*) from public.kitchen_pulses where outlet_id = :'KAL'), 0::bigint,
  'nor Kalyani''s pulse');
select pg_temp.unimpersonate();
select pg_temp.impersonate(:'FA_KAL');
select ok((select count(*) from public.kitchen_acknowledgements) >= 3,
  'the outlet''s FA reads its kitchens'' acknowledgements');
select pg_temp.unimpersonate();
select pg_temp.impersonate(:'COUNTER');
select is((select count(*) from public.kitchen_acknowledgements), 0::bigint,
  'a counter tablet reads none');
select pg_temp.unimpersonate();
select pg_temp.impersonate(:'EMPLOYEE');
select is((select count(*) from public.kitchen_acknowledgements), 0::bigint,
  'an employee reads none');
select pg_temp.unimpersonate();

-- ---------------------------------------------------------------------------
-- One person, two jobs; and the day close ignores kitchens.

select is((select status from public.request_counter_shift(
    :'KITCHEN', 'biller.kalyani', 'kitchen-shift-hash-2', interval '2 minutes')),
  'ok', 'the counter''s biller asks for the kitchen too');
select is((select status from public.confirm_counter_shift(:'BILLER',
    (select id from public.counter_shift_requests where device_id = :'KITCHEN' and resolution is null),
    'kitchen-shift-hash-2')),
  'ok', 'and confirms it');
select is((select count(*) from public.counter_shifts
            where person_id = :'BILLER' and ended_at is null and expires_at > now()),
  2::bigint, 'they hold a counter shift and a kitchen shift at once');

select pg_temp.impersonate(:'FA_KAL');
select is((select kind from public.counter_operations_snapshot_v2(array[:'KAL'::uuid])
            where device_id = :'KITCHEN'), 'kitchen', 'the Tablets list reads a kitchen as a kitchen');
select is((select kitchen_filter_mode || ':' || array_to_string(kitchen_category_names, ',')
             from public.counter_operations_snapshot_v2(array[:'KAL'::uuid])
            where device_id = :'KITCHEN'),
  'exclude:Burgers', 'with its filter in words');
select is((select operator_name from public.counter_operations_snapshot_v2(array[:'KAL'::uuid])
            where device_id = :'KITCHEN'), 'Synthetic Biller Kal',
  'and who holds its shift');
select is((select bill_count from public.counter_operations_snapshot_v2(array[:'KAL'::uuid])
            where device_id = :'KITCHEN'), null::bigint, 'and no money figure for it');
select ok((select bill_count is not null from public.counter_operations_snapshot_v2(array[:'KAL'::uuid])
            where device_id = :'COUNTER'), 'while the counter keeps its figures');
select pg_temp.unimpersonate();

select pg_temp.impersonate(:'FA_KAL');
select is((public.billing_day_readiness(:'KAL', pg_temp.today()) ->> 'liveShifts')::int, 1,
  'day-close readiness counts the counter''s live shift and not the kitchen''s');
select pg_temp.unimpersonate();

-- Becoming a kitchen is refused while the counter owes the rail.
select is(public.edit_counter_device(:'COUNTER', :'FA_KAL', 'Kalyani counter tablet', :'KAL', 'kitchen'),
  'rail_orders', 'a counter with orders it took still on the rail cannot become a kitchen');
update public.counter_devices set last_reported_unsent = 2 where id = :'COUNTER';
select is(public.edit_counter_device(:'COUNTER', :'FA_KAL', 'Kalyani counter tablet', :'KAL', 'kitchen'),
  'unresolved_work', 'nor one still holding unsent work');
select is((select kind from public.counter_devices where id = :'COUNTER'), 'counter',
  'and nothing about it changed');

-- Becoming a counter ends the kitchen shift, and is never refused for owing.
select pg_temp.impersonate(:'KITCHEN');
select throws_ok($$select public.request_counter_shift(
    'eeeeeeee-0000-4000-a000-000000000070', 'biller.kalyani.two', 'pending-hash',
    interval '2 minutes')$$,
  '42501', null, 'a tablet cannot call the shift request itself: it goes through the Edge Function');
select pg_temp.unimpersonate();
create temporary table pending_request as
  select * from public.request_counter_shift(
    :'KITCHEN', 'biller.kalyani.two', 'pending-hash', interval '2 minutes');
select is((select status from pending_request), 'ok', 'a request is pending on the kitchen tablet');
select is(public.edit_counter_device(:'KITCHEN', :'OWNER', 'Kitchen 1', :'KAL', 'counter'),
  'ok', 'the owner turns the kitchen back into a counter');
select is((select ended_reason from public.counter_shifts
            where device_id = :'KITCHEN' and person_id = :'BILLER' and kind = 'kitchen'),
  'device_kind_changed', 'its live kitchen shift ended with the change');
select is((select resolution from public.counter_shift_requests
            where id = (select request_id from pending_request)),
  'cancelled', 'its pending request was cancelled');
select is((select count(*) from public.counter_shifts
            where person_id = :'BILLER' and ended_at is null and expires_at > now()),
  1::bigint, 'the biller''s counter shift is untouched');

select * from finish();
rollback;
