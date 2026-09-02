-- Self check-in must use the database clock, never the device/GPS timestamp.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
end;
$$;

-- Put one outlet after its cutover/deadline and the other before its cutover.
-- The boundary values avoid wrapping around midnight: 00:00 always resolves to
-- the CURRENT business date, while 24:00 always resolves to the PRIOR one.
--
-- Which outlet gets which is not free. The seed checks these people in at
-- Kalyani on `current_date - 1`, and `current_date` is the container's UTC
-- date, so between 00:00 and 05:30 IST it names a different day than it does
-- for the rest of the day. Kalyani must therefore resolve to the CURRENT
-- business date, which is strictly later than any seeded row at every hour, or
-- the first check-in here collides with a seeded one and the suite fails for
-- most of the day. IST is ahead of UTC, so `today` in Asia/Kolkata is never
-- earlier than `current_date` in the container: that inequality is what makes
-- this arrangement hold at every hour rather than at the hour it was written.
update public.outlets
   set business_day_cutover = time '00:00',
       arrival_deadline = time '00:00'
 where id = '00000000-0000-4000-a000-000000000001';
update public.outlets
   set business_day_cutover = time '24:00'
 where id = '00000000-0000-4000-a000-000000000002';

-- The arrangement above, asserted rather than trusted. This suite has broken
-- twice on a date it assumed: once when relative cutovers wrapped past
-- midnight, and once when the boundary values were the right idea applied to
-- the wrong outlets and Kalyani's derived day landed on a seeded check-in. If a
-- future seed reaches today, this line fails first and says so, instead of
-- eleven assertions failing as "another check-in is not allowed".
select ok(
  (select count(*) = 0 from public.attendance a
    where a.outlet_id = '00000000-0000-4000-a000-000000000001'
      and a.business_date >= public.app_business_date(now(), time '00:00')),
  'no seeded check-in occupies the business date these check-ins resolve to');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000e');

select lives_ok($q$
  select public.attendance_submit_attempt(
    '87000000-0000-4000-a000-000000000101',
    '00000000-0000-4000-a000-000000000001',
    date '2099-01-01',
    now() + interval '1 year',
    22.9840, 88.4345, 25, null
  )
$q$, 'an ahead device timestamp cannot block a self check-in');
select ok((select attempted_at > statement_timestamp() - interval '1 minute'
                 and attempted_at < statement_timestamp() + interval '1 minute'
             from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000101'),
  'the accepted attempt stores the database statement instant, not the forward device instant');
select is((select a.check_in_at from public.attendance a
             join public.attendance_attempts at on at.attendance_id = a.id
            where at.id = '87000000-0000-4000-a000-000000000101'),
          (select attempted_at from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000101'),
  'the canonical check-in uses the same database-authored instant');
select is((select at.business_date from public.attendance_attempts at where at.id = '87000000-0000-4000-a000-000000000101'),
          (select public.app_business_date(at.attempted_at, o.business_day_cutover)
             from public.attendance_attempts at
             join public.outlets o on o.id = at.outlet_id
            where at.id = '87000000-0000-4000-a000-000000000101'),
  'a first attempt stores the explicit business date derived at the database instant');
select ok((select attempted_at > ((business_date + arrival_deadline) at time zone 'Asia/Kolkata')
             from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000101'),
  'lateness follows server acceptance time, not the submitted future clock');

create temporary table pg_temp.first_server_attempt as
select attempted_at, business_date
  from public.attendance_attempts
 where id = '87000000-0000-4000-a000-000000000101';

-- Open the one legal retry, then move Kalyani past its cutover: 24:00 puts its
-- current business date a day behind the attempt's. The exact original command
-- must still replay before any current-date calculation.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select lives_ok($q$
  select * from public.attendance_decide_set(
    '88000000-0000-4000-a000-000000000101', 'deny',
    jsonb_build_array(jsonb_build_object(
      'attendance_id', (select id from public.attendance where current_attempt_id = '87000000-0000-4000-a000-000000000101'),
      'attempt_id', '87000000-0000-4000-a000-000000000101',
      'expected_version', (select state_version from public.attendance where current_attempt_id = '87000000-0000-4000-a000-000000000101'),
      'decision_id', '88000000-0000-4000-a000-000000000102')),
    'Outside the outlet', false, null, null, null)
$q$, 'the manager leaves the denied attempt eligible for one retry');

reset role;
update public.outlets
   set business_day_cutover = time '24:00'
 where id = '00000000-0000-4000-a000-000000000001';
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000e');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '87000000-0000-4000-a000-000000000101',
    '00000000-0000-4000-a000-000000000001',
    date '2099-01-01', now() + interval '1 year', 22.9840, 88.4345, 25, null)
$q$, 'an exact replay after rollover returns the original server-stamped attempt');
select is((select count(*) from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000101'),
  1::bigint, 'replay leaves one immutable attempt');
select is((select attempted_at from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000101'),
          (select attempted_at from pg_temp.first_server_attempt),
  'replay keeps the first server-authored event instant');
select is((select business_date from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000101'),
          (select business_date from pg_temp.first_server_attempt),
  'replay keeps the first explicit business date');
select throws_ok($q$
  select public.attendance_submit_attempt(
    '87000000-0000-4000-a000-000000000101',
    '00000000-0000-4000-a000-000000000001',
    date '2099-01-01', now() + interval '1 year' + interval '1 minute', 22.9840, 88.4345, 25, null)
$q$, 'P0001', 'attempt id was reused with a changed payload', 'changed legacy timestamp reuse remains refused');

-- Kalyani now regards the original row as current again; Kanchrapara remains
-- before cutover, so the retry must stay anchored to the canonical date rather
-- than create a second day at the target outlet.
reset role;
update public.outlets
   set business_day_cutover = time '00:00'
 where id = '00000000-0000-4000-a000-000000000001';
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000e');
select throws_ok($q$
  select public.attendance_submit_attempt(
    '87000000-0000-4000-a000-000000000102',
    '00000000-0000-4000-a000-000000000002',
    (select business_date from pg_temp.first_server_attempt), now(), null, null, null,
    (select state_version from public.attendance where current_attempt_id is null
       and person_id = auth.uid() and business_date = (select business_date from pg_temp.first_server_attempt)))
$q$, 'P0001', 'retry target no longer regards this as its current business date',
  'a retry cannot move its canonical day across an outlet cutover');

-- A backward phone clock cannot backdate either the event or the lateness.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '87000000-0000-4000-a000-000000000103',
    '00000000-0000-4000-a000-000000000001',
    date '1900-01-01', now() - interval '1 year', 22.97505, 88.43460, 12, null)
$q$, 'a backward device timestamp cannot backdate a self check-in');
select ok((select attempted_at > statement_timestamp() - interval '1 minute'
                 and attempted_at < statement_timestamp() + interval '1 minute'
             from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000103'),
  'the backward-clock attempt also stores database time');
select ok((select attempted_at > ((business_date + arrival_deadline) at time zone 'Asia/Kolkata')
             from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000103'),
  'the backward clock cannot make a server-late arrival look on time');

-- Missing GPS changes evidence, not the clock: the same server-authoritative
-- event is written with explicit null coordinates.
select pg_temp.impersonate('20000000-0000-4000-a000-000000000002');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '87000000-0000-4000-a000-000000000104',
    '00000000-0000-4000-a000-000000000001',
    date '1900-01-01', now() + interval '1 year', null, null, null, null)
$q$, 'a position-free self check-in still receives the database clock');
select ok((select latitude is null and longitude is null and accuracy_m is null
             from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000104'),
  'the position-free attempt stores no fabricated location evidence');
select ok((select attempted_at > statement_timestamp() - interval '1 minute'
                 and attempted_at < statement_timestamp() + interval '1 minute'
             from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000104'),
  'the position-free attempt uses the same server clock');

-- Manual entry is intentional testimony: an authorised manager's past instant
-- remains the event time, while self check-in does not get that privilege.
--
-- "Seven minutes ago, or the moment this business day opened, whichever is
-- later", both halves read from `now()` — the same clock the call below names
-- its date from. That call names TODAY, and for the seven minutes after the
-- outlet's cutover a flat `now() - interval '7 minutes'` lands on the previous
-- business day, which the command refuses as an instant that does not belong to
-- the named date. The claim under test is that the asserted instant survives,
-- not which minute the suite happens to run in.
create temporary table pg_temp.manual_time as
select greatest(
         now() - interval '7 minutes',
         (public.app_business_date(now(), o.business_day_cutover)
            + o.business_day_cutover) at time zone 'Asia/Kolkata') as at
  from public.outlets o
 where o.id = '00000000-0000-4000-a000-000000000001';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select lives_ok($q$
  select public.attendance_record_manual(
    '87000000-0000-4000-a000-000000000105',
    '88000000-0000-4000-a000-000000000105',
    '10000000-0000-4000-a000-00000000000a',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), (select business_day_cutover from public.outlets where id = '00000000-0000-4000-a000-000000000001')),
    (select at from pg_temp.manual_time))
$q$, 'manual historical entry remains manager-attested');
select is((select attempted_at from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000105'),
          (select at from pg_temp.manual_time), 'manual entry retains its asserted historical instant');
select is((select check_in_at from public.attendance where outcome_attempt_id = '87000000-0000-4000-a000-000000000105'),
          (select at from pg_temp.manual_time), 'manual canonical time retains the manager assertion');

reset role;
select * from finish();
rollback;
