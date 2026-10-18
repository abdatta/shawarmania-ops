-- billing-history-reads-what-it-shows: a page of the day's bills, sorted and
-- filtered by the server, and the day in numbers; and who may read them.
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
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'
\set SHIFT 'cc000000-0000-4000-a000-0000000000f0'
\set TILL_A 'cc000000-0000-4000-a000-0000000000d1'
\set TILL_B 'cc000000-0000-4000-a000-0000000000d2'

select has_function('public', 'billing_history_bills', array['uuid', 'date', 'jsonb', 'integer', 'jsonb'],
  'a page of the day''s bills is one read');
select has_function('public', 'billing_day_numbers', array['uuid', 'date'], 'and the day in numbers another');

-- ── 10 Feb 2025 at Kalyani: one bill of every shape ─────────────────────────
-- Rows are written directly, with triggers and keys held off, because what is
-- under test is how the reads answer, not how the counter writes.
update public.outlets set business_day_cutover = '04:00' where id = :'KAL';
set local session_replication_role = replica;

insert into public.counter_device_history (id, device_id, outlet_id, label, valid_from)
values ('cc000000-0000-4000-a000-0000000000e1', :'TILL_A', :'KAL', 'Till A', '2020-01-01'),
       ('cc000000-0000-4000-a000-0000000000e2', :'TILL_B', :'KAL', 'Till B', '2020-01-01');

create temp table seeded (id uuid, n int, status text, kind text, ordered time, paid time, paise int,
  till uuid, phone text, name text, tier text, service text, entry text);
insert into seeded values
  -- Gold, a number, dine-in, a bill discount, on Till A.
  ('cc000000-0000-4000-a000-000000000001', 901, 'settled', null, '12:00', '12:05', 10000, :'TILL_A', '9876543210', 'Ravi', 'gold', 'dine_in', 'counter'),
  -- A name and no number counts as without; split tender; Till B.
  ('cc000000-0000-4000-a000-000000000002', 902, 'settled', null, '12:10', '12:12', 20000, :'TILL_B', null, 'Asha', null, 'takeaway', 'counter'),
  -- A blank number is no number; a twenty-minute wait; its receipt failed.
  ('cc000000-0000-4000-a000-000000000003', 903, 'settled', null, '12:20', '12:40', 30000, :'TILL_A', '   ', null, null, 'dine_in', 'counter'),
  -- A legacy void, no kind: a manager's cancellation.
  ('cc000000-0000-4000-a000-000000000004', 904, 'void', null, '12:30', '12:31', 4000, :'TILL_B', null, null, null, null, 'counter'),
  ('cc000000-0000-4000-a000-000000000005', 905, 'void', 'cancelled_after_paid', '12:45', '12:50', 6000, :'TILL_A', null, null, null, null, 'counter'),
  ('cc000000-0000-4000-a000-000000000006', 906, 'void', 'counter_unpay', '12:55', '13:00', 7000, :'TILL_A', null, null, null, null, 'counter'),
  -- A paper bill: no tablet, no biller.
  ('cc000000-0000-4000-a000-000000000007', 907, 'settled', null, '13:10', '13:10', 8000, null, null, null, null, null, 'paper'),
  -- Its cash corrected to UPI.
  ('cc000000-0000-4000-a000-000000000008', 908, 'settled', null, '13:15', '13:20', 9000, :'TILL_A', null, null, null, null, 'counter');

insert into public.bills
  (id, outlet_id, bill_number, business_date, payment_business_date, ordered_at, paid_at,
   biller_profile_id, counter_device_id, counter_shift_id, subtotal_paise, total_paise,
   status, void_kind, voided_by, voided_at, void_reason, customer_phone, customer_name,
   customer_tier, service_type, entry_source, entered_by, entered_at, entry_payload_hash)
select s.id, :'KAL'::uuid, s.n, '2025-02-10', '2025-02-10',
       ('2025-02-10 ' || s.ordered || '+05:30')::timestamptz, ('2025-02-10 ' || s.paid || '+05:30')::timestamptz,
       case when s.entry = 'counter' then :'BILLER_KAL'::uuid end, s.till,
       case when s.entry = 'counter' then :'SHIFT'::uuid end, s.paise, s.paise,
       s.status::public.bill_status, s.kind,
       case when s.status = 'void' then :'FA_KAL'::uuid end,
       case when s.status = 'void' then '2025-02-10 14:00+05:30'::timestamptz end,
       case when s.status = 'void' then 'test' end,
       s.phone, s.name, s.tier::public.customer_tier, s.service::public.service_type, s.entry,
       case when s.entry = 'paper' then :'FA_KAL'::uuid end,
       case when s.entry = 'paper' then '2025-02-11 10:00+05:30'::timestamptz end,
       case when s.entry = 'paper' then repeat('a', 64) end
  from seeded s;

-- Another outlet's bill and another day's: never on this page.
insert into public.bills
  (id, outlet_id, bill_number, business_date, payment_business_date, ordered_at, paid_at,
   biller_profile_id, counter_device_id, counter_shift_id, subtotal_paise, total_paise, status)
values
  ('cc000000-0000-4000-a000-000000000009', :'KPA', 909, '2025-02-10', '2025-02-10',
   '2025-02-10 12:00+05:30', '2025-02-10 12:01+05:30', :'BILLER_KAL', :'TILL_A', :'SHIFT', 99900, 99900, 'settled'),
  ('cc000000-0000-4000-a000-00000000000a', :'KAL', 910, '2025-02-09', '2025-02-09',
   '2025-02-09 12:00+05:30', '2025-02-09 12:01+05:30', :'BILLER_KAL', :'TILL_A', :'SHIFT', 88800, 88800, 'settled');

insert into public.bill_payments (bill_id, outlet_id, method, amount_paise)
select s.id, :'KAL'::uuid, case when s.n in (903, 906) then 'upi' else 'cash' end::public.payment_method,
       case when s.n = 902 then 5000 else s.paise end
  from seeded s
union all select 'cc000000-0000-4000-a000-000000000002'::uuid, :'KAL'::uuid, 'upi', 15000
union all select 'cc000000-0000-4000-a000-000000000009'::uuid, :'KPA'::uuid, 'cash', 99900
union all select 'cc000000-0000-4000-a000-00000000000a'::uuid, :'KAL'::uuid, 'cash', 88800;

insert into public.bill_payment_corrections
  (id, command_id, bill_id, outlet_id, device_id, shift_id, actor_id, revision, client_created_at)
values ('cc000000-0000-4000-a000-0000000000c1', 'cc000000-0000-4000-a000-0000000000c2',
        'cc000000-0000-4000-a000-000000000008', :'KAL', :'TILL_A', :'SHIFT', :'BILLER_KAL', 1,
        '2025-02-10 13:25+05:30');
insert into public.bill_payment_correction_allocations (correction_id, outlet_id, method, amount_paise)
values ('cc000000-0000-4000-a000-0000000000c1', :'KAL', 'upi', 9000);

insert into public.bill_discounts (bill_id, outlet_id, basis, value_paise, amount_paise)
values ('cc000000-0000-4000-a000-000000000001', :'KAL', 'amount', 1000, 1000);
insert into public.bill_receipt_deliveries (bill_id, outlet_id, earned_points, balance_points, state)
values ('cc000000-0000-4000-a000-000000000001', :'KAL', 0, 0, 'delivered'),
       ('cc000000-0000-4000-a000-000000000003', :'KAL', 0, 0, 'failed');

-- The day's commands: one refusal at 13:00, then 150 accepted; a refusal after
-- midnight but before the 04:00 cutover belongs to the 10th; one on the 9th and
-- one at 05:00 on the 11th do not.
insert into public.billing_commands
  (id, outlet_id, device_id, shift_id, actor_id, client_created_at, received_at, command_type,
   payload_hash, schema_version, result_category, result)
values
  ('cc000000-0000-4000-a000-0000000000b1', :'KAL', :'TILL_A', :'SHIFT', :'BILLER_KAL', '2025-02-10 13:00+05:30',
   '2025-02-10 13:00+05:30', 'revise_order', repeat('b', 64), 1, 'order_not_open', jsonb_build_object('orderNumber', 77)),
  ('cc000000-0000-4000-a000-0000000000b2', :'KAL', :'TILL_A', :'SHIFT', :'BILLER_KAL', '2025-02-11 02:00+05:30',
   '2025-02-11 02:00+05:30', 'pay_now', repeat('c', 64), 1, 'payment_edit_expired', '{}'),
  ('cc000000-0000-4000-a000-0000000000b3', :'KAL', :'TILL_A', :'SHIFT', :'BILLER_KAL', '2025-02-09 13:00+05:30',
   '2025-02-09 13:00+05:30', 'pay_now', repeat('d', 64), 1, 'order_not_open', '{}'),
  ('cc000000-0000-4000-a000-0000000000b4', :'KAL', :'TILL_A', :'SHIFT', :'BILLER_KAL', '2025-02-11 05:00+05:30',
   '2025-02-11 05:00+05:30', 'pay_now', repeat('e', 64), 1, 'order_not_open', '{}');
insert into public.billing_commands
  (id, outlet_id, device_id, shift_id, actor_id, client_created_at, received_at, command_type,
   payload_hash, schema_version, result_category, result)
select gen_random_uuid(), :'KAL', :'TILL_A', :'SHIFT', :'BILLER_KAL',
       '2025-02-10 13:01+05:30'::timestamptz + g * interval '1 minute',
       '2025-02-10 13:01+05:30'::timestamptz + g * interval '1 minute',
       'pay_now', lpad(to_hex(g), 64, '0'), 1, 'accepted', '{}'
  from generate_series(1, 150) g;

-- Open orders of the 10th: one open, one paid and still cooking; the 9th's left out.
insert into public.orders
  (id, outlet_id, device_id, order_number, business_date, ordered_at, created_by, created_shift_id,
   subtotal_paise, total_paise, status, paid_at, paid_by, paid_shift_id, bill_id)
values
  ('cc000000-0000-4000-a000-0000000000a1', :'KAL', :'TILL_A', 951, '2025-02-10', '2025-02-10 20:00+05:30',
   :'BILLER_KAL', :'SHIFT', 12300, 12300, 'open', null, null, null, null),
  ('cc000000-0000-4000-a000-0000000000a2', :'KAL', :'TILL_A', 952, '2025-02-10', '2025-02-10 20:05+05:30',
   :'BILLER_KAL', :'SHIFT', 4500, 4500, 'paid', '2025-02-10 20:06+05:30', :'BILLER_KAL', :'SHIFT',
   'cc000000-0000-4000-a000-000000000001'),
  ('cc000000-0000-4000-a000-0000000000a3', :'KAL', :'TILL_A', 953, '2025-02-09', '2025-02-09 20:00+05:30',
   :'BILLER_KAL', :'SHIFT', 99900, 99900, 'open', null, null, null, null);

set local session_replication_role = origin;

-- ── The page (design D1) ────────────────────────────────────────────────────
create function pg_temp.numbers(p_filter jsonb) returns int[] language sql as $$
  select coalesce(array_agg((r->>'bill_number')::int order by ord), '{}')
    from jsonb_array_elements(
           (public.billing_history_bills('00000000-0000-4000-a000-000000000001', '2025-02-10', p_filter, 100))->'rows'
         ) with ordinality as x(r, ord)
$$;

select pg_temp.impersonate(:'FA_KAL');
select is(pg_temp.numbers('{}'), array[908, 907, 906, 905, 903, 904, 902, 901],
  'by default every bill of the day, newest payment first, and no other outlet''s or day''s');
select is((public.billing_history_bills(:'KAL', '2025-02-10'))->'matching', '8'::jsonb, 'matching counts the day');

select is(pg_temp.numbers('{"kinds":["cancelled"]}'), array[904], 'a legacy void reads as cancelled');
select is(pg_temp.numbers('{"kinds":["cancelled_after_paid","payment_undone"]}'), array[906, 905],
  'kinds widen within their group');
select is(pg_temp.numbers('{"kinds":["paid"]}'), array[908, 907, 903, 902, 901], 'paid is every bill not cancelled');
select is(pg_temp.numbers('{"tenders":["mixed"]}'), array[902], 'split tender');
select is(pg_temp.numbers('{"tenders":["upi"]}'), array[908, 906, 903],
  'tender is the effective one: a corrected cash bill is UPI');
select is(pg_temp.numbers('{"customer":"with_number"}'), array[901], 'with number');
select is(pg_temp.numbers('{"customer":"without"}'), array[908, 907, 906, 905, 903, 904, 902],
  'without counts a name alone and a blank number');
select is(pg_temp.numbers('{"customer":"gold"}'), array[901], 'gold');
select is(pg_temp.numbers('{"services":["takeaway"]}'), array[902], 'service');
select is(pg_temp.numbers('{"traits":["discount"]}'), array[901], 'had a discount');
select is(pg_temp.numbers('{"traits":["payment_changed"]}'), array[908], 'payment changed');
select is(pg_temp.numbers('{"traits":["receipt_failed"]}'), array[903], 'receipt failed');
select is(pg_temp.numbers('{"traits":["discount","receipt_failed"]}'), array[903, 901], 'traits widen');
select is(pg_temp.numbers('{"tablets":["Till B"]}'), array[904, 902], 'tablet, by its label at payment');
select is(pg_temp.numbers('{"kinds":["paid"],"tenders":["cash"],"tablets":["Till A"]}'), array[901],
  'groups narrow each other');
select is((public.billing_history_bills(:'KAL', '2025-02-10', '{"kinds":["paid"],"tenders":["cash"]}'))->'matching',
  '2'::jsonb, 'matching counts what the filter keeps');
select is(pg_temp.numbers('{"tenders":["cash"],"tablets":["Till B"],"customer":"gold"}'), '{}'::int[],
  'a filter can match nothing');

select is(pg_temp.numbers('{"sort":"paid","descending":false}'), array[901, 902, 904, 903, 905, 906, 907, 908],
  'paid time, oldest first');
select is(pg_temp.numbers('{"sort":"ordered"}'), array[908, 907, 906, 905, 904, 903, 902, 901], 'order time');
select is(pg_temp.numbers('{"sort":"amount"}'), array[903, 902, 901, 908, 907, 906, 905, 904], 'amount, highest');
select is(pg_temp.numbers('{"sort":"amount","descending":false}'), array[904, 905, 906, 907, 908, 901, 902, 903],
  'amount, lowest');
select is(pg_temp.numbers('{"sort":"wait"}'), array[903, 908, 906, 905, 901, 902, 904, 907],
  'wait, longest first, ties by bill number the same way');
select is(pg_temp.numbers('{"sort":"wait","descending":false}'), array[907, 904, 902, 901, 905, 906, 908, 903],
  'wait, shortest first');

select ok(not exists (
  select 1 from jsonb_array_elements((public.billing_history_bills(:'KAL', '2025-02-10', '{}', 100))->'rows') r
   where r ? 'customer_phone' or r ? 'customer_name'
      or r::text like '%9876543210%' or r::text like '%Asha%'),
  'no row carries the customer''s name or phone');
select is(jsonb_array_length((public.billing_history_bills(:'KAL', '2025-02-10', '{}', 1000))->'rows'), 8,
  'the page is capped (at 100), not refused');
select is(jsonb_array_length((public.billing_history_bills(:'KAL', '2025-02-10', '{}', 3))->'rows'), 3,
  'and asks for no more than its limit');
select is((select r->>'till_label' from jsonb_array_elements((public.billing_history_bills(:'KAL', '2025-02-10'))->'rows') r
            where (r->>'bill_number')::int = 907), null, 'a paper bill names no tablet');
select is((select r->'payments' from jsonb_array_elements((public.billing_history_bills(:'KAL', '2025-02-10'))->'rows') r
            where (r->>'bill_number')::int = 908) -> 0 ->> 'method', 'upi', 'a row carries its effective payments');

-- A cursor walk, two at a time, in every sort, meets every bill once.
create function pg_temp.walk(p_filter jsonb, p_size int) returns int[] language plpgsql as $$
declare
  v_after jsonb := null;
  v_page jsonb;
  v_out int[] := '{}';
begin
  loop
    v_page := public.billing_history_bills('00000000-0000-4000-a000-000000000001', '2025-02-10', p_filter, p_size, v_after);
    exit when jsonb_array_length(v_page->'rows') = 0;
    v_out := v_out || array(select (r->>'bill_number')::int from jsonb_array_elements(v_page->'rows') r);
    v_after := (v_page->'rows'->-1)->'cursor';
  end loop;
  return v_out;
end $$;
select is(pg_temp.walk('{}', 2), pg_temp.numbers('{}'), 'pages of two read the day once, in order');
select is(pg_temp.walk('{"sort":"wait"}', 2), pg_temp.numbers('{"sort":"wait"}'),
  'and through the wait''s ties');
select is(pg_temp.walk('{"sort":"amount","descending":false}', 3), pg_temp.numbers('{"sort":"amount","descending":false}'),
  'and ascending');

-- A bill paid between two pages neither repeats nor hides a row.
create temp table first_page as
select public.billing_history_bills(:'KAL', '2025-02-10', '{}', 3) as j;
reset role;
set local session_replication_role = replica;
insert into public.bills
  (id, outlet_id, bill_number, business_date, payment_business_date, ordered_at, paid_at,
   biller_profile_id, counter_device_id, counter_shift_id, subtotal_paise, total_paise, status)
values ('cc000000-0000-4000-a000-00000000000b', :'KAL', 911, '2025-02-10', '2025-02-10',
        '2025-02-10 15:00+05:30', '2025-02-10 15:01+05:30', :'BILLER_KAL', :'TILL_A', :'SHIFT', 1000, 1000, 'settled');
insert into public.bill_payments (bill_id, outlet_id, method, amount_paise)
values ('cc000000-0000-4000-a000-00000000000b', :'KAL', 'cash', 1000);
set local session_replication_role = origin;
select pg_temp.impersonate(:'FA_KAL');
select is(
  array(select (r->>'bill_number')::int from jsonb_array_elements((select j->'rows' from first_page)) r)
  || array(select (r->>'bill_number')::int from jsonb_array_elements(
       (public.billing_history_bills(:'KAL', '2025-02-10', '{}', 100,
          (select (j->'rows'->-1)->'cursor' from first_page)))->'rows') r),
  array[908, 907, 906, 905, 903, 904, 902, 901],
  'the second page starts after the first page''s last row, whatever was paid since');

-- ── The day in numbers (design D2) ──────────────────────────────────────────
-- Bill 911, paid between the pages above, is part of the day from here on.
create temp table d as select public.billing_day_numbers(:'KAL', '2025-02-10') as j;
select is((select (j->>'cashPaise')::bigint from d), 24000::bigint,
  'cash is revenue_figures''s: settled bills only, the corrected bill as UPI, voids left out');
select is((select (j->>'upiPaise')::bigint from d), 54000::bigint, 'UPI likewise, a split bill''s UPI part included');
reset role;
select is((select jsonb_build_object('cash', j->'cashPaise', 'upi', j->'upiPaise') from d),
  (select jsonb_build_object('cash', f->'cashPaise', 'upi', f->'upiPaise')
     from (select public.revenue_figures(:'KAL', '2025-02-10', '2025-02-10') as f) r),
  'and both are exactly what #76''s revenue definition says, as Overview and the Ledger read it');
select pg_temp.impersonate(:'FA_KAL');
select is((select (j->>'settledBills')::int from d), 6, 'settled bills, AOV''s divisor');
select is((select (j->>'bills')::int from d), 9, 'every bill of the day');
select is((select j->'stats' from d), public.billing_day_stats(:'KAL', '2025-02-10'), 'the Stats figures are billing_day_stats''s');
select is((select jsonb_array_length(j->'refusals') from d), 2,
  'the day''s refusals: the 13:00 one after 150 accepted, and the one before the cutover');
select is((select j->'refusals'->1->>'order_number' from d), '77', 'a refusal names its order');
select is((select j->'refusals'->0->>'command_type' from d), 'pay_now', 'newest first');
select ok((select not (j->'refusals')::text like '%payload%' from d), 'and carries no payload');
select is((select (j->>'openOrders')::int from d), 2, 'open orders: open, and paid still cooking, of the day');
select is((select (j->>'unpaidPaise')::bigint from d), 12300::bigint, 'unpaid: the open one only');
select is((select j->'tablets' from d), '["Till A", "Till B"]'::jsonb, 'the day''s tablets, by name');

create temp table past as select public.billing_day_numbers(:'KAL', '2025-02-09') as j;
select is((select j->>'newestCommandAt' from past), (select j->>'newestCommandAt' from d),
  'the newest command is the outlet''s now, whichever day is asked');
select is((select jsonb_array_length(j->'refusals') from past), 1, 'another day reads its own refusals');
select throws_ok($q$select public.billing_day_numbers('00000000-0000-4000-a000-000000000001', null)$q$,
  '22023', null, 'a day must be chosen');

-- ── Authority ───────────────────────────────────────────────────────────────
select is((public.billing_history_bills(:'KPA', '2025-02-10'))->'rows', '[]'::jsonb,
  'a manager asking for another outlet''s rows gets none');
select throws_ok($q$select public.billing_day_numbers('00000000-0000-4000-a000-000000000002', '2025-02-10')$q$,
  '42501', null, 'and is refused its day');
select pg_temp.impersonate(:'OWNER');
select is((public.billing_history_bills(:'KPA', '2025-02-10'))->'matching', '1'::jsonb, 'the owner reads any outlet');
select pg_temp.impersonate(:'BILLER_KAL');
select throws_ok($q$select public.billing_day_numbers('00000000-0000-4000-a000-000000000001', '2025-02-10')$q$,
  '42501', null, 'a biller is refused the day');
select pg_temp.impersonate(:'EMPLOYEE_KAL');
select is((public.billing_history_bills(:'KAL', '2025-02-10'))->'rows', '[]'::jsonb, 'an employee reads no rows');
reset role;
set local role anon;
select throws_ok($q$select public.billing_history_bills('00000000-0000-4000-a000-000000000001', '2025-02-10')$q$,
  '42501', null, 'anonymous may not call the page');
select throws_ok($q$select public.billing_day_numbers('00000000-0000-4000-a000-000000000001', '2025-02-10')$q$,
  '42501', null, 'nor the day');
reset role;

select * from finish();
rollback;
