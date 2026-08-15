-- Geofence evidence through attendance commands.

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

-- Pin the distance implementation independently of attendance.
select is(round(public.app_distance_m(22.97505, 88.43460, 22.97505, 88.43460)::numeric, 2),
  0.00::numeric, 'identical points are zero metres apart');
select ok(public.app_distance_m(22.97505, 88.43460, 22.9840, 88.4345) > 900,
  'the reference kilometre is measured beyond the fence');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '83000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.9840, 88.4345, 20, null)
$q$, 'an outside check-in is recorded for manager review');
select ok((select distance_m > 900 from public.attendance_attempts where id = '83000000-0000-4000-a000-000000000001'),
  'the client cannot forge the stored distance');
select is((select status from public.attendance where current_attempt_id = '83000000-0000-4000-a000-000000000001'),
  'absent'::public.attendance_status, 'outside evidence does not settle the outcome');

select lives_ok($q$
  select public.attendance_submit_attempt(
    '83000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.9830, 88.4345, 18,
    (select state_version from public.attendance where current_attempt_id = '83000000-0000-4000-a000-000000000001'))
$q$, 'an outside current attempt may be retried');
select isnt((select superseded_at from public.attendance_attempts where id = '83000000-0000-4000-a000-000000000001'),
  null::timestamptz, 'retry supersedes rather than overwrites old evidence');

select lives_ok($q$
  select public.attendance_submit_attempt(
    '83000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.97505, 88.43460, 12,
    (select state_version from public.attendance where current_attempt_id = '83000000-0000-4000-a000-000000000002'))
$q$, 'an outside attempt can be replaced by an inside attempt');
select throws_ok($q$
  select public.attendance_submit_attempt(
    '83000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.97505, 88.43460, 12,
    (select state_version from public.attendance where current_attempt_id = '83000000-0000-4000-a000-000000000003'))
$q$, 'P0001', 'the current in-fence attempt must be decided before another check-in',
  'an inside current attempt locks employee retries');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select lives_ok($q$
  select * from public.attendance_decide_set(
    '84000000-0000-4000-a000-0000000000c1', 'approve',
    jsonb_build_array(jsonb_build_object(
      'attendance_id', (select id from public.attendance where current_attempt_id = '83000000-0000-4000-a000-000000000003'),
      'attempt_id', '83000000-0000-4000-a000-000000000003',
      'expected_version', (select state_version from public.attendance where current_attempt_id = '83000000-0000-4000-a000-000000000003'),
      'decision_id', '84000000-0000-4000-a000-000000000001')),
    null, false, 22.97505, 88.43460, 12)
$q$, 'an on-site same-day approval needs no reason');
select ok((select manager_distance_m < 100 from public.attendance_decisions where id = '84000000-0000-4000-a000-000000000001'),
  'manager distance is computed from manager coordinates');

reset role;
select throws_ok($q$
  update public.attendance_attempts set latitude = 0 where id = '83000000-0000-4000-a000-000000000001'
$q$, 'P0001', 'attendance attempts are append-only', 'attempt evidence is immutable even to a service path');
select throws_ok($q$
  delete from public.attendance_decisions where id = '84000000-0000-4000-a000-000000000001'
$q$, 'P0001', 'attendance decisions are append-only', 'decisions cannot be deleted');

-- Missing employee coordinates record unknown distance and require a reasoned approval.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000007');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '83000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000002',
    public.app_business_date(now(), time '04:00'), now(), null, null, null, null)
$q$, 'an unverifiable check-in claim is still recorded');
select is((select distance_m from public.attendance_attempts where id = '83000000-0000-4000-a000-000000000005'),
  null::numeric, 'missing coordinates invent no distance');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select throws_ok($q$
  select * from public.attendance_decide_set(
    '84000000-0000-4000-a000-0000000000c2', 'approve',
    jsonb_build_array(jsonb_build_object(
      'attendance_id', (select id from public.attendance where current_attempt_id = '83000000-0000-4000-a000-000000000005'),
      'attempt_id', '83000000-0000-4000-a000-000000000005',
      'expected_version', (select state_version from public.attendance where current_attempt_id = '83000000-0000-4000-a000-000000000005'),
      'decision_id', '84000000-0000-4000-a000-000000000002')),
    null, false, null, null, null)
$q$, 'P0001', null, 'an unverifiable approval needs a reason');
select lives_ok($q$
  select * from public.attendance_decide_set(
    '84000000-0000-4000-a000-0000000000c3', 'approve',
    jsonb_build_array(jsonb_build_object(
      'attendance_id', (select id from public.attendance where current_attempt_id = '83000000-0000-4000-a000-000000000005'),
      'attempt_id', '83000000-0000-4000-a000-000000000005',
      'expected_version', (select state_version from public.attendance where current_attempt_id = '83000000-0000-4000-a000-000000000005'),
      'decision_id', '84000000-0000-4000-a000-000000000003')),
    'Seen at the counter (synthetic)', false, null, null, null)
$q$, 'a reason permits an unverifiable approval');

reset role;
select * from finish();
rollback;
