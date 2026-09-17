-- Editing a counter tablet without replacing its browser session, and the RLS
-- boundary after its stable Auth UUID has history at two outlets.

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
  perform set_config('request.jwt.claims', null, true);
  execute 'reset role';
end;
$$;

\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'
\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set BILLER_KPA '10000000-0000-4000-a000-00000000000b'
\set DEVICE '10000000-0000-4000-a000-00000000000f'
\set OLD_SHIFT 'f2000000-0000-4000-a000-000000000001'
\set NEW_SHIFT 'f2000000-0000-4000-a000-000000000002'
\set OLD_ORDER 'f3000000-0000-4000-a000-000000000001'
\set NEW_ORDER 'f3000000-0000-4000-a000-000000000002'
\set OLD_COMMAND 'f4000000-0000-4000-a000-000000000001'
\set LATE_COMMAND 'f4000000-0000-4000-a000-000000000002'
\set NEW_COMMAND 'f4000000-0000-4000-a000-000000000003'
\set OLD_REQUEST 'f5000000-0000-4000-a000-000000000001'
\set PENDING_REQUEST 'f5000000-0000-4000-a000-000000000002'
\set NEW_REQUEST 'f5000000-0000-4000-a000-000000000003'
\set OLD_LEGACY_SHIFT 'f6000000-0000-4000-a000-000000000001'
\set NEW_LEGACY_SHIFT 'f6000000-0000-4000-a000-000000000002'

select public.app_business_date(now()-interval '1 day',k.business_day_cutover) old_date,
       public.app_business_date(now(),p.business_day_cutover) new_date
  from public.outlets k,public.outlets p
 where k.id=:'KAL' and p.id=:'KPA' \gset

update public.counter_devices
   set outlet_id=:'KAL',label='Transfer test tablet',removed_at=null,
       last_seen_at=now(),last_reported_unsent=0,
       last_reported_oldest_unresolved_at=null
 where id=:'DEVICE';

create temporary table pg_temp.device_before as
select id,set_up_by,set_up_at,session_proven_at,proof_expires_at
  from public.counter_devices where id=:'DEVICE';

insert into public.counter_shifts
  (id,device_id,outlet_id,person_id,opened_at,business_date,expires_at)
values
  (:'OLD_SHIFT',:'DEVICE',:'KAL',:'BILLER_KAL',now()-interval '1 hour',
   :'old_date'::date,now()+interval '1 hour');

insert into public.shifts
  (id,outlet_id,counter_device_id,biller_profile_id,business_date,opened_at,closed_at)
values
  (:'OLD_LEGACY_SHIFT',:'KAL',:'DEVICE',:'BILLER_KAL',:'old_date'::date,
   now()-interval '1 day',now()-interval '23 hours');

insert into public.orders
  (id,outlet_id,order_number,device_id,created_by,created_shift_id,ordered_at,
   business_date,status,subtotal_paise,total_paise,pricing_mode)
values
  (:'OLD_ORDER',:'KAL',990001,:'DEVICE',:'BILLER_KAL',:'OLD_SHIFT',
   now()-interval '1 day',:'old_date'::date,'open',13900,13900,'no_tax');

insert into public.billing_commands
  (id,outlet_id,device_id,shift_id,actor_id,command_type,schema_version,
   payload_hash,client_created_at,received_at,business_date,result_category,result)
values
  (:'OLD_COMMAND',:'KAL',:'DEVICE',:'OLD_SHIFT',:'BILLER_KAL','create_order',1,
   repeat('a',64),now()-interval '1 day',now()-interval '1 hour',:'old_date'::date,
   'accepted',jsonb_build_object('status','accepted','orderId',:'OLD_ORDER'));

insert into public.counter_shift_requests
  (id,device_id,outlet_id,person_id,requested_username,code_hash,created_at,
   expires_at,resolution,resolved_at,shift_id)
values
  (:'OLD_REQUEST',:'DEVICE',:'KAL',:'BILLER_KAL','biller.kalyani',null,
   now()-interval '1 day',now()-interval '23 hours','confirmed',
   now()-interval '23 hours',:'OLD_SHIFT');

insert into public.billing_end_of_day_confirmations
  (outlet_id,device_id,business_date,shift_id,confirmed_at,command_watermark)
select :'KAL',:'DEVICE',:'old_date'::date,:'OLD_SHIFT',now()-interval '22 hours',
       watermark
  from public.billing_commands where id=:'OLD_COMMAND';

-- Name-only edits are small: they are allowed during a live shift and do not
-- require telemetry or ownership of the whole business.
select is(
  public.edit_counter_device(:'DEVICE',:'FA_KAL','  Front counter  ',:'KAL'),
  'ok',
  'a Franchise Admin renames a tablet at their managed outlet during a live shift');
select is(
  (select label from public.counter_devices where id=:'DEVICE'),
  'Front counter',
  'the stored label is trimmed');
select is(
  public.edit_counter_device(:'DEVICE',:'FA_KAL','Front counter',:'KAL'),
  'no_change',
  'submitting the same setup properties is an explicit no-op');
select is(
  public.edit_counter_device(:'DEVICE',:'FA_KAL','Cross-outlet name',:'KPA'),
  'not_authorised',
  'a Franchise Admin cannot hand-craft an outlet transfer');
select is(
  public.edit_counter_device(:'DEVICE',:'OWNER','Owner move',:'KPA'),
  'live_shift',
  'a live shift blocks an owner transfer');
select is(
  (select outlet_id from public.counter_devices where id=:'DEVICE'),
  :'KAL'::uuid,
  'refused edits leave the outlet unchanged');

update public.counter_shifts
   set ended_at=now(),ended_reason='operator'
 where id=:'OLD_SHIFT';

insert into public.counter_shift_requests
  (id,device_id,outlet_id,person_id,requested_username,code_hash,created_at,expires_at)
values
  (:'PENDING_REQUEST',:'DEVICE',:'KAL',:'BILLER_KAL','biller.kalyani','hash',
   now()-interval '10 minutes',now()-interval '5 minutes');
select is(
  public.edit_counter_device(:'DEVICE',:'OWNER','Owner move',:'KPA'),
  'pending_request',
  'even an expired but unresolved request blocks transfer');
update public.counter_shift_requests
   set resolution='cancelled',resolved_at=now(),code_hash=null
 where id=:'PENDING_REQUEST';

update public.counter_devices
   set last_seen_at=now()-interval '31 minutes'
 where id=:'DEVICE';
select is(
  public.edit_counter_device(:'DEVICE',:'OWNER','Owner move',:'KPA'),
  'stale_telemetry',
  'a report older than thirty minutes cannot prove the local queue empty');

update public.counter_devices
   set last_seen_at=now(),last_reported_unsent=1,
       last_reported_oldest_unresolved_at=now()-interval '5 minutes'
 where id=:'DEVICE';
select is(
  public.edit_counter_device(:'DEVICE',:'OWNER','Owner move',:'KPA'),
  'unresolved_work',
  'reported unresolved work blocks transfer');

update public.counter_devices
   set last_seen_at=now()-interval '10 seconds',last_reported_unsent=0,
       last_reported_oldest_unresolved_at=null
 where id=:'DEVICE';
insert into public.billing_commands
  (id,outlet_id,device_id,shift_id,actor_id,command_type,schema_version,
   payload_hash,client_created_at,received_at,business_date,result_category,result)
values
  (:'LATE_COMMAND',:'KAL',:'DEVICE',:'OLD_SHIFT',:'BILLER_KAL','create_order',1,
   repeat('b',64),now(),now(),:'old_date'::date,'accepted',jsonb_build_object('status','accepted'));
select is(
  public.edit_counter_device(:'DEVICE',:'OWNER','Owner move',:'KPA'),
  'stale_telemetry',
  'a zero report predating accepted server work does not establish an empty queue');

update public.counter_devices set last_seen_at=now() where id=:'DEVICE';
update public.outlets set is_active=false where id=:'KPA';
select is(
  public.edit_counter_device(:'DEVICE',:'OWNER','Owner move',:'KPA'),
  'inactive_outlet',
  'an inactive destination blocks transfer');
update public.outlets set is_active=true where id=:'KPA';

select is(
  public.edit_counter_device(
    :'DEVICE',:'OWNER','Kanchrapara counter tablet',:'KPA'),
  'label_taken',
  'the destination active-label index is translated to an actionable refusal');
select is(
  public.edit_counter_device(
    '10000000-0000-4000-a000-000000000009',:'OWNER','Old tablet',:'KAL'),
  'device_invalid',
  'a removed tablet cannot be edited');

update public.counter_devices
   set outlet_id=:'KAL',label='Unproven tablet',removed_at=null,
       last_seen_at=now(),last_reported_unsent=0,session_proven_at=null,
       proof_expires_at=now()+interval '5 minutes'
 where id='10000000-0000-4000-a000-000000000009';
select is(
  public.edit_counter_device(
    '10000000-0000-4000-a000-000000000009',:'OWNER','Still unproven',:'KAL'),
  'device_invalid',
  'an unproven setup cannot be edited');

select is(
  public.edit_counter_device(:'DEVICE',:'OWNER','Kanchrapara front counter',:'KPA'),
  'ok',
  'a Super Admin atomically changes name and outlet once every precondition holds');
select results_eq(
  $$select id,set_up_by,set_up_at,session_proven_at,proof_expires_at
      from public.counter_devices where id='10000000-0000-4000-a000-00000000000f'$$,
  $$select id,set_up_by,set_up_at,session_proven_at,proof_expires_at
      from pg_temp.device_before$$,
  'transfer preserves the Auth UUID, setup attribution and proven-session facts');
select is(
  (select outlet_id from public.counter_devices where id=:'DEVICE'),
  :'KPA'::uuid,
  'the current device context is now the destination outlet');

-- The stable device UUID does not grant its former history back. With no live
-- shift it sees no operational rows at either outlet.
select pg_temp.impersonate(:'DEVICE'::uuid);
select is((select count(*) from public.orders),0::bigint,
  'a transferred tablet with no shift reads no orders');
select is((select count(*) from public.billing_commands),0::bigint,
  'a transferred tablet with no shift reads no command receipts');
select is((select count(*) from public.billing_end_of_day_confirmations),0::bigint,
  'a transferred tablet with no shift reads no end-of-day confirmations');
select is((select count(*) from public.counter_shifts),0::bigint,
  'a transferred tablet with no shift reads no historical counter shifts');
select is((select count(*) from public.shifts),0::bigint,
  'a transferred tablet with no shift reads no legacy shifts');
select pg_temp.unimpersonate();

insert into public.counter_shifts
  (id,device_id,outlet_id,person_id,opened_at,business_date,expires_at)
values
  (:'NEW_SHIFT',:'DEVICE',:'KPA',:'BILLER_KPA',now(),:'new_date'::date,now()+interval '1 hour');
insert into public.shifts
  (id,outlet_id,counter_device_id,biller_profile_id,business_date,opened_at)
values
  (:'NEW_LEGACY_SHIFT',:'KPA',:'DEVICE',:'BILLER_KPA',:'new_date'::date,now());
insert into public.orders
  (id,outlet_id,order_number,device_id,created_by,created_shift_id,ordered_at,
   business_date,status,subtotal_paise,total_paise,pricing_mode)
values
  (:'NEW_ORDER',:'KPA',990001,:'DEVICE',:'BILLER_KPA',:'NEW_SHIFT',now(),
   :'new_date'::date,'open',15900,15900,'no_tax');
insert into public.billing_commands
  (id,outlet_id,device_id,shift_id,actor_id,command_type,schema_version,
   payload_hash,client_created_at,received_at,business_date,result_category,result)
values
  (:'NEW_COMMAND',:'KPA',:'DEVICE',:'NEW_SHIFT',:'BILLER_KPA','create_order',1,
   repeat('c',64),now(),now(),:'new_date'::date,'accepted',
   jsonb_build_object('status','accepted','orderId',:'NEW_ORDER'));
insert into public.counter_shift_requests
  (id,device_id,outlet_id,person_id,requested_username,code_hash,created_at,
   expires_at,resolution,resolved_at,shift_id)
values
  (:'NEW_REQUEST',:'DEVICE',:'KPA',:'BILLER_KPA','biller.kanchrapara',null,
   now(),now()+interval '2 minutes','confirmed',now(),:'NEW_SHIFT');
insert into public.billing_end_of_day_confirmations
  (outlet_id,device_id,business_date,shift_id,confirmed_at,command_watermark)
select :'KPA',:'DEVICE',:'new_date'::date,:'NEW_SHIFT',now(),watermark
  from public.billing_commands where id=:'NEW_COMMAND';

select pg_temp.impersonate(:'DEVICE'::uuid);
select is((select count(*) from public.orders where id=:'OLD_ORDER'),0::bigint,
  'the destination shift does not expose the device UUID''s former-outlet order');
select is((select count(*) from public.orders where id=:'NEW_ORDER'),1::bigint,
  'the destination shift reads destination orders');
select is((select count(*) from public.billing_commands where id=:'OLD_COMMAND'),0::bigint,
  'the destination shift does not expose a former-outlet command receipt');
select is((select count(*) from public.billing_commands where id=:'NEW_COMMAND'),1::bigint,
  'the destination shift reads its destination command receipt');
select is((select count(*) from public.billing_end_of_day_confirmations
            where outlet_id=:'KAL'),0::bigint,
  'the destination shift does not expose a former-outlet end-of-day row');
select is((select count(*) from public.billing_end_of_day_confirmations
            where outlet_id=:'KPA'),1::bigint,
  'the destination shift reads its destination end-of-day row');
select is((select count(*) from public.counter_shift_requests where id=:'OLD_REQUEST'),0::bigint,
  'the stable device UUID does not expose a former-outlet request');
select is((select count(*) from public.counter_shift_requests where id=:'NEW_REQUEST'),1::bigint,
  'the device reads its destination request');
select is((select count(*) from public.counter_shifts where id=:'OLD_SHIFT'),0::bigint,
  'the tablet does not read its historical counter shift');
select is((select count(*) from public.counter_shifts where id=:'NEW_SHIFT'),1::bigint,
  'the tablet reads only its current live counter shift');
select is((select count(*) from public.shifts where id=:'OLD_LEGACY_SHIFT'),0::bigint,
  'the destination shift does not expose a former-outlet legacy shift');
select is((select count(*) from public.shifts where id=:'NEW_LEGACY_SHIFT'),1::bigint,
  'the destination shift reads its destination legacy shift');
with changed as (
  update public.shifts set closed_at=now()
   where id=:'OLD_LEGACY_SHIFT' returning 1)
select is(
  (select count(*) from changed),
  0::bigint,
  'a direct write cannot reach the former-outlet legacy shift');
select pg_temp.unimpersonate();

-- Historical attribution did not move: the manager at A still owns its reads,
-- while the device session itself does not.
select pg_temp.impersonate(:'FA_KAL'::uuid);
select is((select count(*) from public.orders where id=:'OLD_ORDER'),1::bigint,
  'the former outlet manager retains its historical order');
select is((select count(*) from public.billing_commands where id=:'OLD_COMMAND'),1::bigint,
  'the former outlet manager retains its historical command receipt');
select is((select count(*) from public.counter_shifts where id=:'OLD_SHIFT'),1::bigint,
  'the former outlet manager retains its historical counter shift');
select pg_temp.unimpersonate();

select ok(
  not has_function_privilege(
    'authenticated',
    'public.edit_counter_device(uuid,uuid,text,uuid)',
    'EXECUTE'),
  'the reusable edit RPC is not callable by an application session');

select * from finish();
rollback;
