-- A Biller marks their own attendance, holding no Employee assignment.
--
-- The claim is small and the reason it is written down is not. A Biller is a
-- person who works at the shop, so they turn up to it. Giving them a check-in by
-- granting a second assignment would mean **a row saying they also work where
-- they already work**, which can drift out of step with the first one and means
-- nothing when it does.
--
-- The database already reads it the honest way, and that is exactly why this
-- file exists: `attendance_submit_attempt` accepts `employee` **or** `biller` at
-- the outlet, and has since attendance-denial-and-retries. Nothing asserted it,
-- so nothing would have noticed it being narrowed. `reachableRoles` in
-- `src/session/session.ts` is what now lets a Biller SEE the surface; this is
-- what proves the surface would work when they reach it.
--
-- Attendance is RPC-only — `20260802000001_attendance_denial_and_retries.sql`
-- dropped the insert and update policies and revoked the grants — so every
-- assertion here goes through the command, which is the only path a client has.

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
    true);
  execute 'set local role authenticated';
end;
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set BILLER_KPA '10000000-0000-4000-a000-00000000000b'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- Standing at the Kalyani counter, within the seeded 150 m geofence.
\set KAL_LAT 22.9750
\set KAL_LNG 88.4345

create function pg_temp.today()
returns date language sql stable as $$
  select public.app_business_date(now(), time '04:00')
$$;

-- ---------------------------------------------------------------------------
-- 1. The Biller holds exactly one assignment, and it does not say `employee`.

select is(
  (select string_agg(role::text, ', ' order by role::text)
     from public.assignments
    where person_id = :'BILLER_KAL' and ended_on is null),
  'biller',
  'the Biller holds one live assignment and it is not an Employee one');

-- ---------------------------------------------------------------------------
-- 2. And checks in anyway.

select pg_temp.impersonate(:'BILLER_KAL'::uuid);

select is(
  (select person_id from public.attendance_submit_attempt(
     '11111111-0000-4000-a000-000000000001',
     :'KAL', pg_temp.today(), now(), :KAL_LAT, :KAL_LNG, 12)),
  :'BILLER_KAL'::uuid,
  'a Biller marks their own attendance at their own outlet from their own phone');

select is(
  (select outlet_id from public.attendance
    where person_id = :'BILLER_KAL' and business_date = pg_temp.today()),
  :'KAL'::uuid,
  'and the day belongs to the outlet they are assigned at');

-- The subject is `auth.uid()` and there is no argument for it, so there is
-- nothing to forge. This is the assertion that says so.
select throws_ok(
  format($q$
    select public.attendance_submit_attempt(
      '11111111-0000-4000-a000-000000000002',
      '%s', pg_temp.today(), now(), 22.9450, 88.4330, 12)
  $q$, :'KPA'),
  '42501', null,
  'but not at an outlet they hold no assignment at');

-- ---------------------------------------------------------------------------
-- 3. Nothing widened for the roles that were not asked about.
--
-- A manager and the owner are deliberately left out. Their attendance is not
-- kept here at all, and a surface offering them a check-in would be offering
-- them a shift nobody rosters them onto.

select pg_temp.impersonate(:'FA_KAL'::uuid);

select throws_ok(
  format($q$
    select public.attendance_submit_attempt(
      '11111111-0000-4000-a000-000000000003',
      '%s', pg_temp.today(), now(), 22.9750, 88.4345, 12)
  $q$, :'KAL'),
  '42501', null,
  'the outlet''s own manager cannot check themselves in, assigned there or not');

select pg_temp.impersonate(:'OWNER'::uuid);

select throws_ok(
  format($q$
    select public.attendance_submit_attempt(
      '11111111-0000-4000-a000-000000000004',
      '%s', pg_temp.today(), now(), 22.9750, 88.4345, 12)
  $q$, :'KAL'),
  '42501', null,
  'nor the owner, who reaches every outlet and works a shift at none of them');

select pg_temp.impersonate(:'BILLER_KPA'::uuid);

select throws_ok(
  format($q$
    select public.attendance_submit_attempt(
      '11111111-0000-4000-a000-000000000005',
      '%s', pg_temp.today(), now(), 22.9750, 88.4345, 12)
  $q$, :'KAL'),
  '42501', null,
  'and the other outlet''s Biller reaches none of it');

-- ---------------------------------------------------------------------------
-- 4. There is no second path.
--
-- Written from the catalog rather than by hand, so it stays true of whatever
-- these are rewritten into. A direct client write would bypass the geofence, the
-- retry ledger and the day-per-person rule all at once, so the absence of one is
-- worth asserting rather than assuming.

select is(
  (select string_agg(policyname, ', ' order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'attendance'),
  'attendance_select',
  'attendance carries a read policy and nothing else');

select is(
  (select count(*) from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'attendance'
      and grantee in ('authenticated', 'anon')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0::bigint,
  'and no client role may write it by any verb, so the command is the only door');

select * from finish();
rollback;
