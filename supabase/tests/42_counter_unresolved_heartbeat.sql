-- The tablet heartbeat reports a freshness-qualified unresolved summary while
-- preserving the deployed one-argument RPC for rolling frontend deploys.

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

\set DEVICE_KAL '10000000-0000-4000-a000-000000000004'
\set DEVICE_KPA '10000000-0000-4000-a000-000000000005'
\set OWNER '10000000-0000-4000-a000-000000000001'
\set KAL '00000000-0000-4000-a000-000000000001'

select has_column('public','counter_devices','last_reported_oldest_unresolved_at',
  'counter telemetry stores the oldest unresolved creation time');
select has_function('public','report_counter_device_state',array['integer'],
  'the deployed heartbeat signature remains callable');
select has_function('public','report_counter_device_state',array['integer','timestamp with time zone'],
  'the richer heartbeat has a distinct PostgREST signature');
select has_function('public','counter_operations_snapshot_v2',array['uuid[]'],
  'the additive management snapshot carries richer telemetry');

select pg_temp.impersonate(:'DEVICE_KAL'::uuid);
select is(public.report_counter_device_state(2, '2026-08-29 01:23:00+00'::timestamptz),
  'ok','a live tablet reports count and actual oldest instant');
reset role;
select is((select last_reported_unsent from public.counter_devices where id=:'DEVICE_KAL'),2,
  'the richer heartbeat stores the unresolved count');
select is((select last_reported_oldest_unresolved_at from public.counter_devices where id=:'DEVICE_KAL'),
  '2026-08-29 01:23:00+00'::timestamptz,
  'the richer heartbeat stores the oldest unresolved instant');

select pg_temp.impersonate(:'DEVICE_KAL'::uuid);
select is(public.report_counter_device_state(0, '2026-08-29 01:23:00+00'::timestamptz),
  'ok','zero clears even when a caller supplies an obsolete oldest instant');
reset role;
select is((select last_reported_unsent from public.counter_devices where id=:'DEVICE_KAL'),0,
  'zero stores a clear count');
select is((select last_reported_oldest_unresolved_at from public.counter_devices where id=:'DEVICE_KAL'),
  null::timestamptz,'zero clears the oldest instant');

select pg_temp.impersonate(:'DEVICE_KAL'::uuid);
select is(public.report_counter_device_state(p_unsent => 3),'ok',
  'a rolling-deploy tablet can still call the legacy signature');
reset role;
select is((select last_reported_oldest_unresolved_at from public.counter_devices where id=:'DEVICE_KAL'),
  null::timestamptz,'a positive legacy report is explicitly oldest-unknown');

select pg_temp.impersonate(:'DEVICE_KPA'::uuid);
select is(public.report_counter_device_state(1, '2026-08-29 02:00:00+00'::timestamptz),
  'ok','another valid tablet can report only as itself');
reset role;
select is((select last_reported_unsent from public.counter_devices where id=:'DEVICE_KAL'),3,
  'another tablet cannot alter the Kalyani tablet row');

select pg_temp.impersonate(:'OWNER'::uuid);
select is(public.report_counter_device_state(9, '2026-08-29 03:00:00+00'::timestamptz),
  'invalid','a human account cannot masquerade as a tablet heartbeat');

reset role;
update public.counter_devices set removed_at = now() where id=:'DEVICE_KAL';
select pg_temp.impersonate(:'DEVICE_KAL'::uuid);
select is(public.report_counter_device_state(0, null),'invalid',
  'a removed tablet cannot repair or alter its retained telemetry');

reset role;
set local role anon;
select throws_ok(
  $$select public.report_counter_device_state(0, null)$$,
  '42501',null,'an anonymous caller has no heartbeat execute grant');

reset role;
select pg_temp.impersonate(:'OWNER'::uuid);
select is(
  (select last_reported_oldest_unresolved_at
     from public.counter_operations_snapshot_v2(array[:'KAL'::uuid]) limit 1),
  null::timestamptz,'the management snapshot exposes the qualified oldest fact');

select * from finish();
rollback;
