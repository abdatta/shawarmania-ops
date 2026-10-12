-- #74: dish handover, Ready receipts, privacy and cross-outlet refusals.
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

create function pg_temp.content(p_order uuid,p_shawarmas integer,p_burgers integer,p_label text,p_note text)
returns jsonb language sql as $$
  select jsonb_set(pg_temp.payload(p_order,p_shawarmas,p_burgers)||jsonb_build_object('label',p_label),
    '{lines,0,note}',to_jsonb(coalesce(p_note,'')))
$$;
create function pg_temp.send(p_fn text,p jsonb,p_id uuid default gen_random_uuid()) returns text
language plpgsql as $$
declare r jsonb;
begin
  execute format('select public.%I($1,1,public.billing_payload_hash($2),now(),$3,$2)',p_fn)
    into r using p_id,p,'90000000-0000-4000-a000-000000000001'::uuid;
  return r->>'status';
end;
$$;
create function pg_temp.tick(p_order uuid,p_menu uuid,p_prepared boolean) returns text language sql as $$
  select pg_temp.send('prepare_order_lines',jsonb_build_object('orderId',p_order,'lines',
    jsonb_build_array(jsonb_build_object('id',(select id from public.order_items
      where order_id=p_order and menu_item_id=p_menu),'prepared',p_prepared))))
$$;
create function pg_temp.ready_lines(p_order uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',l->>'id','quantity',(l->>'quantity')::integer)),'[]')
    from jsonb_array_elements(public.kitchen_board()->'orders') o,
         jsonb_array_elements(o->'lines') l where o->>'id'=p_order::text
$$;
create function pg_temp.pay(p_order uuid) returns text language sql as $$
  select pg_temp.send('pay_billing_order',jsonb_build_object('orderId',p_order,'billId',gen_random_uuid(),
    'paidAt',now(),'paymentBusinessDate',pg_temp.today(),'payments',
    jsonb_build_array(jsonb_build_object('method','cash','amountPaise',o.total_paise))))
  from public.orders o where o.id=p_order
$$;

select is(pg_temp.kitchen_tablet(:'K1','Kitchen 1','dish-k1','dish.k1@login.shawarmania.invalid'),'ok','kitchen one set up');
select is(pg_temp.kitchen_tablet(:'K2','Kitchen 2','dish-k2','dish.k2@login.shawarmania.invalid'),'ok','kitchen two set up');
update public.counter_devices set session_proven_at=now(),proof_expires_at=null where id in (:'K1',:'K2');
select is(pg_temp.open_kitchen(:'K1','biller.kalyani.two',:'BILLER_TWO','dish-shift1'),'ok','kitchen one opens');
select is(pg_temp.open_kitchen(:'K2','biller.kalyani',:'BILLER','dish-shift2'),'ok','kitchen two opens');
select pg_temp.impersonate(:'K1');
select is(public.set_kitchen_filter('include',array[:'SHAWARMA_CAT'::uuid]),'ok','kitchen one shawarmas');
select pg_temp.impersonate(:'K2');
select is(public.set_kitchen_filter('include',array[:'BURGERS_CAT'::uuid]),'ok','kitchen two burgers');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('create_billing_order',pg_temp.content(:'O1',2,1,'  Red shirt  ','  No sauce  ')),
  'accepted','label and note accepted with old envelope version');
select is((select label from public.orders where id=:'O1'),'Red shirt','label trimmed');
select is((select note from public.order_items where order_id=:'O1' and menu_item_id='31000000-0000-4000-a000-000000000001'),
  'No sauce','note trimmed');
select is(pg_temp.send('create_billing_order',pg_temp.content(:'O2',1,0,repeat('x',25),null)),
  'malformed_payload','long label refused');
select is(pg_temp.send('create_billing_order',pg_temp.content(:'O2',1,0,null,repeat('x',61))),
  'malformed_payload','long note refused');
select is(pg_temp.send('create_billing_order',jsonb_set(pg_temp.content(:'O2',1,0,null,'Note'),'{lines,0,kind}','"packaging"')),
  'malformed_payload','packaging note refused before arithmetic');
select is(pg_temp.send('create_billing_order',pg_temp.content(:'O2',1,0,'   ',null)),
  'accepted','blank label accepted');
select is((select label from public.orders where id=:'O2'),null::text,'blank label stored as none');
select pg_temp.impersonate(:'K1');
select ok(public.kitchen_board()::text like '%No sauce%','note reaches its kitchen');
select ok(public.kitchen_board()::text !~ 'Red shirt|Asha Counter|9876501234|Paise|paise|label|customer',
  'kitchen board omits label, customer and all money');
select pg_temp.ready_lines(:'O1') as ready_lines \gset
\set READY '74740000-0000-4000-a000-000000000001'
select is(public.kitchen_ready(:'READY',:'O1',:'ready_lines')->>'status','accepted','Ready accepted');
select is(public.kitchen_ready(:'READY',:'O1',:'ready_lines')->>'replay','true','Ready identity replays');
select is(public.kitchen_ready(:'READY',:'O2',:'ready_lines')->>'status','identity_conflict','Ready identity cannot change order');
select is((select count(*) from jsonb_array_elements(public.kitchen_board()->'orders') o
  where o->>'readyId'=:'READY'),1::bigint,'Done is a separate receipt');
select pg_temp.impersonate(:'K2');
select ok(public.kitchen_board()::text not like '%No sauce%','other kitchen does not receive hidden note');
select pg_temp.impersonate(:'COUNTER');
select is((select (o->'readyQuantities'->>i.id::text)::integer from jsonb_array_elements(public.counter_kitchen_marks()->'orders') o
  join public.order_items i on i.order_id=:'O1' and i.menu_item_id='31000000-0000-4000-a000-000000000001'
  where o->>'orderId'=:'O1'),2,'Ready quantity reaches counter');
select is(pg_temp.send('revise_billing_order',pg_temp.content(:'O1',3,1,'Red shirt','Changed')),
  'accepted','stale edit increasing Ready food accepted');
select is((select note from public.order_items where order_id=:'O1' and menu_item_id='31000000-0000-4000-a000-000000000001'),
  'No sauce','Ready note remains locked');
select pg_temp.impersonate(:'K1');
select is((select (o->>'ticketNumber')::int from jsonb_array_elements(public.kitchen_board()->'orders') o where o->>'id'=:'O1'),
  2,'extra food is ticket two');
select is((select (o->'lines'->0->>'quantity')::int from jsonb_array_elements(public.kitchen_board()->'orders') o where o->>'id'=:'O1'),
  1,'only the extra quantity is owed');
select is(public.kitchen_ready_undo(gen_random_uuid(),:'READY')->>'status','accepted','Undo has no time window');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.tick(:'O1','31000000-0000-4000-a000-000000000001',true),'accepted','tick shawarmas');
select is((select prepared_at from public.orders where id=:'O1'),null::timestamptz,'burger still unticked');
select is(pg_temp.tick(:'O1','31000000-0000-4000-a000-000000000007',true),'accepted','tick last dish');
select is((select prepared_source from public.orders where id=:'O1'),'counter','all dishes derive preparation');
select is(pg_temp.tick(:'O1','31000000-0000-4000-a000-000000000001',false),'accepted','untick unpaid');
select is((select prepared_at from public.orders where id=:'O1'),null::timestamptz,'untick clears preparation');
select is(pg_temp.send('revise_billing_order',pg_temp.content(:'O1',3,1,'Red shirt','Fixed while ticked')),'accepted','revision after handover');
select is(pg_temp.send('prepare_billing_order',jsonb_build_object('orderId',:'O1','prepared',true)),
  'accepted','old queued whole-order command still works');
select is((select count(*) from public.order_line_preparations where order_id=:'O1'),2::bigint,'legacy command ticks every dish');
select is(pg_temp.send('revise_billing_order',pg_temp.content(:'O1',4,1,'Red shirt','Ignored')),'accepted','queued edit raises ticked quantity');
select is((select prepared_at from public.orders where id=:'O1'),null::timestamptz,'larger quantity clears open preparation');
select is((select note from public.order_items where order_id=:'O1' and menu_item_id='31000000-0000-4000-a000-000000000001'),
  'Fixed while ticked','ticked note fixed even when quantity increases');
select is(pg_temp.send('prepare_billing_order',jsonb_build_object('orderId',:'O1','prepared',true)),
  'accepted','whole order tick again');
select is(pg_temp.pay(:'O1'),'accepted','pay prepared order');
select is((select label from public.orders where id=:'O1'),null::text,'payment of prepared order clears label');
select is(pg_temp.tick(:'O1','31000000-0000-4000-a000-000000000001',false),'order_not_open','finished order cannot be unticked');
select ok((select bool_and(not (to_jsonb(b) ? 'label')) from public.bills b where order_id=:'O1'),
  'bill has no label column');
select ok((select bool_and(not (to_jsonb(i) ? 'note')) from public.bill_items i join public.bills b on b.id=i.bill_id where b.order_id=:'O1'),
  'bill items have no note');

select is(pg_temp.send('create_billing_order',pg_temp.content(:'O3',2,0,'Paid first','No onion')),'accepted','upfront order');
select is(pg_temp.pay(:'O3'),'accepted','paid while cooking');
select is((select label from public.orders where id=:'O3'),'Paid first','label survives while cooking');
select pg_temp.impersonate(:'K1');
\set READY2 '74740000-0000-4000-a000-000000000002'
select is(public.kitchen_ready(:'READY2',:'O3',pg_temp.ready_lines(:'O3'))->>'status','accepted','upfront food Ready');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.tick(:'O3','31000000-0000-4000-a000-000000000001',true),'accepted','paid order completes on last tick');
select is((select label from public.orders where id=:'O3'),null::text,'last tick clears paid label');
select pg_temp.impersonate(:'K1');
select is(public.kitchen_ready(gen_random_uuid(),:'O3',:'ready_lines')->>'status','invalid','finished order refuses Ready');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('cancel_billing_order',jsonb_build_object('orderId',:'O2','reason','Left')),'accepted','cancel order');
select is((select label from public.orders where id=:'O2'),null::text,'cancellation clears label');

-- Day change clears labels and a delayed counter tick can supersede its stamp.
select is(pg_temp.send('create_billing_order',pg_temp.content('74740000-0000-4000-a000-000000000004',1,0,'Day change',null)),'accepted','day-change order');
select is(pg_temp.pay('74740000-0000-4000-a000-000000000004'),'accepted','day-change payment');
select pg_temp.unimpersonate();
select ok(public.finish_paid_orders_at_day_change(now()+interval '2 days')>0,'day change finishes food');
select is((select label from public.orders where id='74740000-0000-4000-a000-000000000004'),null::text,'day change clears label');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.tick('74740000-0000-4000-a000-000000000004','31000000-0000-4000-a000-000000000001',true),'accepted','delayed tick supersedes day change');
select is((select prepared_source from public.orders where id='74740000-0000-4000-a000-000000000004'),'counter','earlier counter time stands');
select pg_temp.unimpersonate();

-- Nonempty rows prove isolation rather than an empty-table coincidence.
select throws_ok('update public.kitchen_readies set lines=''[]''','42501',null,'Ready history append-only even to privileged writer');
select throws_ok('delete from public.kitchen_readies','42501',null,'Ready history cannot be deleted');
select pg_temp.impersonate(:'FA_KPA');
select is((select count(*) from public.order_line_preparations where outlet_id=:'KAL'),0::bigint,'other outlet admin sees no dish ticks');
select is((select count(*) from public.kitchen_readies where outlet_id=:'KAL'),0::bigint,'other outlet admin sees no Readies');
select pg_temp.impersonate(:'COUNTER');
select is((select count(*) from public.kitchen_readies),0::bigint,'counter reads Readies only through marks');
select pg_temp.impersonate(:'K1');
select is((select count(*) from public.order_line_preparations),0::bigint,'kitchen reads ticks only through board');
select is((select count(*) from public.kitchen_readies where device_id=:'K2'),0::bigint,'kitchen sees no other kitchen history');
select is(public.kitchen_ready(gen_random_uuid(),'50000000-0000-4000-a000-000000000011',:'ready_lines')->>'status',
  'not_authorised','Ready naming another outlet or missing order refused');
select pg_temp.unimpersonate();
select ok((select count(*) from public.order_line_preparations)>0,'dish isolation used real nonempty records');
select ok((select count(*) from public.kitchen_readies)>0,'Ready isolation used real nonempty records');

-- Stale Ready caps to today's food; later reduction/cancellation rings nothing.
select pg_temp.impersonate(:'COUNTER');
\set O4 '74740000-0000-4000-a000-000000000010'
\set R4 '74740000-0000-4000-a000-000000000011'
\set R5 '74740000-0000-4000-a000-000000000012'
select is(pg_temp.send('create_billing_order',pg_temp.content(:'O4',3,1,'Two kitchens','No mayo')),'accepted','two-kitchen order');
select pg_temp.impersonate(:'K1');
select pg_temp.ready_lines(:'O4') as stale_lines \gset
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('revise_billing_order',pg_temp.content(:'O4',2,1,'Two kitchens','No mayo')),'accepted','quantity lowered before Ready reaches server');
select pg_temp.impersonate(:'K1');
select is(public.kitchen_ready(:'R4',:'O4',:'stale_lines')->>'status','accepted','stale Ready records what cook made');
select is((select (o->'lines'->0->>'quantity')::integer from jsonb_array_elements(public.kitchen_board()->'orders') o
  where o->>'readyId'=:'R4'),2,'Done receipt capped to surviving quantity');
select is((select count(*) from jsonb_array_elements(public.kitchen_board()->'orders') o where o->>'id'=:'O4'),0::bigint,'lowered ready food produces no cooking ticket');
select pg_temp.impersonate(:'K2');
select is(public.kitchen_ready(:'R5',:'O4',pg_temp.ready_lines(:'O4'))->>'status','accepted','second kitchen Ready independently');
select pg_temp.impersonate(:'COUNTER');
select is((select (o->'dishStates')::text from jsonb_array_elements(public.counter_kitchen_marks()->'orders') o
  where o->>'orderId'=:'O4'),'["ready", "ready"]','both kitchens Ready');
select is(pg_temp.tick(:'O4','31000000-0000-4000-a000-000000000001',true),'accepted','handover only first kitchen');
select is((select (o->'dishStates')::text from jsonb_array_elements(public.counter_kitchen_marks()->'orders') o
  where o->>'orderId'=:'O4'),'["handed_over", "ready"]','handover clears only its kitchen');
select pg_temp.impersonate(:'K1');
select is(public.kitchen_ready_undo(gen_random_uuid(),:'R4')->>'status','accepted','Undo after handover');
select is((select count(*) from jsonb_array_elements(public.kitchen_board()->'orders') o
  where o->>'sourceOrderId'=:'O4' or o->>'id'=:'O4'),0::bigint,'Undo does not make handed-over food owed');
select pg_temp.impersonate(:'COUNTER');
select is((select p.quantity from public.order_line_preparations p join public.order_items i on i.id=p.order_item_id
  where p.order_id=:'O4'),2,'Undo preserves counter handover');
select is(pg_temp.tick(:'O4','31000000-0000-4000-a000-000000000001',false),'accepted','counter can restore unfinished food');
select pg_temp.impersonate(:'K1');
select is(public.kitchen_ready(gen_random_uuid(),:'O4',pg_temp.ready_lines(:'O4'))->>'status','accepted','restored food Ready again');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('cancel_billing_order',jsonb_build_object('orderId',:'O4','reason','Left')),'accepted','cancel after both kitchens Ready');
select is((select label from public.orders where id=:'O4'),null::text,'label cleared on actual labelled cancellation');
select pg_temp.impersonate(:'K1');
select is((select count(*) from jsonb_array_elements(public.kitchen_board()->'orders') o
  where o->>'sourceOrderId'=:'O4' or o->>'id'=:'O4'),0::bigint,'cancel after Ready rings nothing');
select pg_temp.impersonate(:'K2');
select is((select count(*) from jsonb_array_elements(public.kitchen_board()->'orders') o
  where o->>'sourceOrderId'=:'O4' or o->>'id'=:'O4'),0::bigint,'other kitchen cancellation silent too');
select pg_temp.unimpersonate();

select * from finish();
rollback;
