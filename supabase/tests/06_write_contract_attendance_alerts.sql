-- Attendance command boundary and the alert thread's narrow write paths.

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

create function pg_temp.rows_touched(q text)
returns bigint language plpgsql as $$
declare n bigint;
begin execute q; get diagnostics n = row_count; return n; end;
$$;

-- Authenticated callers cannot bypass commands.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$
  insert into public.attendance (outlet_id, person_id, business_date, status)
  values ('00000000-0000-4000-a000-000000000001', auth.uid(), current_date, 'absent')
$q$, '42501', null, 'authenticated direct attendance inserts are revoked');

select lives_ok($q$
  select public.attendance_submit_attempt(
    '81000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(),
    22.97502, 88.43455, 15, null)
$q$, 'an employee checks in through the guarded command');

select is((select status from public.attendance where current_attempt_id = '81000000-0000-4000-a000-000000000001'),
  'absent'::public.attendance_status, 'the claim remains absent until a manager decides');
select is((select arrival_deadline from public.attendance_attempts where id = '81000000-0000-4000-a000-000000000001'),
  time '13:00', 'the database stamps the outlet deadline');
select ok((select distance_m < 100 from public.attendance_attempts where id = '81000000-0000-4000-a000-000000000001'),
  'the database derives distance from coordinates');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
-- A set of one, because the per-row Approve button is a set of one: there is a
-- single write path, so this rule cannot be enforced two ways.
select lives_ok($q$
  select * from public.attendance_decide_set(
    '82000000-0000-4000-a000-0000000000c1', 'approve',
    jsonb_build_array(jsonb_build_object(
      'attendance_id', (select id from public.attendance where current_attempt_id = '81000000-0000-4000-a000-000000000001'),
      'attempt_id', '81000000-0000-4000-a000-000000000001',
      'expected_version', (select state_version from public.attendance where current_attempt_id = '81000000-0000-4000-a000-000000000001'),
      'decision_id', '82000000-0000-4000-a000-000000000001')),
    null, false, 22.97502, 88.43455, 15)
$q$, 'the outlet manager approves the current attempt');
select is((select status from public.attendance where outcome_attempt_id = '81000000-0000-4000-a000-000000000001'),
  'present'::public.attendance_status, 'approval settles the canonical day present');
select is((select actor_name from public.attendance_decisions where id = '82000000-0000-4000-a000-000000000001'),
  'Synthetic Admin Kal', 'manager identity is snapshotted by the database');

-- "Ten minutes ago, or the moment this business day opened, whichever is later."
-- This case names TODAY, so its instant has to sit inside today: for the ten
-- minutes after the 04:00 cutover a flat `now() - interval '10 minutes'` is a
-- time on the previous business day, and the command refuses an instant that
-- resolves to a date other than the one named. Clamping keeps the assertion
-- about the write contract rather than about the hour the suite happens to run
-- in (17_owner_reach.sql carries the same clamp for the same reason).
select lives_ok($q$
  select public.attendance_record_manual(
    '81000000-0000-4000-a000-000000000002',
    '82000000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'),
    greatest(
      now() - interval '10 minutes',
      (public.app_business_date(now(), time '04:00') + time '04:00')
        at time zone 'Asia/Kolkata'))
$q$, 'a manager records and settles a manual arrival through its command');
select is((select kind from public.attendance_decisions where id = '82000000-0000-4000-a000-000000000002'),
  'manual_present'::public.attendance_decision_kind, 'manual settlement is an explicit decision');

-- Alerts retain their independent write contract.
select lives_ok($q$
  insert into public.alerts (outlet_id, raised_by, subject, message, category, priority)
  values ('00000000-0000-4000-a000-000000000001', auth.uid(),
          'Grill igniter failing', 'Needs a service visit this week. (synthetic)', 'equipment', 'normal')
$q$, 'the franchise admin raises an alert');
select throws_ok($q$
  insert into public.alert_responses (alert_id, responder_profile_id, message)
  values ('70000000-0000-4000-a000-000000000001', auth.uid(), 'talking to myself')
$q$, '42501', null, 'the franchise admin cannot write owner responses');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select lives_ok($q$
  insert into public.alert_responses (alert_id, responder_profile_id, message)
  values ('70000000-0000-4000-a000-000000000001', auth.uid(), 'Booked the service visit. (synthetic)')
$q$, 'the owner responds');
select lives_ok($q$
  update public.alerts set status = 'resolved' where id = '70000000-0000-4000-a000-000000000001'
$q$, 'the owner resolves an alert');
select throws_ok($q$
  update public.alerts set subject = 'rewritten history' where id = '70000000-0000-4000-a000-000000000001'
$q$, 'P0001', null, 'only alert status may change');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select is((select count(*) from public.alerts), 0::bigint, 'employees see no alerts');

reset role;
select * from finish();
rollback;
