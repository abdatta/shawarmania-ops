-- the-ledger-reads-fast-and-keeps-its-place, round two.
--
-- The payment view was re-created for speed and must mean exactly what it
-- meant: this holds it to the previous definition, written out here, on a bill
-- never corrected, one corrected once and one corrected twice, both as the
-- database and as the owner through RLS. Then the Ledger day's takings, and the
-- delivery log's index.
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

-- Three bills on 5 April 2026, well clear of the seed.
insert into public.bills
  (id, outlet_id, business_date, biller_profile_id, counter_device_id,
   subtotal_paise, discount_paise, total_paise, payment_method, status, created_at)
values
  ('59000000-0000-4000-a000-000000000001', :'KAL', '2026-04-05', :'BILLER_KAL',
   '10000000-0000-4000-a000-000000000004', 10000, 0, 10000, 'cash', 'settled',
   '2026-04-05 12:00:00+05:30'),
  ('59000000-0000-4000-a000-000000000002', :'KAL', '2026-04-05', :'BILLER_KAL',
   '10000000-0000-4000-a000-000000000004', 20000, 0, 20000, 'cash', 'settled',
   '2026-04-05 13:00:00+05:30'),
  ('59000000-0000-4000-a000-000000000003', :'KAL', '2026-04-05', :'BILLER_KAL',
   '10000000-0000-4000-a000-000000000004', 15000, 0, 15000, 'cash', 'settled',
   '2026-04-05 14:00:00+05:30');
insert into public.bill_payments (bill_id, outlet_id, method, amount_paise, created_at) values
  ('59000000-0000-4000-a000-000000000001', :'KAL', 'cash', 10000, '2026-04-05 12:00:00+05:30'),
  ('59000000-0000-4000-a000-000000000002', :'KAL', 'cash', 20000, '2026-04-05 13:00:00+05:30'),
  ('59000000-0000-4000-a000-000000000003', :'KAL', 'cash', 10000, '2026-04-05 14:00:00+05:30'),
  ('59000000-0000-4000-a000-000000000003', :'KAL', 'upi', 5000, '2026-04-05 14:00:00+05:30');

-- Corrections are written only by `correct_bill_payment`, whose guards need a
-- live tablet shift. What is under test is the view's reading of them, so they
-- are placed directly with triggers off, inside this transaction only.
set local session_replication_role = replica;
insert into public.bill_payment_corrections
  (id, command_id, bill_id, outlet_id, device_id, shift_id, actor_id, revision, client_created_at)
values
  ('59100000-0000-4000-a000-000000000002', gen_random_uuid(), '59000000-0000-4000-a000-000000000002',
   :'KAL', '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000001',
   :'BILLER_KAL', 1, '2026-04-05 13:05:00+05:30'),
  ('59100000-0000-4000-a000-000000000031', gen_random_uuid(), '59000000-0000-4000-a000-000000000003',
   :'KAL', '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000001',
   :'BILLER_KAL', 1, '2026-04-05 14:05:00+05:30'),
  ('59100000-0000-4000-a000-000000000032', gen_random_uuid(), '59000000-0000-4000-a000-000000000003',
   :'KAL', '10000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000001',
   :'BILLER_KAL', 2, '2026-04-05 14:10:00+05:30');
insert into public.bill_payment_correction_allocations (correction_id, outlet_id, method, amount_paise) values
  ('59100000-0000-4000-a000-000000000002', :'KAL', 'upi', 20000),
  ('59100000-0000-4000-a000-000000000031', :'KAL', 'cash', 15000),
  ('59100000-0000-4000-a000-000000000032', :'KAL', 'upi', 15000);
set local session_replication_role = origin;

-- The definition this view had before round two, verbatim in meaning.
create function pg_temp.previous_effective(p_bills uuid[])
returns table (bill_id uuid, outlet_id uuid, method public.payment_method, amount_paise bigint, revision integer)
language sql stable as $$
  with latest as (
    select distinct on (bill_id) id, bill_id, outlet_id, revision
      from public.bill_payment_corrections
     order by bill_id, revision desc
  )
  select * from (
    select bp.bill_id, bp.outlet_id, bp.method, bp.amount_paise, 0::integer as revision
      from public.bill_payments bp
     where not exists (select 1 from latest l where l.bill_id = bp.bill_id)
    union all
    select l.bill_id, l.outlet_id, a.method, a.amount_paise, l.revision
      from latest l
      join public.bill_payment_correction_allocations a on a.correction_id = l.id
  ) v where v.bill_id = any(p_bills)
$$;
grant execute on function pg_temp.previous_effective(uuid[]) to authenticated;

\set FIXTURE '{59000000-0000-4000-a000-000000000001,59000000-0000-4000-a000-000000000002,59000000-0000-4000-a000-000000000003}'

select results_eq(
  format($q$select bill_id, outlet_id, method, amount_paise, revision from public.effective_bill_payments
            where bill_id = any(%L::uuid[]) order by bill_id, method$q$, :'FIXTURE'),
  format($q$select * from pg_temp.previous_effective(%L::uuid[]) order by bill_id, method$q$, :'FIXTURE'),
  'the rewritten view returns what the previous definition returned');
select results_eq(
  format($q$select method::text, amount_paise, revision from public.effective_bill_payments
            where bill_id = any(%L::uuid[]) order by bill_id, method$q$, :'FIXTURE'),
  $$values ('cash', 10000::bigint, 0), ('upi', 20000::bigint, 1), ('upi', 15000::bigint, 2)$$,
  'an uncorrected bill keeps its payment, and a corrected one reads its latest revision only');

select pg_temp.impersonate(:'OWNER');
select results_eq(
  format($q$select bill_id, outlet_id, method, amount_paise, revision from public.effective_bill_payments
            where bill_id = any(%L::uuid[]) order by bill_id, method$q$, :'FIXTURE'),
  format($q$select * from pg_temp.previous_effective(%L::uuid[]) order by bill_id, method$q$, :'FIXTURE'),
  'and the same through the owner''s policies');

select pg_temp.impersonate(:'MANAGER_KAL');
select is((select count(*) from public.effective_bill_payments where outlet_id = :'KPA'),
  (select count(*) from pg_temp.previous_effective(
     array(select id from public.bills where outlet_id = :'KPA'))),
  'a Kalyani manager sees what the previous definition showed them of Kanchrapara');

-- ── The Ledger day's takings ─────────────────────────────────────────────────
select pg_temp.impersonate(:'OWNER');
select is(ledger_day_takings(:'KAL', '2026-04-05'),
  '{"cashPaise":10000,"cashBills":1,"upiPaise":35000,"upiBills":2}'::jsonb,
  'the day''s takings read each bill''s latest payment, counted per bill');
select is(ledger_day_takings(:'KAL', '2026-04-06'),
  '{"cashPaise":0,"cashBills":0,"upiPaise":0,"upiBills":0}'::jsonb,
  'a day with no bills takes nothing');

select pg_temp.impersonate(:'MANAGER_KAL');
select lives_ok(format('select ledger_day_takings(%L, %L)', :'KAL', '2026-04-05'),
  'a Franchise Admin reads their own outlet''s takings');
select throws_ok(format('select ledger_day_takings(%L, %L)', :'KPA', '2026-04-05'),
  '42501', 'may not read the ledger at this outlet',
  'another outlet''s takings are refused, not answered as nothing');
select pg_temp.impersonate(:'BILLER_KAL');
select throws_ok(format('select ledger_day_takings(%L, %L)', :'KAL', '2026-04-05'),
  '42501', 'may not read the ledger at this outlet', 'a Biller is refused at their own outlet');

reset role;

-- ── The delivery log's index ─────────────────────────────────────────────────
select has_index('public', 'billing_commands', 'billing_commands_outlet_received_idx',
  array['outlet_id', 'received_at'], 'the delivery log is indexed for "the latest at an outlet"');

select * from finish();
rollback;
