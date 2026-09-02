-- The management Tablets read is one RLS-scoped operational snapshot, not a
-- client-side join and not a feed.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub',p_sub,'role','authenticated')::text,true);
  execute 'set local role authenticated';
end;
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set DEVICE_KAL '10000000-0000-4000-a000-000000000004'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'
\set LIVE_SHIFT '90000000-0000-4000-a000-000000000001'
\set OLD_SHIFT 'aa000000-0000-4000-a000-000000000001'
\set TEST_BILL 'aa000000-0000-4000-a000-000000000002'
\set VOID_BILL 'aa000000-0000-4000-a000-000000000003'
\set CORRECTION_COMMAND 'aa000000-0000-4000-a000-000000000004'
\set CORRECTION 'aa000000-0000-4000-a000-000000000005'
\set OPEN_ORDER 'aa000000-0000-4000-a000-000000000006'

select has_function('public','counter_operations_snapshot',array['uuid[]'],
  'the management counter snapshot has one outlet-scoped read boundary');
select has_index('public','bills','bills_counter_shift_id_idx',
  'the live counter shift rollup does not scan every bill');

-- One settled bill whose original Cash tender is corrected to UPI. The void
-- beside it remains a bill rung, but contributes no current tender.
insert into public.bills
  (id,outlet_id,bill_number,business_date,payment_business_date,ordered_at,paid_at,
   biller_profile_id,counter_device_id,counter_shift_id,subtotal_paise,total_paise,
   status,voided_by,voided_at,void_reason)
values
  (:'TEST_BILL',:'KAL',9001,public.app_business_date(now(),time '04:00'),
   public.app_business_date(now(),time '04:00'),now()-interval '10 minutes',
   now()-interval '10 minutes',:'BILLER_KAL',:'DEVICE_KAL',:'LIVE_SHIFT',13900,13900,
   'settled',null,null,null),
  (:'VOID_BILL',:'KAL',9002,public.app_business_date(now(),time '04:00'),
   public.app_business_date(now(),time '04:00'),now()-interval '9 minutes',
   now()-interval '9 minutes',:'BILLER_KAL',:'DEVICE_KAL',:'LIVE_SHIFT',15900,15900,
   'void',:'FA_KAL',now()-interval '8 minutes','Snapshot test void');
insert into public.bill_payments (bill_id,outlet_id,method,amount_paise)
values (:'TEST_BILL',:'KAL','cash',13900),(:'VOID_BILL',:'KAL','cash',15900);
insert into public.billing_commands
  (id,outlet_id,device_id,shift_id,actor_id,client_created_at,command_type,
   payload_hash,schema_version,result_category,result)
values (:'CORRECTION_COMMAND',:'KAL',:'DEVICE_KAL',:'LIVE_SHIFT',:'BILLER_KAL',
  now()-interval '8 minutes','correct_bill_payment',repeat('a',64),1,'accepted','{}');
select set_config('app.billing_command','1',true);
insert into public.bill_payment_corrections
  (id,command_id,bill_id,outlet_id,device_id,shift_id,actor_id,revision,client_created_at)
values (:'CORRECTION',:'CORRECTION_COMMAND',:'TEST_BILL',:'KAL',:'DEVICE_KAL',
  :'LIVE_SHIFT',:'BILLER_KAL',1,now()-interval '8 minutes');
insert into public.bill_payment_correction_allocations
  (correction_id,outlet_id,method,amount_paise)
values (:'CORRECTION',:'KAL','upi',13900);

-- A waiting order created under an earlier shift still belongs to the physical
-- counter now held by the live shift. The oversight card counts what that
-- counter must serve, rather than losing the order at operator handover.
insert into public.counter_shifts
  (id,device_id,outlet_id,person_id,opened_at,business_date,expires_at,ended_at,ended_reason)
values (:'OLD_SHIFT',:'DEVICE_KAL',:'KAL',:'BILLER_KAL',now()-interval '3 hours',
  public.app_business_date(now(),time '04:00'),now()+interval '1 hour',
  now()-interval '2 hours','operator');
insert into public.orders
  (id,outlet_id,device_id,order_number,business_date,ordered_at,created_by,
   created_shift_id,subtotal_paise,total_paise,status)
values (:'OPEN_ORDER',:'KAL',:'DEVICE_KAL',9001,
  public.app_business_date(now(),time '04:00'),now()-interval '150 minutes',
  :'BILLER_KAL',:'OLD_SHIFT',17900,17900,'open');

-- Keyed on the tablet rather than the outlet from multiple-billing-devices on:
-- Kalyani holds two counters, so an outlet no longer names one row of this
-- snapshot. Every figure below belongs to the tablet that produced it.
select pg_temp.impersonate(:'OWNER'::uuid);
create temporary table pg_temp.owner_snapshot as
select * from public.counter_operations_snapshot(array[:'KAL'::uuid,:'KPA'::uuid]);
select is((select count(distinct read_at) from pg_temp.owner_snapshot),1::bigint,
  'every outlet and figure in one read has the same server timestamp');
select is((select operator_name from pg_temp.owner_snapshot where device_id=:'DEVICE_KAL'),
  'Synthetic Biller Kal','the owner sees the live shift operator name');
select is((select bill_count from pg_temp.owner_snapshot where device_id=:'DEVICE_KAL'),4::bigint,
  'bills rung includes seeded bills plus the settled and void fixture bills');
select is((select cash_total_paise from pg_temp.owner_snapshot where device_id=:'DEVICE_KAL'),13900::bigint,
  'the corrected fixture Cash is absent while the unrelated seeded Cash remains');
select is((select upi_total_paise from pg_temp.owner_snapshot where device_id=:'DEVICE_KAL'),29800::bigint,
  'the latest effective UPI correction is added once beside seeded UPI');
select is((select drawer_cash_paise from pg_temp.owner_snapshot where device_id=:'DEVICE_KAL'),13900::bigint,
  'drawer contribution follows effective Cash rather than original tender');
select is((select open_order_count from pg_temp.owner_snapshot where device_id=:'DEVICE_KAL'),1::bigint,
  'a waiting order inherited from the same tablet and business date remains visible');

select pg_temp.impersonate(:'FA_KAL'::uuid);
select is((select count(*) from public.counter_operations_snapshot(array[:'KAL'::uuid])),1::bigint,
  'a franchise admin reads their own outlet counter');
select throws_ok(
  format('select * from public.counter_operations_snapshot(array[%L::uuid])',:'KPA'),
  '42501',null,'a franchise admin hand-crafting another outlet request is refused');

select pg_temp.impersonate(:'FA_KPA'::uuid);
select throws_ok(
  format('select * from public.counter_operations_snapshot(array[%L::uuid,%L::uuid])',:'KPA',:'KAL'),
  '42501',null,'mixing an authorised and foreign outlet refuses the whole snapshot');

select pg_temp.impersonate(:'BILLER_KAL'::uuid);
select throws_ok(
  format('select * from public.counter_operations_snapshot(array[%L::uuid])',:'KAL'),
  '42501',null,'a Biller cannot use their handshake visibility to read counter money');

select pg_temp.impersonate(:'EMPLOYEE_KAL'::uuid);
select throws_ok(
  format('select * from public.counter_operations_snapshot(array[%L::uuid])',:'KAL'),
  '42501',null,'an Employee cannot read counter operations');

select pg_temp.impersonate(:'DEVICE_KAL'::uuid);
select throws_ok(
  format('select * from public.counter_operations_snapshot(array[%L::uuid])',:'KAL'),
  '42501',null,'the tablet itself cannot turn the management RPC into a money read');

select * from finish();
rollback;
