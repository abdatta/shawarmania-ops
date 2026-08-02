-- Denial, retries, correction, idempotency and cross-outlet evidence isolation.

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

-- A multi-outlet employee starts with weak Kalyani evidence.
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000e');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '87000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), date_trunc('minute', now()), 22.9840, 88.4345, 25, null)
$q$, 'the multi-outlet employee records an outside Kalyani attempt');

select lives_ok($q$
  select public.attendance_submit_attempt(
    '87000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), date_trunc('minute', now()), 22.9840, 88.4345, 25, null)
$q$, 'an exact repeated command UUID is idempotent');
select is((select count(*) from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000001'),
  1::bigint, 'idempotency leaves one attempt');
select throws_ok($q$
  select public.attendance_submit_attempt(
    '87000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), date_trunc('minute', now()), 22.9830, 88.4345, 25, null)
$q$, 'P0001', 'attempt id was reused with a changed payload', 'changed-payload UUID reuse is refused');

-- Denial records absence and no manager GPS; retry remains open by default.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$
  select public.attendance_deny_attempt(
    '88000000-0000-4000-a000-000000000001',
    (select id from public.attendance where current_attempt_id = '87000000-0000-4000-a000-000000000001'),
    '87000000-0000-4000-a000-000000000001',
    (select state_version from public.attendance where current_attempt_id = '87000000-0000-4000-a000-000000000001'),
    '   ', false)
$q$, 'P0001', 'a denial requires a reason', 'blank denial is refused');
select lives_ok($q$
  select public.attendance_deny_attempt(
    '88000000-0000-4000-a000-000000000001',
    (select id from public.attendance where current_attempt_id = '87000000-0000-4000-a000-000000000001'),
    '87000000-0000-4000-a000-000000000001',
    (select state_version from public.attendance where current_attempt_id = '87000000-0000-4000-a000-000000000001'),
    'Not at outlet', false)
$q$, 'the Kalyani manager denies without preventing retry');
select is((select status from public.attendance where outcome_attempt_id = '87000000-0000-4000-a000-000000000001'),
  'absent'::public.attendance_status, 'denial conclusively marks the day absent');
select is((select retry_blocked from public.attendance where outcome_attempt_id = '87000000-0000-4000-a000-000000000001'),
  false, 'retry remains open when the manager leaves the checkbox unchecked');
select is((select manager_lat from public.attendance_decisions where id = '88000000-0000-4000-a000-000000000001'),
  null::double precision, 'denial captures no manager location');

-- The employee can recover at the correct outlet; absence remains until approval.
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000e');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '87000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002',
    public.app_business_date(now(), time '04:00'), now(), null, null, null,
    (select state_version from public.attendance where outcome_attempt_id = '87000000-0000-4000-a000-000000000001'))
$q$, 'the employee retries at the correct assigned outlet');
select is((select status from public.attendance where current_attempt_id = '87000000-0000-4000-a000-000000000002'),
  'absent'::public.attendance_status, 'the previous absent outcome remains while the retry waits');
select is((select outlet_id from public.attendance where current_attempt_id = '87000000-0000-4000-a000-000000000002'),
  '00000000-0000-4000-a000-000000000002'::uuid, 'the single waiting queue moves to Kanchrapara');
select is((select count(*) from public.attendance_attempts where attendance_id = (select attendance_id from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000002')),
  2::bigint, 'both attempts remain in immutable history');

-- Former manager sees local history only and cannot act on the new attempt.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is((select count(*) from public.attendance_attempts where person_id = '10000000-0000-4000-a000-00000000000e' and business_date = public.app_business_date(now(), time '04:00')),
  1::bigint, 'the former manager sees only their local attempt');
select is((select count(*) from public.attendance_decisions where person_id = '10000000-0000-4000-a000-00000000000e' and business_date = public.app_business_date(now(), time '04:00')),
  1::bigint, 'the former manager sees only their local decision');
select throws_ok($q$
  select public.attendance_deny_attempt(
    '88000000-0000-4000-a000-000000000002',
    (select attendance_id from public.attendance_attempts where id = '87000000-0000-4000-a000-000000000001'),
    '87000000-0000-4000-a000-000000000002', 3, 'Wrong shop', false)
$q$, '42501', null, 'the former manager cannot decide the new outlet attempt');

-- Current manager prevents retry, then explicitly reopens it with an audited correction.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select lives_ok($q$
  select public.attendance_deny_attempt(
    '88000000-0000-4000-a000-000000000003',
    (select id from public.attendance where current_attempt_id = '87000000-0000-4000-a000-000000000002'),
    '87000000-0000-4000-a000-000000000002',
    (select state_version from public.attendance where current_attempt_id = '87000000-0000-4000-a000-000000000002'),
    'Could not verify arrival', true)
$q$, 'the current manager denies and prevents retry');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000e');
select throws_ok($q$
  select public.attendance_submit_attempt(
    '87000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), null, null, null,
    (select state_version from public.attendance where outcome_attempt_id = '87000000-0000-4000-a000-000000000002'))
$q$, 'P0001', 'another check-in is not allowed for this business date', 'global prevent blocks every outlet');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select lives_ok($q$
  select public.attendance_correct(
    '88000000-0000-4000-a000-000000000004',
    (select id from public.attendance where outcome_attempt_id = '87000000-0000-4000-a000-000000000002'),
    (select state_version from public.attendance where outcome_attempt_id = '87000000-0000-4000-a000-000000000002'),
    'allow_retry', 'Employee was scheduled at the other outlet', null, null, null)
$q$, 'the manager reopens retry with a reason');
select is((select kind from public.attendance_decisions where id = '88000000-0000-4000-a000-000000000004'),
  'allow_retry'::public.attendance_decision_kind, 'the reopen is append-only audit history');

-- Subject and owner see the complete cross-outlet sequence; unrelated employee sees none.
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000e');
select is((select count(*) from public.attendance_attempts where person_id = auth.uid() and business_date = public.app_business_date(now(), time '04:00')), 2::bigint,
  'the subject reads their full attempt sequence');
select is((select count(*) from public.attendance_decisions where person_id = auth.uid() and business_date = public.app_business_date(now(), time '04:00')), 3::bigint,
  'the subject reads their full decision sequence');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select is((select count(*) from public.attendance_attempts where person_id = '10000000-0000-4000-a000-00000000000e' and business_date = public.app_business_date(now(), time '04:00')),
  0::bigint, 'an unrelated employee reads no evidence');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select is((select count(*) from public.attendance_attempts where person_id = '10000000-0000-4000-a000-00000000000e' and business_date = public.app_business_date(now(), time '04:00')),
  2::bigint, 'the owner reaches both outlets attempts');
select is((select count(*) from public.attendance_decisions where person_id = '10000000-0000-4000-a000-00000000000e' and business_date = public.app_business_date(now(), time '04:00')),
  3::bigint, 'the owner reaches the complete decision history');

reset role;
select * from finish();
rollback;
