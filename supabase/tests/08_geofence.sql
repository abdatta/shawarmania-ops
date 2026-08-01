-- Geofence evaluation: every distance is derived from the evidence, the fence
-- decides nothing about status any more, and captured evidence is frozen.
--
-- The fence used to be the thing that denied a claim of `present`. It is now
-- only evidence: an unapproved check-in is stored `absent` whatever its
-- distance, and a recorded human approval is the only thing that settles a day.
-- The fence still never IMPOSES a status.
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
  'a seeded check-in with no approval is not counted present');

select is(round((select approver_distance_m from public.attendance
                  where person_id = '10000000-0000-4000-a000-000000000007'
                    and business_date = current_date - 1)::numeric, 0),
  1531::numeric,
  'and a seeded off-site approval stores the distance ITS coordinates imply');

select is((select arrival_deadline from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000007'
              and business_date = current_date - 1), time '20:00',
  'the stamped deadline is the OUTLET''s, so Kanchrapara''s 20:00 is not Kalyani''s 13:00');

select is((select check_in_distance_m from public.attendance
            where person_id = '20000000-0000-4000-a000-000000000002'
              and business_date = current_date - 1),
  null,
  'a counter-tablet check-in with no coordinates stores no distance');

-- ---------------------------------------------------------------------------
-- An employee cannot claim `present` at all, wherever they are standing.

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

select is((select arrival_deadline from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000006'
              and business_date = public.app_business_date(now(), time '04:00')), time '13:00',
  'and the outlet''s arrival deadline is stamped onto the row as it lands');

-- The same claim from INSIDE the fence, which used to survive as present. It no
-- longer does: standing at the counter is evidence, not a witness.
--
-- Backdated rows below state the business date they belong to and build the
-- arrival from it, rather than shifting `now()` and letting the trigger derive
-- the date. `current_date` is the database's UTC calendar date; a business date
-- is an IST day that opens at the outlet's 04:00 cutover, so for the ninety
-- minutes between 04:00 and 05:30 IST the two are a day apart.
-- `app_business_date(now() - interval '3 days', ...)` lands on `current_date - 2`
-- for that hour and a half every night, which is the seeded Kalyani day this
-- same person already holds, and one row per person per day refuses the second
-- one. A date that is stated cannot drift into another day's, and a 09:00 IST
-- arrival is past the 04:00 cutover both seeded outlets keep, so
-- validate_business_date agrees the timestamp and the date describe one day.
select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006',
          current_date - 3, 'present',
          ((current_date - 3) + time '09:00') at time zone 'Asia/Kolkata',
          22.97505, 88.43460, 14, 'phone')
$q$, 'an employee checks in from inside the fence');

select is((select status::text from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000006'
              and business_date = current_date - 3),
  'absent',
  'and an in-fence present claim is stored absent too — only an approval settles a day');

-- A phone check-in with no coordinates at all cannot be judged, so it is not
-- counted present either — otherwise refusing location permission would be the
-- simplest way to defeat the fence.
select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status, check_in_at, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006',
          current_date - 5, 'present',
          ((current_date - 5) + time '09:00') at time zone 'Asia/Kolkata', 'phone')
$q$, 'a phone check-in with no position is accepted as a record');

select is((select status::text from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000006'
              and business_date = current_date - 5),
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
  'absent',
  'and it waits like any other: the device stands in the outlet, it does not attest');

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
  'absent',
  'and it waits for a manager, because nothing but a manager ever counted it');

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

-- ---------------------------------------------------------------------------
-- The manager's side: the approval, and where the approver was.
--
-- The approver's distance is the database's number for the same reason the
-- employee's is — it is the one figure a client has every incentive to shade,
-- and the whole point of recording it is that it cannot be arranged.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

-- On site and on the day, so the rule asks for no reason at all — which makes
-- this the one path on which a BLANK reason reaches the constraint rather than
-- the guard. Somebody who types spaces has still recorded nothing.
select throws_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000002',
         approver_lat = 22.97505, approver_lng = 88.43460, approver_accuracy_m = 14,
         approval_reason = '   ',
         status = 'present'
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, '23514', null, 'a blank reason is refused by the constraint even where none was needed');

select lives_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000002',
         approver_lat = 22.97505, approver_lng = 88.43460, approver_accuracy_m = 14,
         approver_distance_m = 9999,
         status = 'present'
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'a manager standing at the counter approves the day, on the day, with no reason');

select is((select status::text from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000006'
              and business_date = public.app_business_date(now(), time '04:00')),
  'present',
  'the approved row becomes present, and the fence does not re-deny it');

select is(round((select approver_distance_m from public.attendance
                  where person_id = '10000000-0000-4000-a000-000000000006'
                    and business_date = public.app_business_date(now(), time '04:00'))::numeric, 2),
  11.65::numeric,
  'and the claimed 9999 m is replaced by the 11.65 m the approver''s coordinates imply');

select is((select approved_by_name from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000006'
              and business_date = public.app_business_date(now(), time '04:00')),
  'Synthetic Admin Kal',
  'the approver''s name is snapshot onto the row, so the employee can read it too');

select isnt((select approved_at from public.attendance
              where person_id = '10000000-0000-4000-a000-000000000006'
                and business_date = public.app_business_date(now(), time '04:00')), null,
  'and the approval time is stamped by the database rather than supplied');

-- A recorded decision is a record. Correcting a mistaken approval means
-- changing the STATUS, which stays the manager's to set and leaves the approval
-- visible — not quietly rewriting who vouched for what.
select throws_ok($q$
  update public.attendance
     set approval_reason = 'Reworded after the fact (synthetic test)'
   where person_id = '10000000-0000-4000-a000-000000000006'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'P0001', 'a recorded approval is immutable',
  'a recorded approval cannot be edited afterwards');

-- Off site, on the same day: not refused, but it costs a sentence.
select throws_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000002',
         approver_lat = 28.6139, approver_lng = 77.2090, approver_accuracy_m = 30,
         status = 'present'
   where person_id = '20000000-0000-4000-a000-000000000002'
     and outlet_id = '00000000-0000-4000-a000-000000000001'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'P0001', 'an approval from away from the outlet, or after the row''s own business day, requires a reason',
  'an approval taken a thousand kilometres away is refused without a reason');

select throws_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000002',
         approver_lat = 28.6139, approver_lng = 77.2090, approver_accuracy_m = 30,
         approval_reason = '   ',
         status = 'present'
   where person_id = '20000000-0000-4000-a000-000000000002'
     and outlet_id = '00000000-0000-4000-a000-000000000001'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'P0001', 'an approval from away from the outlet, or after the row''s own business day, requires a reason',
  'and spaces are not a reason — the guard reads it the same as nothing');

select lives_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000002',
         approver_lat = 28.6139, approver_lng = 77.2090, approver_accuracy_m = 30,
         approval_reason = 'Seen at the counter before I travelled (synthetic test)',
         status = 'present'
   where person_id = '20000000-0000-4000-a000-000000000002'
     and outlet_id = '00000000-0000-4000-a000-000000000001'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'with a reason it is recorded — nothing is refused on distance alone');

select is(round((select approver_distance_m from public.attendance
                  where person_id = '20000000-0000-4000-a000-000000000002'
                    and outlet_id = '00000000-0000-4000-a000-000000000001'
                    and business_date = public.app_business_date(now(), time '04:00'))::numeric, 0),
  1285955::numeric,
  'and the row keeps how far away the approver was, so being elsewhere is visible');

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

-- An unsurveyed outlet cannot vouch for anybody, approvers included: there is
-- no position to judge them against, so every approval there costs a reason.
-- That is honest, and it matches how check-ins already behave there.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003'::uuid);

select throws_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000003',
         approver_lat = 22.94508, approver_lng = 88.43312, approver_accuracy_m = 19,
         status = 'present'
   where person_id = '10000000-0000-4000-a000-000000000007'
     and outlet_id = '00000000-0000-4000-a000-000000000002'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'P0001', 'an approval from away from the outlet, or after the row''s own business day, requires a reason',
  'an approval at an unsurveyed outlet needs a reason, standing at the counter or not');

select lives_ok($q$
  update public.attendance
     set approved_by = '10000000-0000-4000-a000-000000000003',
         approval_reason = 'Outlet position never captured; seen at the counter (synthetic)',
         status = 'present'
   where person_id = '10000000-0000-4000-a000-000000000007'
     and outlet_id = '00000000-0000-4000-a000-000000000002'
     and business_date = public.app_business_date(now(), time '04:00')
$q$, 'and with one it is recorded, with the approver''s position stored as unknown');

select is((select approver_distance_m from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000007'
              and outlet_id = '00000000-0000-4000-a000-000000000002'
              and business_date = public.app_business_date(now(), time '04:00')), null,
  'rather than a distance from a point nobody has stood on');

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
-- outlet just moved ~3.3 km; a later write to a settled row must leave its
-- check-in distance and its approver distance exactly where they were.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003'::uuid);

select lives_ok($q$
  update public.attendance set status = 'half_day'
   where person_id = '10000000-0000-4000-a000-000000000007'
     and business_date = current_date - 1
$q$, 'a settled row is amended after the outlet moved');

select is(round((select check_in_distance_m from public.attendance
                  where person_id = '10000000-0000-4000-a000-000000000007'
                    and business_date = current_date - 1)::numeric, 2),
  293.77::numeric,
  'moving an outlet does not retroactively rewrite a settled check-in distance');

select is(round((select approver_distance_m from public.attendance
                  where person_id = '10000000-0000-4000-a000-000000000007'
                    and business_date = current_date - 1)::numeric, 0),
  1531::numeric,
  'nor a recorded approval''s, so "was the manager there" cannot be changed later');

select is((select arrival_deadline from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000007'
              and business_date = current_date - 1), time '20:00',
  'and the deadline the day was judged against is still the one it was recorded under');

reset role;

select * from finish();
rollback;
