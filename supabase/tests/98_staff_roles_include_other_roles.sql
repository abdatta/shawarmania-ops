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
--   2. Each policy twin ALONE, with its original dropped inside a savepoint,
--      admits exactly what the original alone admits, for every persona.
--   3. Each `_v2` a build calls returns what its original returns.
--
-- With the gate off the twins admit nothing, so the off path is today's.

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

-- ---------------------------------------------------------------------------
-- 1. Policies: each twin alone admits what its original alone admits.

update public.change_gates set enabled = true where key = 'role-includes';

-- DDL inside a loop needs savepoints, which plpgsql cannot issue, so each
-- policy is measured with two subtransactions of its own: one where the twin is
-- dropped (the original alone) and one where the original is (the twin alone).
create function pg_temp.measure(p_table text, p_drop text, p_probe text)
returns text language plpgsql as $$
declare
  v_person record;
  v_out text := '';
begin
  begin
    execute 'reset role';
    execute format('drop policy %I on public.%I', p_drop, p_table);
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

create function pg_temp.twin_matches(p_table text, p_policy text, p_probe text)
returns boolean language plpgsql as $$
declare
  v_original text := pg_temp.measure(p_table, p_policy || '_includes', p_probe);
  v_twin text := pg_temp.measure(p_table, p_policy, p_probe);
begin
  if v_original is distinct from v_twin then
    raise notice E'% differs\n original: %\n twin:     %', p_policy, v_original, v_twin;
  end if;
  return v_original = v_twin;
end;
$$;

select ok(pg_temp.twin_matches('expenses', 'expenses_select',
  'select 1 from public.expenses'),
  'expenses_select_includes alone shows every persona the rows the original shows');

select ok(pg_temp.twin_matches('expenses', 'expenses_insert',
  $p$insert into public.expenses (outlet_id, business_date, is_cash, amount_paise, category)
     values ('00000000-0000-4000-a000-000000000001', current_date, true, 5000, 'Vegetables')$p$),
  'expenses_insert_includes alone admits a cash expense at Kalyani exactly as the original does');

select ok(pg_temp.twin_matches('expenses', 'expenses_insert',
  $p$insert into public.expenses (outlet_id, business_date, is_cash, amount_paise, category)
     values ('00000000-0000-4000-a000-000000000001', current_date, false, 5000, 'Rent')$p$),
  'and a non-cash one');

select ok(pg_temp.twin_matches('expenses', 'expenses_update',
  'update public.expenses set amount_paise = amount_paise'),
  'expenses_update_includes alone lets every persona update the rows the original does');

select ok(pg_temp.twin_matches('expense_categories', 'expense_categories_insert',
  $p$insert into public.expense_categories (name) values ('Ladder probe')$p$),
  'expense_categories_insert_includes alone admits a new category exactly as the original does');

select ok(pg_temp.twin_matches('menu_items', 'menu_items_select',
  'select 1 from public.menu_items'),
  'menu_items_select_includes alone shows every persona the menu the original shows');

select ok(pg_temp.twin_matches('menu_categories', 'menu_categories_select',
  'select 1 from public.menu_categories'),
  'menu_categories_select_includes alone, likewise');

select ok(pg_temp.twin_matches('menu_discounts', 'menu_discounts_select',
  'select 1 from public.menu_discounts'),
  'menu_discounts_select_includes alone, likewise');

select ok(pg_temp.twin_matches('profiles', 'profiles_select',
  'select 1 from public.profiles'),
  'profiles_select_includes alone shows every persona the people the original shows');

select ok(pg_temp.twin_matches('assignments', 'assignments_insert',
  $p$insert into public.assignments (person_id, role, outlet_id, started_on)
     values ('10000000-0000-4000-a000-000000000007', 'employee', '00000000-0000-4000-a000-000000000001', current_date)$p$),
  'assignments_insert_includes alone admits a staff assignment exactly as the original does');

select ok(pg_temp.twin_matches('assignments', 'assignments_insert',
  $p$insert into public.assignments (person_id, role, outlet_id, started_on)
     values ('10000000-0000-4000-a000-000000000007', 'franchise_admin', '00000000-0000-4000-a000-000000000001', current_date)$p$),
  'and refuses a manager assignment exactly as the original does');

select ok(pg_temp.twin_matches('assignments', 'assignments_update',
  'update public.assignments set ended_on = ended_on'),
  'assignments_update_includes alone lets every persona update the rows the original does');

-- With the gate off, no twin admits anything.
update public.change_gates set enabled = false where key = 'role-includes';

create function pg_temp.twin_alone_with_gate_off(p_table text, p_policy text)
returns bigint language plpgsql as $$
declare
  v_seen bigint := 0;
  v_n bigint;
  v_person record;
begin
  begin
    execute 'reset role';
    execute format('drop policy %I on public.%I', p_policy, p_table);
    for v_person in select * from personas loop
      perform pg_temp.impersonate(v_person.id);
      execute format('select count(*) from public.%I', p_table) into v_n;
      v_seen := v_seen + v_n;
      execute 'reset role';
    end loop;
    raise exception using errcode = 'P0096', message = v_seen::text;
  exception when sqlstate 'P0096' then
    return sqlerrm::bigint;
  end;
end;
$$;

select is(pg_temp.twin_alone_with_gate_off('expenses', 'expenses_select'), 0::bigint,
  'with the gate off, expenses_select_includes alone shows nobody anything');
select is(pg_temp.twin_alone_with_gate_off('menu_items', 'menu_items_select'), 0::bigint,
  'with the gate off, menu_items_select_includes alone shows nobody anything');
select is(pg_temp.twin_alone_with_gate_off('profiles', 'profiles_select'), 0::bigint,
  'with the gate off, profiles_select_includes alone shows nobody anything');

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

-- Each _v2 differs from its original only in the role comparison. A body that
-- grew any other difference would show here as more than the expected lines.
create function pg_temp.changed_lines(p_v1 text, p_v2 text)
returns integer language sql as $$
  select count(*)::int from (
    select line from unnest(string_to_array(
      (select prosrc from pg_proc where proname = p_v2 and pronamespace = 'public'::regnamespace), E'\n')) line
    except all
    select line from unnest(string_to_array(
      (select prosrc from pg_proc where proname = p_v1 and pronamespace = 'public'::regnamespace), E'\n')) line
  ) s
$$;

select is(pg_temp.changed_lines('attendance_submit_attempt', 'attendance_submit_attempt_v2'), 1,
  'attendance_submit_attempt_v2 changes one line of its original');
select is(pg_temp.changed_lines('attendance_record_manual', 'attendance_record_manual_v2'), 2,
  'attendance_record_manual_v2 changes its two role lines and nothing else');
select is(pg_temp.changed_lines('attendance_elsewhere', 'attendance_elsewhere_v2'), 1,
  'attendance_elsewhere_v2 changes one line');
select is(pg_temp.changed_lines('expense_people', 'expense_people_v2'), 1,
  'expense_people_v2 changes one line');
select is(pg_temp.changed_lines('review_billing_attribution', 'review_billing_attribution_v2'), 1,
  'review_billing_attribution_v2 changes one line');
select is(pg_temp.changed_lines('app_may_see_person', 'app_may_see_person_v2'), 1,
  'app_may_see_person_v2 changes one line');

select * from finish();
rollback;
