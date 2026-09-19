-- Rehearse the exact, owner-only production correction helper. Each fixture is
-- cleaned between cases so failures prove atomicity without polluting the next
-- fixture (rolling back a savepoint would also erase pgTAP's test counters).

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- Rehearse against the stable codes that exist in production, rather than
-- accidentally proving only the shorter aliases used by the synthetic seed.
update public.outlets
   set code = case id
     when :'KAL'::uuid then 'skalyani'
     when :'KPA'::uuid then 'skpa'
     else code
   end
 where id in (:'KAL'::uuid, :'KPA'::uuid);

-- Production begins with Kanchrapara holding the non-deferrable partial-unique
-- compatibility marker. Rehearse the two-step handoff used by the migration:
-- setting Kalyani true before clearing Kanchrapara would raise 23505 here.
update public.outlets
   set hyperpure_delivery = false
 where id = :'KAL'::uuid;
update public.outlets
   set hyperpure_delivery = true
 where id = :'KPA'::uuid;
update public.outlets
   set hyperpure_delivery = false
 where hyperpure_delivery
   and id <> :'KAL'::uuid;
update public.outlets
   set hyperpure_delivery = true
 where id = :'KAL'::uuid;

select is(
  (select id from public.outlets where hyperpure_delivery),
  :'KAL'::uuid,
  'the compatibility marker moves through a unique-index-safe two-step handoff');

-- Exact production-shaped boundary: one retained historical row, the named
-- anchor, and a later genuine arrival that must join the bounded correction.
insert into public.expenses
  (id, outlet_id, business_date, category, is_cash, amount_paise, description,
   source_system, source_ref, shared_cost, recorded_by)
values
  ('56000000-0000-4000-a000-000000000001', :'KPA', date '2026-09-15',
   'Hyperpure', false, 90000, 'retained historical order',
   'hyperpure', 'MIGRATION-PRE-15', true, null),
  ('56000000-0000-4000-a000-000000000002', :'KPA', date '2026-09-17',
   'Hyperpure', false, 110129, 'production anchor',
   'hyperpure', 'ZHPWB27-OR-0030242357', true, null),
  ('56000000-0000-4000-a000-000000000003', :'KPA', date '2026-09-18',
   'Hyperpure', false, 220000, 'later arrival before deploy',
   'hyperpure', 'MIGRATION-POST-18', true, null);

select is(
  public.apply_hyperpure_delivery_cutover(),
  jsonb_build_object('rows_moved', 2, 'paise_moved', 330129),
  'the valid production-shaped fixture preserves the bounded count and paise total');

select results_eq(
  $$select id, source_ref, business_date, amount_paise, shared_cost, voided_at
      from public.expenses
     where id in ('56000000-0000-4000-a000-000000000002',
                  '56000000-0000-4000-a000-000000000003')
       and outlet_id = '00000000-0000-4000-a000-000000000001'
     order by id$$,
  $$values
      ('56000000-0000-4000-a000-000000000002'::uuid,
       'ZHPWB27-OR-0030242357'::text, date '2026-09-17', 110129::bigint, true, null::timestamptz),
      ('56000000-0000-4000-a000-000000000003'::uuid,
       'MIGRATION-POST-18'::text, date '2026-09-18', 220000::bigint, true, null::timestamptz)$$,
  'ids, source refs, dates, amounts, shared markers and void state survive exactly');

select is(
  (select outlet_id from public.expenses where source_ref = 'MIGRATION-PRE-15'),
  :'KPA'::uuid,
  'the pre-cutover row remains at Kanchrapara');

select is(
  (select tgenabled from pg_trigger
    where tgrelid = 'public.expenses'::regclass and tgname = 'expenses_guarded'),
  'O'::"char",
  'the expense identity trigger is restored before the correction returns');

alter table public.expenses disable trigger expenses_no_delete;
delete from public.expenses where source_system = 'hyperpure';
alter table public.expenses enable trigger expenses_no_delete;

-- Wrong amount: the helper aborts before moving the row and the caller can see
-- that the entire attempted correction remained unchanged.
insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, source_system,
   source_ref, shared_cost, recorded_by)
values
  (:'KPA', date '2026-09-17', 'Hyperpure', false, 110130,
   'hyperpure', 'ZHPWB27-OR-0030242357', true, null);

select throws_ok(
  $$select public.apply_hyperpure_delivery_cutover()$$,
  'P0001', null,
  'an unexpected anchor amount aborts the correction');
select is(
  (select outlet_id from public.expenses where source_ref = 'ZHPWB27-OR-0030242357'),
  :'KPA'::uuid,
  'the amount mismatch leaves the anchor at its original outlet');
alter table public.expenses disable trigger expenses_no_delete;
delete from public.expenses where source_system = 'hyperpure';
alter table public.expenses enable trigger expenses_no_delete;

-- A hostile test trigger makes one snapshotted update disappear. The helper's
-- count postcondition must abort the entire statement, including the anchor
-- move that did happen before the missing row was noticed.
create function public.test_hyperpure_cutover_skip_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source_ref = 'MIGRATION-SKIP' then
    return null;
  end if;
  return new;
end;
$$;

create trigger test_hyperpure_cutover_skip_row
before update of outlet_id on public.expenses
for each row execute function public.test_hyperpure_cutover_skip_row();

insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, source_system,
   source_ref, shared_cost, recorded_by)
values
  (:'KPA', date '2026-09-17', 'Hyperpure', false, 110129,
   'hyperpure', 'ZHPWB27-OR-0030242357', true, null),
  (:'KPA', date '2026-09-18', 'Hyperpure', false, 2000,
   'hyperpure', 'MIGRATION-SKIP', true, null);

select throws_ok(
  $$select public.apply_hyperpure_delivery_cutover()$$,
  'P0001', null,
  'row-count drift aborts the whole correction');
select is(
  (select count(*) from public.expenses
    where source_system = 'hyperpure' and outlet_id = :'KPA'),
  2::bigint,
  'a row-count failure rolls back every attempted move');

drop trigger test_hyperpure_cutover_skip_row on public.expenses;
drop function public.test_hyperpure_cutover_skip_row();
alter table public.expenses disable trigger expenses_no_delete;
delete from public.expenses where source_system = 'hyperpure';
alter table public.expenses enable trigger expenses_no_delete;

-- A second hostile trigger changes money during the move. Exact snapshot
-- comparison must catch that mutation and restore the original outlet/amount.
create function public.test_hyperpure_cutover_drift_paise()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source_ref = 'MIGRATION-PAISE-DRIFT' then
    new.amount_paise := new.amount_paise + 1;
  end if;
  return new;
end;
$$;

create trigger test_hyperpure_cutover_drift_paise
before update of outlet_id on public.expenses
for each row execute function public.test_hyperpure_cutover_drift_paise();

insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, source_system,
   source_ref, shared_cost, recorded_by)
values
  (:'KPA', date '2026-09-17', 'Hyperpure', false, 110129,
   'hyperpure', 'ZHPWB27-OR-0030242357', true, null),
  (:'KPA', date '2026-09-18', 'Hyperpure', false, 3000,
   'hyperpure', 'MIGRATION-PAISE-DRIFT', true, null);

select throws_ok(
  $$select public.apply_hyperpure_delivery_cutover()$$,
  'P0001', null,
  'paise drift aborts the whole correction');
select results_eq(
  $$select outlet_id, amount_paise
      from public.expenses
     where source_ref = 'MIGRATION-PAISE-DRIFT'$$,
  $$values ('00000000-0000-4000-a000-000000000002'::uuid, 3000::bigint)$$,
  'a paise failure rolls back both attribution and money');

drop trigger test_hyperpure_cutover_drift_paise on public.expenses;
drop function public.test_hyperpure_cutover_drift_paise();
alter table public.expenses disable trigger expenses_no_delete;
delete from public.expenses where source_system = 'hyperpure';
alter table public.expenses enable trigger expenses_no_delete;

insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, source_system,
   source_ref, shared_cost, recorded_by)
values
  (:'KPA', date '2026-09-16', 'Hyperpure', false, 110129,
   'hyperpure', 'ZHPWB27-OR-0030242357', true, null);

select throws_ok(
  $$select public.apply_hyperpure_delivery_cutover()$$,
  'P0001', null,
  'an unexpected anchor date aborts the correction');
select is(
  (select outlet_id from public.expenses where source_ref = 'ZHPWB27-OR-0030242357'),
  :'KPA'::uuid,
  'the date mismatch leaves the anchor at its original outlet');
alter table public.expenses disable trigger expenses_no_delete;
delete from public.expenses where source_system = 'hyperpure';
alter table public.expenses enable trigger expenses_no_delete;

insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, source_system,
   source_ref, shared_cost, recorded_by)
values
  (:'KAL', date '2026-09-17', 'Hyperpure', false, 110129,
   'hyperpure', 'ZHPWB27-OR-0030242357', true, null);

select throws_ok(
  $$select public.apply_hyperpure_delivery_cutover()$$,
  'P0001', null,
  'an unexpected anchor outlet aborts the correction');
select is(
  (select outlet_id from public.expenses where source_ref = 'ZHPWB27-OR-0030242357'),
  :'KAL'::uuid,
  'the outlet mismatch is not silently rewritten');
alter table public.expenses disable trigger expenses_no_delete;
delete from public.expenses where source_system = 'hyperpure';
alter table public.expenses enable trigger expenses_no_delete;

insert into public.expenses
  (outlet_id, business_date, category, is_cash, amount_paise, source_system,
   source_ref, shared_cost, recorded_by)
values
  (:'KPA', date '2026-09-15', 'Hyperpure', false, 1000,
   'hyperpure', 'MIGRATION-DUPLICATE', true, null);

select throws_ok(
  $$insert into public.expenses
      (outlet_id, business_date, category, is_cash, amount_paise, source_system,
       source_ref, shared_cost, recorded_by)
    values
      ('00000000-0000-4000-a000-000000000001', date '2026-09-16',
       'Hyperpure', false, 1000, 'hyperpure', 'MIGRATION-DUPLICATE', true, null)$$,
  '23505', null,
  'a duplicate global Hyperpure identity aborts before any correction can run');
alter table public.expenses disable trigger expenses_no_delete;
delete from public.expenses where source_system = 'hyperpure';
alter table public.expenses enable trigger expenses_no_delete;

select * from finish();
rollback;
