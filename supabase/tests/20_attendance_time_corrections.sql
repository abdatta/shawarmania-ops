-- Settled arrival times may change effectively; captured attempts never do.

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

create temporary table correction_target as
select a.id, a.state_version, a.business_date, a.check_in_at,
       a.outcome_attempt_id, at.attempted_at
  from public.attendance a
  join public.attendance_attempts at on at.id = a.outcome_attempt_id
 where a.person_id = '10000000-0000-4000-a000-000000000006'
   and a.outlet_id = '00000000-0000-4000-a000-000000000001'
   and a.current_attempt_id is null
   and a.business_date < public.app_business_date(now(), time '04:00')
 order by a.business_date desc
 limit 1;
grant select on correction_target to authenticated;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select lives_ok($q$
  select public.attendance_correct(
    '8a000000-0000-4000-a000-000000000001',
    (select id from correction_target),
    (select state_version from correction_target),
    'time', 'Paper register confirms the arrival', null, null, null,
    ((select business_date from correction_target) + time '12:30') at time zone 'Asia/Kolkata')
$q$, 'an outlet manager corrects a settled historical arrival time');

select is(
  (select check_in_at from public.attendance where id = (select id from correction_target)),
  ((select business_date from correction_target) + time '12:30') at time zone 'Asia/Kolkata',
  'the canonical effective arrival time changes');
select is(
  (select attempted_at from public.attendance_attempts where id = (select outcome_attempt_id from correction_target)),
  (select attempted_at from correction_target),
  'the captured attempt timestamp remains immutable');
select is(
  (select previous_check_in_at from public.attendance_decisions where id = '8a000000-0000-4000-a000-000000000001'),
  (select check_in_at from correction_target),
  'the decision preserves the previous effective time');
select is(
  (select new_check_in_at from public.attendance_decisions where id = '8a000000-0000-4000-a000-000000000001'),
  ((select business_date from correction_target) + time '12:30') at time zone 'Asia/Kolkata',
  'the decision preserves the replacement time');
select is(
  (select actor_id from public.attendance_decisions where id = '8a000000-0000-4000-a000-000000000001'),
  '10000000-0000-4000-a000-000000000002'::uuid,
  'the database stamps the acting manager');

savepoint correction_cutover_probe;
select lives_ok($q$
  select public.attendance_correct(
    '8a000000-0000-4000-a000-000000000006',
    (select id from correction_target),
    (select state_version + 1 from correction_target),
    'time', 'After-midnight arrival before cutover', null, null, null,
    ((select business_date + 1 from correction_target) + time '02:30') at time zone 'Asia/Kolkata')
$q$, 'an after-midnight time before cutover remains on the recorded business date');
select is(
  (select check_in_at from public.attendance where id = (select id from correction_target)),
  ((select business_date + 1 from correction_target) + time '02:30') at time zone 'Asia/Kolkata',
  'the canonical time accepts the next calendar date before the outlet cutover');
rollback to correction_cutover_probe;

select lives_ok($q$
  select public.attendance_correct(
    '8a000000-0000-4000-a000-000000000001',
    (select id from correction_target),
    (select state_version from correction_target),
    'time', 'Paper register confirms the arrival', null, null, null,
    ((select business_date from correction_target) + time '12:30') at time zone 'Asia/Kolkata')
$q$, 'an exact correction replay is idempotent');
select is(
  (select count(*) from public.attendance_decisions where id = '8a000000-0000-4000-a000-000000000001'),
  1::bigint, 'idempotent replay appends no duplicate decision');

select throws_ok($q$
  select public.attendance_correct(
    '8a000000-0000-4000-a000-000000000001',
    (select id from correction_target),
    (select state_version from correction_target),
    'time', 'Changed payload', null, null, null,
    ((select business_date from correction_target) + time '12:30') at time zone 'Asia/Kolkata')
$q$, 'P0001', 'decision id was reused with a changed payload',
  'a reused id with changed correction data is refused');

select throws_ok($q$
  select public.attendance_correct(
    '8a000000-0000-4000-a000-000000000002',
    (select id from correction_target),
    (select state_version from correction_target),
    'time', 'Stale version', null, null, null,
    ((select business_date from correction_target) + time '12:45') at time zone 'Asia/Kolkata')
$q$, 'P0001', 'attendance state is stale', 'a stale correction cannot win');

select throws_ok($q$
  select public.attendance_correct(
    '8a000000-0000-4000-a000-000000000003',
    (select id from correction_target),
    (select state_version + 1 from correction_target),
    'time', 'Wrong business date', null, null, null,
    ((select business_date - 1 from correction_target) + time '12:30') at time zone 'Asia/Kolkata')
$q$, 'P0001', 'a corrected check-in time must remain on the recorded business date',
  'a correction cannot cross the outlet business-date boundary');

select throws_ok($q$
  select public.attendance_correct(
    '8a000000-0000-4000-a000-000000000004',
    (select id from correction_target),
    (select state_version + 1 from correction_target),
    'time', 'Future time', null, null, null, now() + interval '1 minute')
$q$, 'P0001', 'a corrected check-in time cannot be in the future',
  'a future effective arrival is refused');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$
  select public.attendance_correct(
    '8a000000-0000-4000-a000-000000000005',
    (select id from correction_target),
    (select state_version + 1 from correction_target),
    'time', 'Self correction', null, null, null,
    ((select business_date from correction_target) + time '13:00') at time zone 'Asia/Kolkata')
$q$, '42501', null, 'an employee cannot correct their own arrival time');

select is(
  (select count(*) from public.attendance_decisions
    where attendance_id = (select id from correction_target)
      and kind = 'correct_time'),
  1::bigint, 'every refused command leaves the append-only history unchanged');

reset role;
select * from finish();
rollback;
