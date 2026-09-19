-- Supplier route history is configuration: every client is read-only, and
-- only the Super Admin may see it. The service role writes it out of band.

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

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select is(
  (select count(*) from public.supplier_delivery_routes),
  2::bigint,
  'the Super Admin reads the complete supplier route history');

select throws_ok(
  $$insert into public.supplier_delivery_routes (source_system, effective_from, outlet_id)
    values ('blocked-owner-write', date '2026-09-18',
            '00000000-0000-4000-a000-000000000001')$$,
  '42501', null,
  'even the Super Admin cannot write supplier routes through a client session');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is(
  (select count(*) from public.supplier_delivery_routes),
  0::bigint,
  'a Franchise Admin cannot read supplier route history');

select throws_ok(
  $$update public.supplier_delivery_routes
       set outlet_id = '00000000-0000-4000-a000-000000000001'$$,
  '42501', null,
  'a Franchise Admin cannot update supplier routes');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  (select count(*) from public.supplier_delivery_routes),
  0::bigint,
  'a Biller cannot read supplier route history');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select is(
  (select count(*) from public.supplier_delivery_routes),
  0::bigint,
  'an Employee cannot read supplier route history');

reset role;
set local role service_role;
insert into public.supplier_delivery_routes (source_system, effective_from, outlet_id)
values ('test-supplier', date '2026-09-18', '00000000-0000-4000-a000-000000000001');
select is(
  (select count(*) from public.supplier_delivery_routes
    where source_system = 'test-supplier'),
  1::bigint,
  'the service role can write supplier route configuration');

reset role;
set local role anon;
select throws_ok(
  $$select count(*) from public.supplier_delivery_routes$$,
  '42501', null,
  'an anonymous caller has no route-table privileges');

reset role;
select * from finish();
rollback;
