-- Outlet setup and the account↔roster link: the two steps that stood between a
-- deployed attendance feature and a reachable one.
--
-- Everything asserted here is authority and consequence, not screens. The
-- screens are covered by component tests and by the REST suite; what matters
-- below is that the database says the same thing when the screens are bypassed.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

create function pg_temp.impersonate(p_sub uuid, p_role text, p_outlet uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_sub, 'role', 'authenticated',
      'app_role', p_role, 'app_outlet_id', p_outlet
    )::text,
    true);
  execute 'set local role authenticated';
end;
$$;

-- How many rows did a write actually touch? Zero is what "RLS filters it
-- out" looks like from the client's side.
create function pg_temp.rows_touched(q text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Independence from whatever ran before.
--
-- supabase/tests/rest/ signs in as the seeded staff and writes real, persistent
-- check-ins to this same local database on today's business date. This file
-- writes today's row for the same seeded employee, so after an
-- `npm run test:rls` it would otherwise die on a unique-constraint collision
-- that has nothing to do with what it is testing — and a suite that passes only
-- on a fresh reset is a suite that will be believed when it is wrong.
--
-- Attendance is append-only, correctly, so clearing it means suspending that
-- guard for the length of this transaction. Deliberately explicit rather than
-- hidden in a helper: this is the one place in the suite that steps around a
-- write rule, and it must be obvious that it is test setup and that the whole
-- file rolls back. Scoped so it can never reach a seeded row — everything in
-- seed.sql is dated yesterday or the day before.
alter table public.attendance disable trigger attendance_no_delete;
delete from public.attendance
 where business_date = public.app_business_date(now(), time '04:00')
   and business_date not in (current_date - 1, current_date - 2);
alter table public.attendance enable trigger attendance_no_delete;

-- ---------------------------------------------------------------------------
-- Creating an outlet is the Super Admin's, and nobody else's.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select throws_ok($q$
  insert into public.outlets (code, name, location_label)
  values ('barrackpore', 'Shawarmania Barrackpore', 'Barrackpore')
$q$, '42501', null, 'a franchise admin cannot create an outlet');

select is(pg_temp.rows_touched($q$
  update public.outlets set name = 'Renamed By The Wrong Person'
   where id = '00000000-0000-4000-a000-000000000001'
$q$), 0::bigint, 'nor rename their own outlet — the update touches no rows');

select is((select name from public.outlets
            where id = '00000000-0000-4000-a000-000000000001'),
  'Shawarmania Kalyani', 'and the name is unchanged');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid,
  'super_admin', null);

select lives_ok($q$
  insert into public.outlets
    (id, code, name, location_label, address_line1, phone, business_day_cutover)
  values ('00000000-0000-4000-a000-000000000009', 'barrackpore',
          'Shawarmania Barrackpore', 'Barrackpore', '1 Synthetic Road',
          '911111111099', time '05:00')
$q$, 'the super admin creates an outlet');

select is((select business_day_cutover from public.outlets
            where id = '00000000-0000-4000-a000-000000000009'), time '05:00',
  'with the cutover it was given, not the default');

select is((select geofence_radius_m from public.outlets
            where id = '00000000-0000-4000-a000-000000000009'), 150,
  'and the agreed default radius until somebody stands there and captures it');

select is((select location_captured_at from public.outlets
            where id = '00000000-0000-4000-a000-000000000009'), null,
  'a new outlet has no position, so it judges nobody until it is surveyed');

select throws_ok($q$
  insert into public.outlets (code, name, location_label)
  values ('barrackpore', 'Shawarmania Barrackpore Two', 'Barrackpore')
$q$, '23505', null, 'an outlet code cannot be reused');

select lives_ok($q$
  update public.outlets set name = 'Shawarmania Barrackpore Main', phone = '911111111098'
   where id = '00000000-0000-4000-a000-000000000009'
$q$, 'the super admin edits an outlet');

-- ---------------------------------------------------------------------------
-- Deactivation means "this shop is not trading", and the asymmetry between
-- check-in and check-out is the whole design (D9).

select lives_ok($q$
  update public.outlets set is_active = false
   where id = '00000000-0000-4000-a000-000000000001'
$q$, 'the super admin deactivates Kalyani');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid,
  'employee', '00000000-0000-4000-a000-000000000001'::uuid);

select throws_ok($q$
  insert into public.attendance
    (outlet_id, employee_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 22.97505, 88.43460, 18, 'phone')
$q$, '23514', 'outlet is not trading',
  'a check-in at a deactivated outlet is refused, and says why');

-- Someone mid-shift when the shop closed must still be able to close their day.
-- The seeded griller checked in yesterday and never checked out.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  update public.attendance
     set check_out_at = now(), check_out_lat = 22.97502, check_out_lng = 88.43455,
         check_out_accuracy_m = 20, check_out_source = 'phone'
   where employee_id = '20000000-0000-4000-a000-000000000002'
     and business_date = current_date - 1
$q$, 'a check-out at a deactivated outlet is recorded, never refused (design D3)');

select isnt((select check_out_at from public.attendance
              where employee_id = '20000000-0000-4000-a000-000000000002'
                and business_date = current_date - 1), null,
  'and the day is closed');

-- Nothing cascaded. The roster, the accounts and the recorded days are all
-- still there — deactivation is a trading state, not a delete.
-- Scoped to the seeded rows rather than counting the whole outlet: the claim is
-- "deactivation destroyed nothing", and a bare count would also be answering
-- "what else has written to this database today", which is a different question
-- with a different answer on every run.
select is((select count(*) from public.employees
            where outlet_id = '00000000-0000-4000-a000-000000000001'
              and employee_code in ('KAL-E1', 'KAL-E2')), 2::bigint,
  'deactivation leaves the roster intact');

select is((select count(*) from public.attendance
            where outlet_id = '00000000-0000-4000-a000-000000000001'
              and business_date in (current_date - 1, current_date - 2)), 3::bigint,
  'and every recorded day still exists');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid,
  'super_admin', null);

select lives_ok($q$
  update public.outlets set is_active = true
   where id = '00000000-0000-4000-a000-000000000001'
$q$, 'the super admin reactivates Kalyani');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid,
  'employee', '00000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  insert into public.attendance
    (outlet_id, employee_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 22.97505, 88.43460, 18, 'phone')
$q$, 'reactivating restores check-in with no other intervention');

select is((select status::text from public.attendance
            where employee_id = '20000000-0000-4000-a000-000000000001'
              and business_date = public.app_business_date(now(), time '04:00')),
  'present', 'and the fence judges it exactly as before');

-- ---------------------------------------------------------------------------
-- The link. `Pending Staff Kal` (10…0c) is an account on no roster; `KAL-E2`
-- (20…02) is a roster row with no account. Neither can produce a working
-- check-in until somebody joins them.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select is((select profile_id from public.employees
            where id = '20000000-0000-4000-a000-000000000002'), null,
  'setup: the griller has no app account');

select lives_ok($q$
  update public.employees
     set profile_id = '10000000-0000-4000-a000-00000000000c'
   where id = '20000000-0000-4000-a000-000000000002'
$q$, 'a franchise admin links an account at their own outlet to a roster row');

-- The link is what makes an employee's own attendance findable at all: the
-- policies scope an Employee's reads through employees.profile_id = auth.uid().
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000c'::uuid,
  'employee', '00000000-0000-4000-a000-000000000001'::uuid);

select is((select count(*) from public.employees), 1::bigint,
  'the newly linked account can now find exactly one roster row — its own');

select is((select count(*) from public.attendance
            where employee_id = '20000000-0000-4000-a000-000000000002'), 2::bigint,
  'and reads that roster row''s recorded days');

-- Unlinking stops the access and keeps the days.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  update public.employees set profile_id = null
   where id = '20000000-0000-4000-a000-000000000002'
$q$, 'the link is removable');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000c'::uuid,
  'employee', '00000000-0000-4000-a000-000000000001'::uuid);

select is((select count(*) from public.employees), 0::bigint,
  'the unlinked account finds no roster row');

select is((select count(*) from public.attendance), 0::bigint,
  'and can no longer read a single attendance row');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select is((select count(*) from public.attendance
            where employee_id = '20000000-0000-4000-a000-000000000002'), 2::bigint,
  'while the roster row keeps every day that was worked');

-- ---------------------------------------------------------------------------
-- What the link may not do.

select throws_ok($q$
  update public.employees
     set profile_id = '10000000-0000-4000-a000-000000000007'
   where id = '20000000-0000-4000-a000-000000000002'
$q$, 'P0001', 'linked profile must belong to the employee''s outlet',
  'an account from another outlet cannot be linked to this roster row');

select is(pg_temp.rows_touched($q$
  update public.employees
     set profile_id = '10000000-0000-4000-a000-00000000000c'
   where id = '20000000-0000-4000-a000-000000000004'
$q$), 0::bigint,
  'a franchise admin cannot write a link on another outlet''s roster row');

select is((select profile_id from public.employees
            where id = '20000000-0000-4000-a000-000000000004'), null,
  'and that roster row is untouched');

-- One account, at most one roster row. Two people sharing a login would make
-- every attendance record ambiguous about who actually stood there.
select lives_ok($q$
  insert into public.employees (id, outlet_id, employee_code, full_name)
  values ('20000000-0000-4000-a000-000000000009',
          '00000000-0000-4000-a000-000000000001', 'KAL-E3', 'Synthetic Helper Kal')
$q$, 'a franchise admin adds a third person to their own roster');

select lives_ok($q$
  update public.employees
     set profile_id = '10000000-0000-4000-a000-00000000000c'
   where id = '20000000-0000-4000-a000-000000000009'
$q$, 'and links the free account to them');

select throws_ok($q$
  update public.employees
     set profile_id = '10000000-0000-4000-a000-00000000000c'
   where id = '20000000-0000-4000-a000-000000000002'
$q$, '23505', null,
  'that same account cannot also be linked to a second roster row');

-- A staff code identifies a payroll record for years. Not-null stops it being
-- absent and says nothing about it being empty, and an empty one satisfies
-- nothing a person needs. **A blank must never survive as a stored value** —
-- that is the claim, and it still holds. What changed with generated-staff-codes
-- is which mechanism keeps it: on insert a blank now means "issue me one", so
-- the row ends up with a real code instead of being refused, and on update a
-- blank is still refused outright, because the row already has a code and
-- clearing it is a mistake rather than a request (that change's design D2).
-- Both halves are asserted, so the original intent is covered rather than
-- traded away for a passing run.
insert into public.employees (id, outlet_id, employee_code, full_name)
values ('20000000-0000-4000-a000-0000000000a9',
        '00000000-0000-4000-a000-000000000001', '   ', 'Synthetic Blank Code');

select matches(
  (select employee_code from public.employees
    where id = '20000000-0000-4000-a000-0000000000a9'),
  '^KAL-[0-9A-HJKMNP-TV-Z]{4}$',
  'a blank staff code on insert is issued a real one, never stored blank');

-- Asserted as the owner, deliberately. This session is a Franchise Admin, who
-- cannot change a staff code at all — a separate rule, proved in
-- `13_generated_staff_codes.sql` — so asking here would raise `42501` and prove
-- something about authority while saying nothing about blankness. Asking as the
-- one person who *is* allowed to change a code isolates the claim: even they
-- cannot clear one.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid,
  'super_admin', null);

select throws_ok($q$
  update public.employees set employee_code = '   '
   where id = '20000000-0000-4000-a000-0000000000a9'
$q$, '23514', null, 'and a blank staff code on update is still refused, even for the owner');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

-- A roster row may be created already linked, in one write — which is what
-- provisioning-with-a-roster-row does.
select lives_ok($q$
  insert into public.employees (outlet_id, profile_id, employee_code, full_name)
  values ('00000000-0000-4000-a000-000000000001',
          '10000000-0000-4000-a000-00000000000a', 'KAL-E4', 'Synthetic Biller Kal')
$q$, 'a roster row can be inserted with its link already set');

select throws_ok($q$
  insert into public.employees (outlet_id, profile_id, employee_code, full_name)
  values ('00000000-0000-4000-a000-000000000001',
          '10000000-0000-4000-a000-000000000003', 'KAL-E5', 'Wrong Outlet Entirely')
$q$, 'P0001', 'linked profile must belong to the employee''s outlet',
  'and the same-outlet rule applies on insert, not only on update');

reset role;

select * from finish();
rollback;
