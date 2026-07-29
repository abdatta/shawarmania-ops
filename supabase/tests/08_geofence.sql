-- Geofence evaluation: the distance is derived from the evidence, the fence
-- only ever denies a claim of `present`, and captured evidence is frozen.
--
-- The distance table below is the SQL half of a pinning pair — the same
-- coordinates and the same expected metres are asserted against the TypeScript
-- implementation in src/domain/geo.test.ts. Two implementations of one formula
-- drift silently unless something forces them to agree, and a drifting geofence
-- would show an employee one distance while storing another. Change a number
-- here, change it there in the same commit.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

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

-- How many rows did a write actually touch? Zero is what "RLS filters it
-- out" looks like from the client's side.
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
-- Independence from whatever ran before. supabase/tests/rest/ writes real,
-- persistent check-ins to this same local database on today's business date,
-- and so does this file, for the same seeded employee — so after an
-- `npm run test:rls` this would die on a unique-constraint collision that has
-- nothing to do with the geofence.
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

-- ---------------------------------------------------------------------------
-- The pinning table.

select is(round(public.app_distance_m(22.9750, 88.4345, 22.9750, 88.4345)::numeric, 3),
  0.000::numeric, 'distance: identical points');

select is(round(public.app_distance_m(22.9750, 88.4345, 22.97505, 88.43460)::numeric, 3),
  11.650::numeric, 'distance: a few paces away');

select is(round(public.app_distance_m(22.9450, 88.4330, 22.94680, 88.43510)::numeric, 3),
  293.768::numeric, 'distance: the seeded out-of-fence check-in');

select is(round(public.app_distance_m(22.9450, 88.4330, 22.94120, 88.42880)::numeric, 3),
  602.913::numeric, 'distance: the seeded blocked check-in');

select is(round(public.app_distance_m(22.9750, 88.4345, 22.9840, 88.4345)::numeric, 3),
  1000.754::numeric, 'distance: a kilometre due north');

select is(round(public.app_distance_m(22.9750, 88.4345, 22.9450, 88.4330)::numeric, 3),
  3339.381::numeric, 'distance: between the two outlets');

select is(round(public.app_distance_m(22.9750, 88.4345, 28.6139, 77.2090)::numeric, 3),
  1285954.907::numeric, 'distance: Kalyani to Delhi');

select is(public.app_distance_m(null, 88.4345, 22.9750, 88.4345), null,
  'distance is unknown when the outlet has no captured position');

select is(public.app_distance_m(22.9750, 88.4345, 22.9750, null), null,
  'distance is unknown when the reading is incomplete');

-- ---------------------------------------------------------------------------
-- The seed itself proves the trigger runs: every claimed distance in seed.sql
-- was recomputed on insert.

select is(round((select check_in_distance_m from public.attendance
                  where person_id = '10000000-0000-4000-a000-000000000006'
                    and business_date = current_date - 1)::numeric, 2),
  11.65::numeric,
  'a seeded in-fence check-in stores the computed distance, not the claimed one');

select is(round((select check_in_distance_m from public.attendance
                  where person_id = '10000000-0000-4000-a000-000000000007'
                    and business_date = current_date - 1)::numeric, 2),
  293.77::numeric,
  'the seeded row claiming 220 m stores the 293.77 m its own coordinates imply');

select is((select status::text from public.attendance
            where person_id = '20000000-0000-4000-a000-000000000004'
              and business_date = current_date - 1),
  'absent',
  'a seeded out-of-fence check-in with no override is not counted present');

select is((select check_in_distance_m from public.attendance
            where person_id = '20000000-0000-4000-a000-000000000002'
              and business_date = current_date - 1),
  null,
  'a counter-tablet check-in with no coordinates stores no distance');

-- ---------------------------------------------------------------------------
-- An employee cannot claim `present` from outside the fence.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);

select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 22.9840, 88.4345, 20, 3, 'phone')
$q$, 'the write itself is allowed — the policy is not what refuses this');

select is((select status::text from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000006'
              and business_date = public.app_business_date(now(), time '04:00')),
  'absent',
  'a present claim from a kilometre away is stored as absent');

select is(round((select check_in_distance_m from public.attendance
                  where person_id = '10000000-0000-4000-a000-000000000006'
                    and business_date = public.app_business_date(now(), time '04:00'))::numeric, 2),
  1000.75::numeric,
  'and the claimed 3 m is replaced by the 1000.75 m its coordinates imply');

-- A phone check-in with no coordinates at all cannot be judged, so it is not
-- counted present either — otherwise refusing location permission would be the
-- simplest way to defeat the fence.
-- Backdated by five days, timestamp and business date together: the
-- validate_business_date trigger checks that the two agree.
select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006',
          public.app_business_date(now() - interval '5 days', time '04:00'), 'present',
          now() - interval '5 days', 'phone')
$q$, 'a phone check-in with no position is accepted as a record');

select is((select status::text from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000006'
              and business_date = public.app_business_date(now() - interval '5 days', time '04:00')),
  'absent',
  'but a phone check-in with no coordinates is not counted present');

-- The counter tablet is exempt: an enrolled device standing in the outlet,
-- with no GPS to offer.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);

select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
          public.app_business_date(now(), time '04:00'), 'present', now(), 'counter_tablet')
$q$, 'the counter tablet checks someone in without coordinates');

-- Read back as the manager: a Biller may write attendance and may not read it,
-- which is its own small proof that the write path is narrower than the view.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select is((select status::text from public.attendance
            where person_id = '20000000-0000-4000-a000-000000000002'
              and business_date = public.app_business_date(now(), time '04:00')),
  'present',
  'and that stays present — the tablet is the trusted device, not the fence');

-- An outlet that was never surveyed blocks nobody: that gap is the owner's to
-- close, not the staff's to pay for. Un-survey Kanchrapara as the owner of the
-- table, so the setup itself cannot be the thing that silently did nothing.
reset role;

update public.outlets set latitude = null, longitude = null
 where id = '00000000-0000-4000-a000-000000000002';

select is((select latitude from public.outlets
            where id = '00000000-0000-4000-a000-000000000002'), null,
  'setup: Kanchrapara now has no captured position');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000007'::uuid);

select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000007',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 28.6139, 77.2090, 20, 'phone')
$q$, 'an employee checks in at an unsurveyed outlet');

select is((select status::text from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000007'
              and business_date = public.app_business_date(now(), time '04:00')),
  'present',
  'and is counted present, however far away, because there is nothing to judge against');

select is((select check_in_distance_m from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000007'
              and business_date = public.app_business_date(now(), time '04:00')),
  null,
  'with the distance stored as unknown rather than guessed at');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);

-- Erasing the evidence must not launder the verdict.
select throws_ok($q$
  update public.attendance
     set check_in_lat = null, check_in_lng = null
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'P0001', null, 'captured check-in evidence cannot be erased');

select throws_ok($q$
  update public.attendance set status = 'present'
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'P0001', null, 'an employee cannot set their own attendance status');

-- Checking out is recorded and never refused, however far away it happens.
select lives_ok($q$
  update public.attendance
     set check_out_at = now(), check_out_lat = 28.6139, check_out_lng = 77.2090,
         check_out_accuracy_m = 30, check_out_distance_m = 5, check_out_source = 'phone'
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'a distant check-out is recorded rather than blocked (design D3)');

select is(round((select check_out_distance_m from public.attendance
                  where person_id = '10000000-0000-4000-a000-000000000006'
                    and business_date = public.app_business_date(now(), time '04:00'))::numeric, 0),
  1285955::numeric,
  'and its distance is computed too, so the manager sees the flag');

-- ---------------------------------------------------------------------------
-- The manager's side: an override clears the block, a blank reason does not.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select throws_ok($q$
  update public.attendance
     set override_by = '10000000-0000-4000-a000-000000000002',
         override_reason = '   ',
         override_at = now(),
         status = 'present'
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, '23514', null, 'an override with a blank reason is not a recorded decision');

select lives_ok($q$
  update public.attendance
     set override_by = '10000000-0000-4000-a000-000000000002',
         override_reason = 'Delivery run, confirmed by phone (synthetic test)',
         override_at = now(),
         status = 'present'
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'a manager clears the block with a reason, and the row becomes present');

select is((select status::text from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000006'
              and business_date = public.app_business_date(now(), time '04:00')),
  'present',
  'the overridden row stays present — the fence does not re-deny it');

select is((select override_by_name from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000006'
              and business_date = public.app_business_date(now(), time '04:00')),
  'Synthetic Admin Kal',
  'the approver''s name is snapshot onto the row, so the employee can read it too');

-- The name is derived, never accepted: a forged one is replaced.
select lives_ok($q$
  update public.attendance
     set override_reason = 'Reworded, still the same approver (synthetic test)',
         override_by_name = 'Somebody Else Entirely'
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'an override reason may be amended by the approving manager');

select is((select override_by_name from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000006'
              and business_date = public.app_business_date(now(), time '04:00')),
  'Synthetic Admin Kal',
  'and a client-supplied approver name does not survive');

-- The fence denies a present claim; it never imposes one.
select lives_ok($q$
  update public.attendance set status = 'half_day'
   where person_id = '20000000-0000-4000-a000-000000000002'
     and business_date = current_date - 1
$q$, 'a manager marks an in-fence day half_day');

select is((select status::text from public.attendance
            where person_id = '20000000-0000-4000-a000-000000000002'
              and business_date = current_date - 1),
  'half_day',
  'and the geofence does not overrule it back to present');

-- ---------------------------------------------------------------------------
-- The reference point itself is the Super Admin's to set (design D4).

select is((select count(*) from public.outlets
            where id = '00000000-0000-4000-a000-000000000001'
              and location_captured_at is not null), 1::bigint,
  'a captured outlet records when its position was surveyed');

-- A Franchise Admin cannot move the fence their own staff are judged against.
-- RLS filters the row out rather than raising, so the proof is that nothing
-- changed and that zero rows were touched.
select is(pg_temp.rows_touched($q$
  update public.outlets
     set latitude = 22.0, longitude = 88.0, geofence_radius_m = 5000
   where id = '00000000-0000-4000-a000-000000000001'
$q$), 0::bigint, 'a franchise admin''s attempt to move the geofence touches no rows');

select is((select geofence_radius_m from public.outlets
            where id = '00000000-0000-4000-a000-000000000001'), 150,
  'and the outlet''s radius is unchanged');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select is((select location_captured_at from public.outlets
            where id = '00000000-0000-4000-a000-000000000002'), null,
  'an outlet that was never surveyed says so, read by the one role that can see it');

select lives_ok($q$
  update public.outlets
     set latitude = 22.97512, longitude = 88.43441,
         geofence_radius_m = 150,
         location_accuracy_m = 7,
         location_captured_at = now()
   where id = '00000000-0000-4000-a000-000000000002'
$q$, 'the super admin captures an outlet position');

select is(round((select location_accuracy_m from public.outlets
                  where id = '00000000-0000-4000-a000-000000000002')::numeric, 0),
  7::numeric, 'the accuracy of the saved fix is stored with it');

-- Re-capturing a position must not rewrite the distances already judged. The
-- outlet just moved ~3.3 km; a later write to a settled row (adding a
-- check-out) must leave its check-in distance exactly where it was.
select lives_ok($q$
  update public.attendance
     set check_out_at = now(), check_out_lat = 22.94690, check_out_lng = 88.43500,
         check_out_accuracy_m = 25, check_out_source = 'phone'
   where person_id = '10000000-0000-4000-a000-000000000007'
     and business_date = current_date - 1
$q$, 'a check-out is added to a settled row after the outlet moved');

select is(round((select check_in_distance_m from public.attendance
                  where person_id = '10000000-0000-4000-a000-000000000007'
                    and business_date = current_date - 1)::numeric, 2),
  293.77::numeric,
  'moving an outlet does not retroactively rewrite a settled check-in distance');

select is((select status::text from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000007'
              and business_date = current_date - 1),
  'present',
  'nor does it retroactively un-present a day a manager already blessed');

reset role;

select * from finish();
rollback;
