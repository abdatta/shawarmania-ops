-- staff-roles-include-other-roles: which role includes which gives every
-- existing role today's answer.
--
-- The change is a refactor, so the claim worth proving is sameness, and it is
-- proved three ways, from the narrowest to the widest:
--
--   1. The substitution itself. Every `role in ('employee', 'biller')` became
--      `app_role_includes(role, 'employee')`, every `role = 'biller'` became
--      `app_role_includes(role, 'biller')`, and every pair of
--      `app_has_role_at` calls became one `app_acts_as`. Each is checked for
--      every value of `app_role` and for every seeded person at both outlets.
--   2. Each of the ten policies, rewritten by the gate's contract migration,
--      admits exactly what the role-by-name policy it replaced admitted, frozen
--      here and put back inside a savepoint, for every persona; and so do the
--      Team and counter-shift helpers the contract rewrote in place.
--   3. Each `_v2` a build calls returns what its original returns, the
--      original now being a call to it.
--
-- The gate has retired: nothing reads it, and no twin is left.

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

-- What a statement does, without keeping it: the rows it touched, or the
-- SQLSTATE it raised. A success is rolled back by raising afterwards.
create function pg_temp.outcome(p_sql text)
returns text language plpgsql as $$
declare
  v_rows bigint;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    raise exception using errcode = 'P0099', message = v_rows::text;
  exception
    when sqlstate 'P0099' then return 'ok:' || sqlerrm;
    when others then return 'err:' || sqlstate || ':' || sqlerrm;
  end;
end;
$$;

-- Personas: every kind of person the seed holds, at both outlets.
create temp table personas (label text, id uuid) on commit drop;
insert into personas values
  ('owner',          '10000000-0000-4000-a000-000000000001'),
  ('manager kal',    '10000000-0000-4000-a000-000000000002'),
  ('manager kpa',    '10000000-0000-4000-a000-000000000003'),
  ('deactivated',    '10000000-0000-4000-a000-000000000008'),
  ('biller kal',     '10000000-0000-4000-a000-00000000000a'),
  ('biller kpa',     '10000000-0000-4000-a000-00000000000b'),
  ('employee kal',   '10000000-0000-4000-a000-000000000006'),
  ('employee kpa',   '10000000-0000-4000-a000-000000000007'),
  ('two outlets',    '10000000-0000-4000-a000-00000000000e');
grant select on personas to authenticated;

\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- ---------------------------------------------------------------------------
-- 0. Which role includes which, and the helpers that read it.

select is(
  (select string_agg(role::text, ', ' order by role::text) from public.staff_roles),
  'biller, employee',
  'the staff roles are Employee and Biller');

select is(
  (select string_agg(role::text || ' includes ' || includes::text, ', ' order by role::text)
     from public.staff_role_includes),
  'biller includes employee',
  'one row says a Biller includes an Employee, and nothing else is written');

select is(
  (select count(*)::int from unnest(enum_range(null::public.app_role)) r
    where public.app_role_includes(r, 'employee') is distinct from (r in ('employee', 'biller'))),
  0,
  'a role includes Employee exactly when it is Employee or Biller, for every role there is');

select is(
  (select count(*)::int from unnest(enum_range(null::public.app_role)) r
    where public.app_role_includes(r, 'biller') is distinct from (r = 'biller')),
  0,
  'a role includes Biller exactly when it is Biller, for every role there is');

select ok(
  not public.app_role_includes('franchise_admin', 'employee')
  and not public.app_role_includes('super_admin', 'employee')
  and not public.app_role_includes('employee', 'franchise_admin'),
  'a manager and the owner are not staff roles, and the includes rows never answer for them');

-- The rows stay a tree that can be walked down and always ends.
select throws_ok(
  $$ insert into public.staff_role_includes values ('employee', 'biller') $$,
  '23514', null,
  'a row that would make Employee include Biller, which already includes Employee, is refused');

select throws_ok(
  $$ insert into public.staff_role_includes values ('biller', 'biller') $$,
  '23514', null,
  'a role cannot include itself');

select throws_ok(
  $$ insert into public.staff_role_includes values ('franchise_admin', 'employee') $$,
  '23503', null,
  'a manager cannot be written into the includes rows');

create function pg_temp.helper_mismatches()
returns integer language plpgsql as $$
declare
  v_person record;
  v_outlet uuid;
  v_bad integer := 0;
begin
  for v_person in select * from personas loop
    perform pg_temp.impersonate(v_person.id);
    foreach v_outlet in array array[
      '00000000-0000-4000-a000-000000000001'::uuid,
      '00000000-0000-4000-a000-000000000002'::uuid] loop
      if public.app_acts_as('employee', v_outlet) is distinct from
         (public.app_has_role_at('employee', v_outlet) or public.app_has_role_at('biller', v_outlet))
      then v_bad := v_bad + 1; raise notice 'app_acts_as employee differs for %', v_person.label; end if;
      if public.app_acts_as('biller', v_outlet) is distinct from public.app_has_role_at('biller', v_outlet)
      then v_bad := v_bad + 1; raise notice 'app_acts_as biller differs for %', v_person.label; end if;
    end loop;
    if array(select o from public.app_outlets_acting_as('biller') o order by o) is distinct from
       array(select o from public.app_outlets_for('biller') o order by o)
    then v_bad := v_bad + 1; raise notice 'app_outlets_acting_as biller differs for %', v_person.label; end if;
    if array(select o from public.app_outlets_acting_as('employee') o order by o) is distinct from
       array(select distinct o from (
         select public.app_outlets_for('employee') o
         union select public.app_outlets_for('biller')) s order by o)
    then v_bad := v_bad + 1; raise notice 'app_outlets_acting_as employee differs for %', v_person.label; end if;
  end loop;
  execute 'reset role';
  return v_bad;
end;
$$;

select is(pg_temp.helper_mismatches(), 0,
  'for every persona at both outlets, the helpers answer as the role-by-name checks do');

-- An ended assignment confers nothing.
reset role;
insert into public.assignments (person_id, role, outlet_id, started_on, ended_on)
values ('10000000-0000-4000-a000-000000000007', 'biller', :'KAL', current_date - 30, current_date - 1);
select pg_temp.impersonate('10000000-0000-4000-a000-000000000007'::uuid);
select ok(not public.app_acts_as('employee', :'KAL'::uuid),
  'an ended assignment confers nothing');
reset role;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);
select throws_ok(
  $$ insert into public.staff_role_includes values ('biller', 'employee') $$,
  '42501', null,
  'no client writes an includes row, not even the owner');
select throws_ok(
  $$ insert into public.staff_roles values ('franchise_admin') $$,
  '42501', null,
  'and no client adds a staff role');
reset role;

-- Who may read the two tables is granted explicitly, not left to Supabase's
-- default grants, which new tables stop receiving on 30 October 2026
-- (20261101000001_staff_roles_have_explicit_grants.sql).
select ok(
  has_table_privilege('authenticated', 'public.staff_roles', 'SELECT')
  and has_table_privilege('authenticated', 'public.staff_role_includes', 'SELECT'),
  'a signed-in client may read both tables');

select ok(
  not has_table_privilege('authenticated', 'public.staff_roles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.staff_roles', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.staff_roles', 'DELETE')
  and not has_table_privilege('authenticated', 'public.staff_role_includes', 'INSERT')
  and not has_table_privilege('authenticated', 'public.staff_role_includes', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.staff_role_includes', 'DELETE'),
  'and may write neither');

select ok(
  has_table_privilege('service_role', 'public.staff_roles', 'SELECT')
  and has_table_privilege('service_role', 'public.staff_role_includes', 'INSERT'),
  'the service role is granted both, table by table');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000006'::uuid);
select is(
  (select count(*)::int from public.staff_role_includes),
  1,
  'an Employee signed in reads the includes row');
reset role;

-- An anonymous caller holds no grant on a fresh schema after 30 October, and the
-- old default grant before it; either way it must read nothing.
create function pg_temp.anon_reads()
returns integer language plpgsql as $$
declare v_rows integer;
begin
  execute 'set local role anon';
  begin
    select (select count(*) from public.staff_roles)::int
         + (select count(*) from public.staff_role_includes)::int
      into v_rows;
  exception when insufficient_privilege then
    v_rows := 0;
  end;
  execute 'reset role';
  return v_rows;
end;
$$;

select is(pg_temp.anon_reads(), 0, 'an anonymous caller reads nothing from either table');

-- ---------------------------------------------------------------------------
-- 1. Policies: each one admits what the role-by-name policy it replaced did.
--
-- The contract (20261113020000_contract_role_includes.sql) gave each of the ten
-- policies its twin's expression and dropped the twin. Each is measured as it
-- stands, then with its old expression put back inside a subtransaction, frozen
-- here as it read in production before the contract.

-- DDL inside a loop needs savepoints, which plpgsql cannot issue, so each
-- measurement is a subtransaction of its own, rolled back by raising.
create function pg_temp.measure(p_setup text[], p_probe text)
returns text language plpgsql as $$
declare
  v_person record;
  v_sql text;
  v_out text := '';
begin
  begin
    execute 'reset role';
    foreach v_sql in array coalesce(p_setup, '{}') loop
      execute v_sql;
    end loop;
    for v_person in select * from personas order by label loop
      perform pg_temp.impersonate(v_person.id);
      v_out := v_out || v_person.label || '=' || pg_temp.outcome(p_probe) || '; ';
      execute 'reset role';
    end loop;
    raise exception using errcode = 'P0097', message = v_out;
  exception when sqlstate 'P0097' then
    return sqlerrm;
  end;
end;
$$;

create function pg_temp.frozen_matches(p_policy text, p_frozen text[], p_probe text)
returns boolean language plpgsql as $$
declare
  v_now text := pg_temp.measure(null, p_probe);
  v_frozen text := pg_temp.measure(p_frozen, p_probe);
begin
  if v_now is distinct from v_frozen then
    raise notice E'% differs\n now:    %\n frozen: %', p_policy, v_now, v_frozen;
  end if;
  return v_now = v_frozen;
end;
$$;

select ok(pg_temp.frozen_matches('expenses_select', array[
  $f$alter policy expenses_select on public.expenses using (
     ((outlet_id = (select public.app_counter_shift_outlet())) and is_cash)
     or (public.app_account_active() and ((select public.app_is_owner())
       or (outlet_id in (select public.app_outlets_for('franchise_admin')))
       or ((public.app_has_role_at('biller', outlet_id) or public.app_has_role_at('employee', outlet_id)) and is_cash))))$f$],
  'select 1 from public.expenses'),
  'expenses_select shows every persona the rows the role-by-name policy showed');

select ok(pg_temp.frozen_matches('expenses_insert', array[
  $f$alter policy expenses_insert on public.expenses with check (
     ((outlet_id = (select public.app_counter_shift_outlet())) and is_cash)
     or (public.app_account_active() and (recorded_by = auth.uid()) and ((select public.app_is_owner())
       or (outlet_id in (select public.app_outlets_for('franchise_admin')))
       or ((public.app_has_role_at('biller', outlet_id) or public.app_has_role_at('employee', outlet_id)) and is_cash))))$f$],
  $p$insert into public.expenses (outlet_id, business_date, is_cash, amount_paise, category)
     values ('00000000-0000-4000-a000-000000000001', current_date, true, 5000, 'Vegetables')$p$),
  'expenses_insert admits a cash expense at Kalyani exactly as the role-by-name policy did');

select ok(pg_temp.frozen_matches('expenses_insert', array[
  $f$alter policy expenses_insert on public.expenses with check (
     ((outlet_id = (select public.app_counter_shift_outlet())) and is_cash)
     or (public.app_account_active() and (recorded_by = auth.uid()) and ((select public.app_is_owner())
       or (outlet_id in (select public.app_outlets_for('franchise_admin')))
       or ((public.app_has_role_at('biller', outlet_id) or public.app_has_role_at('employee', outlet_id)) and is_cash))))$f$],
  $p$insert into public.expenses (outlet_id, business_date, is_cash, amount_paise, category)
     values ('00000000-0000-4000-a000-000000000001', current_date, false, 5000, 'Rent')$p$),
  'and a non-cash one');

select ok(pg_temp.frozen_matches('expenses_update', array[
  $f$alter policy expenses_update on public.expenses
     using (public.app_account_active() and ((select public.app_is_owner())
       or (outlet_id in (select public.app_outlets_for('franchise_admin')))
       or ((recorded_by = auth.uid())
           and (public.app_has_role_at('biller', outlet_id) or public.app_has_role_at('employee', outlet_id)) and is_cash)))
     with check (public.app_account_active() and ((select public.app_is_owner())
       or (outlet_id in (select public.app_outlets_for('franchise_admin')))
       or ((recorded_by = auth.uid())
           and (public.app_has_role_at('biller', outlet_id) or public.app_has_role_at('employee', outlet_id)) and is_cash)))$f$],
  'update public.expenses set amount_paise = amount_paise'),
  'expenses_update lets every persona update the rows the role-by-name policy did');

select ok(pg_temp.frozen_matches('expense_categories_insert', array[
  $f$alter policy expense_categories_insert on public.expense_categories with check (
     public.app_account_active() and (created_by = auth.uid()) and ((select public.app_is_owner())
       or exists (select 1 from public.app_outlets_for('franchise_admin'))
       or exists (select 1 from public.app_outlets_for('biller'))
       or exists (select 1 from public.app_outlets_for('employee'))))$f$],
  $p$insert into public.expense_categories (name) values ('Ladder probe')$p$),
  'expense_categories_insert admits a new category exactly as the role-by-name policy did');

select ok(pg_temp.frozen_matches('menu_items_select', array[
  $f$alter policy menu_items_select on public.menu_items using (
     public.app_device_ok() and ((outlet_id = (select public.app_counter_shift_outlet()))
       or (public.app_account_active() and ((select public.app_is_owner())
         or (outlet_id in (select public.app_outlets_for('franchise_admin')))
         or (outlet_id in (select public.app_outlets_for('biller')))))))$f$],
  'select 1 from public.menu_items'),
  'menu_items_select shows every persona the menu the role-by-name policy showed');

select ok(pg_temp.frozen_matches('menu_categories_select', array[
  $f$alter policy menu_categories_select on public.menu_categories using (
     public.app_device_ok() and ((outlet_id = (select public.app_counter_shift_outlet()))
       or (outlet_id = (select public.app_kitchen_shift_outlet()))
       or (public.app_account_active() and ((select public.app_is_owner())
         or (outlet_id in (select public.app_outlets_for('franchise_admin')))
         or (outlet_id in (select public.app_outlets_for('biller')))))))$f$],
  'select 1 from public.menu_categories'),
  'menu_categories_select, likewise');

select ok(pg_temp.frozen_matches('menu_discounts_select', array[
  $f$alter policy menu_discounts_select on public.menu_discounts using (
     public.app_device_ok() and ((outlet_id = (select public.app_counter_shift_outlet()))
       or (public.app_account_active() and ((select public.app_is_owner())
         or (outlet_id in (select public.app_outlets_for('franchise_admin')))
         or (outlet_id in (select public.app_outlets_for('biller')))))))$f$],
  'select 1 from public.menu_discounts'),
  'menu_discounts_select, likewise');

-- profiles_select read `app_may_see_person`, which the contract made a call to
-- its `_v2`, so its old body is put back with it.
select ok(pg_temp.frozen_matches('profiles_select', array[
  $f$create or replace function public.app_may_see_person(person uuid)
     returns boolean language sql stable security definer set search_path = '' as $b$
       select exists (
         select 1
           from public.assignments target
           join public.assignments mine on mine.outlet_id = target.outlet_id
          where target.person_id = person
            and target.ended_on is null
            and mine.person_id = auth.uid()
            and mine.ended_on is null
            and mine.role in ('franchise_admin', 'biller'))
     $b$$f$,
  $f$alter policy profiles_select on public.profiles using (
     public.app_account_active() and public.app_device_ok()
     and ((id = auth.uid()) or (select public.app_is_owner()) or public.app_may_see_person(id)))$f$],
  'select 1 from public.profiles'),
  'profiles_select shows every persona the people the role-by-name policy showed');

select ok(pg_temp.frozen_matches('assignments_insert', array[
  $f$alter policy assignments_insert on public.assignments with check (
     public.app_account_active() and ((select public.app_is_owner())
       or ((role = any (array['biller'::public.app_role, 'employee'::public.app_role]))
           and (outlet_id in (select public.app_outlets_for('franchise_admin'))))))$f$],
  $p$insert into public.assignments (person_id, role, outlet_id, started_on)
     values ('10000000-0000-4000-a000-000000000007', 'employee', '00000000-0000-4000-a000-000000000001', current_date)$p$),
  'assignments_insert admits a staff assignment exactly as the role-by-name policy did');

select ok(pg_temp.frozen_matches('assignments_insert', array[
  $f$alter policy assignments_insert on public.assignments with check (
     public.app_account_active() and ((select public.app_is_owner())
       or ((role = any (array['biller'::public.app_role, 'employee'::public.app_role]))
           and (outlet_id in (select public.app_outlets_for('franchise_admin'))))))$f$],
  $p$insert into public.assignments (person_id, role, outlet_id, started_on)
     values ('10000000-0000-4000-a000-000000000007', 'franchise_admin', '00000000-0000-4000-a000-000000000001', current_date)$p$),
  'and refuses a manager assignment exactly as it did');

select ok(pg_temp.frozen_matches('assignments_update', array[
  $f$alter policy assignments_update on public.assignments
     using (public.app_account_active() and ((select public.app_is_owner())
       or ((role = any (array['biller'::public.app_role, 'employee'::public.app_role]))
           and (outlet_id in (select public.app_outlets_for('franchise_admin'))))))
     with check (public.app_account_active() and ((select public.app_is_owner())
       or ((role = any (array['biller'::public.app_role, 'employee'::public.app_role]))
           and (outlet_id in (select public.app_outlets_for('franchise_admin'))))))$f$],
  'update public.assignments set ended_on = ended_on'),
  'assignments_update lets every persona update the rows the role-by-name policy did');

-- Nothing reads the gate any more, and no twin is left beside its policy.
select is(
  (select count(*)::int from pg_policies
    where coalesce(qual, '') || coalesce(with_check, '') like '%role-includes%'
       or (schemaname = 'public' and policyname like '%\_includes')),
  0,
  'no policy reads the role-includes gate, and every twin is gone');

select is(
  (select count(*)::int from pg_proc
    where pronamespace = 'public'::regnamespace and prosrc like '%role-includes%'),
  0,
  'and no function does');

select ok(
  (select retired_at is not null and not enabled from public.change_gates where key = 'role-includes'),
  'the gate''s row is retired, and off with it');

-- ---------------------------------------------------------------------------
-- 1b. What waited for the cleanup (design D4) answers as before.
--
-- `expense_guard`'s one changed line is the pair of role checks section 0 proves
-- `app_acts_as` answers as; the other two are compared with frozen copies.

create function pg_temp.old_account_actor_may_replace_set(p_actor_id uuid, p_profile_id uuid, p_desired jsonb)
returns boolean language plpgsql stable as $$
declare
  v_actor_is_owner boolean;
  v_actor_managed uuid[];
begin
  if p_actor_id = p_profile_id then return false; end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_actor_id and p.is_active
  ) then return false; end if;
  select exists (
    select 1 from public.assignments a
     where a.person_id = p_actor_id and a.role = 'super_admin' and a.ended_on is null
  ) into v_actor_is_owner;
  if v_actor_is_owner then return true; end if;
  select coalesce(array_agg(a.outlet_id), '{}'::uuid[]) into v_actor_managed
    from public.assignments a
   where a.person_id = p_actor_id and a.role = 'franchise_admin' and a.ended_on is null;
  if cardinality(v_actor_managed) = 0 then return false; end if;
  if exists (
    select 1 from public.assignments a
     where a.person_id = p_profile_id and a.ended_on is null
       and (a.role not in ('employee', 'biller') or a.outlet_id is null
            or not (a.outlet_id = any(v_actor_managed)))
  ) then return false; end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_desired, '[]'::jsonb))
        as wanted("outletId" uuid, role public.app_role)
     where wanted.role not in ('employee', 'biller') or wanted."outletId" is null
        or not (wanted."outletId" = any(v_actor_managed))
  ) then return false; end if;
  return true;
end;
$$;

select is(
  (select count(*)::int
     from personas actor
     cross join personas target
     cross join (
       select '[]'::jsonb as desired
       union all
       select jsonb_build_array(jsonb_build_object('outletId', o, 'role', r))
         from unnest(enum_range(null::public.app_role)) r,
              unnest(array[:'KAL'::uuid, :'KPA'::uuid]) o
     ) d
    where public.account_actor_may_replace_set(actor.id, target.id, d.desired)
          is distinct from pg_temp.old_account_actor_may_replace_set(actor.id, target.id, d.desired)),
  0,
  'account_actor_may_replace_set answers every actor, person and role at either outlet as before');

create function pg_temp.old_app_may_hold_counter_shift(person uuid, outlet uuid)
returns boolean language sql stable as $$
  select exists (select 1 from public.profiles p where p.id = person and p.is_active)
     and exists (
       select 1 from public.assignments a
        where a.person_id = person and a.ended_on is null
          and (a.role = 'super_admin'
               or (a.role in ('biller', 'franchise_admin') and a.outlet_id = outlet)))
$$;

select is(
  (select count(*)::int
     from personas p, unnest(array[:'KAL'::uuid, :'KPA'::uuid]) o
    where public.app_may_hold_counter_shift(p.id, o)
          is distinct from pg_temp.old_app_may_hold_counter_shift(p.id, o)),
  0,
  'app_may_hold_counter_shift answers every persona at either outlet as before');

-- ---------------------------------------------------------------------------
-- 2. The `_v2` functions return what their originals return.

create function pg_temp.same_as_v2(p_v1 text, p_v2 text)
returns text language plpgsql as $$
declare
  v_person record;
  v_a text;
  v_b text;
  v_diffs text := '';
begin
  for v_person in select * from personas order by label loop
    perform pg_temp.impersonate(v_person.id);
    v_a := pg_temp.outcome(p_v1);
    v_b := pg_temp.outcome(p_v2);
    if v_a is distinct from v_b then
      v_diffs := v_diffs || v_person.label || ' (' || v_a || ' / ' || v_b || ') ';
    end if;
    execute 'reset role';
  end loop;
  return v_diffs;
end;
$$;

create function pg_temp.rows_as_text(p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  execute format('select coalesce(string_agg(x::text, %L order by x::text), %L) from (%s) x', ',', '', p_sql)
    into v;
  return v;
exception when others then return 'err:' || sqlstate;
end;
$$;

create function pg_temp.same_rows(p_v1 text, p_v2 text)
returns text language plpgsql as $$
declare
  v_person record;
  v_a text;
  v_b text;
  v_diffs text := '';
begin
  for v_person in select * from personas order by label loop
    perform pg_temp.impersonate(v_person.id);
    v_a := pg_temp.rows_as_text(p_v1);
    v_b := pg_temp.rows_as_text(p_v2);
    if v_a is distinct from v_b then v_diffs := v_diffs || v_person.label || ' '; end if;
    execute 'reset role';
  end loop;
  return v_diffs;
end;
$$;

select is(
  pg_temp.same_as_v2(
    $p$select public.attendance_submit_attempt('a0000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', public.app_business_date(now(), time '04:00'), now(), 22.9750, 88.4345, 12)$p$,
    $p$select public.attendance_submit_attempt_v2('a0000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', public.app_business_date(now(), time '04:00'), now(), 22.9750, 88.4345, 12)$p$),
  '',
  'attendance_submit_attempt_v2 admits and refuses every persona checking in at Kalyani as the original does');

select is(
  pg_temp.same_rows(
    $p$select * from public.attendance_elsewhere(array['00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002']::uuid[], current_date)$p$,
    $p$select * from public.attendance_elsewhere_v2(array['00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002']::uuid[], current_date)$p$),
  '',
  'attendance_elsewhere_v2 returns every persona what the original returns');

select is(
  pg_temp.same_rows('select * from public.expense_people()', 'select * from public.expense_people_v2()'),
  '',
  'expense_people_v2 returns every persona the names the original returns');

select is(
  pg_temp.same_rows(
    'select p.id, public.app_may_see_person(p.id) from public.profiles p',
    'select p.id, public.app_may_see_person_v2(p.id) from public.profiles p'),
  '',
  'app_may_see_person_v2 answers for every persona and person as the original does');

select is(
  pg_temp.same_as_v2(
    $p$select public.attendance_record_manual('a0000000-0000-4000-a000-000000000002', 'a0000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000001', public.app_business_date(now(), time '04:00') - 1, now() - interval '1 day')$p$,
    $p$select public.attendance_record_manual_v2('a0000000-0000-4000-a000-000000000002', 'a0000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000001', public.app_business_date(now(), time '04:00') - 1, now() - interval '1 day')$p$),
  '',
  'attendance_record_manual_v2 admits and refuses every persona entering an Employee''s day as the original does');

select is(
  pg_temp.same_as_v2(
    $p$select public.attendance_record_manual('a0000000-0000-4000-a000-000000000004', 'a0000000-0000-4000-a000-000000000005', '10000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-000000000001', public.app_business_date(now(), time '04:00') - 1, now() - interval '1 day')$p$,
    $p$select public.attendance_record_manual_v2('a0000000-0000-4000-a000-000000000004', 'a0000000-0000-4000-a000-000000000005', '10000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-000000000001', public.app_business_date(now(), time '04:00') - 1, now() - interval '1 day')$p$),
  '',
  'and a Biller''s day');

select is(
  pg_temp.same_as_v2(
    $p$select public.attendance_record_manual('a0000000-0000-4000-a000-000000000006', 'a0000000-0000-4000-a000-000000000007', '10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', public.app_business_date(now(), time '04:00') - 1, now() - interval '1 day')$p$,
    $p$select public.attendance_record_manual_v2('a0000000-0000-4000-a000-000000000006', 'a0000000-0000-4000-a000-000000000007', '10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', public.app_business_date(now(), time '04:00') - 1, now() - interval '1 day')$p$),
  '',
  'and refuses a manager''s day, who is not staff, as the original does');

select is(
  pg_temp.same_as_v2(
    $p$select public.review_billing_attribution(gen_random_uuid(), 'confirmed_original')$p$,
    $p$select public.review_billing_attribution_v2(gen_random_uuid(), 'confirmed_original')$p$),
  '',
  'review_billing_attribution_v2 refuses as the original does; its one changed clause is the at-least-Biller substitution proved in section 0');

-- Each original is now one call to its `_v2`, so the two cannot drift apart.
create function pg_temp.calls_its_v2(p_v1 text)
returns boolean language sql as $$
  select prosrc ~* ('^\s*select (\* from )?public\.' || p_v1 || '_v2\(')
    from pg_proc where proname = p_v1 and pronamespace = 'public'::regnamespace
$$;

select ok(pg_temp.calls_its_v2('attendance_submit_attempt'),
  'attendance_submit_attempt is a call to its _v2');
select ok(pg_temp.calls_its_v2('attendance_record_manual'),
  'attendance_record_manual is a call to its _v2');
select ok(pg_temp.calls_its_v2('attendance_elsewhere'),
  'attendance_elsewhere is a call to its _v2');
select ok(pg_temp.calls_its_v2('expense_people'),
  'expense_people is a call to its _v2');
select ok(pg_temp.calls_its_v2('review_billing_attribution'),
  'review_billing_attribution is a call to its _v2');
select ok(pg_temp.calls_its_v2('app_may_see_person'),
  'app_may_see_person is a call to its _v2');

select * from finish();
rollback;
