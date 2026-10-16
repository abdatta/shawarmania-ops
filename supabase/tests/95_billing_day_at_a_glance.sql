-- billing-day-at-a-glance (#78): the day's stats, the in-progress amount on
-- Overview, and who may read them.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.impersonate(p_sub uuid) returns void language plpgsql as $$ begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end; $$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set DEVICE_KAL '10000000-0000-4000-a000-000000000004'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'
\set SHIFT 'bb000000-0000-4000-a000-0000000000f0'
\set K1 'bb000000-0000-4000-a000-0000000000c1'
\set K2 'bb000000-0000-4000-a000-0000000000c2'
\set O1 'bb000000-0000-4000-a000-000000000001'
\set O2 'bb000000-0000-4000-a000-000000000002'
\set O3 'bb000000-0000-4000-a000-000000000003'
\set O4 'bb000000-0000-4000-a000-000000000004'
\set O5 'bb000000-0000-4000-a000-000000000005'

select has_function('public', 'billing_day_stats', array['uuid', 'date'], 'the day''s stats are one read');
select has_function('public', 'overview_today_v2', array['uuid'], 'and Overview''s today has a v2');

-- ── A day nobody traded: 15 Jan 2025 at Kalyani ─────────────────────────────
-- Rows are written directly, with triggers and keys held off, because what is
-- under test is how the read counts them, not how the counter writes them.
set local session_replication_role = replica;

insert into public.orders
  (id, outlet_id, device_id, order_number, business_date, ordered_at, created_at, created_by,
   created_shift_id, subtotal_paise, total_paise, status, prepared_at, prepared_source,
   paid_at, paid_by, paid_shift_id, bill_id, cancelled_at, cancelled_by, cancel_reason)
values
  -- Paid; split between two kitchens, Ready at 12:04 and 12:09; handed over at 12:11.
  (:'O1', :'KAL', :'DEVICE_KAL', 801, '2025-01-15', '2025-01-15 12:00+05:30', '2025-01-15 12:00+05:30',
   :'BILLER_KAL', :'SHIFT', 50000, 50000, 'paid', '2025-01-15 12:11+05:30', 'counter',
   '2025-01-15 12:02+05:30', :'BILLER_KAL', :'SHIFT', 'bb000000-0000-4000-a000-0000000000e1', null, null, null),
  -- Open; its one Ready was undone.
  (:'O2', :'KAL', :'DEVICE_KAL', 802, '2025-01-15', '2025-01-15 12:30+05:30', '2025-01-15 12:30+05:30',
   :'BILLER_KAL', :'SHIFT', 84000, 84000, 'open', null, null, null, null, null, null, null, null, null),
  -- Cancelled.
  (:'O3', :'KAL', :'DEVICE_KAL', 803, '2025-01-15', '2025-01-15 12:40+05:30', '2025-01-15 12:40+05:30',
   :'BILLER_KAL', :'SHIFT', 40000, 40000, 'cancelled', null, null, null, null, null, null,
   '2025-01-15 12:45+05:30', :'BILLER_KAL', 'test'),
  -- Paid; Ready at 13:00, finished by the day change, not by the counter.
  (:'O4', :'KAL', :'DEVICE_KAL', 804, '2025-01-15', '2025-01-15 12:50+05:30', '2025-01-15 12:50+05:30',
   :'BILLER_KAL', :'SHIFT', 30000, 30000, 'paid', '2025-01-16 04:00+05:30', 'day_change',
   '2025-01-15 12:51+05:30', :'BILLER_KAL', :'SHIFT', 'bb000000-0000-4000-a000-0000000000e9', null, null, null),
  -- The day before: never counted on the 15th.
  (:'O5', :'KAL', :'DEVICE_KAL', 805, '2025-01-14', '2025-01-14 21:00+05:30', '2025-01-14 21:00+05:30',
   :'BILLER_KAL', :'SHIFT', 99900, 99900, 'open', null, null, null, null, null, null, null, null, null);

insert into public.kitchen_acknowledgements
  (id, outlet_id, device_id, shift_id, person_id, order_id, order_version, kind, lines, acked_at)
values
  ('bb000000-0000-4000-a000-0000000000a1', :'KAL', :'K1', :'SHIFT', :'BILLER_KAL', :'O1', '2025-01-15 12:00+05:30', 'new', '[]', '2025-01-15 12:01+05:30'),
  ('bb000000-0000-4000-a000-0000000000a2', :'KAL', :'K2', :'SHIFT', :'BILLER_KAL', :'O1', '2025-01-15 12:00+05:30', 'new', '[]', '2025-01-15 12:02+05:30'),
  ('bb000000-0000-4000-a000-0000000000a3', :'KAL', :'K1', :'SHIFT', :'BILLER_KAL', :'O2', '2025-01-15 12:00+05:30', 'new', '[]', '2025-01-15 12:31+05:30');

insert into public.kitchen_readies (id, outlet_id, device_id, shift_id, person_id, order_id, lines, at, undoes)
values
  ('bb000000-0000-4000-a000-0000000000b1', :'KAL', :'K1', :'SHIFT', :'BILLER_KAL', :'O1', '[]', '2025-01-15 12:04+05:30', null),
  ('bb000000-0000-4000-a000-0000000000b2', :'KAL', :'K2', :'SHIFT', :'BILLER_KAL', :'O1', '[]', '2025-01-15 12:09+05:30', null),
  ('bb000000-0000-4000-a000-0000000000b3', :'KAL', :'K1', :'SHIFT', :'BILLER_KAL', :'O2', '[]', '2025-01-15 12:40+05:30', null),
  ('bb000000-0000-4000-a000-0000000000b4', :'KAL', :'K1', :'SHIFT', :'BILLER_KAL', :'O2', '[]', '2025-01-15 12:41+05:30',
   'bb000000-0000-4000-a000-0000000000b3'),
  ('bb000000-0000-4000-a000-0000000000b5', :'KAL', :'K1', :'SHIFT', :'BILLER_KAL', :'O4', '[]', '2025-01-15 13:00+05:30', null);

insert into public.billing_commands
  (id, outlet_id, device_id, shift_id, actor_id, client_created_at, received_at, command_type,
   payload_hash, schema_version, result_category, result)
values
  -- Two edits of O1 count it once; one of O2; a refused edit of O3 counts nothing.
  ('bb000000-0000-4000-a000-0000000000d1', :'KAL', :'DEVICE_KAL', :'SHIFT', :'BILLER_KAL', '2025-01-15 12:03+05:30',
   '2025-01-15 12:03+05:30', 'revise_order', repeat('1', 64), 1, 'accepted', jsonb_build_object('orderId', :'O1')),
  ('bb000000-0000-4000-a000-0000000000d2', :'KAL', :'DEVICE_KAL', :'SHIFT', :'BILLER_KAL', '2025-01-15 12:05+05:30',
   '2025-01-15 12:05+05:30', 'revise_order', repeat('2', 64), 1, 'accepted', jsonb_build_object('orderId', :'O1')),
  ('bb000000-0000-4000-a000-0000000000d3', :'KAL', :'DEVICE_KAL', :'SHIFT', :'BILLER_KAL', '2025-01-15 12:35+05:30',
   '2025-01-15 12:35+05:30', 'revise_order', repeat('3', 64), 1, 'accepted', jsonb_build_object('orderId', :'O2')),
  ('bb000000-0000-4000-a000-0000000000d4', :'KAL', :'DEVICE_KAL', :'SHIFT', :'BILLER_KAL', '2025-01-15 12:45+05:30',
   '2025-01-15 12:45+05:30', 'revise_order', repeat('4', 64), 1, 'order_closed', jsonb_build_object('orderId', :'O3'));

insert into public.bills
  (id, outlet_id, bill_number, business_date, payment_business_date, ordered_at, paid_at,
   biller_profile_id, counter_device_id, counter_shift_id, subtotal_paise, total_paise,
   status, void_kind, voided_by, voided_at, void_reason)
values
  ('bb000000-0000-4000-a000-0000000000e1', :'KAL', 801, '2025-01-15', '2025-01-15', '2025-01-15 12:00+05:30',
   '2025-01-15 12:02+05:30', :'BILLER_KAL', :'DEVICE_KAL', :'SHIFT', 50000, 50000, 'settled', null, null, null, null),
  -- A legacy void with no kind reads as a manager's.
  ('bb000000-0000-4000-a000-0000000000e2', :'KAL', 802, '2025-01-15', '2025-01-15', '2025-01-15 12:10+05:30',
   '2025-01-15 12:11+05:30', :'BILLER_KAL', :'DEVICE_KAL', :'SHIFT', 10000, 10000, 'void', null, :'FA_KAL',
   '2025-01-15 13:00+05:30', 'test'),
  ('bb000000-0000-4000-a000-0000000000e3', :'KAL', 803, '2025-01-15', '2025-01-15', '2025-01-15 12:20+05:30',
   '2025-01-15 12:21+05:30', :'BILLER_KAL', :'DEVICE_KAL', :'SHIFT', 10000, 10000, 'void', 'manager_void', :'FA_KAL',
   '2025-01-15 13:00+05:30', 'test'),
  ('bb000000-0000-4000-a000-0000000000e4', :'KAL', 804, '2025-01-15', '2025-01-15', '2025-01-15 12:25+05:30',
   '2025-01-15 12:26+05:30', :'BILLER_KAL', :'DEVICE_KAL', :'SHIFT', 10000, 10000, 'void', 'cancelled_after_paid',
   :'BILLER_KAL', '2025-01-15 12:27+05:30', 'test'),
  ('bb000000-0000-4000-a000-0000000000e5', :'KAL', 805, '2025-01-15', '2025-01-15', '2025-01-15 12:28+05:30',
   '2025-01-15 12:29+05:30', :'BILLER_KAL', :'DEVICE_KAL', :'SHIFT', 10000, 10000, 'void', 'counter_unpay',
   :'BILLER_KAL', '2025-01-15 12:30+05:30', 'test');

-- Two corrections of one bill count it once.
insert into public.bill_payment_corrections
  (id, command_id, bill_id, outlet_id, device_id, shift_id, actor_id, revision, client_created_at)
values
  ('bb000000-0000-4000-a000-0000000000f1', 'bb000000-0000-4000-a000-0000000000d1', 'bb000000-0000-4000-a000-0000000000e1',
   :'KAL', :'DEVICE_KAL', :'SHIFT', :'BILLER_KAL', 1, '2025-01-15 12:05+05:30'),
  ('bb000000-0000-4000-a000-0000000000f2', 'bb000000-0000-4000-a000-0000000000d2', 'bb000000-0000-4000-a000-0000000000e1',
   :'KAL', :'DEVICE_KAL', :'SHIFT', :'BILLER_KAL', 2, '2025-01-15 12:06+05:30');

set local session_replication_role = origin;

-- ── The figures (design D3) ─────────────────────────────────────────────────
select pg_temp.impersonate(:'FA_KAL');
create temp table s as select public.billing_day_stats(:'KAL', '2025-01-15') as j;
select is((select (j->>'placed')::int from s), 4, 'Placed counts the day''s orders and not the day before''s');
select is((select (j->>'updated')::int from s), 2, 'Updated counts each order once, and no refused edit');
select is((select (j->>'cancelled')::int from s), 1, 'Cancelled');
select is((select (j->>'paid')::int from s), 2, 'Paid');
select is((select (j->>'seen')::int from s), 2, 'Seen counts an order once however many kitchens saw it');
select is((select (j->>'ready')::int from s), 2, 'Ready leaves out an order whose only Ready was undone');
select is((select (j->>'toReadySeconds')::int from s), 540,
  'Avg to ready runs to the second kitchen, and leaves out the day change''s order');
select is((select (j->>'handoverSeconds')::int from s), 120, 'Avg handover runs from the last Ready to Prepared');
select is((select (j->>'billsCancelled')::int from s), 2, 'Bills cancelled includes a legacy void');
select is((select (j->>'cancelledAfterPaid')::int from s), 1, 'Cancelled after paid');
select is((select (j->>'paymentUndone')::int from s), 1, 'Payment undone');
select is((select (j->>'paymentChanged')::int from s), 1, 'Payment changed counts a bill once');

create temp table empty as select public.billing_day_stats(:'KAL', '2025-01-10') as j;
select is((select (j->>'placed')::int from empty), 0, 'a day with nothing reads zero');
select ok((select j->'toReadySeconds' = 'null'::jsonb and j->'handoverSeconds' = 'null'::jsonb from empty),
  'and an average with nothing to average is null, not zero');
select throws_ok($q$select public.billing_day_stats('00000000-0000-4000-a000-000000000001', null)$q$,
  '22023', null, 'a day must be chosen');

-- ── Overview's in-progress amount (design D1) ────────────────────────────────
reset role;
create temp table today_before as
select public.app_business_date(now(), o.business_day_cutover) as d,
       (select coalesce(sum(total_paise), 0) from public.orders x
         where x.outlet_id = o.id and x.status = 'open'
           and x.business_date = public.app_business_date(now(), o.business_day_cutover)) as open_paise
  from public.outlets o where o.id = :'KAL';
set local session_replication_role = replica;
insert into public.orders
  (id, outlet_id, device_id, order_number, business_date, ordered_at, created_by, created_shift_id,
   subtotal_paise, total_paise, status, paid_at, paid_by, paid_shift_id, bill_id,
   cancelled_at, cancelled_by, cancel_reason)
select v.id::uuid, :'KAL'::uuid, :'DEVICE_KAL'::uuid, v.n, t.d + v.back, now(), :'BILLER_KAL'::uuid,
       :'SHIFT'::uuid, v.paise, v.paise, v.status::public.order_status,
       case when v.status = 'paid' then now() end,
       case when v.status = 'paid' then :'BILLER_KAL'::uuid end,
       case when v.status = 'paid' then :'SHIFT'::uuid end,
       case when v.status = 'paid' then 'bb000000-0000-4000-a000-0000000000ea'::uuid end,
       case when v.status = 'cancelled' then now() end,
       case when v.status = 'cancelled' then :'BILLER_KAL'::uuid end,
       case when v.status = 'cancelled' then 'test' end
  from today_before t,
       (values ('bb000000-0000-4000-a000-000000000011', 811, 0, 124000, 'open'),
               -- Paid and still cooking: already revenue, so not in progress.
               ('bb000000-0000-4000-a000-000000000012', 812, 0, 30000, 'paid'),
               ('bb000000-0000-4000-a000-000000000013', 813, 0, 20000, 'cancelled'),
               ('bb000000-0000-4000-a000-000000000014', 814, -1, 77700, 'open'))
         as v(id, n, back, paise, status);
set local session_replication_role = origin;
grant select on today_before to authenticated;

select pg_temp.impersonate(:'OWNER');
create temp table ot as select public.overview_today_v2(:'KAL') as j;
select is((select (j->>'openPaise')::bigint from ot), (select (open_paise + 124000)::bigint from today_before),
  'openPaise is today''s open, unpaid orders: not a paid, a cancelled or yesterday''s order');
select is((select j - 'openPaise' from ot), (select public.overview_today(:'KAL')),
  'and every other figure is overview_today''s');

-- ── Authority ───────────────────────────────────────────────────────────────
select pg_temp.impersonate(:'FA_KAL');
select throws_ok($q$select public.billing_day_stats('00000000-0000-4000-a000-000000000002', '2025-01-15')$q$,
  '42501', null, 'a manager''s crafted request for another outlet''s day is refused');
select throws_ok($q$select public.overview_today_v2('00000000-0000-4000-a000-000000000002')$q$,
  '42501', null, 'and for its in-progress amount');
select pg_temp.impersonate(:'BILLER_KAL');
select throws_ok($q$select public.billing_day_stats('00000000-0000-4000-a000-000000000001', '2025-01-15')$q$,
  '42501', null, 'a biller is refused the day');
select pg_temp.impersonate(:'EMPLOYEE_KAL');
select throws_ok($q$select public.overview_today_v2('00000000-0000-4000-a000-000000000001')$q$,
  '42501', null, 'an employee is refused the in-progress amount');
reset role;
set local role anon;
select throws_ok($q$select public.billing_day_stats('00000000-0000-4000-a000-000000000001', '2025-01-15')$q$,
  '42501', null, 'anonymous is refused');
reset role;

select * from finish();
rollback;
