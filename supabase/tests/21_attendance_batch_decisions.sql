-- One manager act over an explicitly selected set: authority, device, staleness,
-- the reason partition, denial, identity and the bound.
--
-- Every rule here is a rule about the WHOLE set, which is why none of them can
-- be proved by calling a single-row command more than once. The set is always
-- built by hand, because the database has to hold even for a request the surface
-- would never send.

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

-- Back to the service path: no role, and no session claiming to be anybody. The
-- claims have to be cleared as well as the role, or `attendance_guard` still
-- sees a signed-in caller and refuses the direct writes this file uses to build
-- a day that has already closed.
create function pg_temp.as_service()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- One selected item, resolved from the attempt it is about.
--
-- The version is stated rather than read, so a payload is reproducible after the
-- rows have moved — which is what a replay test needs. Every waiting row in this
-- file is at version 1: a first check-in inserts the day at 0 and stamps it to 1,
-- and a service-inserted day is materialised at 1.
--
-- `security definer` so a set can be hand-crafted naming a row the caller is not
-- entitled to read, which is exactly what the tenancy cases have to submit.
create function pg_temp.item(p_attempt uuid, p_decision uuid, p_version integer default 1)
returns jsonb language sql security definer as $$
  select jsonb_build_object(
    'attendance_id', at.attendance_id,
    'attempt_id', p_attempt,
    'expected_version', p_version,
    'decision_id', p_decision
  )
  from public.attendance_attempts at
  where at.id = p_attempt
$$;

create function pg_temp.set_of(variadic p_items jsonb[])
returns jsonb language sql as $$ select jsonb_agg(item) from unnest(p_items) as item $$;

-- ---------------------------------------------------------------------------
-- The morning: five arrivals inside the Kalyani fence, three inside
-- Kanchrapara's. A Biller is among them, because a-biller-is-staff settled that
-- a Biller is staff wherever attendance asks.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '8a000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.97505, 88.43460, 12, null)
$q$, 'Kalyani counter staff arrive inside the fence');

select pg_temp.impersonate('20000000-0000-4000-a000-000000000002');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '8a000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.97505, 88.43460, 14, null)
$q$, 'the Kalyani griller arrives inside the fence');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '8a000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.97505, 88.43460, 16, null)
$q$, 'the Kalyani Biller arrives inside the fence');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000007');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '8a000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000002',
    public.app_business_date(now(), time '04:00'), now(), 22.94500, 88.43300, 11, null)
$q$, 'Kanchrapara counter staff arrive inside their own fence');

select pg_temp.impersonate('20000000-0000-4000-a000-000000000004');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '8a000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000002',
    public.app_business_date(now(), time '04:00'), now(), 22.94500, 88.43300, 13, null)
$q$, 'the Kanchrapara griller arrives inside their own fence');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000e');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '8a000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.97505, 88.43460, 18, null)
$q$, 'the two-outlet employee works Kalyani today');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000c');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '8a000000-0000-4000-a000-000000000007', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.97505, 88.43460, 15, null)
$q$, 'a fifth Kalyani arrival waits with the rest');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000b');
select lives_ok($q$
  select public.attendance_submit_attempt(
    '8a000000-0000-4000-a000-000000000008', '00000000-0000-4000-a000-000000000002',
    public.app_business_date(now(), time '04:00'), now(), 22.94500, 88.43300, 17, null)
$q$, 'the Kanchrapara Biller arrives inside their own fence');

-- ---------------------------------------------------------------------------
-- 1.1 The whole-set contract, while every row is still waiting.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000001', 'settle',
    pg_temp.set_of(pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000001')),
    null, false, 22.97505, 88.43460, 12)
$q$, 'P0001', 'unknown attendance decision action', 'only approve and deny are actions');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000002', 'approve', '[]'::jsonb,
    null, false, 22.97505, 88.43460, 12)
$q$, 'P0001', 'a decision set must name at least one row', 'an empty set decides nothing');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000003', 'approve',
    (select jsonb_agg(jsonb_build_object(
       'attendance_id', gen_random_uuid(), 'attempt_id', gen_random_uuid(),
       'expected_version', 1, 'decision_id', gen_random_uuid()))
     from generate_series(1, 101)),
    null, false, 22.97505, 88.43460, 12)
$q$, 'P0001', 'a decision set carries at most 100 rows', 'an oversized set is refused before anything is locked');
select is((select count(*) from public.attendance_decisions where command_id = '8c000000-0000-4000-a000-000000000003'),
  0::bigint, 'the oversized set settled nothing');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000004', 'approve',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000004'),
      pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000005')),
    null, false, 22.97505, 88.43460, 12)
$q$, 'P0001', 'a decision set names one row twice', 'a set cannot decide the same person twice');

-- A hand-crafted set mixing the caller's own outlet with one they hold no live
-- assignment at. The whole command is refused, and naming the outlet grants
-- nothing.
select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000005', 'approve',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000006'),
      pg_temp.item('8a000000-0000-4000-a000-000000000004', '8b000000-0000-4000-a000-000000000007')),
    'Covering both shops', false, 22.97505, 88.43460, 12)
$q$, '42501', null, 'a set naming an unauthorised outlet is refused entirely');
select isnt((select current_attempt_id from public.attendance
              where current_attempt_id = '8a000000-0000-4000-a000-000000000001'),
  null::uuid, 'the caller''s own row is still waiting after that refusal');

-- One stale item refuses the whole set: the version is wrong on the third row
-- only, and the first two must survive untouched.
select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000006', 'approve',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000008'),
      pg_temp.item('8a000000-0000-4000-a000-000000000002', '8b000000-0000-4000-a000-000000000009'),
      pg_temp.item('8a000000-0000-4000-a000-000000000003', '8b000000-0000-4000-a000-00000000000a', 999)),
    null, false, 22.97505, 88.43460, 12)
$q$, 'P0001', 'attendance state is stale', 'one stale row refuses the whole set');
select is((select count(*) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-000000000006'),
  0::bigint, 'a refused set appends no decision for anybody');
select is((select count(*) from public.attendance
            where current_attempt_id in ('8a000000-0000-4000-a000-000000000001',
                                         '8a000000-0000-4000-a000-000000000002',
                                         '8a000000-0000-4000-a000-000000000003')),
  3::bigint, 'all three named Kalyani rows are still waiting');

-- An attempt that is not the row's current one is stale rather than ignored.
select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000007', 'approve',
    pg_temp.set_of(jsonb_build_object(
      'attendance_id', (select attendance_id from public.attendance_attempts
                         where id = '8a000000-0000-4000-a000-000000000001'),
      'attempt_id', '8a000000-0000-4000-a000-0000000000ff',
      'expected_version', 1,
      'decision_id', '8b000000-0000-4000-a000-00000000000b')),
    null, false, 22.97505, 88.43460, 12)
$q$, 'P0001', 'attendance state is stale', 'an invented or superseded attempt is stale');

-- The enrolled-device condition the read policies already require. The caller is
-- an active Franchise Admin holding the assignment; the only thing wrong is that
-- their session id belongs to a counter tablet that has been removed. The
-- single-row commands this change drops never asked.
select pg_temp.as_service();
insert into public.counter_devices (id, outlet_id, label, set_up_by, set_up_at, removed_at,
                                   session_proven_at)
values ('10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001',
        'Synthetic removed tablet sharing a manager session',
        '10000000-0000-4000-a000-000000000001', now() - interval '10 days', now() - interval '1 day',
        -- Proven, because this fixture is a tablet that traded and was then
        -- removed. An unproven row would be refused for a different reason than
        -- the one this test is about.
        now() - interval '10 days');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000008', 'approve',
    pg_temp.set_of(pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-00000000000c')),
    null, false, 22.97505, 88.43460, 12)
$q$, '42501', null, 'a removed counter device cannot decide attendance');

select pg_temp.as_service();
delete from public.counter_devices where id = '10000000-0000-4000-a000-000000000002';

-- An Employee holds no authority over anybody, including themselves.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000009', 'approve',
    pg_temp.set_of(pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-00000000000d')),
    null, false, 22.97505, 88.43460, 12)
$q$, '42501', null, 'an employee cannot approve their own selected day');

-- 1.6 Tenancy, taken while both outlets still hold waiting rows.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-00000000000a', 'approve',
    pg_temp.set_of(pg_temp.item('8a000000-0000-4000-a000-000000000003', '8b000000-0000-4000-a000-00000000000e')),
    'Reaching across', false, 22.97505, 88.43460, 12)
$q$, '42501', null, 'a single-outlet Franchise Admin cannot decide the other outlet''s row');

-- ---------------------------------------------------------------------------
-- 1.2 The approval partition: one reading, judged independently per row.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-00000000000c', 'approve',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000010'),
      pg_temp.item('8a000000-0000-4000-a000-000000000002', '8b000000-0000-4000-a000-000000000011')),
    null, false, 22.98400, 88.43450, 20)
$q$, 'P0001', null, 'an approval from beyond every selected fence needs a reason');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-00000000000d', 'approve',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000012'),
      pg_temp.item('8a000000-0000-4000-a000-000000000002', '8b000000-0000-4000-a000-000000000013')),
    null, false, null, null, null)
$q$, 'P0001', null, 'a set approved with no position at all needs a reason');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-00000000000e', 'approve',
    pg_temp.set_of(pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000014')),
    null, false, 22.97505, null, 12)
$q$, 'P0001', 'approver coordinates must be paired', 'half a reading is not a reading');

-- On site, on the day: two rows settled in one act, neither carrying a reason.
select lives_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-00000000000f', 'approve',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000015'),
      pg_temp.item('8a000000-0000-4000-a000-000000000002', '8b000000-0000-4000-a000-000000000016')),
    null, false, 22.97505, 88.43460, 12)
$q$, 'an on-site same-day set is approved with no reason');

select is((select count(*) from public.attendance
            where outcome_attempt_id in ('8a000000-0000-4000-a000-000000000001',
                                         '8a000000-0000-4000-a000-000000000002')
              and status = 'present'),
  2::bigint, 'both selected days are present');
select is((select count(*) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-00000000000f' and reason is null),
  2::bigint, 'a row approved on the plain terms keeps no reason');
select ok((select bool_and(manager_distance_m < 50) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-00000000000f'),
  'every row records its own server-computed distance to its own outlet');
select is((select count(*) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-00000000000f'
              and manager_lat = 22.97505 and manager_lng = 88.43460 and manager_accuracy_m = 12),
  2::bigint, 'one reading is written to every approval in the act');
select is((select count(*) from public.attendance_attempts
            where id in ('8a000000-0000-4000-a000-000000000001', '8a000000-0000-4000-a000-000000000002')
              and settled_at is not null),
  2::bigint, 'each settled attempt is stamped');
select is((select count(*) from public.attendance
            where outcome_attempt_id in ('8a000000-0000-4000-a000-000000000001',
                                         '8a000000-0000-4000-a000-000000000002')
              and state_version = 2),
  2::bigint, 'each settled row moved on by exactly one version');

-- The mixed partition, across two outlets, judged from inside one of them. The
-- caller is the owner because only a Super Admin reaches both, and they hold no
-- outlet assignment at all.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select is((select count(*) from public.assignments
            where person_id = '10000000-0000-4000-a000-000000000001' and outlet_id is not null),
  0::bigint, 'the owner holds no outlet assignment and still decides both shops');

select lives_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000010', 'approve',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000003', '8b000000-0000-4000-a000-000000000017'),
      pg_temp.item('8a000000-0000-4000-a000-000000000004', '8b000000-0000-4000-a000-000000000018'),
      pg_temp.item('8a000000-0000-4000-a000-000000000005', '8b000000-0000-4000-a000-000000000019')),
    'At Kalyani this morning; the Kanchrapara pair were on the shift photo',
    false, 22.97505, 88.43460, 12)
$q$, 'one reading inside Kalyani settles rows at both outlets');

select is((select reason from public.attendance_decisions where id = '8b000000-0000-4000-a000-000000000017'),
  null::text, 'the row inside the reading''s own fence stores no reason');
select isnt((select reason from public.attendance_decisions where id = '8b000000-0000-4000-a000-000000000018'),
  null::text, 'a row at the outlet the manager was not at stores the shared reason');
select isnt((select reason from public.attendance_decisions where id = '8b000000-0000-4000-a000-000000000019'),
  null::text, 'every remote row stores the shared reason');
select ok((select manager_distance_m > 3000 from public.attendance_decisions where id = '8b000000-0000-4000-a000-000000000018'),
  'a remote row measures the same reading against its own outlet');
select ok((select manager_distance_m < 50 from public.attendance_decisions where id = '8b000000-0000-4000-a000-000000000017'),
  'the near row measures the same reading against its own outlet');
select is((select approval_reason from public.attendance
            where outcome_attempt_id = '8a000000-0000-4000-a000-000000000003'),
  null::text, 'the canonical row agrees with its decision about the reason');

-- ---------------------------------------------------------------------------
-- A business day that has already closed at its own outlet.
--
-- Built through the service path because a check-in command refuses a business
-- date its outlet no longer regards as current, which is the very state a
-- stranded day is in.

select pg_temp.as_service();
insert into public.attendance
  (id, outlet_id, person_id, business_date, status, state_version, retry_blocked,
   check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
values
  ('8d000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-000000000006',
   public.app_business_date(now(), time '04:00') - 30, 'absent', 0, false,
   now() - interval '30 days', 22.97505, 88.43460, 12, 'phone'),
  ('8d000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001',
   '20000000-0000-4000-a000-000000000002',
   public.app_business_date(now(), time '04:00') - 30, 'absent', 0, false,
   now() - interval '30 days', 22.97505, 88.43460, 12, 'phone'),
  ('8d000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-00000000000a',
   public.app_business_date(now(), time '04:00') - 31, 'absent', 0, false,
   now() - interval '31 days', 22.97505, 88.43460, 12, 'phone');

select is((select count(*) from public.attendance_attempts
            where id in ('8d000000-0000-4000-a000-000000000001',
                         '8d000000-0000-4000-a000-000000000002',
                         '8d000000-0000-4000-a000-000000000003')),
  3::bigint, 'the stranded days materialised their own attempts');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000011', 'approve',
    pg_temp.set_of(
      pg_temp.item('8d000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-00000000001a'),
      pg_temp.item('8d000000-0000-4000-a000-000000000002', '8b000000-0000-4000-a000-00000000001b')),
    null, false, 22.97505, 88.43460, 12)
$q$, 'P0001', null, 'a closed day needs a reason even from inside the fence');

select lives_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000012', 'approve',
    pg_temp.set_of(
      pg_temp.item('8d000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-00000000001c'),
      pg_temp.item('8d000000-0000-4000-a000-000000000002', '8b000000-0000-4000-a000-00000000001d')),
    'Settling a morning that was missed', false, 22.97505, 88.43460, 12)
$q$, 'a set of closed days is settled with one shared reason');
select is((select count(*) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-000000000012' and reason is not null),
  2::bigint, 'both closed-day rows carry the reason the rule required');

-- 1.5 A set that genuinely spans two business dates. Nothing refuses it for
-- spanning; each row is judged against its own date.
select lives_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000013', 'approve',
    pg_temp.set_of(
      pg_temp.item('8d000000-0000-4000-a000-000000000003', '8b000000-0000-4000-a000-00000000001e'),
      pg_temp.item('8a000000-0000-4000-a000-000000000007', '8b000000-0000-4000-a000-00000000001f')),
    'One stranded day and one from this morning', false, 22.97505, 88.43460, 12)
$q$, 'a set spanning two business dates is not refused for spanning');
select is((select count(distinct business_date) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-000000000013'),
  2::bigint, 'each row kept its own business date');
select is((select reason from public.attendance_decisions where id = '8b000000-0000-4000-a000-00000000001f'),
  null::text, 'the row whose date is still current took the plain terms');
select isnt((select reason from public.attendance_decisions where id = '8b000000-0000-4000-a000-00000000001e'),
  null::text, 'the row whose date had closed took the shared reason');

-- An outlet whose position was never captured cannot vouch for anybody.
select pg_temp.as_service();
update public.outlets set latitude = null, longitude = null, location_accuracy_m = null,
       location_captured_at = null
 where id = '00000000-0000-4000-a000-000000000002';
insert into public.attendance
  (id, outlet_id, person_id, business_date, status, state_version, retry_blocked,
   check_in_at, check_in_source)
values
  ('8d000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000002',
   '10000000-0000-4000-a000-00000000000d',
   public.app_business_date(now(), time '04:00'), 'absent', 0, false, now(), 'phone');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000014', 'approve',
    pg_temp.set_of(pg_temp.item('8d000000-0000-4000-a000-000000000004', '8b000000-0000-4000-a000-000000000020')),
    null, false, 22.94500, 88.43300, 11)
$q$, 'P0001', null, 'an unsurveyed outlet cannot make an approval plain');
select lives_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000015', 'approve',
    pg_temp.set_of(pg_temp.item('8d000000-0000-4000-a000-000000000004', '8b000000-0000-4000-a000-000000000021')),
    'This shop has never been surveyed', false, 22.94500, 88.43300, 11)
$q$, 'a reason settles a row at an unsurveyed outlet');
select is((select manager_distance_m from public.attendance_decisions where id = '8b000000-0000-4000-a000-000000000021'),
  null::numeric, 'an unsurveyed outlet invents no distance');

select pg_temp.as_service();
update public.outlets set latitude = 22.9450, longitude = 88.4330
 where id = '00000000-0000-4000-a000-000000000002';

-- ---------------------------------------------------------------------------
-- 1.3 Denial: one reason, one retry choice, and no position at all.

select pg_temp.as_service();
insert into public.attendance
  (id, outlet_id, person_id, business_date, status, state_version, retry_blocked,
   check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
values
  ('8d000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-000000000006',
   public.app_business_date(now(), time '04:00') - 32, 'absent', 0, false,
   now() - interval '32 days', 22.98400, 88.43450, 30, 'phone');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000016', 'deny',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000006', '8b000000-0000-4000-a000-000000000022'),
      pg_temp.item('8d000000-0000-4000-a000-000000000005', '8b000000-0000-4000-a000-000000000023')),
    '   ', false, null, null, null)
$q$, 'P0001', 'a denial requires a reason', 'a blank shared reason refuses the whole denied set');
select is((select count(*) from public.attendance
            where current_attempt_id in ('8a000000-0000-4000-a000-000000000006',
                                         '8d000000-0000-4000-a000-000000000005')),
  2::bigint, 'every selected attempt is still waiting after the blank denial');

select lives_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000017', 'deny',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000006', '8b000000-0000-4000-a000-000000000024'),
      pg_temp.item('8d000000-0000-4000-a000-000000000005', '8b000000-0000-4000-a000-000000000025')),
    'Check-in was outside the outlet geofence', true, null, null, null)
$q$, 'a set spanning two dates is denied with one reason and one retry choice');

select is((select count(*) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-000000000017'
              and reason = 'Check-in was outside the outlet geofence'),
  2::bigint, 'one reason reaches every denied person');
select is((select count(*) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-000000000017' and prevents_retry),
  2::bigint, 'the retry choice reaches every denied person');
select is((select count(*) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-000000000017'
              and (manager_lat is not null or manager_lng is not null
                   or manager_accuracy_m is not null or manager_distance_m is not null)),
  0::bigint, 'a denied set stores no manager position of any kind');
select is((select count(*) from public.attendance
            where outcome_attempt_id in ('8a000000-0000-4000-a000-000000000006',
                                         '8d000000-0000-4000-a000-000000000005')
              and status = 'absent' and retry_blocked),
  2::bigint, 'every denied day is absent and locked against another attempt');

-- Retry prevention lands on each row's OWN business date, which is the whole
-- reason the control must not say `today`.
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000e');
select throws_ok($q$
  select public.attendance_submit_attempt(
    '8a000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00'), now(), 22.97505, 88.43460, 12,
    (select state_version from public.attendance
      where outcome_attempt_id = '8a000000-0000-4000-a000-000000000006'))
$q$, 'P0001', 'another check-in is not allowed for this business date',
  'the shared retry choice blocks the denied person''s own date');

-- Coordinates offered with a denial are ignored rather than quietly stored.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select lives_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000018', 'deny',
    pg_temp.set_of(pg_temp.item('8a000000-0000-4000-a000-000000000008', '8b000000-0000-4000-a000-000000000026')),
    'No arrival was witnessed', false, 22.94500, 88.43300, 11)
$q$, 'a denial carrying coordinates is accepted');
select is((select count(*) from public.attendance_decisions
            where id = '8b000000-0000-4000-a000-000000000026'
              and manager_lat is null and manager_lng is null
              and manager_accuracy_m is null and manager_distance_m is null),
  1::bigint, 'a denial discards coordinates it was handed');
select is((select retry_blocked from public.attendance
            where outcome_attempt_id = '8a000000-0000-4000-a000-000000000008'),
  false, 'retry stays open when the shared choice is left unchecked');

-- ---------------------------------------------------------------------------
-- 1.4 Identity: one command, one decision per person, replay, and reuse.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');

select is((select count(distinct command_id) from public.attendance_decisions
            where id in ('8b000000-0000-4000-a000-000000000015', '8b000000-0000-4000-a000-000000000016')),
  1::bigint, 'decisions from one action share one command identity');
select is((select count(*) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-00000000000f'),
  2::bigint, 'one action appends exactly one decision per selected person');
select is((select count(distinct attendance_id) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-00000000000f'),
  2::bigint, 'each decision belongs to its own person''s day');

-- A decision from a command that is not a set carries no batch identity, so the
-- column says what it means rather than being stamped on everything.
select lives_ok($q$
  select public.attendance_correct(
    '8b000000-0000-4000-a000-000000000030',
    (select attendance_id from public.attendance_attempts where id = '8a000000-0000-4000-a000-000000000001'),
    (select state_version from public.attendance
      where outcome_attempt_id = '8a000000-0000-4000-a000-000000000001'),
    'absent', 'Corrected after the fact', null, null, null)
$q$, 'a correction is still a single-row command');
select is((select command_id from public.attendance_decisions where id = '8b000000-0000-4000-a000-000000000030'),
  null::uuid, 'a decision made outside a set carries no command identity');

-- An exact replay settles once and answers with the same rows.
select is((select count(*) from public.attendance_decide_set(
    '8c000000-0000-4000-a000-00000000000f', 'approve',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000015'),
      pg_temp.item('8a000000-0000-4000-a000-000000000002', '8b000000-0000-4000-a000-000000000016')),
    null, false, 22.97505, 88.43460, 12)),
  2::bigint, 'an exact replay returns the settled rows');
select is((select count(*) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-00000000000f'),
  2::bigint, 'an exact replay appends no second decision');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-00000000000f', 'approve',
    pg_temp.set_of(pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000015')),
    null, false, 22.97505, 88.43460, 12)
$q$, 'P0001', 'command id was reused with a changed payload',
  'dropping a person from a replayed set is refused');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-00000000000f', 'approve',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000015'),
      pg_temp.item('8a000000-0000-4000-a000-000000000002', '8b000000-0000-4000-a000-000000000016')),
    'A reason that was not there before', false, 22.97505, 88.43460, 12)
$q$, 'P0001', 'command id was reused with a changed payload',
  'changing the reason on a replayed command is refused');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-00000000000f', 'approve',
    pg_temp.set_of(
      pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000015'),
      pg_temp.item('8a000000-0000-4000-a000-000000000002', '8b000000-0000-4000-a000-000000000016')),
    null, false, 22.98400, 88.43450, 12)
$q$, 'P0001', 'command id was reused with a changed payload',
  'changing the position on a replayed command is refused');

select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-000000000019', 'approve',
    pg_temp.set_of(pg_temp.item('8a000000-0000-4000-a000-000000000001', '8b000000-0000-4000-a000-000000000015')),
    null, false, 22.97505, 88.43460, 12)
$q$, 'P0001', 'decision id was reused with a changed payload',
  'a spent decision id cannot be carried into a new command');

-- ---------------------------------------------------------------------------
-- An assignment that ends while a set is open takes the authority with it.
--
-- Last, because an ended assignment cannot be reopened: the guard on
-- `assignments` refuses it, which is itself the reason this case matters.

select pg_temp.as_service();
insert into public.attendance
  (id, outlet_id, person_id, business_date, status, state_version, retry_blocked,
   check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
values
  ('8d000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000002',
   '10000000-0000-4000-a000-00000000000b',
   public.app_business_date(now(), time '04:00') - 30, 'absent', 0, false,
   now() - interval '30 days', 22.94500, 88.43300, 14, 'phone');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select lives_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-00000000001a', 'approve',
    pg_temp.set_of(pg_temp.item('8d000000-0000-4000-a000-000000000006', '8b000000-0000-4000-a000-000000000031')),
    'Settling it while the assignment still stands', false, 22.94500, 88.43300, 11)
$q$, 'the Kanchrapara manager can settle their own outlet''s stranded day');

select pg_temp.as_service();
insert into public.attendance
  (id, outlet_id, person_id, business_date, status, state_version, retry_blocked,
   check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
values
  ('8d000000-0000-4000-a000-000000000007', '00000000-0000-4000-a000-000000000002',
   '10000000-0000-4000-a000-00000000000b',
   public.app_business_date(now(), time '04:00') - 31, 'absent', 0, false,
   now() - interval '31 days', 22.94500, 88.43300, 14, 'phone');
update public.assignments set ended_on = current_date - 1
 where person_id = '10000000-0000-4000-a000-000000000003'
   and outlet_id = '00000000-0000-4000-a000-000000000002';

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select throws_ok($q$
  select * from public.attendance_decide_set(
    '8c000000-0000-4000-a000-00000000001b', 'approve',
    pg_temp.set_of(pg_temp.item('8d000000-0000-4000-a000-000000000007', '8b000000-0000-4000-a000-000000000032')),
    'Reaching a shop I no longer run', false, 22.94500, 88.43300, 11)
$q$, '42501', null, 'an assignment that ended during the review takes the authority with it');
select is((select count(*) from public.attendance_decisions
            where command_id = '8c000000-0000-4000-a000-00000000001b'),
  0::bigint, 'and the row it named was not settled');

-- ---------------------------------------------------------------------------
-- The append-only guard, and one write path rather than three.

select pg_temp.as_service();
select throws_ok($q$
  update public.attendance_decisions set command_id = null
   where id = '8b000000-0000-4000-a000-000000000015'
$q$, 'P0001', 'attendance decisions are append-only', 'a batch identity cannot be rewritten afterwards');

select is((select count(*) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('attendance_approve_attempt', 'attendance_deny_attempt')),
  0::bigint, 'the per-row approve and deny commands no longer exist');
select is((select count(*) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'attendance_decide_set'),
  1::bigint, 'there is exactly one set decision command');
select ok(not has_function_privilege('anon',
  'public.attendance_decide_set(uuid, text, jsonb, text, boolean, double precision, double precision, numeric)', 'execute'),
  'anon cannot execute the set decision command');
select ok(has_function_privilege('authenticated',
  'public.attendance_decide_set(uuid, text, jsonb, text, boolean, double precision, double precision, numeric)', 'execute'),
  'an authenticated session can execute the set decision command');

reset role;
select * from finish();
rollback;
