begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select is((select count(*) from public.outlets where not collect_customer_details), 0::bigint,
  'existing outlets keep customer collection on');
insert into public.outlets (id, code, name, location_label)
values ('00000000-0000-4000-a000-000000000077', 'collecttest', 'Synthetic Collection Test', 'Nowhere');
select ok((select collect_customer_details from public.outlets where code = 'collecttest'),
  'new outlets default collection on');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select lives_ok($q$ select public.set_outlet_service_settings(
  '00000000-0000-4000-a000-000000000002', false, false, false, 'off', null, false, false)
$q$, 'owner can disable collection at any outlet');
select is((select collect_customer_details from public.outlets where id = '00000000-0000-4000-a000-000000000002'), false,
  'owner choice persists');
select lives_ok($q$ select public.set_outlet_service_settings(
  '00000000-0000-4000-a000-000000000002', false, false, false, 'off', null, false)
$q$, 'older client service write still works');
select is((select collect_customer_details from public.outlets where id = '00000000-0000-4000-a000-000000000002'), false,
  'omitted new argument preserves the saved off choice');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select lives_ok($q$ select public.set_outlet_service_settings(
  '00000000-0000-4000-a000-000000000001', false, false, false, 'off', null, false, false)
$q$, 'assigned franchise admin can disable collection');
select is((select collect_customer_details from public.outlets where id = '00000000-0000-4000-a000-000000000001'), false,
  'same-outlet franchise admin reads their saved choice');
select throws_ok($q$ select public.set_outlet_service_settings(
  '00000000-0000-4000-a000-000000000002', false, false, false, 'off', null, false, true)
$q$, '42501', null, 'other-outlet franchise admin cannot change collection');
select is((select count(*) from public.outlets where id = '00000000-0000-4000-a000-000000000002'), 0::bigint,
  'other-outlet settings remain unreadable');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select throws_ok($q$ select public.set_outlet_service_settings(
  '00000000-0000-4000-a000-000000000001', false, false, false, 'off', null, false, true)
$q$, '42501', null, 'biller cannot change collection');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is((select collect_customer_details from public.outlets where id = '00000000-0000-4000-a000-000000000001'), false,
  'own-outlet tablet can read the choice for its counter');
select throws_ok($q$ select public.set_outlet_service_settings(
  '00000000-0000-4000-a000-000000000001', false, false, false, 'off', null, false, true)
$q$, '42501', null, 'tablet cannot change collection');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$ select public.set_outlet_service_settings(
  '00000000-0000-4000-a000-000000000001', false, false, false, 'off', null, false, true)
$q$, '42501', null, 'employee cannot change collection');

reset role;
select is((select collect_customer_details from public.outlets where id = '00000000-0000-4000-a000-000000000002'), false,
  'refused cross-outlet calls left that choice intact');
select ok(not has_function_privilege('anon',
  'public.set_outlet_service_settings(uuid,boolean,boolean,boolean,public.packaging_mode,integer,boolean,boolean)', 'execute'),
  'anonymous callers have no execute grant');
update public.profiles set is_active = false where id = '10000000-0000-4000-a000-000000000002';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$ select public.set_outlet_service_settings(
  '00000000-0000-4000-a000-000000000001', false, false, false, 'off', null, false, true)
$q$, '42501', null, 'deactivated manager cannot change collection');
select * from finish();
rollback;
