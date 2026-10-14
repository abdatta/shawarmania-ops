-- #74 relaunched (each-dish-is-ticked-off, design R1–R10): dish handover, Ready
-- receipts, labels, privacy, cross-outlet refusals, and what each path does with
-- the rows the other wrote (R4).
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
\set SHAWARMA '31000000-0000-4000-a000-000000000001'
\set BURGER '31000000-0000-4000-a000-000000000007'
\set O1 'e9000000-0000-4000-a000-000000000001'
\set O2 'e9000000-0000-4000-a000-000000000002'
\set O3 'e9000000-0000-4000-a000-000000000003'
\set O4 'e9000000-0000-4000-a000-000000000004'
\set O5 'e9000000-0000-4000-a000-000000000005'
\set O6 'e9000000-0000-4000-a000-000000000006'
\set O7 'e9000000-0000-4000-a000-000000000007'
\set O8 'e9000000-0000-4000-a000-000000000008'

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

/** The payload with a label and a note on its first line. */
create function pg_temp.content(p_order uuid, p_shawarmas integer, p_burgers integer, p_label text, p_note text)
returns jsonb language sql as $$
  select jsonb_set(pg_temp.payload(p_order, p_shawarmas, p_burgers) || jsonb_build_object('label', p_label),
    '{lines,0,note}', to_jsonb(coalesce(p_note, '')))
$$;

/** Send a billing command as the counter tablet, by function name. */
create function pg_temp.send(p_fn text, p jsonb, p_id uuid default gen_random_uuid()) returns text
language plpgsql as $$
declare r jsonb;
begin
  execute format('select public.%I($1,1,public.billing_payload_hash($2),now(),$3,$2)', p_fn)
    into r using p_id, p, '90000000-0000-4000-a000-000000000001'::uuid;
  return r ->> 'status';
end;
$$;

create function pg_temp.line(p_order uuid, p_menu uuid) returns uuid language sql as $$
  select id from public.order_items where order_id = p_order and menu_item_id = p_menu
$$;

create function pg_temp.tick(p_order uuid, p_menu uuid, p_prepared boolean) returns text language sql as $$
  select pg_temp.send('prepare_order_lines_v2', jsonb_build_object('orderId', p_order, 'lines',
    jsonb_build_array(jsonb_build_object('id', pg_temp.line(p_order, p_menu), 'prepared', p_prepared))))
$$;

create function pg_temp.pay(p_order uuid) returns text language sql as $$
  select pg_temp.send('pay_billing_order', jsonb_build_object('orderId', p_order, 'billId', gen_random_uuid(),
    'paidAt', now(), 'paymentBusinessDate', pg_temp.today(), 'payments',
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amountPaise', o.total_paise))))
  from public.orders o where o.id = p_order
$$;

/** The lines the calling kitchen's v2 board shows for an order's cooking ticket. */
create function pg_temp.ready_lines(p_order uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l ->> 'id', 'quantity', (l ->> 'quantity')::integer)), '[]')
    from jsonb_array_elements(public.kitchen_board_v2() -> 'orders') o,
         jsonb_array_elements(o -> 'lines') l
   where o ->> 'id' = p_order::text
$$;

/** The calling kitchen's v2 cooking ticket for an order, or null. */
create function pg_temp.ticket(p_order uuid) returns jsonb language sql as $$
  select o from jsonb_array_elements(public.kitchen_board_v2() -> 'orders') o
   where o ->> 'id' = p_order::text
$$;

/** The calling kitchen's old-board card for an order, or null. */
create function pg_temp.old_card(p_order uuid) returns jsonb language sql as $$
  select o from jsonb_array_elements(public.kitchen_board() -> 'orders') o
   where o ->> 'id' = p_order::text
$$;

/** The counter's v2 reading of one order. */
create function pg_temp.marks(p_order uuid) returns jsonb language sql as $$
  select o from jsonb_array_elements(public.counter_kitchen_marks_v2() -> 'orders') o
   where o ->> 'orderId' = p_order::text
$$;

/** ACK as the calling kitchen, through v2, at the version its v2 board shows. */
create function pg_temp.ack(p_order uuid, p_kind text) returns text language sql as $$
  select public.kitchen_acknowledge_v2(gen_random_uuid(), p_order, p_kind,
    (pg_temp.ticket(p_order) ->> 'version')::timestamptz) ->> 'status'
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

/** The owner's switch, as the operator path takes it (no app session in a test). */
create function pg_temp.gate(p_key text, p_on boolean) returns void language plpgsql as $$
begin
  perform pg_temp.unimpersonate();
  perform public.change_gate_force(p_key, p_on, 'pgTAP');
end;
$$;

-- ---------------------------------------------------------------------------
-- The gates exist, off, and the dependency is recorded.

select is((select enabled from public.change_gates where key = 'dish-ticks'), false, 'dish-ticks is declared off');
select is((select enabled from public.change_gates where key = 'kitchen-ready'), false, 'kitchen-ready is declared off');
select is((select depends_on from public.change_gate_dependencies where gate_key = 'kitchen-ready'),
  'dish-ticks', 'kitchen-ready depends on dish-ticks');

select is(pg_temp.kitchen_tablet(:'K1', 'Kitchen 1', 'dish-k1', 'dish.k1@login.shawarmania.invalid'), 'ok', 'kitchen one set up');
select is(pg_temp.kitchen_tablet(:'K2', 'Kitchen 2', 'dish-k2', 'dish.k2@login.shawarmania.invalid'), 'ok', 'kitchen two set up');
update public.counter_devices set session_proven_at = now(), proof_expires_at = null where id in (:'K1', :'K2');
select is(pg_temp.open_kitchen(:'K1', 'biller.kalyani.two', :'BILLER_TWO', 'dish-shift1'), 'ok', 'kitchen one opens');
select is(pg_temp.open_kitchen(:'K2', 'biller.kalyani', :'BILLER', 'dish-shift2'), 'ok', 'kitchen two opens');
select pg_temp.impersonate(:'K1');
select is(public.set_kitchen_filter('include', array[:'SHAWARMA_CAT'::uuid]), 'ok', 'kitchen one shawarmas');
select pg_temp.impersonate(:'K2');
select is(public.set_kitchen_filter('include', array[:'BURGERS_CAT'::uuid]), 'ok', 'kitchen two burgers');

-- ---------------------------------------------------------------------------
-- Labels and notes on the v2 commands; the old ones accept the keys and keep
-- neither, as they have since the rollback.

select pg_temp.gate('dish-ticks', true);
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('create_billing_order_v2', pg_temp.content(:'O1', 2, 1, '  Red shirt  ', '  No sauce  ')),
  'accepted', 'label and note accepted with the oldest envelope version');
select is((select label from public.order_labels where order_id = :'O1'), 'Red shirt', 'label trimmed, in its own table');
select is((select label from public.orders where id = :'O1'), null::text, 'the first launch''s column stays unused');
select is((select note from public.order_items where id = pg_temp.line(:'O1', :'SHAWARMA')), 'No sauce', 'note trimmed');
select is(pg_temp.send('create_billing_order_v2', pg_temp.content(:'O2', 1, 0, repeat('x', 25), null)),
  'malformed_payload', 'a long label is refused');
select is(pg_temp.send('create_billing_order_v2', pg_temp.content(:'O2', 1, 0, null, repeat('x', 61))),
  'malformed_payload', 'a long note is refused');
select is(pg_temp.send('create_billing_order_v2',
    jsonb_set(pg_temp.content(:'O2', 1, 0, null, 'Note'), '{lines,0,kind}', '"packaging"')),
  'malformed_payload', 'a note on packaging is refused before arithmetic');
select is(pg_temp.send('create_billing_order_v2', pg_temp.content(:'O2', 1, 0, '   ', null)),
  'accepted', 'a blank label is accepted');
select is((select count(*) from public.order_labels where order_id = :'O2'), 0::bigint, 'a blank label is stored as none');
select is(pg_temp.send('create_billing_order', pg_temp.content(:'O7', 1, 0, 'Old path', 'No onion')),
  'accepted', 'the old create still accepts the keys');
select is((select count(*) from public.order_labels where order_id = :'O7'), 0::bigint, 'the old create keeps no label');
select is((select note from public.order_items where id = pg_temp.line(:'O7', :'SHAWARMA')), null::text,
  'the old create keeps no note');
select is(pg_temp.send('revise_billing_order_v2', pg_temp.content(:'O2', 1, 0, 'Blue cap', null)),
  'accepted', 'a revision labels an order');
select is((select label from public.order_labels where order_id = :'O2'), 'Blue cap', 'the revision''s label is kept');
select is(pg_temp.send('revise_billing_order_v2', pg_temp.payload(:'O2', 1, 0)),
  'accepted', 'a revision without the key');
select is((select label from public.order_labels where order_id = :'O2'), 'Blue cap', 'leaves the label as it was');

-- ---------------------------------------------------------------------------
-- The kitchen's v2 board: notes to the kitchen showing the dish, never a label,
-- customer or money; the old board unchanged.

select pg_temp.impersonate(:'K1');
select ok(public.kitchen_board_v2()::text like '%No sauce%', 'the note reaches its kitchen');
select ok(public.kitchen_board_v2()::text !~ 'Red shirt|Blue cap|Asha Counter|9876501234|Paise|paise|label|customer',
  'the v2 board omits labels, customers and all money');
select ok(public.kitchen_board()::text not like '%No sauce%', 'the old board shows no note');
select pg_temp.impersonate(:'K2');
select ok(public.kitchen_board_v2()::text not like '%No sauce%', 'the other kitchen does not see a note on a dish it does not show');

-- ---------------------------------------------------------------------------
-- Ready (D5), and Ready answering for ACK (R4).

select pg_temp.impersonate(:'K1');
select pg_temp.ready_lines(:'O1') as ready_lines \gset
\set READY '74740000-0000-4000-a000-000000000001'
select is((pg_temp.ticket(:'O1') ->> 'acknowledged')::boolean, false, 'nobody has pressed ACK');
select is(public.kitchen_ready_v2(:'READY', :'O1', :'ready_lines') ->> 'status', 'accepted', 'Ready accepted');
select is(public.kitchen_ready_v2(:'READY', :'O1', :'ready_lines') ->> 'replay', 'true', 'a Ready replays by its id');
select is(public.kitchen_ready_v2(:'READY', :'O2', :'ready_lines') ->> 'status', 'identity_conflict',
  'a Ready id cannot move to another order');
select is((select count(*) from public.kitchen_acknowledgements where order_id = :'O1' and device_id = :'K1'),
  1::bigint, 'Ready recorded an acknowledgement the cook never pressed');
select ok((select max(acked_at) from public.kitchen_acknowledgements where order_id = :'O1' and device_id = :'K1')
          < (select at from public.kitchen_readies where id = :'READY'),
  'the acknowledgement is timed before its Ready');
select is((select lines -> 0 ->> 'note' from public.kitchen_acknowledgements where order_id = :'O1' and device_id = :'K1'),
  'No sauce', 'an acknowledgement snapshots full lines with their notes');
select is((pg_temp.old_card(:'O1') ->> 'acknowledged')::boolean, true,
  'the old board reads the Done order as acknowledged');
select is((pg_temp.old_card(:'O1') -> 'latestAck' -> 'lines' -> 0 ->> 'quantity')::integer, 2,
  'the old board compares full lines, and stays quiet');
select is(pg_temp.ticket(:'O1'), null::jsonb, 'nothing is owed, so no cooking ticket');
select is((select count(*) from jsonb_array_elements(public.kitchen_board_v2() -> 'orders') o
  where o ->> 'readyId' = :'READY'), 1::bigint, 'Done is a separate receipt');

select pg_temp.impersonate(:'COUNTER');
select is((pg_temp.marks(:'O1') -> 'readyQuantities' ->> pg_temp.line(:'O1', :'SHAWARMA')::text)::integer, 2,
  'the Ready quantity reaches the counter');
select is((pg_temp.marks(:'O1') -> 'dishStates')::text, '["ready", "sent"]',
  'kitchen one has Ready food, kitchen two is still to answer');
select is((pg_temp.marks(:'O1') -> 'marks')::text, '["seen", "waiting"]', 'and the old bell reads beside it');
select is((select o -> 'marks' from jsonb_array_elements(public.counter_kitchen_marks() -> 'orders') o
  where o ->> 'orderId' = :'O1')::text, '["seen", "waiting"]', 'the old marks read the same bell');

-- Food added after Ready is the next ticket; a locked line keeps its note.
select is(pg_temp.send('revise_billing_order_v2', pg_temp.content(:'O1', 3, 1, 'Red shirt', 'Changed')),
  'accepted', 'a stale edit raising Ready food is accepted');
select is((select note from public.order_items where id = pg_temp.line(:'O1', :'SHAWARMA')), 'No sauce',
  'a Ready line keeps its note');
select pg_temp.impersonate(:'K1');
select is((pg_temp.ticket(:'O1') ->> 'ticketNumber')::integer, 2, 'the extra food is ticket two');
select is((pg_temp.ticket(:'O1') -> 'lines' -> 0 ->> 'quantity')::integer, 1, 'only the extra is owed');
select is(pg_temp.ticket(:'O1') ->> 'latestAck', null::text, 'and it is new: no acknowledgement since Ready');
select is(pg_temp.ack(:'O1', 'new'), 'accepted', 'the kitchen acknowledges ticket two');
select is((pg_temp.ticket(:'O1') ->> 'acknowledged')::boolean, true, 'ticket two is acknowledged');
select is(public.kitchen_ready_undo_v2(gen_random_uuid(), :'READY') ->> 'status', 'accepted', 'Undo has no time window');
select is((pg_temp.ticket(:'O1') ->> 'ticketNumber')::integer, 1, 'after Undo the order is one ticket again');

-- ---------------------------------------------------------------------------
-- Ticks derive the order's Prepared (D6).

select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.tick(:'O1', :'SHAWARMA', true), 'accepted', 'tick the shawarmas');
select is((select prepared_at from public.orders where id = :'O1'), null::timestamptz, 'the burger is still unticked');
select pg_temp.impersonate(:'K1');
select is(pg_temp.ticket(:'O1'), null::jsonb, 'the ticked shawarmas leave kitchen one silently');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.tick(:'O1', :'BURGER', true), 'accepted', 'tick the last dish');
select is((select prepared_source from public.orders where id = :'O1'), 'counter', 'every dish ticked prepares the order');
select is(pg_temp.tick(:'O1', :'SHAWARMA', false), 'accepted', 'untick on an unpaid order');
select is((select prepared_at from public.orders where id = :'O1'), null::timestamptz, 'untick clears the preparation');

-- ---------------------------------------------------------------------------
-- The old path's preparation reads as every dish ticked (R4).

select is(pg_temp.send('create_billing_order_v2', pg_temp.content(:'O5', 2, 1, 'Old tick', null)), 'accepted',
  'an on-path order');
select is(pg_temp.send('prepare_billing_order', jsonb_build_object('orderId', :'O5', 'prepared', true)),
  'accepted', 'prepared whole by the old command, as a command queued while off would');
select is((select count(*) from public.order_line_preparations where order_id = :'O5'), 0::bigint,
  'the old command ticks no line');
select pg_temp.unimpersonate();
select is((select bool_and((l ->> 'ticked')::integer = (l ->> 'quantity')::integer)
             from jsonb_array_elements(public.dish_lines_v2(:'O5')) l), true,
  'the on path reads every dish of a prepared order as ticked');
select pg_temp.impersonate(:'COUNTER');
select is((pg_temp.marks(:'O5') -> 'dishStates')::text, '["handed_over", "handed_over"]',
  'and the counter''s slots as handed over');
select is(pg_temp.tick(:'O5', :'BURGER', false), 'accepted', 'untick one dish');
select is((select count(*) from public.order_line_preparations where order_id = :'O5'), 1::bigint,
  'the other dish was written ticked before the untick');
select is((select order_item_id from public.order_line_preparations where order_id = :'O5'),
  pg_temp.line(:'O5', :'SHAWARMA'), 'and it is the shawarma that stays ticked');
select is((select prepared_at from public.orders where id = :'O5'), null::timestamptz, 'the order is unprepared');
select is(pg_temp.send('prepare_billing_order', jsonb_build_object('orderId', :'O5', 'prepared', true)),
  'accepted', 'prepared whole again');
select is(pg_temp.send('revise_billing_order_v2', pg_temp.content(:'O5', 3, 1, 'Old tick', null)),
  'accepted', 'a revision adds a shawarma');
select is((select prepared_at from public.orders where id = :'O5'), null::timestamptz,
  'food added unprepares the order');
select is((select quantity from public.order_line_preparations where order_item_id = pg_temp.line(:'O5', :'SHAWARMA')),
  2, 'the shawarmas ticked before the revision are still the two that were');
select pg_temp.unimpersonate();
select is((select (l ->> 'ticked')::integer from jsonb_array_elements(public.dish_lines_v2(:'O5')) l
            where l ->> 'id' = pg_temp.line(:'O5', :'SHAWARMA')::text), 2,
  'so one shawarma is owed');
select pg_temp.impersonate(:'COUNTER');

-- ---------------------------------------------------------------------------
-- The label goes as the order leaves the rail, by every path (R8).

select is(pg_temp.send('prepare_billing_order', jsonb_build_object('orderId', :'O1', 'prepared', true)),
  'accepted', 'O1 prepared whole');
select is(pg_temp.pay(:'O1'), 'accepted', 'paid, prepared');
select is((select count(*) from public.order_labels where order_id = :'O1'), 0::bigint,
  'payment of a prepared order clears the label');
select is(pg_temp.tick(:'O1', :'SHAWARMA', false), 'order_not_open', 'a finished order takes no untick');
select ok((select bool_and(not (to_jsonb(b) ? 'label')) from public.bills b where order_id = :'O1'),
  'a bill has no label');
select ok((select bool_and(not (to_jsonb(i) ? 'note')) from public.bill_items i
            join public.bills b on b.id = i.bill_id where b.order_id = :'O1'),
  'a bill line has no note');

select is(pg_temp.send('create_billing_order_v2', pg_temp.content(:'O3', 2, 0, 'Paid first', 'No onion')),
  'accepted', 'an upfront order');
select is(pg_temp.pay(:'O3'), 'accepted', 'paid while cooking');
select is((select label from public.order_labels where order_id = :'O3'), 'Paid first', 'the label stays while it cooks');
select pg_temp.impersonate(:'K1');
\set READY2 '74740000-0000-4000-a000-000000000002'
select is(public.kitchen_ready_v2(:'READY2', :'O3', pg_temp.ready_lines(:'O3')) ->> 'status', 'accepted',
  'the upfront food is Ready');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.tick(:'O3', :'SHAWARMA', true), 'accepted', 'the paid order completes on its last tick');
select is((select count(*) from public.order_labels where order_id = :'O3'), 0::bigint, 'the last tick clears the label');
select pg_temp.impersonate(:'K1');
select is(public.kitchen_ready_v2(gen_random_uuid(), :'O3', :'ready_lines') ->> 'status', 'invalid',
  'a finished order refuses Ready');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('cancel_billing_order', jsonb_build_object('orderId', :'O2', 'reason', 'Left')),
  'accepted', 'a labelled order is cancelled by the old command');
select is((select count(*) from public.order_labels where order_id = :'O2'), 0::bigint, 'cancellation clears the label');

select is(pg_temp.send('create_billing_order_v2',
    pg_temp.content('74740000-0000-4000-a000-000000000004', 1, 0, 'Day change', null)), 'accepted', 'a day-change order');
select is(pg_temp.pay('74740000-0000-4000-a000-000000000004'), 'accepted', 'paid');
select pg_temp.unimpersonate();
select ok(public.finish_paid_orders_at_day_change(now() + interval '2 days') > 0, 'the day change finishes the food');
select is((select count(*) from public.order_labels where order_id = '74740000-0000-4000-a000-000000000004'),
  0::bigint, 'the day change clears the label');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.tick('74740000-0000-4000-a000-000000000004', :'SHAWARMA', true), 'accepted',
  'a delayed tick supersedes the day change');
select is((select prepared_source from public.orders where id = '74740000-0000-4000-a000-000000000004'), 'counter',
  'the earlier counter time stands');

-- With the gate off nothing clears a label; the on path's next create sweeps it.
select is(pg_temp.send('create_billing_order_v2', pg_temp.content(:'O6', 1, 0, 'Gap', null)), 'accepted',
  'a labelled order');
select pg_temp.gate('dish-ticks', false);
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('cancel_billing_order', jsonb_build_object('orderId', :'O6', 'reason', 'Left')),
  'accepted', 'cancelled while the gate is off');
select is((select count(*) from public.order_labels where order_id = :'O6'), 1::bigint,
  'the trigger does nothing while the gate is off');
select pg_temp.gate('dish-ticks', true);
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('create_billing_order_v2', pg_temp.content(:'O8', 1, 0, null, null)), 'accepted',
  'the next on-path order');
select is((select count(*) from public.order_labels where order_id = :'O6'), 0::bigint,
  'sweeps the label the gap left');

-- ---------------------------------------------------------------------------
-- Isolation and refusals. Nonempty rows prove isolation rather than an empty
-- table's coincidence.

select pg_temp.unimpersonate();
select throws_ok('update public.kitchen_readies set lines = ''[]''', '42501', null,
  'Ready history is append-only even to a privileged writer');
select throws_ok('delete from public.kitchen_readies', '42501', null, 'Ready history cannot be deleted');
select pg_temp.impersonate(:'FA_KPA');
select is((select count(*) from public.order_line_preparations where outlet_id = :'KAL'), 0::bigint,
  'another outlet''s admin sees no dish ticks');
select is((select count(*) from public.kitchen_readies where outlet_id = :'KAL'), 0::bigint,
  'another outlet''s admin sees no Readies');
select is((select count(*) from public.order_labels where outlet_id = :'KAL'), 0::bigint,
  'another outlet''s admin sees no labels');
select pg_temp.impersonate(:'FA_KAL');
select ok((select count(*) from public.order_labels where outlet_id = :'KAL') > 0, 'its own admin sees its labels');
select pg_temp.impersonate(:'COUNTER');
select is((select count(*) from public.kitchen_readies), 0::bigint, 'the counter reads Readies only through marks');
select ok((select count(*) from public.order_labels) > 0, 'the counter reads its outlet''s labels');
select pg_temp.impersonate(:'K1');
select is((select count(*) from public.order_line_preparations), 0::bigint, 'a kitchen reads ticks only through its board');
select is((select count(*) from public.order_labels), 0::bigint, 'a kitchen reads no label');
select is((select count(*) from public.kitchen_readies where device_id = :'K2'), 0::bigint,
  'a kitchen sees no other kitchen''s history');
select is(public.kitchen_ready_v2(gen_random_uuid(), '50000000-0000-4000-a000-000000000011', :'ready_lines') ->> 'status',
  'not_authorised', 'a Ready naming another outlet''s order, or none, is refused');
select throws_ok($$ insert into public.order_labels (order_id, outlet_id, label)
  values ('e9000000-0000-4000-a000-000000000008', '00000000-0000-4000-a000-000000000001', 'x') $$,
  '42501', null, 'no client writes a label');
select pg_temp.unimpersonate();
select ok((select count(*) from public.order_line_preparations) > 0, 'dish isolation used real records');
select ok((select count(*) from public.kitchen_readies) > 0, 'Ready isolation used real records');

-- ---------------------------------------------------------------------------
-- A stale Ready caps to today's food; later removal or cancellation rings
-- nothing; two kitchens answer for their own food.

select pg_temp.impersonate(:'COUNTER');
\set O9 '74740000-0000-4000-a000-000000000010'
\set R4 '74740000-0000-4000-a000-000000000011'
\set R5 '74740000-0000-4000-a000-000000000012'
select is(pg_temp.send('create_billing_order_v2', pg_temp.content(:'O9', 3, 1, 'Two kitchens', 'No mayo')),
  'accepted', 'a two-kitchen order');
select pg_temp.impersonate(:'K1');
select pg_temp.ready_lines(:'O9') as stale_lines \gset
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('revise_billing_order_v2', pg_temp.content(:'O9', 2, 1, 'Two kitchens', 'No mayo')),
  'accepted', 'the quantity is lowered before the Ready reaches the server');
select pg_temp.impersonate(:'K1');
select is(public.kitchen_ready_v2(:'R4', :'O9', :'stale_lines') ->> 'status', 'accepted',
  'a stale Ready records what the cook made');
select is((select (o -> 'lines' -> 0 ->> 'quantity')::integer from jsonb_array_elements(public.kitchen_board_v2() -> 'orders') o
  where o ->> 'readyId' = :'R4'), 2, 'the Done receipt is capped to the surviving quantity');
select is(pg_temp.ticket(:'O9'), null::jsonb, 'lowered Ready food leaves no cooking ticket');
select pg_temp.impersonate(:'K2');
select is(public.kitchen_ready_v2(:'R5', :'O9', pg_temp.ready_lines(:'O9')) ->> 'status', 'accepted',
  'the second kitchen is Ready on its own');
select pg_temp.impersonate(:'COUNTER');
select is((pg_temp.marks(:'O9') -> 'dishStates')::text, '["ready", "ready"]', 'both kitchens Ready');
select is(pg_temp.tick(:'O9', :'SHAWARMA', true), 'accepted', 'hand over the first kitchen''s food');
select is((pg_temp.marks(:'O9') -> 'dishStates')::text, '["handed_over", "ready"]', 'handover clears only its kitchen');
select pg_temp.impersonate(:'K1');
select is(public.kitchen_ready_undo_v2(gen_random_uuid(), :'R4') ->> 'status', 'accepted', 'Undo after handover');
select is((select count(*) from jsonb_array_elements(public.kitchen_board_v2() -> 'orders') o
  where o ->> 'sourceOrderId' = :'O9' or o ->> 'id' = :'O9'), 0::bigint,
  'Undo does not make handed-over food owed');
select pg_temp.impersonate(:'COUNTER');
select is((select quantity from public.order_line_preparations where order_id = :'O9'), 2,
  'Undo keeps the counter''s handover');
select is(pg_temp.tick(:'O9', :'SHAWARMA', false), 'accepted', 'the counter takes back unfinished food');
select pg_temp.impersonate(:'K1');
select is(public.kitchen_ready_v2(gen_random_uuid(), :'O9', pg_temp.ready_lines(:'O9')) ->> 'status', 'accepted',
  'the food is Ready again');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('cancel_billing_order', jsonb_build_object('orderId', :'O9', 'reason', 'Left')),
  'accepted', 'cancelled after both kitchens are Ready');
select is((select count(*) from public.order_labels where order_id = :'O9'), 0::bigint, 'its label goes');
select pg_temp.impersonate(:'K1');
select is((select count(*) from jsonb_array_elements(public.kitchen_board_v2() -> 'orders') o
  where o ->> 'sourceOrderId' = :'O9' or o ->> 'id' = :'O9'), 0::bigint, 'cancelling after Ready rings nothing');
select pg_temp.impersonate(:'K2');
select is((select count(*) from jsonb_array_elements(public.kitchen_board_v2() -> 'orders') o
  where o ->> 'sourceOrderId' = :'O9' or o ->> 'id' = :'O9'), 0::bigint, 'at the other kitchen either');

-- ---------------------------------------------------------------------------
-- An ACK after a tick stays silent, on both boards (R4).

select pg_temp.impersonate(:'COUNTER');
\set O10 '74740000-0000-4000-a000-000000000020'
select is(pg_temp.send('create_billing_order_v2', pg_temp.content(:'O10', 2, 1, null, null)), 'accepted',
  'an order for both kitchens');
select pg_temp.impersonate(:'K1');
select is(pg_temp.ack(:'O10', 'new'), 'accepted', 'kitchen one acknowledges');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('revise_billing_order_v2', pg_temp.content(:'O10', 3, 1, null, null)), 'accepted',
  'one more shawarma');
select pg_temp.impersonate(:'K1');
select pg_temp.ticket(:'O10') as edited \gset
select pg_temp.unimpersonate();
select ok(not public.kitchen_same_lines_v2(:'edited'::jsonb -> 'lines', :'edited'::jsonb -> 'latestAck' -> 'lines'),
  'a raised quantity reads as an edit');
select pg_temp.impersonate(:'K1');
select is(pg_temp.ack(:'O10', 'edit'), 'accepted', 'the edit is acknowledged');
select pg_temp.ticket(:'O10') as answered \gset
select pg_temp.unimpersonate();
select ok(public.kitchen_same_lines_v2(:'answered'::jsonb -> 'lines', :'answered'::jsonb -> 'latestAck' -> 'lines'),
  'and reads quiet');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.tick(:'O10', :'BURGER', true), 'accepted', 'the other kitchen''s burger is handed over');
select pg_temp.impersonate(:'K1');
select pg_temp.ticket(:'O10') as after_tick \gset
select pg_temp.old_card(:'O10') as old_after_tick \gset
select pg_temp.unimpersonate();
select ok(public.kitchen_same_lines_v2(:'after_tick'::jsonb -> 'lines', :'after_tick'::jsonb -> 'latestAck' -> 'lines'),
  'kitchen one stays quiet');
select is((:'old_after_tick'::jsonb -> 'latestAck' -> 'lines' -> 0 ->> 'quantity')::integer, 3,
  'the old board holds the same full snapshot');
select ok(public.kitchen_same_lines(:'old_after_tick'::jsonb -> 'lines', :'old_after_tick'::jsonb -> 'latestAck' -> 'lines'),
  'and reads it quiet too');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.tick(:'O10', :'SHAWARMA', true), 'accepted', 'the shawarmas are handed over');
select pg_temp.impersonate(:'K1');
select is(pg_temp.ticket(:'O10'), null::jsonb, 'handed over after ACK: silent, gone');
select is(pg_temp.old_card(:'O10'), null::jsonb, 'the old board agrees: prepared is done');

select pg_temp.unimpersonate();
select * from finish();
rollback;
