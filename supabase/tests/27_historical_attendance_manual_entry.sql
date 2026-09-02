-- Historical manager testimony: broaden the date without broadening authority,
-- staff scope, or the immutable one-person/day command ledger.

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

-- Kalyani's manager records yesterday for a current employee who was already
-- assigned yesterday. The local 09:00 instant belongs unambiguously to that
-- outlet's 04:00-cutover business day.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select lives_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000001',
    '89000000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00') - 1,
    ((public.app_business_date(now(), time '04:00') - 1 + time '09:00') at time zone 'Asia/Kolkata'))
$q$, 'a franchise manager records a historical arrival at their outlet');

select is(
  (select status from public.attendance where outcome_attempt_id = '89000000-0000-4000-a000-000000000001'),
  'present'::public.attendance_status,
  'the historical day is settled present');
select is(
  (select check_in_source from public.attendance where outcome_attempt_id = '89000000-0000-4000-a000-000000000001'),
  'manual'::public.check_in_source,
  'the canonical arrival remains explicit manager testimony');
select is(
  (select check_in_entered_by from public.attendance where outcome_attempt_id = '89000000-0000-4000-a000-000000000001'),
  '10000000-0000-4000-a000-000000000002'::uuid,
  'the database stamps the authenticated manager as enterer');
select ok(
  (select latitude is null and longitude is null and accuracy_m is null and distance_m is null
     from public.attendance_attempts where id = '89000000-0000-4000-a000-000000000001'),
  'historical manager testimony fabricates no location evidence');
select is(
  (select kind from public.attendance_decisions where id = '89000000-0000-4000-a000-000000000002'),
  'manual_present'::public.attendance_decision_kind,
  'recording the arrival is also the immutable settlement decision');
select ok(
  (select d.decided_at > at.attempted_at
     from public.attendance_decisions d
     join public.attendance_attempts at on at.id = d.attempt_id
    where d.id = '89000000-0000-4000-a000-000000000002'),
  'the decision time is the database settlement time, not the attested arrival');

-- Exact replay returns the same day and creates no duplicate ledger facts.
select lives_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000001',
    '89000000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00') - 1,
    ((public.app_business_date(now(), time '04:00') - 1 + time '09:00') at time zone 'Asia/Kolkata'))
$q$, 'an exact historical command replay is idempotent');
select is(
  (select count(*) from public.attendance_attempts where id = '89000000-0000-4000-a000-000000000001'),
  1::bigint,
  'an exact replay leaves one attempt');
select is(
  (select count(*) from public.attendance_decisions where id = '89000000-0000-4000-a000-000000000002'),
  1::bigint,
  'an exact replay leaves one decision');

select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000001',
    '89000000-0000-4000-a000-000000000003',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00') - 1,
    ((public.app_business_date(now(), time '04:00') - 1 + time '09:01') at time zone 'Asia/Kolkata'))
$q$, 'P0001', 'attendance command id was reused with a changed payload',
  'reusing an attempt id with changed historical testimony is refused');

select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000004',
    '89000000-0000-4000-a000-000000000005',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00') + 1,
    ((public.app_business_date(now(), time '04:00') + 1 + time '09:00') at time zone 'Asia/Kolkata'))
$q$, 'P0001', 'a manual entry cannot be recorded for a future business day',
  'a future business date remains impossible');

select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000006',
    '89000000-0000-4000-a000-000000000007',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'),
    now() + interval '1 minute')
$q$, 'P0001', 'a manual entry cannot be recorded for the future',
  'a future arrival instant remains impossible');

select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000008',
    '89000000-0000-4000-a000-000000000009',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00') - 2,
    ((public.app_business_date(now(), time '04:00') - 1 + time '09:00') at time zone 'Asia/Kolkata'))
$q$, 'P0001', 'manual entry time does not belong to the named business date',
  'an instant from another business day cannot be relabelled');

select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000010',
    '89000000-0000-4000-a000-000000000011',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    current_date - 11,
    (((current_date - 11) + time '09:00') at time zone 'Asia/Kolkata'))
$q$, 'P0001', 'person was not staff at this outlet on the named business date',
  'a day before the employee joined cannot be backfilled');

-- A former assignment followed by a new live assignment does not fill the gap
-- between them. Current visibility alone cannot rewrite a date after the old
-- assignment ended and before the new one began.
reset role;
insert into public.assignments (person_id, role, outlet_id, started_on, ended_on)
values (
  '10000000-0000-4000-a000-00000000000c', 'employee',
  '00000000-0000-4000-a000-000000000001', current_date - 30, current_date - 20);
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000020',
    '89000000-0000-4000-a000-000000000021',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    current_date - 15,
    (((current_date - 15) + time '09:00') at time zone 'Asia/Kolkata'))
$q$, 'P0001', 'person was not staff at this outlet on the named business date',
  'a date after an ended assignment and before the live one cannot be backfilled');

-- Outlet authority and subject membership remain independent boundaries.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000012',
    '89000000-0000-4000-a000-000000000013',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000002',
    public.app_business_date(now(), time '04:00') - 3,
    ((public.app_business_date(now(), time '04:00') - 3 + time '09:00') at time zone 'Asia/Kolkata'))
$q$, 'P0001', 'person is not current staff at this outlet',
  'a manager cannot place another outlet employee on their roll-call');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000014',
    '89000000-0000-4000-a000-000000000015',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00') - 3,
    ((public.app_business_date(now(), time '04:00') - 3 + time '09:00') at time zone 'Asia/Kolkata'))
$q$, '42501', 'only a manager for this outlet may record a manual entry',
  'an employee cannot forge manager testimony');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000022',
    '89000000-0000-4000-a000-000000000023',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00') - 3,
    ((public.app_business_date(now(), time '04:00') - 3 + time '09:00') at time zone 'Asia/Kolkata'))
$q$, '42501', 'only a manager for this outlet may record a manual entry',
  'a Biller cannot record manager testimony');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000024',
    '89000000-0000-4000-a000-000000000025',
    '10000000-0000-4000-a000-00000000000c',
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00') - 3,
    ((public.app_business_date(now(), time '04:00') - 3 + time '09:00') at time zone 'Asia/Kolkata'))
$q$, '42501', 'only a manager for this outlet may record a manual entry',
  'a counter device cannot record manager testimony');

-- The owner uses the same command across outlets; no owner assignment is
-- manufactured to make that authority work.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select lives_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000016',
    '89000000-0000-4000-a000-000000000017',
    '10000000-0000-4000-a000-00000000000d',
    '00000000-0000-4000-a000-000000000002',
    public.app_business_date(now(), time '04:00') - 3,
    ((public.app_business_date(now(), time '04:00') - 3 + time '09:00') at time zone 'Asia/Kolkata'))
$q$, 'the owner records a historical arrival without an outlet assignment');
select is(
  (select check_in_entered_by from public.attendance where outcome_attempt_id = '89000000-0000-4000-a000-000000000016'),
  '10000000-0000-4000-a000-000000000001'::uuid,
  'the owner is stamped from authentication, not convenience input');

-- The two-outlet employee already has a seeded Kalyani row yesterday. Naming
-- Kanchrapara cannot create another person-day behind the other outlet's RLS.
select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000026',
    '89000000-0000-4000-a000-000000000027',
    '10000000-0000-4000-a000-00000000000e',
    '00000000-0000-4000-a000-000000000002',
    current_date - 1,
    (((current_date - 1) + time '10:00') at time zone 'Asia/Kolkata'))
$q$, 'P0001', 'a check-in is already recorded for this day',
  'an existing person-day at another outlet cannot be duplicated');
select is(
  (select count(*) from public.attendance
    where person_id = '10000000-0000-4000-a000-00000000000e'
      and business_date = current_date - 1),
  1::bigint,
  'the cross-outlet refusal leaves exactly one person-day');

-- An ended assignment remains history but no longer grants current list
-- eligibility. End a different employee inside this rolled-back test only.
reset role;
update public.assignments
   set ended_on = current_date - 1
 where person_id = '10000000-0000-4000-a000-000000000006'
   and outlet_id = '00000000-0000-4000-a000-000000000001'
   and role = 'employee';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$
  select public.attendance_record_manual(
    '89000000-0000-4000-a000-000000000018',
    '89000000-0000-4000-a000-000000000019',
    '10000000-0000-4000-a000-000000000006',
    '00000000-0000-4000-a000-000000000001',
    current_date - 3,
    (((current_date - 3) + time '09:00') at time zone 'Asia/Kolkata'))
$q$, 'P0001', 'person is not current staff at this outlet',
  'departed-only profiles are not reopened by historical entry');

reset role;
select * from finish();
rollback;
