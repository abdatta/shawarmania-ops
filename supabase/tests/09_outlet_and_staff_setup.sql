-- Outlet setup and the staff lifecycle: creation authority, trading state,
-- and — since staff-as-accounts — what the end of a person's involvement may
-- and may not do. There is no account↔roster link any more; the invariants
-- the link machinery enforced (same outlet, one account one person) are
-- structural now, because one record cannot disagree with itself.
--
-- Everything asserted here is authority and consequence, not screens. The
-- screens are covered by component tests and by the REST suite; what matters
-- below is that the database says the same thing when the screens are bypassed.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

-- Claims carry `sub` and nothing about authority (multi-outlet-people): scope
-- is resolved from the seeded `assignments` rows, exactly as a real session's
-- is.
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

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

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

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

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

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);

select throws_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 22.97505, 88.43460, 18, 'phone')
$q$, '23514', 'outlet is not trading',
  'a check-in at a deactivated outlet is refused, and says why');

-- Someone mid-shift when the shop closed must still be able to close their day.
-- The seeded griller checked in yesterday and never checked out.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select lives_ok($q$
  update public.attendance
     set check_out_at = now(), check_out_lat = 22.97502, check_out_lng = 88.43455,
         check_out_accuracy_m = 20, check_out_source = 'phone'
   where person_id = '20000000-0000-4000-a000-000000000002'
     and business_date = current_date - 1
$q$, 'a check-out at a deactivated outlet is recorded, never refused (design D3)');

select isnt((select check_out_at from public.attendance
              where person_id = '20000000-0000-4000-a000-000000000002'
                and business_date = current_date - 1), null,
  'and the day is closed');

-- Nothing cascaded. The staff, the accounts and the recorded days are all
-- still there — deactivation is a trading state, not a delete.
-- Scoped to the seeded rows rather than counting the whole outlet: the claim is
-- "deactivation destroyed nothing", and a bare count would also be answering
-- "what else has written to this database today", which is a different question
-- with a different answer on every run.
select is((select count(*) from public.assignments
            where outlet_id = '00000000-0000-4000-a000-000000000001'
              and ended_on is null
              and person_id in ('10000000-0000-4000-a000-000000000006',
                                '20000000-0000-4000-a000-000000000002')), 2::bigint,
  'deactivation leaves the staff list intact');

select is((select count(*) from public.attendance
            where outlet_id = '00000000-0000-4000-a000-000000000001'
              and business_date in (current_date - 1, current_date - 2)), 4::bigint,
  'and every recorded day still exists');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  update public.outlets set is_active = true
   where id = '00000000-0000-4000-a000-000000000001'
$q$, 'the super admin reactivates Kalyani');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);

select lives_ok($q$
  insert into public.attendance
    (outlet_id, person_id, business_date, status,
     check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_source)
  values ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006',
          public.app_business_date(now(), time '04:00'), 'present',
          now(), 22.97505, 88.43460, 18, 'phone')
$q$, 'reactivating restores check-in with no other intervention');

select is((select status::text from public.attendance
            where person_id = '10000000-0000-4000-a000-000000000006'
              and business_date = public.app_business_date(now(), time '04:00')),
  'present', 'and the fence judges it exactly as before');

-- ---------------------------------------------------------------------------
-- Nothing with history is deletable. Every foreign key onto profiles(id) is
-- plain NO ACTION except the account_invites cascade (an invite is plumbing,
-- not history), so the keys themselves refuse the delete — there is no flag
-- to maintain and no list of tables to keep in step. The migration aborts if
-- a cascade ever appears; this proves the property against hand-crafted
-- deletes from both directions, as the database owner, because clients hold
-- no delete grant on profiles at all.

reset role;

select is((select count(*)
             from pg_catalog.pg_constraint c
             join pg_catalog.pg_class cl on cl.oid = c.conrelid
             join pg_catalog.pg_namespace ns on ns.oid = cl.relnamespace
            where c.contype = 'f'
              and c.confrelid = 'public.profiles'::regclass
              and c.confdeltype = 'c'
              and ns.nspname = 'public'
              and cl.relname not in ('account_invites', 'assignments')), 0::bigint,
  'no foreign key onto profiles cascades, except the two recorded exceptions');

-- The two exceptions, named so that adding a third has to argue for itself
-- here. Both are PLUMBING rather than history: an invite is a code waiting to
-- be redeemed, an assignment is the record that somebody works somewhere.
-- Neither is evidence of anything that happened, which is what the
-- no-deletion rule protects — and every table that IS evidence still refuses,
-- which the two deletes above prove.
select is((select string_agg(cl.relname, ', ' order by cl.relname)
             from pg_catalog.pg_constraint c
             join pg_catalog.pg_class cl on cl.oid = c.conrelid
             join pg_catalog.pg_namespace ns on ns.oid = cl.relnamespace
            where c.contype = 'f'
              and c.confrelid = 'public.profiles'::regclass
              and c.confdeltype = 'c'
              and ns.nspname = 'public'),
  'account_invites, assignments',
  'and the cascading keys are exactly the two that are plumberage, not history');

select throws_ok($q$
  delete from public.profiles where id = '10000000-0000-4000-a000-000000000006'
$q$, '23503', null,
  'deleting an account with recorded attendance is refused by the keys themselves');

select throws_ok($q$
  delete from auth.users where id = '10000000-0000-4000-a000-000000000006'
$q$, '23503', null,
  'the auth-side delete is refused too — the cascade onto the profile meets the same keys');

-- An account with no history remains deletable, so a provisioning that fails
-- halfway can clean up after itself.
insert into auth.users
  (instance_id, id, aud, role, email, email_confirmed_at, encrypted_password,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change_token_new,
   email_change_token_current, email_change, phone_change,
   phone_change_token, reauthentication_token, is_sso_user)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-a000-0000000000fe',
   'authenticated', 'authenticated', 'fresh.kalyani@example.com', now(),
   extensions.crypt('shawarmania-local', extensions.gen_salt('bf')),
   '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
   now(), now(), '', '', '', '', '', '', '', '', false);

insert into public.profiles (id, full_name)
values ('10000000-0000-4000-a000-0000000000fe', 'Synthetic Fresh Hire');
insert into public.assignments (person_id, role, outlet_id)
values ('10000000-0000-4000-a000-0000000000fe', 'employee',
        '00000000-0000-4000-a000-000000000001');

select lives_ok($q$
  delete from auth.users where id = '10000000-0000-4000-a000-0000000000fe'
$q$, 'an account with no recorded history can still be cleaned up');

select is((select count(*) from public.profiles
            where id = '10000000-0000-4000-a000-0000000000fe'), 0::bigint,
  'and its profile went with it — the cascade from auth.users still works downward');

-- ---------------------------------------------------------------------------
-- Departure and access are two independent facts, and neither erases a day.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

-- Departure is per-outlet since multi-outlet-people: it ends the assignment
-- at this outlet, not a column on the person.
select lives_ok($q$
  update public.assignments set ended_on = current_date
   where person_id = '20000000-0000-4000-a000-000000000002'
     and outlet_id = '00000000-0000-4000-a000-000000000001'
     and ended_on is null
$q$, 'a franchise admin ends their outlet''s griller''s assignment');

select is((select count(*) from public.attendance
            where person_id = '20000000-0000-4000-a000-000000000002'), 2::bigint,
  'every day the departed person worked is still on the record');

select lives_ok($q$
  insert into public.assignments (person_id, role, outlet_id)
  values ('20000000-0000-4000-a000-000000000002', 'employee',
          '00000000-0000-4000-a000-000000000001')
$q$, 'and departure is reversible — people do come back, as a fresh assignment');

-- The panic-button state: access cut while the assignment stays live. The
-- seeded deactivated admin holds it; what matters is that the person is still
-- on the staff list — deactivation is about sign-in, not existence.
select is((select count(*) from public.profiles p
            join public.assignments a on a.person_id = p.id and a.ended_on is null
           where p.id = '10000000-0000-4000-a000-000000000008'
             and p.is_active = false), 1::bigint,
  'access cut with no departure is a real, stored state');

select throws_ok($q$
  update public.assignments
     set ended_on = started_on - 1
   where person_id = '20000000-0000-4000-a000-000000000002'
     and ended_on is null
$q$, '23514', null, 'an assignment ending before it started is refused');

-- Ending one assignment leaves the person's other one, and their account,
-- exactly as they were — the gate clause, at the database.
select lives_ok($q$
  update public.assignments set ended_on = current_date
   where person_id = '10000000-0000-4000-a000-00000000000e'
     and outlet_id = '00000000-0000-4000-a000-000000000001'
     and ended_on is null
$q$, 'the split-shift person''s Kalyani assignment is ended');

-- Read the consequences as the owner: a Kalyani manager is — correctly — no
-- longer able to see this person at all, which is the isolation working rather
-- than the account having gone anywhere.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select is((select count(*) from public.assignments
            where person_id = '10000000-0000-4000-a000-00000000000e'
              and ended_on is null), 1::bigint,
  'their Kanchrapara assignment is untouched');

select is((select is_active from public.profiles
            where id = '10000000-0000-4000-a000-00000000000e'), true,
  'and their account still signs in');

select is((select count(*) from public.attendance
            where person_id = '10000000-0000-4000-a000-00000000000e'), 2::bigint,
  'and every day they worked at either outlet is still on the record');

reset role;

select * from finish();
rollback;
