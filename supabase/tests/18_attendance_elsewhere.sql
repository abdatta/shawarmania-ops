-- The one bit that crosses the outlet boundary, and everything it must not say.
--
-- `attendance-one-day-per-person` says a person carrying a row anywhere is not
-- absent anywhere. A Franchise Admin at Kalyani cannot see rows written at
-- Kanchrapara, so their client cannot compute that rule; left alone, their
-- roll-call would keep deriving absent for somebody who was at work
-- (design D3). `attendance_elsewhere` answers exactly one question — "is this
-- person, whom you already manage, accounted for somewhere today?" — and this
-- file is the proof that it answers nothing else.
--
-- It also asserts the by-staff read's scope (design D4). That read dropped its
-- explicit outlet argument, so what it returns is now entirely the policy's
-- answer. A test is the only thing standing between that and a widening nobody
-- noticed.

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

-- Back to the table owner with NO session behind it. Clearing the claims is the
-- part that matters: `assignments_self_grant_guard` reads `auth.uid()`, and a
-- leftover impersonation would make the setup below look like a manager quietly
-- granting themselves an outlet.
create function pg_temp.as_owner()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
end;
$$;

/** Does the function name this person, for this caller, on this date? */
create function pg_temp.names(p_outlets uuid[], p_date date, p_person uuid)
returns boolean language sql as $$
  select exists (
    select 1 from public.attendance_elsewhere(p_outlets, p_date) as e
     where e = p_person
  )
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set STAFF_KAL '10000000-0000-4000-a000-000000000006'
\set BOTH '10000000-0000-4000-a000-00000000000e'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'
\set THIRD '00000000-0000-4000-a000-000000000009'

-- ---------------------------------------------------------------------------
-- Setup, as the table owner. A third outlet the two-outlet person also works
-- at, so "every outlet the reader may see" can be shown to stop somewhere.

insert into public.outlets
  (id, code, name, location_label, address_line1, phone,
   latitude, longitude, geofence_radius_m, business_day_cutover, arrival_deadline)
values (:'THIRD', 'barrackpore', 'Shawarmania Barrackpore', 'Barrackpore',
        '1 Synthetic Road', '911111111099',
        22.7600, 88.3700, 150, time '04:00', time '13:00');

insert into public.assignments (person_id, role, outlet_id, started_on)
values (:'BOTH', 'employee', :'THIRD', current_date - 90);

-- A day worked at that third outlet, waiting for its manager. Nothing in the
-- seed reaches it, so any read that returns it has widened.
insert into public.attendance
  (outlet_id, person_id, business_date, status,
   check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
values (:'THIRD', :'BOTH', current_date - 3, 'present',
        ((current_date - 3) + time '10:00') at time zone 'Asia/Kolkata',
        22.76005, 88.37004, 14, 'phone');

-- The premise, asserted rather than assumed. The seed gives this person one day
-- at Kalyani and one at Kanchrapara, on different dates.
select is(
  (select count(*) from public.attendance
    where person_id = :'BOTH' and business_date = current_date - 1
      and outlet_id = :'KAL'),
  1::bigint,
  'setup: they worked at Kalyani yesterday');
select is(
  (select count(*) from public.attendance
    where person_id = :'BOTH' and business_date = current_date - 1
      and outlet_id = :'KPA'),
  0::bigint,
  'setup: and hold no row at Kanchrapara that day');

-- ---------------------------------------------------------------------------
-- 1. The manager who cannot see the row learns that there is one.

select pg_temp.impersonate(:'FA_KPA');

select ok(pg_temp.names(array[:'KPA']::uuid[], current_date - 1, :'BOTH'::uuid),
  'the Kanchrapara manager learns their staff member is accounted for elsewhere');

-- …and learns nothing else. This is the whole bound: the fact is disclosed,
-- the row behind it is not.
select is(
  (select count(*) from public.attendance
    where person_id = :'BOTH' and business_date = current_date - 1),
  0::bigint,
  'while the row itself is still refused, by a hand-crafted request naming them');

select is(
  (select count(*) from public.attendance where outlet_id = :'KAL'),
  0::bigint,
  'and no Kalyani row is readable by any shape of request');

-- Somebody who is not on their staff list is not somebody this says anything
-- about, however many rows that person holds at the other outlet.
select ok(not pg_temp.names(array[:'KPA']::uuid[], current_date - 1, :'STAFF_KAL'::uuid),
  'a person off their staff list is never named, though they worked that day');

-- On the day the person DID work at Kanchrapara there is nothing to point at:
-- the real row is already on that manager's roll-call.
select ok(not pg_temp.names(array[:'KPA']::uuid[], current_date - 2, :'BOTH'::uuid),
  'no elsewhere reading on a day they attended this outlet');

-- A genuine absence still reads absent: no row anywhere means no fact here.
select ok(not pg_temp.names(array[:'KPA']::uuid[], current_date - 6, :'BOTH'::uuid),
  'a day with no row at any outlet produces no elsewhere reading');

-- ---------------------------------------------------------------------------
-- 2. Naming an outlet confers nothing, exactly as the selector never did.

select pg_temp.impersonate(:'FA_KAL');

select ok(pg_temp.names(array[:'KAL']::uuid[], current_date - 2, :'BOTH'::uuid),
  'the Kalyani manager gets the mirror fact on the day they worked elsewhere');

select is(
  (select count(*) from public.attendance_elsewhere(array[:'KPA']::uuid[], current_date - 1)),
  0::bigint,
  'and naming ONLY an outlet they do not manage returns nothing at all');

-- Naming both is not a way to borrow the other outlet's view either: the set is
-- intersected with what they may see, so the answer is the same as for Kalyani
-- alone — which on this date is nothing, because Kalyani is where they were.
select ok(
  not pg_temp.names(array[:'KAL', :'KPA']::uuid[], current_date - 1, :'BOTH'::uuid),
  'naming both outlets answers as their own outlet alone would');

-- An Employee holds no Franchise Admin assignment anywhere, so the function is
-- silent for them even about themselves.
select pg_temp.impersonate(:'BOTH');

select is(
  (select count(*) from public.attendance_elsewhere(array[:'KAL', :'KPA']::uuid[], current_date - 1)),
  0::bigint,
  'an employee calling it directly learns nothing about anybody');

-- ---------------------------------------------------------------------------
-- 3. The owner selecting both outlets sees the real row, not a hint of one.

select pg_temp.impersonate(:'OWNER');

select ok(not pg_temp.names(array[:'KAL', :'KPA']::uuid[], current_date - 1, :'BOTH'::uuid),
  'with both outlets selected there is no elsewhere reading — the row is in scope');

select ok(pg_temp.names(array[:'KAL', :'KPA']::uuid[], current_date - 3, :'BOTH'::uuid),
  'but a day worked at a third outlet, outside the selection, still reads elsewhere');

-- ---------------------------------------------------------------------------
-- 4. The by-staff read takes its scope from the policy (design D4).
--
-- No outlet is named in any query below. What comes back is entirely what the
-- reader may see, which is the point: #28 pinned an outlet here so the query
-- would mean one thing, and this change makes the policy's answer the meaning.

select pg_temp.impersonate(:'FA_KAL');

select is(
  (select count(*) from public.attendance
    where person_id = :'BOTH' and business_date between current_date - 40 and current_date),
  1::bigint,
  'a single-outlet manager reads that person''s days at their own outlet only');

-- The same manager, now live at both. Nothing else changes.
select pg_temp.as_owner();
insert into public.assignments (person_id, role, outlet_id, started_on)
values (:'FA_KAL', 'franchise_admin', :'KPA', current_date - 20);

select pg_temp.impersonate(:'FA_KAL');

select is(
  (select count(distinct outlet_id) from public.attendance
    where person_id = :'BOTH' and business_date between current_date - 40 and current_date),
  2::bigint,
  'a manager live at two outlets reads exactly those two');

select is(
  (select count(*) from public.attendance
    where person_id = :'BOTH' and outlet_id = :'THIRD'),
  0::bigint,
  'and the third outlet''s day is not returned, by any shape of request');

select pg_temp.impersonate(:'OWNER');

select is(
  (select count(distinct outlet_id) from public.attendance
    where person_id = :'BOTH' and business_date between current_date - 40 and current_date),
  3::bigint,
  'the owner reads every outlet the person worked at');

reset role;

select * from finish();
rollback;
