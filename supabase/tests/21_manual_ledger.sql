-- Retirement contract for the manual-ledger stopgap.
--
-- Runtime history now has one expense table and one continuous drawer. The
-- source day rows survive only as a client-dark immutable archive.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

select has_table('public', 'expenses',
  'the promoted expense record owns the canonical name');
select has_table('public', 'archived_manual_ledger_days',
  'the notebook day rows survive under an explicit archive name');
select hasnt_table('public', 'manual_ledger_days',
  'the writable notebook day table is gone');
select hasnt_table('public', 'manual_ledger_expenses',
  'the temporary expense table name is gone');
select hasnt_table('public', 'daily_cash_records',
  'the dead close snapshot is gone');
select hasnt_table('public', 'cash_withdrawals',
  'the dead withdrawal table is gone');

select has_column('public', 'drawer_observations', 'is_legacy_imprecise',
  'drawer observations distinguish a carried date with no recorded hour');
select col_type_is('public', 'drawer_observations', 'is_legacy_imprecise', 'boolean',
  'the legacy marker is a boolean catalog fact');
select col_not_null('public', 'drawer_observations', 'is_legacy_imprecise',
  'every observation says explicitly whether its hour is known');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'archived_manual_ledger_days'),
  0::bigint,
  'the archive has no policy');
select ok(
  not has_table_privilege('authenticated', 'public.archived_manual_ledger_days', 'SELECT')
  and not has_table_privilege('authenticated', 'public.archived_manual_ledger_days', 'INSERT')
  and not has_table_privilege('authenticated', 'public.archived_manual_ledger_days', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.archived_manual_ledger_days', 'DELETE'),
  'authenticated clients have no archive privilege');
select throws_ok(
  $$insert into public.archived_manual_ledger_days
      (outlet_id, business_date, recorded_by)
    values ('00000000-0000-4000-a000-000000000001', current_date,
            '10000000-0000-4000-a000-000000000001')$$,
  'P0001', null,
  'even privileged maintenance cannot append to the immutable archive');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'expenses'),
  3::bigint,
  'expenses retain select, insert and update policies after the rename');
select ok(
  has_table_privilege('authenticated', 'public.expenses', 'SELECT')
  and has_table_privilege('authenticated', 'public.expenses', 'INSERT')
  and has_table_privilege('authenticated', 'public.expenses', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.expenses', 'DELETE'),
  'the promoted table retains its exact client verb set');

select has_function('public', 'expense_people', array[]::text[],
  'the promoted expense attribution reader exists');
select hasnt_function('public', 'manual_ledger_people', array[]::text[],
  'the notebook-named attribution reader is gone');
select hasnt_function('public', 'close_business_day',
  'a drawer observation no longer closes a day');
select hasnt_function('public', 'billing_assert_day_ready',
  'billing no longer depends on a close snapshot');
select hasnt_function('public', 'counter_shift_closed_day_guard',
  'the closed-day shift guard is gone');
select hasnt_column('public', 'outlets', 'billing_live_from',
  'the handover flag is gone');

select is(
  coalesce((
    select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f', 'p')
       and pg_get_functiondef(p.oid) ~
         '(manual_ledger_days|manual_ledger_expenses|daily_cash_records|billing_live_from)'
  ), ''),
  '',
  'no live public function names a retired relation or handover flag');

select * from finish();
rollback;
