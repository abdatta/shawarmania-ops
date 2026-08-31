-- Status immediacy and role scope. Deactivation and revocation must bite on
-- the next request with a still-valid token — that is the whole reason the
-- policies check status in the database rather than trusting claims. Plus
-- the two narrow scopes: an employee sees only themselves, a device sees
-- only its open shifts' bills.

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
-- A deactivated Franchise Admin with otherwise-perfect claims: nothing, not
-- even their own profile.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000008'::uuid);

select is((select count(*) from public.menu_items), 0::bigint,
  'deactivated admin reads no menu');
select is((select count(*) from public.bills), 0::bigint,
  'deactivated admin reads no bills');
select is((select count(*) from public.profiles), 0::bigint,
  'deactivated admin reads no profiles, not even their own');
select is((select count(*) from public.outlets), 0::bigint,
  'deactivated admin reads no outlet row');

select throws_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, amount_paise, is_cash, recorded_by)
  values ('00000000-0000-4000-a000-000000000001', current_date, 'Other', 1000, true,
          '10000000-0000-4000-a000-000000000008')
$q$, '42501', null, 'deactivated admin cannot write');

-- ---------------------------------------------------------------------------
-- A revoked counter device with a still-live session and an active profile:
-- the device check alone blocks it.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000009'::uuid);

select is((select count(*) from public.menu_items), 0::bigint,
  'revoked device reads no menu');
select is((select count(*) from public.bills), 0::bigint,
  'revoked device reads no bills');
select is((select count(*) from public.shifts), 0::bigint,
  'revoked device reads no shifts');
select is((select count(*) from public.counter_devices), 0::bigint,
  'revoked device cannot even read its own device row');

select throws_ok($q$
  insert into public.shifts (id, outlet_id, counter_device_id, biller_profile_id, business_date, opened_at)
  values (gen_random_uuid(), '00000000-0000-4000-a000-000000000001',
          '10000000-0000-4000-a000-000000000009', '10000000-0000-4000-a000-00000000000a',
          public.app_business_date(now(), time '04:00'), now())
$q$, '42501', null, 'revoked device cannot open a shift');

select throws_ok($q$
  insert into public.bills (id, outlet_id, business_date, biller_profile_id, counter_device_id,
                            shift_id, subtotal_paise, total_paise, payment_method)
  values (gen_random_uuid(), '00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000009',
          '40000000-0000-4000-a000-000000000002', 13900, 13900, 'cash')
$q$, '42501', null, 'revoked device cannot insert a bill');

-- ---------------------------------------------------------------------------
-- Employee self-scope: their own rows and nobody else's, even inside their
-- own outlet.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);

select is(
  (select count(*) from public.attendance
    where person_id <> '10000000-0000-4000-a000-000000000006'),
  0::bigint,
  'employee sees no colleague''s attendance, same outlet included');

select ok(
  (select count(*) from public.attendance
    where person_id = '10000000-0000-4000-a000-000000000006') >= 1,
  'employee sees their own attendance');

select is(
  (select count(*) from public.profiles), 1::bigint,
  'employee sees exactly their own person record');

select is((select count(*) from public.bills), 0::bigint,
  'employee reads no bills');
select is((select count(*) from public.expenses), 3::bigint,
  'employee reads their outlet expenses');
select is((select count(*) from public.menu_items), 0::bigint,
  'employee has no menu surface');

-- ---------------------------------------------------------------------------
-- Biller shift scope: the device sees bills of its open shifts only — not
-- the closed morning shift, not the reconciled day before yesterday.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);

select is((select count(*) from public.bills), 2::bigint,
  'device sees exactly the open shift''s two bills');

select is(
  (select count(*) from public.bills
    where id = '50000000-0000-4000-a000-000000000013'),
  0::bigint,
  'the closed morning shift''s bill is invisible to the device');

select is(
  (select count(*) from public.bills where business_date = current_date - 2),
  0::bigint,
  'the reconciled day''s bills are invisible to the device');

-- ---------------------------------------------------------------------------
-- Write paths that must not exist for clients at all.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select throws_ok($q$
  insert into public.profiles (id, full_name)
  values (gen_random_uuid(), 'Forged Profile')
$q$, '42501', null, 'no client can insert a profile');

-- The profile row splits in two along the column axis: staff facts (name, job
-- title) are the admin's own RLS write, access (is_active) remains
-- privileged. The column-level grant is the boundary between them. Since
-- multi-outlet-people, role and outlet are not on this row at all — they are
-- assignments, with their own policy and their own guard.

select throws_ok($q$
  update public.profiles set is_active = false
   where id = '10000000-0000-4000-a000-000000000006'
$q$, '42501', null, 'no client can touch is_active — the panic lever stays privileged');

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('role', 'outlet_id', 'staff_code', 'joined_on', 'left_on')),
  0::bigint,
  'role, outlet and the staff code are gone from the account record entirely');

-- A manager cannot move somebody to another outlet, because moving is now
-- granting an assignment there — and the policy refuses an outlet they do not
-- manage.
select throws_ok($q$
  insert into public.assignments (person_id, role, outlet_id)
  values ('10000000-0000-4000-a000-000000000006', 'employee',
          '00000000-0000-4000-a000-000000000002')
$q$, '42501', null, 'no manager can place a person at an outlet they do not manage');

select throws_ok($q$
  insert into public.assignments (person_id, role, outlet_id)
  values ('10000000-0000-4000-a000-000000000006', 'franchise_admin',
          '00000000-0000-4000-a000-000000000001')
$q$, '42501', null, 'no manager can promote somebody to their own rank');

select is(
  pg_temp.rows_touched($q$
    update public.profiles set role_title = 'Senior Griller'
     where id = '20000000-0000-4000-a000-000000000002' $q$),
  1::bigint,
  'a franchise admin edits the staff facts of their own outlet''s person');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);

select is(
  pg_temp.rows_touched($q$
    update public.profiles set full_name = 'Self Renamed'
     where id = '10000000-0000-4000-a000-000000000006' $q$),
  0::bigint,
  'an employee cannot edit their own staff facts — the row is an admin''s to maintain');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select throws_ok($q$
  update public.counter_devices set removed_at = null
   where id = '10000000-0000-4000-a000-000000000009'
$q$, '42501', null, 'no client can un-remove a tablet');

select throws_ok($q$
  select count(*) from public.bill_number_counters
$q$, '42501', null, 'the bill number counters are invisible to clients');

-- An FA cannot touch outlets; only the Super Admin manages them.
select is(
  pg_temp.rows_touched($q$ update public.outlets set name = name $q$),
  0::bigint,
  'franchise admin cannot update any outlet row');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  update public.outlets set name = name where code = 'kalyani'
$q$, 'super admin can update an outlet');

-- ---------------------------------------------------------------------------
-- Account invitations. Two properties beyond the cross-outlet sweep in 02:
-- the code hash is readable by nobody, and no client writes the table at all.

-- Counted over the seeded invites by id rather than over the whole table: the
-- REST integration suite provisions real accounts against this same database,
-- and an assertion that breaks when someone else does their job is a bad
-- assertion. The property under test is visibility, not population.
select is(
  (select count(*) from public.account_invites
    where id in ('80000000-0000-4000-a000-000000000001',
                 '80000000-0000-4000-a000-000000000002')),
  2::bigint,
  'super admin sees both outlets'' outstanding invites');

select throws_ok($q$
  select code_hash from public.account_invites
$q$, '42501', null, 'not even the super admin can read an invite code hash');

-- `select *` expands to the withheld column, so the whole-row read is refused
-- too — a client must name the columns it is allowed to have.
select throws_ok($q$
  select * from public.account_invites
$q$, '42501', null, 'a whole-row invite read is refused because it includes the hash');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select is(
  (select count(*) from public.account_invites
    where id = '80000000-0000-4000-a000-000000000001'),
  1::bigint,
  'franchise admin sees their own outlet''s outstanding invite');

-- Since multi-outlet-people an invite carries no outlet of its own — it is
-- about a person, and a person may be at several outlets. The scoping question
-- is therefore "may this caller manage that person", and the other outlet's
-- pending staff member is the row that must not appear.
select is(
  (select count(*) from public.account_invites
    where profile_id = '10000000-0000-4000-a000-00000000000d'),
  0::bigint,
  'franchise admin sees no invite for a person assigned only to the other outlet');

select throws_ok($q$
  select code_hash from public.account_invites
$q$, '42501', null, 'franchise admin cannot read an invite code hash');

select throws_ok($q$
  insert into public.account_invites (profile_id, code_hash, issued_by, expires_at)
  values ('10000000-0000-4000-a000-000000000006',
          'forged', '10000000-0000-4000-a000-000000000002', now() + interval '1 day')
$q$, '42501', null, 'no client can issue an invite');

select throws_ok($q$
  update public.account_invites set expires_at = now() + interval '99 days'
$q$, '42501', null, 'no client can extend an invite');

select throws_ok($q$
  delete from public.account_invites
$q$, '42501', null, 'no client can delete an invite');

-- Neither of the two roles that never issue codes sees any.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);
select is((select count(*) from public.account_invites), 0::bigint,
  'an employee sees no invites, including their own');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);
select is((select count(*) from public.account_invites), 0::bigint,
  'a counter device sees no invites');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000008'::uuid);
select is((select count(*) from public.account_invites), 0::bigint,
  'a deactivated admin sees no invites');

reset role;

select * from finish();
rollback;
