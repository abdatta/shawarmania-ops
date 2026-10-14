-- #74: the owner's Orders tab reads its kitchens as the counter does
-- (each-dish-is-ticked-off, design R11). `manager_kitchen_marks_v2(outlet)`
-- answers the owner and that outlet's franchise admins with exactly what
-- `counter_kitchen_marks_v2()` answers the outlet's counter, and refuses
-- everyone else.
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
\set BILLER '10000000-0000-4000-a000-00000000000a'
\set BILLER_TWO '10000000-0000-4000-a000-000000000010'
\set K1 'eeeeeeee-0000-4000-a000-000000000073'
\set SHAWARMA_CAT '30000000-0000-4000-a000-000000000001'
\set O1 'e9100000-0000-4000-a000-000000000001'
\set O2 'e9100000-0000-4000-a000-000000000002'

create function pg_temp.today() returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00')
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

/** The refusal's SQLSTATE, or 'ok'. */
create function pg_temp.refusal(p_outlet uuid) returns text language plpgsql as $$
begin
  perform public.manager_kitchen_marks_v2(p_outlet);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- A kitchen on shift and an order on the rail, one dish acknowledged.

select is(pg_temp.kitchen_tablet(:'K1', 'Kitchen 1', 'owner-k1', 'owner.k1@login.shawarmania.invalid'),
  'ok', 'a kitchen is set up');
update public.counter_devices set session_proven_at = now(), proof_expires_at = null where id = :'K1';
select is(pg_temp.open_kitchen(:'K1', 'biller.kalyani.two', :'BILLER_TWO', 'owner-shift1'),
  'ok', 'its shift opens');
select pg_temp.impersonate(:'K1');
select is(public.set_kitchen_filter('include', array[:'SHAWARMA_CAT'::uuid]), 'ok', 'it shows shawarmas');

select pg_temp.unimpersonate();
select public.change_gate_force('dish-ticks', true, 'pgTAP');
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('create_billing_order_v2', jsonb_build_object(
    'orderId', :'O1', 'businessDate', pg_temp.today(),
    'customerId', null, 'customerName', null, 'customerPhone', null,
    'subtotalPaise', 27800, 'discountPaise', 0, 'taxPaise', 0, 'totalPaise', 27800,
    'pricingMode', 'no_tax', 'label', 'Blue cap',
    'lines', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma', 'unitPricePaise', 13900,
      'quantity', 2, 'lineTotalPaise', 27800, 'note', 'No onion')))),
  'accepted', 'the counter rings an order');

select pg_temp.impersonate(:'K1');
select is(public.kitchen_acknowledge_v2(gen_random_uuid(), :'O1', 'new',
    (select (o ->> 'version')::timestamptz
       from jsonb_array_elements(public.kitchen_board_v2() -> 'orders') o
      where o ->> 'id' = :'O1')) ->> 'status',
  'accepted', 'the kitchen acknowledges it');

-- A second order the kitchen has not acknowledged.
select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.send('create_billing_order_v2', jsonb_build_object(
    'orderId', :'O2', 'businessDate', pg_temp.today(),
    'customerId', null, 'customerName', null, 'customerPhone', null,
    'subtotalPaise', 13900, 'discountPaise', 0, 'taxPaise', 0, 'totalPaise', 13900,
    'pricingMode', 'no_tax',
    'lines', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma', 'unitPricePaise', 13900,
      'quantity', 1, 'lineTotalPaise', 13900)))),
  'accepted', 'the counter rings another');

-- What the counter reads, to compare with.
select public.counter_kitchen_marks_v2() as counter_marks \gset

-- ---------------------------------------------------------------------------
-- The owner and this outlet's franchise admin read the same; nobody else does.

select pg_temp.impersonate(:'OWNER');
select is(public.manager_kitchen_marks_v2(:'KAL') - 'ackedLines', :'counter_marks'::jsonb,
  'the owner reads exactly what the counter reads');
select is(public.manager_kitchen_marks_v2(:'KAL') -> 'ackedLines' -> :'O1',
  jsonb_build_array((select id from public.order_items where order_id = :'O1')::text),
  'and that the kitchen acknowledged the dish');
select is(public.manager_kitchen_marks_v2(:'KAL') -> 'ackedLines' -> :'O2', null::jsonb,
  'and not a dish it has only been sent');
select is(public.manager_kitchen_marks_v2(:'KAL') #>> '{orders,0,dishStates,0}', 'acknowledged',
  'and sees the kitchen''s acknowledgement');

select pg_temp.impersonate(:'FA_KAL');
select is(public.manager_kitchen_marks_v2(:'KAL') - 'ackedLines', :'counter_marks'::jsonb,
  'this outlet''s franchise admin reads the same');

select pg_temp.impersonate(:'FA_KPA');
select is(pg_temp.refusal(:'KAL'), '42501', 'another outlet''s franchise admin is refused');

select pg_temp.impersonate(:'BILLER');
select is(pg_temp.refusal(:'KAL'), '42501', 'a biller''s own sign-in is refused');

select pg_temp.impersonate(:'COUNTER');
select is(pg_temp.refusal(:'KAL'), '42501', 'the counter tablet keeps its own read');

select pg_temp.impersonate(:'K1');
select is(pg_temp.refusal(:'KAL'), '42501', 'a kitchen tablet is refused');

select pg_temp.impersonate(:'OWNER');
select is(pg_temp.refusal(null), '42501', 'no outlet, no answer');

select pg_temp.unimpersonate();
select ok(not has_function_privilege('anon', 'public.manager_kitchen_marks_v2(uuid)', 'execute'),
  'anon cannot call it');

select * from finish();
rollback;
