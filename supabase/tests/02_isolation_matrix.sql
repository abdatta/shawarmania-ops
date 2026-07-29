-- The cross-outlet isolation matrix. For every outlet-scoped table discovered
-- from the catalog, and for each scoped role: a session claimed to outlet A
-- reads zero of outlet B's rows and cannot update them — including by naming
-- B's outlet_id explicitly. The Super Admin sees exactly what the database
-- owner sees. Positive controls prove the policies are not simply deny-all.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Impersonation: exactly what PostgREST does — the authenticated role plus
-- request.jwt.claims.

create function pg_temp.impersonate(p_sub uuid, p_role text, p_outlet uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_sub, 'role', 'authenticated',
      'app_role', p_role, 'app_outlet_id', p_outlet
    )::text,
    true);
  execute 'set local role authenticated';
end;
$$;

create function pg_temp.cross_read_count(tbl text, other_outlet uuid)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where outlet_id = %L', tbl, other_outlet)
    into n;
  return n;
exception when insufficient_privilege then
  return -1;  -- read denied outright: at least as strong as zero rows
end;
$$;

-- A no-op update targeting the other outlet's rows. Zero rows touched, or the
-- privilege refused, both mean blocked. Any trigger error would mean rows
-- were reachable — a leak, reported as failure.
create function pg_temp.cross_update_blocked(tbl text, other_outlet uuid)
returns boolean language plpgsql as $$
declare n bigint;
begin
  execute format(
    'with r as (update public.%I set outlet_id = outlet_id where outlet_id = %L returning 1) '
    'select count(*) from r',
    tbl, other_outlet)
    into n;
  return n = 0;
exception
  when insufficient_privilege then return true;
  when others then return false;
end;
$$;

create function pg_temp.isolation_sweep(
  persona text, p_sub uuid, p_role text, p_outlet uuid, other_outlet uuid
)
returns setof text language plpgsql as $$
declare
  t record;
  n bigint;
begin
  perform pg_temp.impersonate(p_sub, p_role, p_outlet);
  for t in
    select c.relname as tbl
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'outlet_id'
                      and not a.attisdropped)
     order by c.relname
  loop
    n := pg_temp.cross_read_count(t.tbl, other_outlet);
    return next ok(
      n <= 0,
      format('%I: %s reads zero cross-outlet rows (got %s)', t.tbl, persona, n));
    return next ok(
      pg_temp.cross_update_blocked(t.tbl, other_outlet),
      format('%I: %s cannot update cross-outlet rows', t.tbl, persona));
  end loop;
  execute 'reset role';
end;
$$;

-- Every scoped role, both directions for the admins.
select * from pg_temp.isolation_sweep('fa_kalyani',
  '10000000-0000-4000-a000-000000000002', 'franchise_admin',
  '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002');

select * from pg_temp.isolation_sweep('fa_kanchrapara',
  '10000000-0000-4000-a000-000000000003', 'franchise_admin',
  '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001');

select * from pg_temp.isolation_sweep('device_kalyani',
  '10000000-0000-4000-a000-000000000004', 'biller',
  '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002');

select * from pg_temp.isolation_sweep('employee_kalyani',
  '10000000-0000-4000-a000-000000000006', 'employee',
  '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002');

-- ---------------------------------------------------------------------------
-- Super Admin reads across: for every outlet-scoped table the Super Admin
-- sees exactly the rows the database owner sees (or the table is closed to
-- clients entirely, as the bill-number counters are).

create function pg_temp.superadmin_sweep(p_sub uuid)
returns setof text language plpgsql as $$
declare
  t record;
  n_owner bigint;
  n_super bigint;
begin
  for t in
    select c.relname as tbl
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'outlet_id'
                      and not a.attisdropped)
     order by c.relname
  loop
    execute 'reset role';
    execute format('select count(*) from public.%I', t.tbl) into n_owner;
    perform pg_temp.impersonate(p_sub, 'super_admin', null);
    begin
      execute format('select count(*) from public.%I', t.tbl) into n_super;
      return next is(
        n_super, n_owner,
        format('%I: super admin sees every row across outlets', t.tbl));
    exception when insufficient_privilege then
      return next ok(true,
        format('%I: closed to all clients including super admin', t.tbl));
    end;
  end loop;
  execute 'reset role';
end;
$$;

select * from pg_temp.superadmin_sweep('10000000-0000-4000-a000-000000000001');

-- ---------------------------------------------------------------------------
-- Positive controls: isolation must not be satisfied by deny-all. Each
-- scoped role actually sees its own outlet's data.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select is((select count(*) from public.menu_items), 7::bigint,
  'fa_kalyani sees the full 7-item Kalyani menu');
select is((select count(*) from public.bills), 9::bigint,
  'fa_kalyani sees all 9 Kalyani bills');
-- Scoped to the seeded codes rather than counted outright. The claim is "a
-- Kalyani admin sees Kalyani's staff", and a bare count also answers "what
-- else has written to this database today" — which after an `npm run
-- test:e2e:auth` is a real person created through the real app, and a
-- different question with a different answer on every run.
select is((select count(*) from public.profiles
            where staff_code in ('KAL-E1', 'KAL-E2')), 2::bigint,
  'fa_kalyani sees both seeded Kalyani staff accounts');
select is((select count(*) from public.daily_cash_records), 1::bigint,
  'fa_kalyani sees the Kalyani closed day');
select is((select count(*) from public.outlets), 1::bigint,
  'fa_kalyani sees exactly their own outlet row');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid,
  'biller', '00000000-0000-4000-a000-000000000001'::uuid);

select is((select count(*) from public.menu_items), 7::bigint,
  'device_kalyani reads the Kalyani menu');
select is((select count(*) from public.outlets), 1::bigint,
  'device_kalyani reads its own outlet row (cutover, geofence)');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid,
  'employee', '00000000-0000-4000-a000-000000000001'::uuid);

select ok((select count(*) from public.attendance) >= 1,
  'employee_kalyani sees their own attendance');

reset role;

-- ---------------------------------------------------------------------------
-- Hand-crafted cross-outlet INSERT payloads: a valid outlet-A session naming
-- outlet B in the row itself. Every one must be refused by policy (42501).

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select throws_ok($q$
  insert into public.expenses (outlet_id, business_date, category, amount_paise, payment_method, recorded_by)
  values ('00000000-0000-4000-a000-000000000002', current_date, 'other', 1000, 'cash',
          '10000000-0000-4000-a000-000000000002')
$q$, '42501', null, 'fa_kalyani cannot insert an expense carrying the other outlet''s id');

select throws_ok($q$
  insert into public.menu_items (outlet_id, category_id, name, price_paise)
  values ('00000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000011',
          'Smuggled Item', 9900)
$q$, '42501', null, 'fa_kalyani cannot insert a menu item into the other outlet');

select throws_ok($q$
  insert into public.inventory_movements (outlet_id, inventory_item_id, movement_type, quantity_delta, unit_cost_paise, recorded_by, business_date)
  values ('00000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000011',
          'added', 5, 1000, '10000000-0000-4000-a000-000000000002', current_date)
$q$, '42501', null, 'fa_kalyani cannot record a movement at the other outlet');

select throws_ok($q$
  insert into public.cash_withdrawals (outlet_id, business_date, amount_paise, withdrawn_by, recorded_by)
  values ('00000000-0000-4000-a000-000000000002', current_date, 1000, 'X',
          '10000000-0000-4000-a000-000000000002')
$q$, '42501', null, 'fa_kalyani cannot record a withdrawal at the other outlet');

select throws_ok($q$
  insert into public.alerts (outlet_id, raised_by, subject, message, category)
  values ('00000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000002',
          'x', 'x', 'other')
$q$, '42501', null, 'fa_kalyani cannot raise an alert for the other outlet');

-- Staff facts live on profiles now, written by the admin's own session — so
-- the cross-outlet write to refuse is an update naming the other outlet's
-- person. Zero rows reachable is the policy doing its job.
create function pg_temp.rows_touched(q text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

select is(pg_temp.rows_touched($q$
  update public.profiles set role_title = 'Smuggled Title'
   where id = '10000000-0000-4000-a000-000000000007'
$q$), 0::bigint,
  'fa_kalyani cannot edit the staff facts of the other outlet''s person');

select throws_ok($q$
  insert into public.attendance (outlet_id, person_id, business_date, status)
  values ('00000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000007',
          current_date, 'present')
$q$, '42501', null, 'fa_kalyani cannot write attendance at the other outlet');

-- Attribution cannot be forged even inside the right outlet.
select throws_ok($q$
  insert into public.expenses (outlet_id, business_date, category, amount_paise, payment_method, recorded_by)
  values ('00000000-0000-4000-a000-000000000001', current_date, 'other', 1000, 'cash',
          '10000000-0000-4000-a000-000000000003')
$q$, '42501', null, 'fa_kalyani cannot record an expense as someone else');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid,
  'biller', '00000000-0000-4000-a000-000000000001'::uuid);

select throws_ok($q$
  insert into public.bills (id, outlet_id, business_date, biller_profile_id, counter_device_id,
                            shift_id, subtotal_paise, total_paise, payment_method)
  values (gen_random_uuid(), '00000000-0000-4000-a000-000000000002',
          public.app_business_date(now(), time '04:00'),
          '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
          '40000000-0000-4000-a000-000000000002', 13900, 13900, 'cash')
$q$, '42501', null, 'device_kalyani cannot insert a bill carrying the other outlet''s id');

select throws_ok($q$
  insert into public.shifts (id, outlet_id, counter_device_id, biller_profile_id, business_date, opened_at)
  values (gen_random_uuid(), '00000000-0000-4000-a000-000000000002',
          '10000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-00000000000a',
          public.app_business_date(now(), time '04:00'), now())
$q$, '42501', null, 'device_kalyani cannot open a shift at the other outlet');

reset role;

select * from finish();
rollback;
