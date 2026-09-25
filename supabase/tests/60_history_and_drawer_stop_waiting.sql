-- the-ledger-reads-fast-and-keeps-its-place, round three.
--
-- Two security-invoker reads replace reads the adapters made by id. Each must
-- return exactly what the reads it replaces returned, and — because RLS is what
-- decides — nothing of an outlet the caller cannot see.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.impersonate(p_sub uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text,true);
  execute 'set local role authenticated';
end $$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set MANAGER_KAL '10000000-0000-4000-a000-000000000002'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- Three bills on 7 April 2026 at Kalyani, one later corrected from cash to UPI,
-- and one at Kanchrapara the same day.
insert into public.bills
  (id, outlet_id, business_date, biller_profile_id, counter_device_id,
   subtotal_paise, discount_paise, total_paise, payment_method, status, created_at)
values
  ('60000000-0000-4000-a000-000000000001', :'KAL', '2026-04-07', :'BILLER_KAL',
   '10000000-0000-4000-a000-000000000004', 10000, 0, 10000, 'cash', 'settled', '2026-04-07 12:00:00+05:30'),
  ('60000000-0000-4000-a000-000000000002', :'KAL', '2026-04-07', :'BILLER_KAL',
   '10000000-0000-4000-a000-000000000004', 20000, 0, 20000, 'cash', 'settled', '2026-04-07 13:00:00+05:30'),
  ('60000000-0000-4000-a000-000000000003', :'KAL', '2026-04-07', :'BILLER_KAL',
   '10000000-0000-4000-a000-000000000004', 15000, 0, 15000, 'upi', 'settled', '2026-04-07 14:00:00+05:30');
insert into public.bill_payments (bill_id, outlet_id, method, amount_paise, created_at) values
  ('60000000-0000-4000-a000-000000000001', :'KAL', 'cash', 10000, '2026-04-07 12:00:00+05:30'),
  ('60000000-0000-4000-a000-000000000002', :'KAL', 'cash', 20000, '2026-04-07 13:00:00+05:30'),
  ('60000000-0000-4000-a000-000000000003', :'KAL', 'upi', 15000, '2026-04-07 14:00:00+05:30');

-- Placed directly with triggers off, inside this transaction only: corrections
-- are written by `correct_bill_payment`, whose guards need a live tablet shift,
-- and what is under test is how they are read.
set local session_replication_role = replica;
insert into public.bill_payment_corrections
  (id, command_id, bill_id, outlet_id, device_id, shift_id, actor_id, revision, client_created_at)
values ('60100000-0000-4000-a000-000000000002', gen_random_uuid(), '60000000-0000-4000-a000-000000000002',
  :'KAL', '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000001',
  :'BILLER_KAL', 1, '2026-04-07 13:05:00+05:30');
insert into public.bill_payment_correction_allocations (correction_id, outlet_id, method, amount_paise)
values ('60100000-0000-4000-a000-000000000002', :'KAL', 'upi', 20000);
set local session_replication_role = origin;

create temp table day_bills on commit drop as
  select id from public.bills where outlet_id = :'KAL' and business_date = '2026-04-07';
grant select on day_bills to authenticated;

-- ── Billing history's day extras ─────────────────────────────────────────────
select pg_temp.impersonate(:'OWNER');
select results_eq(
  $$select (p->>'bill_id')::uuid, p->>'method', (p->>'amount_paise')::bigint, (p->>'revision')::int
      from jsonb_array_elements(public.billing_history_day_extras(
             '00000000-0000-4000-a000-000000000001', '2026-04-07')->'payments') p
     order by 1, 2$$,
  $$select bill_id, method::text, amount_paise, revision from public.effective_bill_payments
     where bill_id in (select id from day_bills) order by 1, 2$$,
  'the day''s payments are the effective payments of the day''s bills, corrections applied');
select results_eq(
  $$select (l->>'event_id')::uuid, l->>'label'
      from jsonb_array_elements(public.billing_history_day_extras(
             '00000000-0000-4000-a000-000000000001', '2026-04-07')->'labels') l
     order by 1$$,
  $$select event_id, label from public.billing_event_device_labels('bill', array(select id from day_bills))
     order by 1$$,
  'the day''s till labels are what the by-id read returns');

select pg_temp.impersonate(:'MANAGER_KAL');
select is(public.billing_history_day_extras(:'KPA', '2026-04-07'),
  '{"labels": [], "payments": []}'::jsonb,
  'a Kalyani manager is told nothing of Kanchrapara''s day');

-- ── The Drawer's recent bills ────────────────────────────────────────────────
select pg_temp.impersonate(:'OWNER');
select results_eq(
  $$select (b->>'id')::uuid, (b->>'cash_paise')::bigint
      from jsonb_array_elements(public.drawer_recent_cash_bills(
             '00000000-0000-4000-a000-000000000001', now())->'nearby') b$$,
  $$select b.id, coalesce((select sum(e.amount_paise) from public.effective_bill_payments e
                            where e.bill_id = b.id and e.method = 'cash'), 0)::bigint
      from public.bills b
     where b.outlet_id = '00000000-0000-4000-a000-000000000001' and b.status = 'settled'
     order by b.paid_at desc limit 40$$,
  'the recent bills are the forty newest settled, each with its effective cash');
select results_eq(
  $$select (b->>'id')::uuid, (b->>'cash_paise')::bigint
      from jsonb_array_elements(public.drawer_recent_cash_bills(
             '00000000-0000-4000-a000-000000000001', now())->'nearby') b
     where (b->>'id')::uuid in ('60000000-0000-4000-a000-000000000001',
                                '60000000-0000-4000-a000-000000000002')
     order by 1$$,
  $$values ('60000000-0000-4000-a000-000000000001'::uuid, 10000::bigint),
           ('60000000-0000-4000-a000-000000000002'::uuid, 0::bigint)$$,
  'a bill corrected from cash to UPI carries no cash; an uncorrected one keeps its cash');
select results_eq(
  $$select (b->>'id')::uuid
      from jsonb_array_elements(public.drawer_recent_cash_bills(
             '00000000-0000-4000-a000-000000000001', '2026-04-01')->'late') b$$,
  $$select b.id from public.bills b
     where b.outlet_id = '00000000-0000-4000-a000-000000000001' and b.status = 'settled'
       and b.synced_at > '2026-04-01' order by b.paid_at desc limit 40$$,
  'the late bills are the forty newest settled that synced after the given instant');

select pg_temp.impersonate(:'MANAGER_KAL');
select is(public.drawer_recent_cash_bills(:'KPA', now()),
  '{"late": [], "nearby": []}'::jsonb,
  'a Kalyani manager is told nothing of Kanchrapara''s bills');

reset role;

-- ── The indexes ──────────────────────────────────────────────────────────────
select has_index('public', 'orders', 'orders_pipeline_idx', array['outlet_id', 'ordered_at'],
  'the pipeline read has an index holding only pipeline orders');
select has_index('public', 'bills', 'bills_settled_recent_idx', array['outlet_id', 'paid_at'],
  'settled bills are indexed newest first per outlet');

select * from finish();
rollback;
