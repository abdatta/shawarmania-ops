-- Attendance evidence and guards, and the alert thread's narrow write paths.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- Independence from whatever ran before. supabase/tests/rest/ writes real,
-- persistent check-ins to this same local database on today's business date,
-- and so does this file, for the same seeded employee — so after an
-- `npm run test:rls` this would die on a unique-constraint collision that has
-- nothing to do with the write contract.
--
-- Attendance is append-only, correctly, so clearing it means suspending that
-- guard for the length of this transaction. Scoped so it can never reach a
-- seeded row: everything in seed.sql is dated yesterday or the day before. The
-- file rolls back regardless.
alter table public.attendance disable trigger attendance_no_delete;
delete from public.attendance
 where business_date = public.app_business_date(now(), time '04:00')
   and business_date not in (current_date - 1, current_date - 2);
alter table public.attendance enable trigger attendance_no_delete;

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

create function pg_temp.rows_touched(q text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attendance.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid,
  'employee', '00000000-0000-4000-a000-000000000001'::uuid);

-- An employee checks themselves in from their phone, evidence attached.
select lives_ok($q$
  insert into public.attendance
    (outlet_id, employee_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 22.97502, 88.43455, 15, 8, 'phone')
$q$, 'an employee checks in with coordinates, accuracy, distance and source stored');

-- …and checks out on the same row.
select lives_ok($q$
  update public.attendance
     set check_out_at = now(),
         check_out_lat = 22.97501, check_out_lng = 88.43457,
         check_out_accuracy_m = 20, check_out_distance_m = 10,
         check_out_source = 'phone'
   where employee_id = '20000000-0000-4000-a000-000000000001'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'the employee records their own check-out');

-- Not for a colleague, though.
select throws_ok($q$
  insert into public.attendance (outlet_id, employee_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
          public.app_business_date(now(), time '04:00'), 'present', now(), 'phone')
$q$, '42501', null, 'an employee cannot check a colleague in');

-- And not twice.
select throws_ok($q$
  insert into public.attendance
    (outlet_id, employee_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'), 'present', now(), 'phone')
$q$, '23505', null, 'one attendance row per employee per business day');

-- An employee cannot bless their own out-of-fence check-in.
select throws_ok($q$
  update public.attendance
     set override_by = '10000000-0000-4000-a000-000000000006',
         override_reason = 'self-approved',
         override_at = now()
   where employee_id = '20000000-0000-4000-a000-000000000001'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'P0001', null, 'an employee cannot record an override');

-- The counter tablet is the secondary check-in path, and says so.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid,
  'biller', '00000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  insert into public.attendance
    (outlet_id, employee_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
          public.app_business_date(now(), time '04:00'), 'present', now(), 'counter_tablet')
$q$, 'the counter tablet checks an employee in');

-- The tablet cannot masquerade as a phone check-in.
select throws_ok($q$
  insert into public.attendance
    (outlet_id, employee_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000004',
          public.app_business_date(now(), time '04:00'), 'present', now(), 'phone')
$q$, '42501', null, 'the tablet cannot record a phone-sourced check-in (and not for another outlet''s employee)');

-- A manager override is recorded with who and why; the guard demands it be
-- the session's own identity.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  update public.attendance
     set override_by = '10000000-0000-4000-a000-000000000002',
         override_reason = 'GPS drift, staff present (synthetic test)',
         override_at = now()
   where employee_id = '20000000-0000-4000-a000-000000000001'
     and business_date = current_date - 1
$q$, 'the franchise admin records an override with attribution');

select throws_ok($q$
  update public.attendance
     set override_by = '10000000-0000-4000-a000-000000000001',
         override_reason = 'forged attribution',
         override_at = now()
   where employee_id = '20000000-0000-4000-a000-000000000002'
     and business_date = current_date - 1
$q$, 'P0001', null, 'an override under someone else''s name is refused');

-- Identity is frozen; business date cannot drift from its evidence.
select throws_ok($q$
  update public.attendance
     set business_date = current_date - 3
   where employee_id = '20000000-0000-4000-a000-000000000001'
     and business_date = current_date - 1
$q$, 'P0001', null, 'attendance identity is immutable');

select throws_ok($q$
  insert into public.attendance
    (outlet_id, employee_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
          current_date - 10, 'present', now(), 'phone')
$q$, 'P0001', null, 'a business date contradicting the check-in time is refused');

reset role;

select throws_ok($q$
  delete from public.attendance where employee_id = '20000000-0000-4000-a000-000000000001'
$q$, 'P0001', null, 'attendance rows cannot be deleted, even by the owner');

-- ---------------------------------------------------------------------------
-- Alerts.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  insert into public.alerts (outlet_id, raised_by, subject, message, category, priority)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000002',
          'Grill igniter failing', 'Needs a service visit this week. (synthetic)',
          'equipment', 'normal')
$q$, 'the franchise admin raises an alert');

select throws_ok($q$
  insert into public.alert_responses (alert_id, responder_profile_id, message)
  values ('70000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000002',
          'talking to myself')
$q$, '42501', null, 'the franchise admin cannot write responses — that is the owner''s side of the channel');

select is(
  pg_temp.rows_touched($q$
    update public.alerts set status = 'resolved'
     where id = '70000000-0000-4000-a000-000000000001'
  $q$),
  0::bigint,
  'the franchise admin cannot work the alert status');

select ok(
  (select count(*) from public.alert_responses) >= 1,
  'the franchise admin reads the owner''s responses on their thread');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid,
  'super_admin', null);

select lives_ok($q$
  insert into public.alert_responses (alert_id, responder_profile_id, message)
  values ('70000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001',
          'Booked the service visit. (synthetic)')
$q$, 'the super admin responds');

select lives_ok($q$
  update public.alerts set status = 'resolved'
   where id = '70000000-0000-4000-a000-000000000001'
$q$, 'the super admin resolves the alert');

select throws_ok($q$
  update public.alerts set subject = 'rewritten history'
   where id = '70000000-0000-4000-a000-000000000001'
$q$, 'P0001', null, 'only the status of an alert may change');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid,
  'employee', '00000000-0000-4000-a000-000000000001'::uuid);

select is((select count(*) from public.alerts), 0::bigint,
  'employees see no alerts');

reset role;

select * from finish();
rollback;
