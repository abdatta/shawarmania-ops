-- a-check-in-at-the-shop-approves-itself (#81): a check-in measured inside the
-- outlet's own fence is approved by the database, an outlet's managers choose
-- whether every check-in still needs them and whether away check-ins are
-- refused, and with `auto-approve-at-the-shop` off v3 is v2.
--
-- Most cases go through `pg_temp.check_in`, which checks in, reads what the day
-- became, and rolls the check-in back, so one person can try every case on the
-- same business day. The cases that need what a check-in left behind (the
-- decision's columns, a second check-in, a correction, a retry) write for real,
-- each with its own person.

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

-- What a check-in through `p_fn` makes of the day, without keeping it:
-- `present auto_approved`, `absent waiting`, or `refused: <message>`. Deferred
-- constraints are fired before reading, so the answer is what a commit keeps.
create function pg_temp.check_in(
  p_person uuid, p_outlet uuid, p_lat double precision, p_lng double precision,
  p_accuracy numeric, p_fn text default 'attendance_submit_attempt_v3'
)
returns text language plpgsql as $$
declare
  v_day public.attendance;
  v_kind text;
begin
  begin
    perform pg_temp.impersonate(p_person);
    execute format(
      'select * from public.%I($1, $2, public.app_business_date(now(), time ''04:00''), now(), $3, $4, $5)',
      p_fn)
      into v_day using gen_random_uuid(), p_outlet, p_lat, p_lng, p_accuracy;
    execute 'reset role';
    set constraints all immediate;
    select d.kind::text into v_kind
      from public.attendance_decisions d where d.id = v_day.latest_decision_id;
    raise exception using errcode = 'P0099',
      message = v_day.status::text || ' ' || coalesce(v_kind, 'waiting');
  exception
    when sqlstate 'P0099' then return sqlerrm;
    when others then return 'refused: ' || sqlerrm;
  end;
end;
$$;

-- A statement whose outcome does not matter, only that it changed nothing.
create function pg_temp.attempt(p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
exception when others then null;
end;
$$;

create function pg_temp.rules(p_outlet uuid, p_needs_manager boolean, p_blocks_away boolean)
returns void language sql as $$
  update public.outlets
     set attendance_needs_manager = p_needs_manager, attendance_blocks_away = p_blocks_away
   where id = p_outlet
$$;

\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'
\set OWNER '10000000-0000-4000-a000-000000000001'
\set MGR_KAL '10000000-0000-4000-a000-000000000002'
\set MGR_KPA '10000000-0000-4000-a000-000000000003'
\set EMP_KAL '10000000-0000-4000-a000-000000000006'
\set EMP_KPA '10000000-0000-4000-a000-000000000007'
\set DEVICE '10000000-0000-4000-a000-000000000004'
\set DEACTIVATED '10000000-0000-4000-a000-000000000008'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set BILLER_KAL_2 '10000000-0000-4000-a000-000000000010'
\set PENDING_KAL '10000000-0000-4000-a000-00000000000c'
\set TWO_OUTLETS '10000000-0000-4000-a000-00000000000e'

-- Kalyani's centre is (22.9750, 88.4345) with a 150 m fence. One thousandth of
-- a degree of latitude is about 111 m.

-- ---------------------------------------------------------------------------
-- 0. The gates and the shapes.

select is((select enabled from public.change_gates where key = 'auto-approve-at-the-shop'), false,
  'auto-approve-at-the-shop is inserted off');
select is((select code from public.change_gates where key = 'auto-approve-at-the-shop'), 'AA',
  'its code is AA');
select is((select enabled from public.change_gates where key = 'refreshed-staff-screens'), false,
  'refreshed-staff-screens is inserted off');
select is(
  (select depends_on from public.change_gate_dependencies where gate_key = 'refreshed-staff-screens'),
  'auto-approve-at-the-shop',
  'refreshed-staff-screens depends on auto-approve-at-the-shop');
select ok(
  (select bool_and(not attendance_needs_manager and not attendance_blocks_away) from public.outlets),
  'every outlet starts with both rules off');

-- ---------------------------------------------------------------------------
-- 1. Gate off: v3 is v2, case for case.

create temp table cases (label text, person uuid, outlet uuid, lat float8, lng float8, accuracy numeric)
  on commit drop;
insert into cases values
  ('inside',                 :'EMP_KAL', :'KAL', 22.9750,   88.4345, 12),
  ('31 m at ±104 m',         :'EMP_KAL', :'KAL', 22.975279, 88.4345, 104),
  ('2.6 km away',            :'EMP_KAL', :'KAL', 22.9984,   88.4345, 20),
  ('no position',            :'EMP_KAL', :'KAL', null,      null,    null),
  ('two outlets, inside one', :'TWO_OUTLETS', :'KAL', 22.9750, 88.4345, 12);
grant select on cases to authenticated;

select is(
  (select string_agg(label || ': ' || pg_temp.check_in(person, outlet, lat, lng, accuracy), '; ' order by label)
     from cases),
  (select string_agg(label || ': absent waiting', '; ' order by label) from cases),
  'with the gate off every check-in waits for a manager, inside the fence or not');

select pg_temp.rules(:'KAL', false, true);
select is(
  (select string_agg(label || ': ' || pg_temp.check_in(person, outlet, lat, lng, accuracy), '; ' order by label)
     from cases),
  (select string_agg(label || ': ' || pg_temp.check_in(person, outlet, lat, lng, accuracy, 'attendance_submit_attempt_v2'), '; ' order by label)
     from cases),
  'with the gate off v3 answers every case as v2 does, Block on included');
select pg_temp.rules(:'KAL', false, false);

-- ---------------------------------------------------------------------------
-- 2. Gate on: what counts.

update public.change_gates set enabled = true where key = 'auto-approve-at-the-shop';

select is(pg_temp.check_in(:'EMP_KAL', :'KAL', 22.9750, 88.4345, 12), 'present auto_approved',
  'a check-in inside the fence is approved at once');
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', 22.975279, 88.4345, 104), 'present auto_approved',
  '31 m away at ±104 m counts: the rule is distance only');
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', 22.9984, 88.4345, 20), 'absent waiting',
  'a check-in 2.6 km away waits');
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', null, null, null), 'absent waiting',
  'a check-in with no position waits');

-- On the radius, and one metre past it: the fence is set from the reading's
-- own distance so floating point decides nothing.
create temp table edge as
  select public.app_distance_m(22.9750, 88.4345, 22.9763, 88.4345) as d;
update public.outlets set geofence_radius_m = ceil((select d from edge)) where id = :'KAL';
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', 22.9763, 88.4345, 10), 'present auto_approved',
  'a reading within the radius by under a metre counts');
update public.outlets set geofence_radius_m = floor((select d from edge)) where id = :'KAL';
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', 22.9763, 88.4345, 10), 'absent waiting',
  'a reading past the radius by under a metre waits');
update public.outlets set geofence_radius_m = 150 where id = :'KAL';

-- An outlet whose position was never captured.
create temp table kal_position as
  select latitude, longitude, location_accuracy_m, location_captured_at
    from public.outlets where id = :'KAL';
update public.outlets
   set latitude = null, longitude = null, location_accuracy_m = null, location_captured_at = null
 where id = :'KAL';
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', 22.9750, 88.4345, 12), 'absent waiting',
  'at an outlet with no position nothing counts');
select pg_temp.rules(:'KAL', false, true);
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', 22.9750, 88.4345, 12),
  'refused: check-in away from the shop is blocked here',
  'and under Block an outlet with no position refuses every check-in');
select pg_temp.rules(:'KAL', false, false);
update public.outlets o
   set latitude = p.latitude, longitude = p.longitude,
       location_accuracy_m = p.location_accuracy_m, location_captured_at = p.location_captured_at
  from kal_position p
 where o.id = :'KAL';

-- Inside two fences: the person works at both, and a reading inside both is
-- ambiguous. Kanchrapara is reopened and moved onto Kalyani for the case.
select is(pg_temp.check_in(:'TWO_OUTLETS', :'KAL', 22.9750, 88.4345, 12), 'present auto_approved',
  'a person who works at two outlets counts inside the one fence they are in');
create temp table kpa_was as select latitude, longitude, is_active from public.outlets where id = :'KPA';
update public.outlets set latitude = 22.9751, longitude = 88.4345, is_active = true where id = :'KPA';
select is(pg_temp.check_in(:'TWO_OUTLETS', :'KAL', 22.9750, 88.4345, 12), 'absent waiting',
  'a reading inside two of their outlets'' fences waits for a manager');
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', 22.9750, 88.4345, 12), 'present auto_approved',
  'an overlapping fence at an outlet the person does not work at changes nothing');
update public.outlets o
   set latitude = w.latitude, longitude = w.longitude, is_active = w.is_active
  from kpa_was w
 where o.id = :'KPA';

-- Manager approves every check-in.
select pg_temp.rules(:'KAL', true, false);
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', 22.9750, 88.4345, 12), 'absent waiting',
  'with Manager approves every check-in on, a check-in inside the fence waits');
select pg_temp.rules(:'KAL', false, false);

-- ---------------------------------------------------------------------------
-- 3. Gate on: Block.

select pg_temp.rules(:'KAL', false, true);
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', 22.9984, 88.4345, 20),
  'refused: check-in away from the shop is blocked here',
  'under Block a check-in 2.6 km away is refused');
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', null, null, null),
  'refused: check-in away from the shop is blocked here',
  'under Block a check-in with no position is refused');
select is(pg_temp.check_in(:'EMP_KAL', :'KAL', 22.9750, 88.4345, 12), 'present auto_approved',
  'under Block a check-in inside the fence still counts');

select pg_temp.impersonate(:'EMP_KAL');
select throws_ok($q$
  select public.attendance_submit_attempt_v3(
    '99000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.9984, 88.4345, 20)
$q$, '23514', 'check-in away from the shop is blocked here',
  'a hand-crafted check-in from away is refused with check_violation');
reset role;
select is(
  (select count(*)::int from public.attendance_attempts where id = '99000000-0000-4000-a000-000000000001')
  + (select count(*)::int from public.attendance
      where person_id = :'EMP_KAL' and business_date = public.app_business_date(now(), time '04:00')),
  0,
  'a refused check-in writes no attempt and no day');
select pg_temp.rules(:'KAL', false, false);

-- Record arrival still settles a blocked day.
select pg_temp.rules(:'KPA', false, true);
update public.outlets set is_active = true where id = :'KPA';
select is(pg_temp.check_in(:'EMP_KPA', :'KPA', 22.9984, 88.4345, 20),
  'refused: check-in away from the shop is blocked here',
  'Kanchrapara under Block refuses its employee from away');
select pg_temp.impersonate(:'MGR_KPA');
select lives_ok($q$
  select public.attendance_record_manual_v2(
    '99000000-0000-4000-a000-000000000002', '99000000-0000-4000-a000-000000000003',
    '10000000-0000-4000-a000-000000000007', '00000000-0000-4000-a000-000000000002',
    public.app_business_date(now(), time '04:00'), now())
$q$, 'the manager records the refused day by hand');
reset role;
select is(
  (select status from public.attendance
    where person_id = :'EMP_KPA' and business_date = public.app_business_date(now(), time '04:00')),
  'present'::public.attendance_status,
  'and the day is present');
select pg_temp.rules(:'KPA', false, false);
update public.outlets o set is_active = w.is_active from kpa_was w where o.id = :'KPA';

-- ---------------------------------------------------------------------------
-- 4. What an auto-approved day stores, written for real.

select pg_temp.impersonate(:'EMP_KAL');
select lives_ok($q$
  select public.attendance_submit_attempt_v3(
    '99000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.9750, 88.4345, 12)
$q$, 'a first-of-day check-in inside the fence is accepted');
reset role;
set constraints all immediate;

create temp table auto_day as
  select a.*, d.kind, d.actor_id, d.actor_name, d.fence_radius_m, d.prevents_retry,
         d.previous_status, d.new_status, d.attempt_id, t.settled_at
    from public.attendance a
    join public.attendance_decisions d on d.id = a.latest_decision_id
    join public.attendance_attempts t on t.id = a.outcome_attempt_id
   where a.person_id = :'EMP_KAL' and a.business_date = public.app_business_date(now(), time '04:00');

select is((select status from auto_day), 'present'::public.attendance_status,
  'the first-of-day check-in reads present once committed: the geofence trigger did not undo it');
select is((select kind from auto_day), 'auto_approved'::public.attendance_decision_kind,
  'its decision is auto_approved');
select ok((select actor_id is null and actor_name is null from auto_day),
  'the decision names no actor');
select is((select fence_radius_m from auto_day), 150,
  'the decision stamps the radius that judged it');
select ok((select prevents_retry and previous_status = 'absent' and new_status = 'present' from auto_day),
  'it prevents a retry and moves the day from absent to present');
select ok((select current_attempt_id is null and retry_blocked and attempt_id = '99000000-0000-4000-a000-000000000010'
             and settled_at is not null from auto_day),
  'the attempt is the outcome, settled, and nothing is waiting');
select ok((select approved_by is null and approved_by_name is null and approved_at is null from auto_day),
  'the day has no approver');
select is((select count(*)::int from public.attendance_decisions
            where person_id = :'EMP_KAL' and business_date = public.app_business_date(now(), time '04:00')),
  1, 'one decision, written once');

select pg_temp.impersonate(:'EMP_KAL');
select throws_ok($q$
  select public.attendance_submit_attempt_v3(
    '99000000-0000-4000-a000-000000000011', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.9750, 88.4345, 12,
    (select state_version from public.attendance where outcome_attempt_id = '99000000-0000-4000-a000-000000000010'))
$q$, 'P0001', 'another check-in is not allowed for this business date',
  'an auto-approved day refuses another check-in');
select lives_ok($q$
  select public.attendance_submit_attempt_v3(
    '99000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.9750, 88.4345, 12)
$q$, 'a replay of the same attempt is answered, not refused');

select pg_temp.impersonate(:'MGR_KAL');
select lives_ok($q$
  select public.attendance_correct(
    '99000000-0000-4000-a000-000000000012',
    (select id from public.attendance where outcome_attempt_id = '99000000-0000-4000-a000-000000000010'),
    (select state_version from public.attendance where outcome_attempt_id = '99000000-0000-4000-a000-000000000010'),
    'absent', 'Left before service (synthetic)', null, null, null)
$q$, 'the manager corrects an auto-approved day with one action');
reset role;
select is(
  (select status from public.attendance where outcome_attempt_id = '99000000-0000-4000-a000-000000000010'),
  'absent'::public.attendance_status, 'and the correction stands');

-- Late counts, and keeps its stamped deadline.
update public.outlets set arrival_deadline = time '04:00' where id = :'KAL';
select pg_temp.impersonate(:'BILLER_KAL_2');
select lives_ok($q$
  select public.attendance_submit_attempt_v3(
    '99000000-0000-4000-a000-000000000020', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.9750, 88.4345, 12)
$q$, 'a check-in after the deadline is accepted');
reset role;
select ok(
  (select a.status = 'present' and t.arrival_deadline = time '04:00'
     from public.attendance a join public.attendance_attempts t on t.id = a.outcome_attempt_id
    where t.id = '99000000-0000-4000-a000-000000000020'),
  'a late check-in inside the fence is approved and keeps its stamped deadline');
update public.outlets set arrival_deadline = time '13:00' where id = :'KAL';

-- An outside attempt, then a retry from inside the fence, counts.
select pg_temp.impersonate(:'PENDING_KAL');
select lives_ok($q$
  select public.attendance_submit_attempt_v3(
    '99000000-0000-4000-a000-000000000030', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.9984, 88.4345, 20)
$q$, 'a check-in from away is recorded and waits');
select lives_ok($q$
  select public.attendance_submit_attempt_v3(
    '99000000-0000-4000-a000-000000000031', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.9750, 88.4345, 12,
    (select state_version from public.attendance where current_attempt_id = '99000000-0000-4000-a000-000000000030'))
$q$, 'a retry from inside the fence is accepted');
reset role;
set constraints all immediate;
select ok(
  (select a.status = 'present' and a.outcome_attempt_id = '99000000-0000-4000-a000-000000000031'
          and a.current_attempt_id is null
     from public.attendance a
    where a.person_id = :'PENDING_KAL' and a.business_date = public.app_business_date(now(), time '04:00')),
  'the in-fence retry of an outside attempt counts');
select isnt(
  (select superseded_at from public.attendance_attempts where id = '99000000-0000-4000-a000-000000000030'),
  null::timestamptz, 'and the outside attempt is superseded, not overwritten');

-- ---------------------------------------------------------------------------
-- 5. Who may change the rules.

select pg_temp.impersonate(:'OWNER');
select lives_ok($q$ select public.set_outlet_attendance_rules('00000000-0000-4000-a000-000000000001', true, false) $q$,
  'the owner changes an outlet''s attendance rules');
select pg_temp.impersonate(:'MGR_KAL');
select lives_ok($q$ select public.set_outlet_attendance_rules('00000000-0000-4000-a000-000000000001', false, true) $q$,
  'the outlet''s manager changes its attendance rules');
reset role;
select ok(
  (select not attendance_needs_manager and attendance_blocks_away from public.outlets where id = :'KAL'),
  'and the rules read back as saved');

select pg_temp.impersonate(:'MGR_KPA');
select throws_ok($q$ select public.set_outlet_attendance_rules('00000000-0000-4000-a000-000000000001', true, true) $q$,
  '42501', null, 'another outlet''s manager is refused');
select pg_temp.impersonate(:'EMP_KAL');
select throws_ok($q$ select public.set_outlet_attendance_rules('00000000-0000-4000-a000-000000000001', true, true) $q$,
  '42501', null, 'an Employee is refused');
select pg_temp.impersonate(:'BILLER_KAL');
select throws_ok($q$ select public.set_outlet_attendance_rules('00000000-0000-4000-a000-000000000001', true, true) $q$,
  '42501', null, 'a Biller is refused');
select pg_temp.impersonate(:'DEVICE');
select throws_ok($q$ select public.set_outlet_attendance_rules('00000000-0000-4000-a000-000000000001', true, true) $q$,
  '42501', null, 'a counter tablet is refused');
select pg_temp.impersonate(:'DEACTIVATED');
select throws_ok($q$ select public.set_outlet_attendance_rules('00000000-0000-4000-a000-000000000001', true, true) $q$,
  '42501', null, 'a deactivated manager is refused');
reset role;
select ok(
  (select not attendance_needs_manager and attendance_blocks_away from public.outlets where id = :'KAL'),
  'the refused calls changed nothing');

select pg_temp.impersonate(:'MGR_KAL');
select pg_temp.attempt($q$
  update public.outlets set geofence_radius_m = 5000, latitude = 0
   where id = '00000000-0000-4000-a000-000000000001'
$q$);
reset role;
select ok(
  (select geofence_radius_m = 150 and latitude = 22.9750 from public.outlets where id = :'KAL'),
  'the manager still cannot move the outlet or widen its fence');

select pg_temp.impersonate(:'MGR_KAL');
select throws_ok($q$
  insert into public.attendance_decisions (
    id, attendance_id, attempt_id, outlet_id, person_id, business_date, kind,
    prevents_retry, previous_status, new_status, request_fingerprint)
  select gen_random_uuid(), a.id, a.outcome_attempt_id, a.outlet_id, a.person_id, a.business_date,
         'auto_approved', true, 'absent', 'present', 'hand-crafted'
    from public.attendance a limit 1
$q$, '42501', null, 'nobody can write an auto_approved decision by hand');
reset role;

select * from finish();
rollback;
