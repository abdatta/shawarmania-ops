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
--
-- The claims carry `sub` and NOTHING ELSE about authority (multi-outlet-people).
-- Until this change they also carried a fabricated `app_role` and
-- `app_outlet_id`, which meant the suite was proving the policies against an
-- identity it invented rather than against the one the database would resolve.
-- Scope now comes from the seeded `assignments` rows, so every sweep below
-- exercises the same lookup a real session does.

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
  persona text, p_sub uuid, other_outlet uuid
)
returns setof text language plpgsql as $$
declare
  t record;
  n bigint;
begin
  perform pg_temp.impersonate(p_sub);
  for t in
    select c.relname as tbl
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'outlet_id'
                      and not a.attisdropped)
       and c.relname <> 'counter_shift_requests'
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
  '10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002');

select * from pg_temp.isolation_sweep('fa_kanchrapara',
  '10000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001');

select * from pg_temp.isolation_sweep('device_kalyani',
  '10000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000002');

select * from pg_temp.isolation_sweep('employee_kalyani',
  '10000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000002');

-- ---------------------------------------------------------------------------
-- Super Admin reads across: for every outlet-scoped table the Super Admin
-- sees exactly the rows the database owner sees (or the table is closed to
-- clients entirely, as the bill-number counters are).
--
-- **One table is deliberately not in that set**, and it is named here rather
-- than discovered as a mysterious failure by whoever next seeds a row. A shift
-- request is between one tablet and one person: there is no fallback approver,
-- so nobody else — not the outlet's manager, not the owner — has a reason to
-- read a pending one, and the policy says so. The sweep would have passed today
-- either way, because nothing seeds a request; that is exactly the kind of
-- accident this exclusion exists to stop being load-bearing.

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
       and c.relname <> 'counter_shift_requests'
     order by c.relname
  loop
    execute 'reset role';
    execute format('select count(*) from public.%I', t.tbl) into n_owner;
    perform pg_temp.impersonate(p_sub);
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

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select is((select count(*) from public.menu_items), 7::bigint,
  'fa_kalyani sees the full 7-item Kalyani menu');
select is((select count(*) from public.bills), 9::bigint,
  'fa_kalyani sees all 9 Kalyani bills');
-- Scoped to the seeded people rather than counted outright. The claim is "a
-- Kalyani admin sees Kalyani's staff", and a bare count also answers "what
-- else has written to this database today" — which after an `npm run
-- test:e2e:auth` is a real person created through the real app, and a
-- different question with a different answer on every run. (Named by id since
-- multi-outlet-people: staff codes are gone.)
select is((select count(*) from public.profiles
            where id in ('10000000-0000-4000-a000-000000000006',
                         '20000000-0000-4000-a000-000000000002')), 2::bigint,
  'fa_kalyani sees both seeded Kalyani staff accounts');
-- The two-outlet person works at Kalyani too, so their profile is visible —
-- but only their KALYANI assignment is. Seeing that they also work elsewhere
-- would be the other outlet's data.
select is((select count(*) from public.profiles
            where id = '10000000-0000-4000-a000-00000000000e'), 1::bigint,
  'fa_kalyani sees the two-outlet person, who works at their outlet');
select is((select count(*) from public.assignments
            where person_id = '10000000-0000-4000-a000-00000000000e'), 1::bigint,
  'fa_kalyani sees only the two-outlet person''s own-outlet assignment');
select is((select count(*) from public.attendance
            where person_id = '10000000-0000-4000-a000-00000000000e'), 1::bigint,
  'fa_kalyani sees only the day the two-outlet person worked at Kalyani');
-- The per-person range read, hand-crafted to name the other outlet. This is the
-- shape that leaks if the outlet is left implicit (design D7): the surface always
-- passes its own outlet, and the policy refuses this even when it does not.
select is((select count(*) from public.attendance
            where person_id = '10000000-0000-4000-a000-00000000000e'
              and outlet_id = '00000000-0000-4000-a000-000000000002'
              and business_date between current_date - 40 and current_date), 0::bigint,
  'fa_kalyani''s range read for that person at the OTHER outlet returns nothing');
select is((select count(*) from public.attendance
            where person_id = '10000000-0000-4000-a000-00000000000e'
              and outlet_id = '00000000-0000-4000-a000-000000000001'
              and business_date between current_date - 40 and current_date), 1::bigint,
  'while the same read at their own outlet returns the day worked there');
select is((select count(*) from public.expenses), 3::bigint,
  'fa_kalyani sees the three seeded Kalyani expenses');
select is((select count(*) from public.outlets), 1::bigint,
  'fa_kalyani sees exactly their own outlet row');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);

select is((select count(*) from public.menu_items), 7::bigint,
  'device_kalyani reads the Kalyani menu');
select is((select count(*) from public.outlets), 1::bigint,
  'device_kalyani reads its own outlet row (cutover, geofence)');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);

select ok((select count(*) from public.attendance) >= 1,
  'employee_kalyani sees their own attendance');

-- ---------------------------------------------------------------------------
-- The multi-outlet person: the case that did not exist before this change.
--
-- Isolation for somebody assigned to two outlets is not "zero cross-outlet
-- rows" — both outlets are theirs. What must hold instead is that they see
-- exactly their OWN rows at each, and nothing of anybody else's at either.

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000e'::uuid);

select is((select count(distinct outlet_id) from public.attendance), 2::bigint,
  'two_outlets sees their own attendance at both assigned outlets');
select is((select count(*) from public.attendance), 2::bigint,
  'two_outlets sees only their own rows — no colleague at either outlet');
select is((select count(*) from public.attendance
            where person_id <> '10000000-0000-4000-a000-00000000000e'), 0::bigint,
  'two_outlets reads no colleague''s attendance by naming them explicitly');
select is((select count(*) from public.outlets), 2::bigint,
  'two_outlets reads both outlet rows, because they work at both');
select is((select count(*) from public.assignments), 2::bigint,
  'two_outlets sees both of their own assignments and nobody else''s');
-- Expenses are an outlet-wide staff surface, even for an Employee.
select is((select count(*) from public.expenses), 5::bigint,
  'two_outlets reads expenses at both assigned outlets and nowhere else');
select is((select count(*) from public.inventory_items), 0::bigint,
  'two_outlets reads no stock at either outlet');

reset role;

-- ---------------------------------------------------------------------------
-- Hand-crafted cross-outlet INSERT payloads: a valid outlet-A session naming
-- outlet B in the row itself. Every one must be refused by policy (42501).

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select throws_ok($q$
  insert into public.expenses (outlet_id, business_date, category, amount_paise, is_cash, recorded_by)
  values ('00000000-0000-4000-a000-000000000002', current_date, 'Other', 1000, true,
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
  insert into public.drawer_cash_out
    (outlet_id, kind, amount_paise, occurred_at, recorded_by,
     recorded_on_site, away_reason)
  values ('00000000-0000-4000-a000-000000000002', 'collection', 1000, now(),
          '10000000-0000-4000-a000-000000000002', false, 'Synthetic cross-outlet attempt')
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
  insert into public.expenses (outlet_id, business_date, category, amount_paise, is_cash, recorded_by)
  values ('00000000-0000-4000-a000-000000000001', current_date, 'Other', 1000, true,
          '10000000-0000-4000-a000-000000000003')
$q$, '42501', null, 'fa_kalyani cannot record an expense as someone else');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);

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
