-- Assignments: the relation that replaced `profiles.role` + `profiles.outlet_id`.
--
-- Everything here is authority and consequence at the database. The screens are
-- covered by component tests and the REST suite; what matters below is that the
-- database says the same thing when the screens are bypassed — which is the
-- only version of "nobody grants themselves the owner role" worth having.

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
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set STAFF_KAL '10000000-0000-4000-a000-000000000006'
\set STAFF_KPA '10000000-0000-4000-a000-000000000007'
\set SPLIT '10000000-0000-4000-a000-00000000000e'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- ---------------------------------------------------------------------------
-- 1. Nothing about authority is in the token.
--
-- The claim helpers and the hook are gone, so a policy cannot be satisfied by
-- a token that says the right thing. This is the property the whole change
-- rests on, and it is asserted by absence.

-- The hook outlived #22 as an inert stub so that applying that migration could
-- not break sign-in on a project whose auth settings still registered it. The
-- registration is gone (2026-07-30) and so is the function: there is now no
-- code path at all by which a token could be handed authority.
select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('app_role', 'app_outlet_id', 'custom_access_token_hook')),
  0::bigint,
  'the claim helpers and the access-token hook no longer exist');

-- A fabricated authority claim buys nothing, because nothing reads one.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', :'STAFF_KAL', 'role', 'authenticated',
                    'app_role', 'super_admin', 'app_outlet_id', null)::text, true);
set local role authenticated;

select is((select count(*) from public.expenses), 0::bigint,
  'a forged super_admin claim on an employee''s token reads no expenses');
select is((select count(*) from public.outlets), 1::bigint,
  'and still sees exactly the one outlet they are assigned to');

-- ---------------------------------------------------------------------------
-- 2. Live and ended.

select pg_temp.impersonate(:'OWNER');

savepoint ending;
select is(pg_temp.rows_touched(format($q$
  update public.assignments set ended_on = current_date
   where person_id = %L and outlet_id = %L and ended_on is null $q$, :'SPLIT', :'KAL')),
  1::bigint, 'the owner ends one of the split-shift person''s assignments');

select is((select count(*) from public.assignments
            where person_id = :'SPLIT' and ended_on is null), 1::bigint,
  'their other assignment is untouched');
select is((select count(*) from public.assignments
            where person_id = :'SPLIT'), 2::bigint,
  'and the ended one is retained, not deleted — the row is the history');

select throws_ok(format($q$
  update public.assignments set ended_on = current_date - 1
   where person_id = %L and outlet_id = %L $q$, :'SPLIT', :'KAL'),
  'P0001', null, 'an assignment that has ended cannot be reopened or re-dated');

-- Re-joining is a fresh assignment, which the partial index permits precisely
-- because the ended row is out of its way.
select lives_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'employee', %L) $q$, :'SPLIT', :'KAL'),
  'and they can be re-assigned there later — people do come back');
rollback to ending;

select throws_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'employee', %L) $q$, :'STAFF_KAL', :'KAL'),
  '23505', null, 'a second live assignment at the same outlet is refused');

select lives_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'employee', %L) $q$, :'STAFF_KAL', :'KPA'),
  'but a live assignment at a DIFFERENT outlet is exactly the point');

-- ---------------------------------------------------------------------------
-- 3. Self-assignment: the one carve-out, drawn narrowly (design D7).

select pg_temp.impersonate(:'OWNER');

select throws_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'super_admin', null) $q$, :'OWNER'),
  '42501', null, 'not even the owner may grant themselves the owner role');

savepoint owner_self_assign;
select lives_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'franchise_admin', %L) $q$, :'OWNER', :'KAL'),
  'the owner may assign themselves as a manager of an outlet');
rollback to owner_self_assign;

select pg_temp.impersonate(:'FA_KAL');

select throws_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'employee', %L) $q$, :'FA_KAL', :'KAL'),
  '42501', null, 'a manager may not assign themselves anything, even at their own outlet');

select throws_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'super_admin', null) $q$, :'FA_KAL'),
  '42501', null, 'nor promote themselves to owner');

select pg_temp.impersonate(:'STAFF_KAL');

select throws_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'franchise_admin', %L) $q$, :'STAFF_KAL', :'KAL'),
  '42501', null, 'an employee may not promote themselves');

select throws_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'employee', %L) $q$, :'STAFF_KPA', :'KAL'),
  '42501', null, 'nor place a colleague anywhere');

-- ---------------------------------------------------------------------------
-- 4. The last owner cannot be removed.

select pg_temp.impersonate(:'OWNER');

select throws_ok($q$
  update public.assignments set ended_on = current_date
   where role = 'super_admin' and ended_on is null
$q$, 'P0001', null, 'the last super admin assignment cannot be ended, even by its holder');

-- With a second owner in place the first becomes removable, which is what
-- makes the rule a safety net rather than a lock.
savepoint two_owners;
reset role;
insert into public.assignments (person_id, role, outlet_id)
values (:'FA_KAL', 'super_admin', null);

select pg_temp.impersonate(:'OWNER');
select is(pg_temp.rows_touched(format($q$
  update public.assignments set ended_on = current_date
   where person_id = %L and role = 'super_admin' and ended_on is null $q$, :'OWNER')),
  1::bigint, 'with a second owner appointed, the first may step down');
rollback to two_owners;

-- ---------------------------------------------------------------------------
-- 5. A manager's authority over assignments stops at their own outlets and
-- below their own rank.

select pg_temp.impersonate(:'FA_KAL');

select lives_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'employee', %L) $q$, :'STAFF_KPA', :'KAL'),
  'a manager may place somebody at their own outlet — including somebody who already works elsewhere');

select throws_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'employee', %L) $q$, :'STAFF_KAL', :'KPA'),
  '42501', null, 'but not at an outlet they do not manage');

select throws_ok(format($q$
  insert into public.assignments (person_id, role, outlet_id)
  values (%L, 'franchise_admin', %L) $q$, :'STAFF_KAL', :'KAL'),
  '42501', null, 'and not at their own rank — no manager mints a peer');

-- Reading: a manager sees assignments at outlets they manage, and NOT the
-- other outlet's assignment of somebody who works at both. That row is the
-- other outlet's data.
select is((select count(*) from public.assignments where person_id = :'SPLIT'), 1::bigint,
  'a manager sees only the own-outlet assignment of a person who works at both');
select is((select outlet_id from public.assignments where person_id = :'SPLIT'),
  :'KAL'::uuid,
  'and it is theirs');

-- ---------------------------------------------------------------------------
-- 6. Assignments are ended, never deleted.

select throws_ok($q$
  delete from public.assignments
$q$, '42501', null, 'no client role holds a delete grant on assignments');

-- ---------------------------------------------------------------------------
-- 7. The owner assigned as a manager runs that outlet, and only that one.
--
-- The gate clause: authority comes from the assignment, not from being the
-- owner — so the drawer opens at the outlet they manage and nowhere else.

reset role;
insert into public.assignments (person_id, role, outlet_id)
values (:'OWNER', 'franchise_admin', :'KAL');

select pg_temp.impersonate(:'OWNER');

select lives_ok(format($q$
  insert into public.cash_withdrawals (outlet_id, business_date, amount_paise, withdrawn_by, recorded_by)
  values (%L, current_date, 5000, 'Synthetic Owner', %L) $q$, :'KAL', :'OWNER'),
  'the owner-as-manager takes cash from the drawer they are responsible for');

select throws_ok(format($q$
  insert into public.cash_withdrawals (outlet_id, business_date, amount_paise, withdrawn_by, recorded_by)
  values (%L, current_date, 5000, 'Synthetic Owner', %L) $q$, :'KPA', :'OWNER'),
  '42501', null, 'and cannot touch the drawer of the outlet they do not manage');

select lives_ok(format($q$
  insert into public.expenses (outlet_id, business_date, category, amount_paise, payment_method, recorded_by)
  values (%L, current_date, 'other', 5000, 'cash', %L) $q$, :'KAL', :'OWNER'),
  'a CASH expense is available to them at the outlet they manage');

select throws_ok(format($q$
  insert into public.expenses (outlet_id, business_date, category, amount_paise, payment_method, recorded_by)
  values (%L, current_date, 'other', 5000, 'cash', %L) $q$, :'KPA', :'OWNER'),
  '42501', null, 'but never at the outlet they merely own');

reset role;

select * from finish();
rollback;
