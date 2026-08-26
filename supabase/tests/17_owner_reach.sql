-- The owner's reach, and where it stops.
--
-- `owner-reaches-every-outlet` (#28) is a UI change: it stopped asking the
-- screens to require a Franchise Admin assignment the database never wanted.
-- Nothing here is new behaviour — every branch asserted below has existed since
-- `multi-outlet-people` (#22) — and that is exactly why it belongs in the suite.
-- The shell now *depends* on these branches, so a test has to fail if one is
-- ever edited away.
--
-- The seeded owner holds `super_admin` and no outlet assignment at all, which is
-- the shape the change made ordinary: they run every outlet and manage none.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- Independence from whatever ran before, on the same terms 06 takes it: the REST
-- suite writes real check-ins to this database on today's business date for the
-- same seeded people, so a manual entry below would otherwise collide on the
-- one-row-per-person-per-day constraint. Scoped so it cannot reach a
-- seeded row — everything in seed.sql is dated yesterday or the day before — and
-- the file rolls back regardless.
alter table public.attendance disable trigger attendance_no_delete;
delete from public.attendance
 where business_date = public.app_business_date(now(), time '04:00')
   and business_date not in (current_date - 1, current_date - 2);
alter table public.attendance enable trigger attendance_no_delete;

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

create function pg_temp.rows_touched(q text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set STAFF_KPA '10000000-0000-4000-a000-000000000007'
\set GRILLER_KPA '20000000-0000-4000-a000-000000000004'
\set KPA '00000000-0000-4000-a000-000000000002'

-- The premise, asserted rather than assumed: this owner is assigned nowhere.
select is(
  (select count(*) from public.assignments
    where person_id = :'OWNER' and outlet_id is not null and ended_on is null),
  0::bigint,
  'the seeded owner holds no outlet assignment');

-- ---------------------------------------------------------------------------
-- 1. Reading and settling another outlet's attendance.

select pg_temp.impersonate(:'OWNER');

select isnt_empty(
  format($q$ select 1 from public.attendance where outlet_id = %L $q$, :'KPA'),
  'the owner reads an outlet''s attendance while assigned nowhere');

-- The waiting arrival at Kanchrapara: a check-in nobody has vouched for.
--
-- Asserted in the order the rule bites. The owner is neither on site nor on the
-- row's own business day, so a bare approval is refused — the reason is the
-- database's rule rather than a formality the screen adds, and it is the same
-- rule the outlet's own manager answers to.
select throws_ok(
  format($q$
    select * from public.attendance_decide_set(
      '86000000-0000-4000-a000-0000000000c1', 'approve',
      jsonb_build_array(jsonb_build_object(
        'attendance_id', (select id from public.attendance where outlet_id = %L and person_id = %L and current_attempt_id is not null),
        'attempt_id', (select current_attempt_id from public.attendance where outlet_id = %L and person_id = %L and current_attempt_id is not null),
        'expected_version', (select state_version from public.attendance where outlet_id = %L and person_id = %L and current_attempt_id is not null),
        'decision_id', '86000000-0000-4000-a000-000000000001')),
      null, false, null, null, null) $q$,
    :'KPA', :'GRILLER_KPA', :'KPA', :'GRILLER_KPA', :'KPA', :'GRILLER_KPA'),
  null,
  'an approval from away from the outlet, or after the row''s own business day, requires a reason',
  'an off-site approval without a reason is refused, owner included');

-- With the reason it records, and the owner needed no assignment to give it.
select lives_ok(
  format($q$
    select * from public.attendance_decide_set(
      '86000000-0000-4000-a000-0000000000c2', 'approve',
      jsonb_build_array(jsonb_build_object(
        'attendance_id', (select id from public.attendance where outlet_id = %L and person_id = %L and current_attempt_id is not null),
        'attempt_id', (select current_attempt_id from public.attendance where outlet_id = %L and person_id = %L and current_attempt_id is not null),
        'expected_version', (select state_version from public.attendance where outlet_id = %L and person_id = %L and current_attempt_id is not null),
        'decision_id', '86000000-0000-4000-a000-000000000002')),
      'Owner settled it from elsewhere (synthetic)', false, null, null, null) $q$,
    :'KPA', :'GRILLER_KPA', :'KPA', :'GRILLER_KPA', :'KPA', :'GRILLER_KPA'),
  'the owner approves a waiting arrival at an outlet they are not assigned to');

-- The approval is theirs on the record, and the database worked out how far away
-- they were rather than taking the request's word for it.
select is(
  (select approved_by_name from public.attendance
    where outlet_id = :'KPA' and person_id = :'GRILLER_KPA'),
  'Synthetic Owner',
  'the row names the owner as the approver');

-- A manual entry at that outlet: past time, the outlet's current business day,
-- and the enterer stamped by the database rather than supplied.
--
-- "Two hours ago, or the moment this business day opened, whichever is later."
-- Both halves of the row are read from one clock that way. A flat
-- `now() - interval '2 hours'` is a time on the PREVIOUS business day for the
-- two hours after the 04:00 cutover, so validate_business_date reads the
-- timestamp as one day and the stated business date as the next and refuses
-- them, and the guard's own rule that a manual entry belongs to the outlet's
-- current business day would refuse the alternative. That is the database being
-- right on both counts: back-filling a closed day is deliberately out of scope
-- (20260729000003_manual_attendance_entry.sql), so the entry this test records
-- has to sit inside the day it names.
select lives_ok(
  format($q$
    select public.attendance_record_manual(
      '86000000-0000-4000-a000-000000000003',
      '86000000-0000-4000-a000-000000000004',
      %L, %L, public.app_business_date(now(), time '04:00'),
      greatest(
        now() - interval '2 hours',
        (public.app_business_date(now(), time '04:00') + time '04:00')
          at time zone 'Asia/Kolkata')) $q$,
    :'STAFF_KPA', :'KPA'),
  'the owner records a manual arrival at an outlet they are not assigned to');

select is(
  (select check_in_entered_by from public.attendance
    where outlet_id = :'KPA' and person_id = :'STAFF_KPA'
      and check_in_source = 'manual'),
  :'OWNER'::uuid,
  'the manual entry names the owner as the person who typed it in');

-- ---------------------------------------------------------------------------
-- 2. Where the reach stops: the drawer.
--
-- The boundary the UI reads through `managed` and states on the screen rather
-- than discovering by refusal. `cash-is-counted-not-closed` (#11) moves it: the
-- owner will reach every outlet's drawer, with geofence evidence on each record
-- instead of a refusal. Until #11 lands, this is what the database says, and
-- these assertions are expected to be rewritten by it rather than deleted.

select throws_ok(
  format($q$
    insert into public.cash_withdrawals
      (outlet_id, business_date, amount_paise, withdrawn_by, recorded_by)
    values (%L, current_date, 5000, 'Synthetic Owner', %L) $q$,
    :'KPA', :'OWNER'),
  '42501',
  null,
  'the owner cannot record a withdrawal at an outlet they are not assigned to');

select throws_ok(
  format($q$ select public.close_business_day(%L, current_date, 100000) $q$, :'KPA'),
  null,
  null,
  'the owner cannot close a day at an outlet they are not assigned to');

-- A cash expense from the same session is refused too, so nothing on the remote
-- path can move that outlet's drawer by another door.
select throws_ok(
  format($q$
    insert into public.expenses
      (outlet_id, business_date, category, amount_paise, payment_method, recorded_by)
    values (%L, current_date, 'other', 5000, 'cash', %L) $q$,
    :'KPA', :'OWNER'),
  '42501',
  null,
  'the owner cannot record a cash expense at an outlet they are not assigned to');

select * from finish();
rollback;
