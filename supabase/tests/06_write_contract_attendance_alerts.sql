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

-- Claims carry `sub` and nothing about authority (multi-outlet-people): scope
-- is resolved from the seeded `assignments` rows, exactly as a real session's
-- is.
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

create function pg_temp.rows_touched(q text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- A past instant guaranteed to remain inside the outlet's current business
-- day, even when the suite runs just after the 04:00 cutover. Subtracting a
-- fixed number of hours made this fixture change days depending on wall time.
create function pg_temp.current_business_instant()
returns timestamptz language sql stable as $$
  with boundary as (
    select (
      public.app_business_date(now(), time '04:00') + time '04:00'
    ) at time zone 'Asia/Kolkata' as started_at
  )
  select started_at + ((now() - started_at) / 2)
    from boundary
$$;

-- ---------------------------------------------------------------------------
-- Attendance.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);

-- An employee checks themselves in from their phone, evidence attached.
select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 22.97502, 88.43455, 15, 8, 'phone')
$q$, 'an employee checks in with coordinates, accuracy, distance and source stored');

-- …and it counts for nothing until somebody vouches for it, even though the
-- coordinates put them at the counter.
select is(
  (select status from public.attendance
    where person_id = '10000000-0000-4000-a000-000000000006'
      and business_date = public.app_business_date(now(), time '04:00')),
  'absent'::public.attendance_status,
  'and the day is stored absent, waiting for a manager, however close they were');

-- Not for a colleague, though.
select throws_ok($q$
  insert into public.attendance (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
          public.app_business_date(now(), time '04:00'), 'present', now(), 'phone')
$q$, '42501', null, 'an employee cannot check a colleague in');

-- And not twice.
select throws_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006',
          public.app_business_date(now(), time '04:00'), 'present', now(), 'phone')
$q$, '23505', null, 'one attendance row per person per business day');

-- An employee cannot vouch for their own day. This is the whole point of the
-- change: the second signal has to come from somebody else.
select throws_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000006',
         approval_reason = 'self-approved',
         approved_at = now()
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'P0001', 'only a franchise admin or super admin may record an approval',
  'an employee cannot approve their own day');

-- The counter tablet is the secondary check-in path, and says so.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);

select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
          public.app_business_date(now(), time '04:00'), 'present', now(), 'counter_tablet')
$q$, 'the counter tablet checks an employee in');

-- The tablet cannot masquerade as a phone check-in.
select throws_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000004',
          public.app_business_date(now(), time '04:00'), 'present', now(), 'phone')
$q$, '42501', null, 'the tablet cannot record a phone-sourced check-in (and not for another outlet''s employee)');

-- ---------------------------------------------------------------------------
-- The approval: who may record one, over which rows, and under whose name.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

-- Approving under somebody else's name is refused before anything else about
-- the write is considered.
select throws_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000001',
         approval_reason = 'forged attribution',
         approver_lat = 22.97502, approver_lng = 88.43455, approver_accuracy_m = 15
   where person_id = '20000000-0000-4000-a000-000000000002'
     and outlet_id = '00000000-0000-4000-a000-000000000001'
     and business_date = current_date - 1
$q$, 'P0001', 'approved_by must be the approving session',
  'an approval under someone else''s name is refused');

-- A day nobody claimed is not a day anybody can settle. The griller's D-2 row
-- is a manager-marked absence with no check-in at all.
select throws_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000002',
         approval_reason = 'settling a day nobody worked (synthetic test)',
         status = 'present'
   where person_id = '20000000-0000-4000-a000-000000000002'
     and outlet_id = '00000000-0000-4000-a000-000000000001'
     and business_date = current_date - 2
$q$, 'P0001', 'an approval requires a check-in on the row',
  'an approval with no check-in on the row is refused');

-- The manager of the OTHER outlet cannot reach this outlet's rows. RLS filters
-- the row out rather than raising, so the proof is that nothing was touched.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003'::uuid);

select is(pg_temp.rows_touched($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000003',
         approval_reason = 'reaching across outlets (synthetic test)',
         status = 'present'
   where person_id = '20000000-0000-4000-a000-000000000002'
     and outlet_id = '00000000-0000-4000-a000-000000000001'
     and business_date = current_date - 1
$q$), 0::bigint, 'a franchise admin''s approval at another outlet touches no rows');

-- Their own outlet, and a day that has already closed, so a reason is required.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select lives_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000002',
         approval_reason = 'GPS drift, staff present (synthetic test)',
         approver_lat = 22.97502, approver_lng = 88.43455, approver_accuracy_m = 15,
         status = 'present'
   where person_id = '20000000-0000-4000-a000-000000000002'
     and outlet_id = '00000000-0000-4000-a000-000000000001'
     and business_date = current_date - 1
$q$, 'the franchise admin settles a waiting day at their own outlet, with attribution');

select is(
  (select approved_by_name from public.attendance
    where person_id = '20000000-0000-4000-a000-000000000002'
      and outlet_id = '00000000-0000-4000-a000-000000000001'
      and business_date = current_date - 1),
  'Synthetic Admin Kal',
  'and the approver''s name is snapshotted, not joined');

-- ---------------------------------------------------------------------------
-- The stamped arrival deadline, and the batch.

select is(
  (select arrival_deadline from public.attendance
    where person_id = '10000000-0000-4000-a000-000000000006'
      and business_date = public.app_business_date(now(), time '04:00')),
  time '13:00',
  'the deadline stamped on a check-in is the outlet''s, not the client''s');

select throws_ok($q$
  update public.attendance
     set arrival_deadline = time '23:00'
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'P0001', 'captured check-in evidence is immutable',
  'and it is frozen with the rest of the captured evidence');

-- A batch is one statement over several rows, and each row is settled with its
-- own computed distance rather than one figure copied across them. The two
-- outlets are 3.3 km apart, so a single reading at Kalyani proves it: the
-- Kalyani row reads on site and the Kanchrapara row does not.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select is(pg_temp.rows_touched($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000001',
         approval_reason = 'Settled the morning in one action (synthetic test)',
         approver_lat = 22.97505, approver_lng = 88.43460, approver_accuracy_m = 14,
         status = 'present'
   where business_date = current_date - 1
     and check_in_at is not null
     and approved_by is null
$q$), 1::bigint, 'the owner settles every remaining waiting day in one statement');

select is(
  (select count(*) from public.attendance
    where business_date = current_date - 1
      and check_in_at is not null
      and approved_by is null), 0::bigint,
  'and nothing is left waiting on that day');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

-- Identity is frozen; business date cannot drift from its evidence.
select throws_ok($q$
  update public.attendance
     set business_date = current_date - 3
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = current_date - 1
$q$, 'P0001', null, 'attendance identity is immutable');

select throws_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006',
          current_date - 10, 'present', now(), 'phone')
$q$, 'P0001', null, 'a business date contradicting the check-in time is refused');

-- ---------------------------------------------------------------------------
-- Manual entry: the admin records the event, the row records the admin.
-- Still impersonating the Kalyani franchise admin. Pending Staff Kal
-- (…000c) has no attendance anywhere, which makes it the clean target.

-- The refusals first, so no row lands before the one that should.

select throws_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-00000000000c',
          public.app_business_date(now() + interval '2 hours', time '04:00'), 'present',
          now() + interval '2 hours', 'manual')
$q$, 'P0001', null, 'a manual entry cannot be recorded for the future');

select throws_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-00000000000c',
          current_date - 1,'present',
          ((current_date - 1) + time '10:00') at time zone 'Asia/Kolkata', 'manual')
$q$, 'P0001', null, 'a manual entry belongs to the current business day, not a past one');

select throws_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-00000000000c',
          public.app_business_date(pg_temp.current_business_instant(), time '04:00'), 'present',
          pg_temp.current_business_instant(), 22.9750, 88.4345, 'manual')
$q$, '23514', null, 'a manual entry carries no coordinates — the admin was not standing there');

-- The entry itself: a past time on today's business day. The forged enterer
-- in the payload is overwritten by the stamp, not honoured.
select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source,
     check_in_entered_by, check_in_entered_by_name)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-00000000000c',
          public.app_business_date(pg_temp.current_business_instant(), time '04:00'), 'present',
          pg_temp.current_business_instant(), 'manual',
          '10000000-0000-4000-a000-000000000001', 'Forged Enterer')
$q$, 'a franchise admin records a past-time manual check-in for someone else');

select is(
  (select check_in_entered_by from public.attendance
    where person_id = '10000000-0000-4000-a000-00000000000c'
      and business_date = public.app_business_date(
        pg_temp.current_business_instant(), time '04:00')),
  '10000000-0000-4000-a000-000000000002'::uuid,
  'the enterer stamp is the writing session, not what the payload claimed');

select is(
  (select check_in_entered_by_name from public.attendance
    where person_id = '10000000-0000-4000-a000-00000000000c'
      and business_date = public.app_business_date(
        pg_temp.current_business_instant(), time '04:00')),
  'Synthetic Admin Kal',
  'the enterer''s name is snapshotted beside the event');

select is(
  (select status from public.attendance
    where person_id = '10000000-0000-4000-a000-00000000000c'
      and business_date = public.app_business_date(
        pg_temp.current_business_instant(), time '04:00')),
  'present'::public.attendance_status,
  'the geofence does not judge a manual entry — no evidence, no denial');

-- Recording it IS the decision: the enterer's stamp settles the day, so nobody
-- has to approve their own typing. There is no approver position, because
-- nobody read one — claiming otherwise would be evidence the row does not hold.
select is(
  (select approved_by from public.attendance
    where person_id = '10000000-0000-4000-a000-00000000000c'
      and business_date = public.app_business_date(
        pg_temp.current_business_instant(), time '04:00')),
  '10000000-0000-4000-a000-000000000002'::uuid,
  'a manual entry settles the day under the enterer''s own name');

select is(
  (select approver_distance_m from public.attendance
    where person_id = '10000000-0000-4000-a000-00000000000c'
      and business_date = public.app_business_date(
        pg_temp.current_business_instant(), time '04:00')),
  null,
  'and records no approver position, because none was ever read');

-- An enterer stamp on a non-manual event is refused by name.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);

select throws_ok($q$
  update public.attendance
     set check_in_entered_by = '10000000-0000-4000-a000-000000000002',
         check_in_entered_by_name = 'Synthetic Admin Kal'
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'P0001', 'captured check-in evidence is immutable',
  'an enterer stamp cannot be added to an event that was not manual');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

-- The Super Admin has the same capability at any outlet.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-00000000000d',
          public.app_business_date(pg_temp.current_business_instant(), time '04:00'), 'present',
          pg_temp.current_business_instant(), 'manual')
$q$, 'the super admin records a manual entry at any outlet');

select is(
  (select check_in_entered_by_name from public.attendance
    where person_id = '10000000-0000-4000-a000-00000000000d'
      and business_date = public.app_business_date(
        pg_temp.current_business_instant(), time '04:00')),
  'Synthetic Owner',
  'the super admin''s manual entry is stamped too');

-- Neither non-admin role can fabricate one, by any path. The person the
-- manual check-in was recorded for updates their own row — the update policy
-- permits the row, so what refuses the write is the guard's role gate, not an
-- accident of policy branch shapes.
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000c'::uuid);

select throws_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-00000000000c', status = 'present'
   where person_id = '10000000-0000-4000-a000-00000000000c'
     and business_date = public.app_business_date(
       pg_temp.current_business_instant(), time '04:00')
$q$, 'P0001', null, 'an employee cannot hand-craft an approval, even on their own row');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);

-- The guard answers before the policy can (BEFORE triggers run ahead of the
-- WITH CHECK), so the refusal arrives as the guard's named error rather than
-- a bare 42501 — and either boundary alone would refuse this.
select throws_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-00000000000c',
          public.app_business_date(now(), time '04:00'), 'present', now(), 'manual')
$q$, 'P0001', null, 'the counter tablet cannot record a manual entry');

reset role;

select throws_ok($q$
  delete from public.attendance where person_id = '10000000-0000-4000-a000-000000000006'
$q$, 'P0001', null, 'attendance rows cannot be deleted, even by the owner');

-- ---------------------------------------------------------------------------
-- Alerts.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

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

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

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

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);

select is((select count(*) from public.alerts), 0::bigint,
  'employees see no alerts');

-- ---------------------------------------------------------------------------
-- One day per person, whatever outlet it was worked at
-- (attendance-one-day-per-person, design D1).
--
-- #28 modelled a split day across two outlets as two rows. It is not a thing
-- that happens: somebody staffed at two outlets works at one of them on a given
-- day. A second row anywhere is now refused, and this is the only place the rule
-- can hold — `checkIn` is a direct insert from the browser, so there is no
-- server-side layer between a hand-crafted request and the table.

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000e'::uuid);

select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-00000000000e',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 22.97501, 88.43451, 12, 'phone')
$q$, 'the two-outlet person checks in at Kalyani from their own phone');

select throws_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-00000000000e',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 22.94501, 88.43301, 12, 'phone')
$q$, '23505', null,
  'and a second row at the OTHER outlet on the same date is refused by the database');

select throws_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-00000000000e',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 22.97501, 88.43451, 12, 'phone')
$q$, '23505', null, 'as is a second row at the SAME outlet, exactly as before');

select is(
  (select count(*) from public.attendance
    where person_id = '10000000-0000-4000-a000-00000000000e'
      and business_date = public.app_business_date(now(), time '04:00')),
  1::bigint,
  'one row stands for the day, at the outlet they actually attended');

-- Different dates at different outlets are the ordinary case, and stay allowed:
-- the constraint is about a day belonging to one person, not about a person
-- belonging to one shop.
select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-00000000000e',
          public.app_business_date(now() - interval '4 days', time '04:00'), 'present',
          now() - interval '4 days', 22.94501, 88.43301, 12, 'phone')
$q$, 'the same person records a different date at the other outlet');

-- A single-outlet person is unchanged: they cannot check in where they do not
-- work, however the request is crafted.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);

select throws_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000006',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 22.94501, 88.43301, 12, 'phone')
$q$, '42501', null, 'an employee cannot check in at an outlet they hold no assignment at');

-- The outlet they attended sees the row; the other one sees nothing at all,
-- which is what makes `attendance_elsewhere` necessary rather than decorative
-- (design D3, asserted in 18_attendance_elsewhere.sql).
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);
select is(
  (select count(*) from public.attendance
    where person_id = '10000000-0000-4000-a000-00000000000e'
      and business_date = public.app_business_date(now(), time '04:00')),
  1::bigint,
  'the Kalyani manager sees the day, because it was worked at Kalyani');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003'::uuid);
select is(
  (select count(*) from public.attendance
    where person_id = '10000000-0000-4000-a000-00000000000e'
      and business_date = public.app_business_date(now(), time '04:00')),
  0::bigint,
  'and the Kanchrapara manager sees no row for that person that day');

reset role;

select * from finish();
rollback;
