-- The billing handover flag and close-day guard were scaffolding for the
-- notebook. The continuous drawer makes both concepts unnecessary.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

select hasnt_column('public', 'outlets', 'billing_live_from',
  'outlets no longer carry a counter-billing handover date');
select hasnt_function('public', 'guard_outlet_billing_live_from',
  'the handover-date guard is gone');
select hasnt_function('public', 'manual_ledger_counter_revenue',
  'the notebook revenue bridge is gone');
select hasnt_function('public', 'guard_manual_ledger_counter_revenue',
  'the notebook overlap guard is gone');
select hasnt_function('public', 'counter_shift_closed_day_guard',
  'a counted drawer never closes a business day');

select lives_ok($q$
  insert into public.counter_shifts
    (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at,
     ended_at, ended_reason)
  values
    ('bbbbbbbb-2800-4000-a000-000000000001',
     '10000000-0000-4000-a000-000000000004',
     '00000000-0000-4000-a000-000000000001',
     '10000000-0000-4000-a000-00000000000a',
     timestamptz '2026-08-01 10:00:00+05:30', date '2026-08-01',
     timestamptz '2026-08-01 20:00:00+05:30',
     timestamptz '2026-08-01 20:00:00+05:30', 'operator')
$q$, 'a historical counter shift is no longer blocked by a close snapshot');

select * from finish();
rollback;
