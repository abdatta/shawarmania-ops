-- Billing transaction contract: orders are editable working state, payment is
-- the only path to a permanent bill number, and every mutation is one exact,
-- replayable database command.

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

create function pg_temp.order_payload(
  p_order_id uuid,
  p_line_id uuid,
  p_business_date date,
  p_total bigint default 13900
)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'orderId', p_order_id,
    'businessDate', p_business_date,
    'customerId', null,
    'customerName', null,
    'customerPhone', null,
    'subtotalPaise', p_total,
    'discountPaise', 0,
    'taxPaise', 0,
    'totalPaise', p_total,
    'pricingMode', 'no_tax',
    'lines', jsonb_build_array(jsonb_build_object(
      'id', p_line_id,
      'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma',
      'unitPricePaise', 13900,
      'quantity', 1,
      'lineTotalPaise', p_total
    ))
  )
$$;

create function pg_temp.pay_order_payload(
  p_bill_id uuid,
  p_order_id uuid,
  p_paid_at timestamptz,
  p_payment_business_date date
)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'billId', p_bill_id,
    'orderId', p_order_id,
    'payments', jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13900)),
    'paidAt', p_paid_at,
    'paymentBusinessDate', p_payment_business_date
  )
$$;

create function pg_temp.pay_now_payload(
  p_bill_id uuid,
  p_business_date date,
  p_paid_at timestamptz,
  p_payment_business_date date,
  p_line_id uuid default gen_random_uuid()
)
returns jsonb language sql volatile as $$
  select jsonb_build_object(
    'billId', p_bill_id,
    'businessDate', p_business_date,
    'paymentBusinessDate', p_payment_business_date,
    'customerId', null,
    'customerName', null,
    'customerPhone', null,
    'subtotalPaise', 13900,
    'discountPaise', 0,
    'taxPaise', 0,
    'totalPaise', 13900,
    'pricingMode', 'no_tax',
    'payments', jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13900)),
    'lines', jsonb_build_array(jsonb_build_object(
      'id', p_line_id,
      'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma',
      'unitPricePaise', 13900,
      'quantity', 1,
      'lineTotalPaise', 13900
    ))
  )
$$;

select has_table('public', 'orders', 'orders exist');
select has_table('public', 'order_items', 'order items exist');
select has_table('public', 'billing_commands', 'compact command receipts exist');
select has_table('public', 'billing_end_of_day_confirmations',
  'end-of-day confirmations exist');
select has_function('public', 'create_billing_order',
  array['uuid','integer','text','timestamp with time zone','uuid','jsonb'],
  'create-order command has the settled envelope signature');
select has_function('public', 'pay_billing_order',
  array['uuid','integer','text','timestamp with time zone','uuid','jsonb'],
  'pay-order command has the settled envelope signature');
select has_function('public', 'pay_billing_now',
  array['uuid','integer','text','timestamp with time zone','uuid','jsonb'],
  'pay-now command has the settled envelope signature');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('create_billing_order','revise_billing_order',
        'cancel_billing_order','pay_billing_order','pay_billing_now',
        'correct_bill_payment',
        'void_billing_bill','manager_cancel_billing_order','confirm_billing_end_of_day')
      and p.pronargdefaults=6),
  9::bigint,
  'all nine command RPCs default every argument so omitted keys classify cleanly');

select is(
  coalesce((select string_agg(attname, ', ' order by attname)
    from pg_attribute where attrelid='public.billing_commands'::regclass
      and attnum>0 and not attisdropped
      and (attname like '%customer%' or attname like '%phone%'
        or attname like '%line%' or attname='payload')), ''),
  '',
  'command receipts carry no customer or line payload columns');

select is(
  public.billing_payload_hash('{"b":null,"a":1}'::jsonb),
  '46e0ff59f6164548317489fbea1133a48f7a83c325c3535e44559c9619afb76b',
  'PostgreSQL canonical hashing matches the shared TypeScript vector');

-- Missing optional RPC keys still resolve to a function and are classified as
-- malformed. This is the regression that undefined command arguments exposed.
select is(
  public.create_billing_order() ->> 'status',
  'malformed_payload',
  'an omitted declared key is malformed rather than an unknown RPC');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

-- Create one open order on the seeded live tablet shift.
select is(
  public.create_billing_order(
    'a1000000-0000-4000-a000-000000000001', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000001',
      'a3000000-0000-4000-a000-000000000001',
      public.app_business_date(now(), time '04:00'))),
    now(), '90000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000001',
      'a3000000-0000-4000-a000-000000000001',
      public.app_business_date(now(), time '04:00'))
  ) ->> 'status',
  'accepted',
  'a valid create-order command lands atomically');

select is(
  (select order_number from public.orders
    where id = 'a2000000-0000-4000-a000-000000000001'),
  1::bigint,
  'the first order gets daily order number 1');

select is(
  (select count(*) from public.order_items
    where order_id = 'a2000000-0000-4000-a000-000000000001'),
  1::bigint,
  'its parent and captured line commit together');

reset role;
select is(
  (select last_number from public.bill_number_counters
    where outlet_id = '00000000-0000-4000-a000-000000000001'),
  9::bigint,
  'creating an order consumes no permanent bill number');

-- Revision preserves the original snapshot even after the live menu changes.
update public.menu_items
   set name = 'Renamed after capture', price_paise = 14900
 where id = '31000000-0000-4000-a000-000000000001';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select is(
  public.revise_billing_order(
    'a1000000-0000-4000-a000-000000000002', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000001',
      'a3000000-0000-4000-a000-000000000001',
      public.app_business_date(now(), time '04:00'))),
    now(), '90000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000001',
      'a3000000-0000-4000-a000-000000000001',
      public.app_business_date(now(), time '04:00'))
  ) ->> 'status',
  'accepted',
  'the owning tablet may revise an open order');

select is(
  (select item_name || ':' || unit_price_paise
     from public.order_items
    where id = 'a3000000-0000-4000-a000-000000000001'),
  'Classic Chicken Shawarma:13900',
  'an existing line keeps its captured name and price');

-- Return the synthetic live menu to its seeded value. The assertion above has
-- proved the historical line did not move; later pay-now commands should now
-- validate against the price a newly added line actually sees.
reset role;
update public.menu_items
   set name = 'Classic Chicken Shawarma', price_paise = 13900
 where id = '31000000-0000-4000-a000-000000000001';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

-- Pay the order and prove both clocks and the final snapshots.
select is(
  public.pay_billing_order(
    'a1000000-0000-4000-a000-000000000003', 1,
    public.billing_payload_hash(pg_temp.pay_order_payload(
      'a4000000-0000-4000-a000-000000000001',
      'a2000000-0000-4000-a000-000000000001', now(),
      public.app_business_date(now(), time '04:00'))),
    now(), '90000000-0000-4000-a000-000000000001',
    pg_temp.pay_order_payload(
      'a4000000-0000-4000-a000-000000000001',
      'a2000000-0000-4000-a000-000000000001', now(),
      public.app_business_date(now(), time '04:00'))
  ) ->> 'status',
  'accepted',
  'paying an open order creates its immutable bill');

select is(
  (select status::text from public.orders
    where id = 'a2000000-0000-4000-a000-000000000001'),
  'paid',
  'the source order becomes paid');

select is(
  (select item_name || ':' || unit_price_paise from public.bill_items
    where bill_id = 'a4000000-0000-4000-a000-000000000001'),
  'Classic Chicken Shawarma:13900',
  'the bill copies the captured order snapshot, not the changed menu');

select is(
  (select bill_number from public.bills
    where id = 'a4000000-0000-4000-a000-000000000001'),
  10::bigint,
  'only successful payment consumes the next permanent bill number');

select is(
  public.revise_billing_order(
    'a1000000-0000-4000-a000-000000000004', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000001',
      'a3000000-0000-4000-a000-000000000001',
      public.app_business_date(now(), time '04:00'))),
    now(), '90000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000001',
      'a3000000-0000-4000-a000-000000000001',
      public.app_business_date(now(), time '04:00'))
  ) ->> 'status',
  'order_not_open',
  'paid orders refuse revision at lock time');

-- Pay-now uses the same bill shape and exact replay returns the same result.
create temp table pg_temp.command_values (name text primary key, value jsonb);
insert into pg_temp.command_values values (
  'pay_now_payload',
  pg_temp.pay_now_payload(
    'a4000000-0000-4000-a000-000000000002',
    public.app_business_date(now(), time '04:00'), now(),
    public.app_business_date(now(), time '04:00'),
    'a3000000-0000-4000-a000-000000000002'));

insert into pg_temp.command_values values (
  'pay_now_result',
  public.pay_billing_now(
    'a1000000-0000-4000-a000-000000000005', 1,
    public.billing_payload_hash((select value from pg_temp.command_values
      where name = 'pay_now_payload')),
    clock_timestamp(), '90000000-0000-4000-a000-000000000001',
    (select value from pg_temp.command_values where name = 'pay_now_payload')));

select is(
  (select value ->> 'status' from pg_temp.command_values where name = 'pay_now_result'),
  'accepted',
  'pay-now is accepted');

select is(
  public.pay_billing_now(
    'a1000000-0000-4000-a000-000000000005', 1,
    public.billing_payload_hash((select value from pg_temp.command_values
      where name = 'pay_now_payload')),
    now(), '90000000-0000-4000-a000-000000000001',
    (select value from pg_temp.command_values where name = 'pay_now_payload')) ->> 'status',
  'identity_conflict',
  'changing immutable envelope creation time conflicts even with the same payload');

-- Replay with the exact stored creation time.
select is(
  public.pay_billing_now(
    'a1000000-0000-4000-a000-000000000005', 1,
    public.billing_payload_hash((select value from pg_temp.command_values
      where name = 'pay_now_payload')),
    (select client_created_at from public.billing_commands
      where id = 'a1000000-0000-4000-a000-000000000005'),
    '90000000-0000-4000-a000-000000000001',
    (select value from pg_temp.command_values where name = 'pay_now_payload')) ->> 'status',
  'replay',
  'an exact retry is classified as replay');

select is(
  (select count(*) from public.bills
    where id = 'a4000000-0000-4000-a000-000000000002'),
  1::bigint,
  'the exact retry lands one bill');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
insert into pg_temp.command_values values (
  'split_payload',
  pg_temp.pay_now_payload(
    'a4000000-0000-4000-a000-000000000042',
    public.app_business_date(now(),time '04:00'),now(),
    public.app_business_date(now(),time '04:00'),
    'a3000000-0000-4000-a000-000000000042')
  || jsonb_build_object('payments',jsonb_build_array(
    jsonb_build_object('method','cash','amountPaise',10000),
    jsonb_build_object('method','upi','amountPaise',3900))));
select is(public.pay_billing_now(
  'a1000000-0000-4000-a000-000000000042',1,
  public.billing_payload_hash((select value from pg_temp.command_values where name='split_payload')),
  now(),'90000000-0000-4000-a000-000000000001',
  (select value from pg_temp.command_values where name='split_payload'))->>'status',
  'accepted','a bill accepts an exact split across two tender methods');
reset role;
select ok((select payment_method is null from public.bills
  where id='a4000000-0000-4000-a000-000000000042'),
  'a mixed bill does not pretend one tender was the whole payment');
select results_eq(
  $$select method::text,amount_paise from public.bill_payments
    where bill_id='a4000000-0000-4000-a000-000000000042' order by method::text$$,
  $$values ('cash',10000::bigint),('upi',3900::bigint)$$,
  'split allocations preserve each exact paise amount');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(public.pay_billing_now(
  'a1000000-0000-4000-a000-000000000043',1,
  public.billing_payload_hash(pg_temp.pay_now_payload(
    'a4000000-0000-4000-a000-000000000043',
    public.app_business_date(now(),time '04:00'),now(),
    public.app_business_date(now(),time '04:00'),
    'a3000000-0000-4000-a000-000000000043')
    || jsonb_build_object('payments',jsonb_build_array(
      jsonb_build_object('method','cash','amountPaise',13899)))),
  now(),'90000000-0000-4000-a000-000000000001',
  pg_temp.pay_now_payload(
    'a4000000-0000-4000-a000-000000000043',
    public.app_business_date(now(),time '04:00'),now(),
    public.app_business_date(now(),time '04:00'),
    'a3000000-0000-4000-a000-000000000043')
    || jsonb_build_object('payments',jsonb_build_array(
      jsonb_build_object('method','cash','amountPaise',13899)) ))->>'status',
  'arithmetic_invalid','an under-allocated payment creates no bill');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is(
  public.void_billing_bill(
    'a1000000-0000-4000-a000-000000000010', 1,
    public.billing_payload_hash(jsonb_build_object(
      'billId', 'a4000000-0000-4000-a000-000000000002',
      'reason', 'Attributed contract-test void')),
    clock_timestamp(), null,
    jsonb_build_object(
      'billId', 'a4000000-0000-4000-a000-000000000002',
      'reason', 'Attributed contract-test void')) ->> 'status',
  'accepted',
  'the outlet FA voids through the attributed command');
reset role;
select is(
  (select status::text || ':' || total_paise from public.bills
    where id = 'a4000000-0000-4000-a000-000000000002'),
  'void:13900',
  'voiding preserves every settled amount');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select is(
  (select to_jsonb(b) - array['id','bill_number','order_id','ordered_at','paid_at',
      'created_at','synced_at','status','voided_by','voided_at','void_reason']
     from public.bills b where id = 'a4000000-0000-4000-a000-000000000001'),
  (select to_jsonb(b) - array['id','bill_number','order_id','ordered_at','paid_at',
      'created_at','synced_at','status','voided_by','voided_at','void_reason']
     from public.bills b where id = 'a4000000-0000-4000-a000-000000000002'),
  'pay-order and pay-now persist identical immutable bill facts');

-- Bad arithmetic is atomic and consumes no number or receipt.
insert into pg_temp.command_values values (
  'bad_payload',
  pg_temp.pay_now_payload(
    'a4000000-0000-4000-a000-000000000003',
    public.app_business_date(now(), time '04:00'), now(),
    public.app_business_date(now(), time '04:00'),
    'a3000000-0000-4000-a000-000000000003')
    || jsonb_build_object('totalPaise', 1));

select is(
  public.pay_billing_now(
    'a1000000-0000-4000-a000-000000000006', 1,
    public.billing_payload_hash((select value from pg_temp.command_values where name = 'bad_payload')),
    now(), '90000000-0000-4000-a000-000000000001',
    (select value from pg_temp.command_values where name = 'bad_payload')) ->> 'status',
  'arithmetic_invalid',
  'aggregate arithmetic failure is classified without a partial bill');

select is((select count(*) from public.bills
  where id = 'a4000000-0000-4000-a000-000000000003'), 0::bigint,
  'the failed parent/line command leaves no bill');
reset role;
select is((select last_number from public.bill_number_counters
  where outlet_id = '00000000-0000-4000-a000-000000000001'), 12::bigint,
  'failed arithmetic consumes no number');

-- Direct money-table writes have no client privilege.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select throws_ok($q$
  insert into public.orders (id) values (gen_random_uuid())
$q$, '42501', null, 'the tablet cannot insert orders directly');
select throws_ok($q$
  insert into public.bills (id) values (gen_random_uuid())
$q$, '42501', null, 'the tablet cannot insert bills directly');
select throws_ok($q$
  delete from public.order_items
$q$, '42501', null, 'the tablet cannot delete order lines directly');

-- Another outlet's tablet cannot see or operate on this order.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000005');
select is((select count(*) from public.orders
  where id = 'a2000000-0000-4000-a000-000000000001'), 0::bigint,
  'another outlet cannot read a known order UUID');

-- An ordinary Employee cannot use the manager cancellation command.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select is(
  public.manager_cancel_billing_order(
    'a1000000-0000-4000-a000-000000000007', 1,
    public.billing_payload_hash(jsonb_build_object(
      'orderId', 'a2000000-0000-4000-a000-000000000001', 'reason', 'No')),
    now(), null,
    jsonb_build_object('orderId', 'a2000000-0000-4000-a000-000000000001', 'reason', 'No')) ->> 'status',
  'authorization_refused',
  'an Employee cannot manager-cancel an order');

-- Historical shifts straddling cutover prove daily order numbering and the two clocks.
reset role;
insert into public.counter_shifts
  (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at,
   ended_at, ended_reason)
values
  ('a5000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-000000000009',
   '00000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-00000000000a',
   ((current_date - 10) + time '03:30') at time zone 'Asia/Kolkata',
   current_date - 11,
   ((current_date - 10) + time '04:00') at time zone 'Asia/Kolkata',
   ((current_date - 10) + time '04:00') at time zone 'Asia/Kolkata', 'operator'),
  ('a5000000-0000-4000-a000-000000000002',
   '10000000-0000-4000-a000-000000000009',
   '00000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-00000000000a',
   ((current_date - 10) + time '04:00') at time zone 'Asia/Kolkata',
   current_date - 10,
   ((current_date - 10) + time '05:00') at time zone 'Asia/Kolkata',
   ((current_date - 10) + time '05:00') at time zone 'Asia/Kolkata', 'operator');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000009');

select is(
  public.create_billing_order(
    'a1000000-0000-4000-a000-000000000008', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000002',
      'a3000000-0000-4000-a000-000000000004', current_date - 11)),
    ((current_date - 10) + time '03:50') at time zone 'Asia/Kolkata',
    'a5000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000002',
      'a3000000-0000-4000-a000-000000000004', current_date - 11)
  ) ->> 'status',
  'accepted',
  'a delayed command created within a historical pre-removal shift is accepted');

reset role;
select is(
  (select order_number from public.orders
    where id = 'a2000000-0000-4000-a000-000000000002'),
  1::bigint,
  'the pre-cutover order starts its business-day sequence');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000009');
select is(
  public.create_billing_order(
    'a1000000-0000-4000-a000-000000000009', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000003',
      'a3000000-0000-4000-a000-000000000005', current_date - 10)),
    ((current_date - 10) + time '04:10') at time zone 'Asia/Kolkata',
    'a5000000-0000-4000-a000-000000000002',
    pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000003',
      'a3000000-0000-4000-a000-000000000005', current_date - 10)
  ) ->> 'status',
  'accepted',
  'the first post-cutover order is accepted');

reset role;
select is((select order_number from public.orders
  where id = 'a2000000-0000-4000-a000-000000000003'), 1::bigint,
  'the daily order number restarts after cutover');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000009');
select is(
  public.pay_billing_order(
    'a1000000-0000-4000-a000-00000000000a', 1,
    public.billing_payload_hash(pg_temp.pay_order_payload(
      'a4000000-0000-4000-a000-000000000004',
      'a2000000-0000-4000-a000-000000000002',
      ((current_date - 10) + time '04:10') at time zone 'Asia/Kolkata',
      current_date - 10)),
    ((current_date - 10) + time '04:10') at time zone 'Asia/Kolkata',
    'a5000000-0000-4000-a000-000000000002',
    pg_temp.pay_order_payload(
      'a4000000-0000-4000-a000-000000000004',
      'a2000000-0000-4000-a000-000000000002',
      ((current_date - 10) + time '04:10') at time zone 'Asia/Kolkata',
      current_date - 10)
  ) ->> 'status',
  'accepted',
  'the same tablet may pay under its next historical shift');

reset role;
select is(
  (select business_date::text || '/' || payment_business_date::text
     from public.bills where id = 'a4000000-0000-4000-a000-000000000004'),
  (current_date - 11)::text || '/' || (current_date - 10)::text,
  'revenue and drawer dates remain independently explicit across cutover');

-- Manager cancellation wins before a payment locks the order: no bill and no number.
reset role;
select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select is(
  public.manager_cancel_billing_order(
    'a1000000-0000-4000-a000-000000000011', 1,
    public.billing_payload_hash(jsonb_build_object(
      'orderId', 'a2000000-0000-4000-a000-000000000003',
      'reason', 'Cross-outlet attempt')),
    now(), null,
    jsonb_build_object(
      'orderId', 'a2000000-0000-4000-a000-000000000003',
      'reason', 'Cross-outlet attempt')) ->> 'status',
  'authorization_refused',
  'another outlet manager cannot cancel a known order UUID');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is(
  public.manager_cancel_billing_order(
    'a1000000-0000-4000-a000-00000000000b', 1,
    public.billing_payload_hash(jsonb_build_object(
      'orderId', 'a2000000-0000-4000-a000-000000000003',
      'reason', 'Manager cancelled test order')),
    now(), null,
    jsonb_build_object(
      'orderId', 'a2000000-0000-4000-a000-000000000003',
      'reason', 'Manager cancelled test order')) ->> 'status',
  'accepted',
  'the outlet FA cancels an open order without a shift');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000009');
select is(
  public.pay_billing_order(
    'a1000000-0000-4000-a000-00000000000c', 1,
    public.billing_payload_hash(pg_temp.pay_order_payload(
      'a4000000-0000-4000-a000-000000000005',
      'a2000000-0000-4000-a000-000000000003',
      ((current_date - 10) + time '04:20') at time zone 'Asia/Kolkata',
      current_date - 10)),
    ((current_date - 10) + time '04:20') at time zone 'Asia/Kolkata',
    'a5000000-0000-4000-a000-000000000002',
    pg_temp.pay_order_payload(
      'a4000000-0000-4000-a000-000000000005',
      'a2000000-0000-4000-a000-000000000003',
      ((current_date - 10) + time '04:20') at time zone 'Asia/Kolkata',
      current_date - 10)
  ) ->> 'status',
  'order_not_open',
  'a pay arriving after manager cancellation is refused cleanly');

select is(
  public.pay_billing_order(
    'a1000000-0000-4000-a000-00000000000c', 1,
    public.billing_payload_hash(pg_temp.pay_order_payload(
      'a4000000-0000-4000-a000-000000000005',
      'a2000000-0000-4000-a000-000000000003',
      ((current_date - 10) + time '04:20') at time zone 'Asia/Kolkata',
      current_date - 10)),
    ((current_date - 10) + time '04:20') at time zone 'Asia/Kolkata',
    'a5000000-0000-4000-a000-000000000002',
    pg_temp.pay_order_payload(
      'a4000000-0000-4000-a000-000000000005',
      'a2000000-0000-4000-a000-000000000003',
      ((current_date - 10) + time '04:20') at time zone 'Asia/Kolkata',
      current_date - 10)
  ) ->> 'status',
  'order_not_open',
  'an exact retry preserves the original refusal instead of reporting success');
reset role;
select is((select count(*) from public.bills
  where id = 'a4000000-0000-4000-a000-000000000005'), 0::bigint,
  'the losing payment creates no bill');

-- Readiness reports every database blocker. The seeded current shift is live,
-- and the current tablet has not confirmed.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  public.create_billing_order(
    'a1000000-0000-4000-a000-00000000000d', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000004',
      'a3000000-0000-4000-a000-000000000006',
      public.app_business_date(now(), time '04:00'))),
    now(), '90000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000004',
      'a3000000-0000-4000-a000-000000000006',
      public.app_business_date(now(), time '04:00'))
  ) ->> 'status',
  'accepted',
  'the tablet creates an order that will exercise ordinary cancellation');

select is(
  public.cancel_billing_order(
    'a1000000-0000-4000-a000-00000000000e', 1,
    public.billing_payload_hash(jsonb_build_object(
      'orderId', 'a2000000-0000-4000-a000-000000000004',
      'reason', 'Customer changed their mind')),
    now(), '90000000-0000-4000-a000-000000000001',
    jsonb_build_object(
      'orderId', 'a2000000-0000-4000-a000-000000000004',
      'reason', 'Customer changed their mind')) ->> 'status',
  'accepted',
  'the owning tablet cancels an open order with attribution');

select is(
  public.create_billing_order(
    'a1000000-0000-4000-a000-00000000000f', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000005',
      'a3000000-0000-4000-a000-000000000007',
      public.app_business_date(now(), time '04:00'))),
    now(), '90000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000005',
      'a3000000-0000-4000-a000-000000000007',
      public.app_business_date(now(), time '04:00'))
  ) ->> 'status',
  'accepted',
  'an intentionally open order is present for the readiness probe');

-- A line UUID belongs to exactly one order. Naming another order's line must
-- refuse without changing either parent or either captured child.
select is(
  public.revise_billing_order(
    'a1000000-0000-4000-a000-000000000020', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000005',
      'a3000000-0000-4000-a000-000000000005',
      public.app_business_date(now(), time '04:00'))),
    now(), '90000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000005',
      'a3000000-0000-4000-a000-000000000005',
      public.app_business_date(now(), time '04:00'))
  ) ->> 'status',
  'arithmetic_invalid',
  'revision refuses a line UUID owned by another order');

select is(
  (select string_agg(id::text, ',' order by id) from public.order_items
    where order_id='a2000000-0000-4000-a000-000000000005'),
  'a3000000-0000-4000-a000-000000000007',
  'the refused collision leaves the target order lines unchanged');

-- Entity collisions roll back the daily counter as part of the failed command.
reset role;
insert into pg_temp.command_values values ('order_counter_before_collision',
  (select to_jsonb(last_number) from public.order_number_counters
    where outlet_id='00000000-0000-4000-a000-000000000001'
      and business_date=public.app_business_date(now(),time '04:00')));
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  public.create_billing_order(
    'a1000000-0000-4000-a000-000000000021', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000005',
      'a3000000-0000-4000-a000-000000000021',
      public.app_business_date(now(), time '04:00'))),
    now(), '90000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000005',
      'a3000000-0000-4000-a000-000000000021',
      public.app_business_date(now(), time '04:00'))
  ) ->> 'status',
  'identity_conflict',
  'a duplicate order UUID is an identity conflict');

select is(
  public.create_billing_order(
    'a1000000-0000-4000-a000-000000000022', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000006',
      'a3000000-0000-4000-a000-000000000022',
      public.app_business_date(now(), time '04:00'))),
    now(), '90000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000006',
      'a3000000-0000-4000-a000-000000000022',
      public.app_business_date(now(), time '04:00'))
  ) ->> 'status',
  'accepted',
  'a valid order still follows the collided command');

reset role;
select is(
  (select order_number from public.orders where id='a2000000-0000-4000-a000-000000000006'),
  ((select value #>> '{}' from pg_temp.command_values
      where name='order_counter_before_collision')::bigint + 1),
  'a failed create consumes no daily order number');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  public.revise_billing_order(
    'a1000000-0000-4000-a000-000000000024',1,
    public.billing_payload_hash(pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000005',
      'a3000000-0000-4000-a000-000000000022',
      public.app_business_date(now(),time '04:00'))),
    now(),'90000000-0000-4000-a000-000000000001',pg_temp.order_payload(
      'a2000000-0000-4000-a000-000000000005',
      'a3000000-0000-4000-a000-000000000022',
      public.app_business_date(now(),time '04:00'))
  )->>'status','arithmetic_invalid','one open order cannot claim another open order line');
select is(
  (select string_agg(order_id::text||':'||id::text,',' order by order_id)
     from public.order_items where order_id in (
       'a2000000-0000-4000-a000-000000000005','a2000000-0000-4000-a000-000000000006')),
  'a2000000-0000-4000-a000-000000000005:a3000000-0000-4000-a000-000000000007,'||
  'a2000000-0000-4000-a000-000000000006:a3000000-0000-4000-a000-000000000022',
  'the refused open-order collision leaves both captured children attached');

-- Entity clocks are monotonic even when a historical shift would otherwise
-- authorise the backdated envelope.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  public.pay_billing_order(
    'a1000000-0000-4000-a000-000000000023', 1,
    public.billing_payload_hash(pg_temp.pay_order_payload(
      'a4000000-0000-4000-a000-000000000023',
      'a2000000-0000-4000-a000-000000000005',
      (select ordered_at-interval '1 second' from public.orders
        where id='a2000000-0000-4000-a000-000000000005'),
      public.app_business_date((select ordered_at-interval '1 second' from public.orders
        where id='a2000000-0000-4000-a000-000000000005'),time '04:00'))),
    (select ordered_at-interval '1 second' from public.orders
      where id='a2000000-0000-4000-a000-000000000005'),
    '90000000-0000-4000-a000-000000000001',
    pg_temp.pay_order_payload(
      'a4000000-0000-4000-a000-000000000023',
      'a2000000-0000-4000-a000-000000000005',
      (select ordered_at-interval '1 second' from public.orders
        where id='a2000000-0000-4000-a000-000000000005'),
      public.app_business_date((select ordered_at-interval '1 second' from public.orders
        where id='a2000000-0000-4000-a000-000000000005'),time '04:00'))
  ) ->> 'status',
  'malformed_payload',
  'payment cannot predate the order it settles');

-- Every typed field is parsed inside the command boundary. A valid hash over
-- invalid values is a permanent malformed result, never a raw server error.
insert into pg_temp.command_values values
  ('malformed_create', pg_temp.order_payload(
    'a2000000-0000-4000-a000-000000000030',
    'a3000000-0000-4000-a000-000000000030',
    public.app_business_date(now(),time '04:00'))
    || jsonb_build_object('customerId','not-a-uuid')),
  ('malformed_revise', pg_temp.order_payload(
    'a2000000-0000-4000-a000-000000000005',
    'a3000000-0000-4000-a000-000000000007',
    public.app_business_date(now(),time '04:00'))
    || jsonb_build_object('orderId','not-a-uuid')),
  ('malformed_pay', pg_temp.pay_order_payload(
    'a4000000-0000-4000-a000-000000000030',
    'a2000000-0000-4000-a000-000000000005',now(),
    public.app_business_date(now(),time '04:00'))
    || jsonb_build_object('orderId','not-a-uuid')),
  ('malformed_pay_now', pg_temp.pay_now_payload(
    'a4000000-0000-4000-a000-000000000031',
    public.app_business_date(now(),time '04:00'),now(),
    public.app_business_date(now(),time '04:00'))
    || jsonb_build_object('customerId','not-a-uuid'));

select is(public.create_billing_order('a1000000-0000-4000-a000-000000000030',1,
  public.billing_payload_hash((select value from pg_temp.command_values where name='malformed_create')),
  now(),'90000000-0000-4000-a000-000000000001',
  (select value from pg_temp.command_values where name='malformed_create'))->>'status',
  'malformed_payload','create parses customer UUIDs into a permanent refusal');
select is(public.revise_billing_order('a1000000-0000-4000-a000-000000000031',1,
  public.billing_payload_hash((select value from pg_temp.command_values where name='malformed_revise')),
  now(),'90000000-0000-4000-a000-000000000001',
  (select value from pg_temp.command_values where name='malformed_revise'))->>'status',
  'malformed_payload','revise parses order UUIDs into a permanent refusal');
select is(public.cancel_billing_order('a1000000-0000-4000-a000-000000000032',1,
  public.billing_payload_hash(jsonb_build_object('orderId',
    'a2000000-0000-4000-a000-000000000005','reason',null)),now(),
  '90000000-0000-4000-a000-000000000001',jsonb_build_object('orderId',
    'a2000000-0000-4000-a000-000000000005','reason',null))->>'status',
  'malformed_payload','cancel refuses a null reason cleanly');
select is(public.pay_billing_order('a1000000-0000-4000-a000-000000000033',1,
  public.billing_payload_hash((select value from pg_temp.command_values where name='malformed_pay')),
  now(),'90000000-0000-4000-a000-000000000001',
  (select value from pg_temp.command_values where name='malformed_pay'))->>'status',
  'malformed_payload','pay-order parses order UUIDs into a permanent refusal');
select is(public.pay_billing_now('a1000000-0000-4000-a000-000000000034',1,
  public.billing_payload_hash((select value from pg_temp.command_values where name='malformed_pay_now')),
  now(),'90000000-0000-4000-a000-000000000001',
  (select value from pg_temp.command_values where name='malformed_pay_now'))->>'status',
  'malformed_payload','pay-now parses customer UUIDs into a permanent refusal');

select is(public.create_billing_order('a1000000-0000-4000-a000-000000000038',1,
  public.billing_payload_hash(pg_temp.order_payload(
    'a2000000-0000-4000-a000-000000000038',
    'a3000000-0000-4000-a000-000000000038',
    public.app_business_date(now(),time '04:00')) || jsonb_build_object('totalPaise',null)),
  now(),'90000000-0000-4000-a000-000000000001',pg_temp.order_payload(
    'a2000000-0000-4000-a000-000000000038',
    'a3000000-0000-4000-a000-000000000038',
    public.app_business_date(now(),time '04:00')) || jsonb_build_object('totalPaise',null)
  )->>'status','malformed_payload','null money is malformed rather than retryable');

select is(public.create_billing_order('a1000000-0000-4000-a000-000000000039',1,
  public.billing_payload_hash(jsonb_set(pg_temp.order_payload(
    'a2000000-0000-4000-a000-000000000039',
    'a3000000-0000-4000-a000-000000000039',
    public.app_business_date(now(),time '04:00')),'{lines,0,itemName}','null'::jsonb)),
  now(),'90000000-0000-4000-a000-000000000001',jsonb_set(pg_temp.order_payload(
    'a2000000-0000-4000-a000-000000000039',
    'a3000000-0000-4000-a000-000000000039',
    public.app_business_date(now(),time '04:00')),'{lines,0,itemName}','null'::jsonb)
  )->>'status','malformed_payload','null line facts are malformed rather than retryable');

select is(public.create_billing_order('a1000000-0000-4000-a000-00000000003f',1,
  public.billing_payload_hash(pg_temp.order_payload(
    'a2000000-0000-4000-a000-00000000003f',
    'a3000000-0000-4000-a000-00000000003f',
    public.app_business_date(now(),time '04:00')) || jsonb_build_object('totalPaise','13900')),
  now(),'90000000-0000-4000-a000-000000000001',pg_temp.order_payload(
    'a2000000-0000-4000-a000-00000000003f',
    'a3000000-0000-4000-a000-00000000003f',
    public.app_business_date(now(),time '04:00')) || jsonb_build_object('totalPaise','13900')
  )->>'status','malformed_payload','string money cannot masquerade as a JSON number');

select is(public.create_billing_order('a1000000-0000-4000-a000-000000000040',1,
  public.billing_payload_hash(jsonb_set(pg_temp.order_payload(
    'a2000000-0000-4000-a000-000000000040',
    'a3000000-0000-4000-a000-000000000040',
    public.app_business_date(now(),time '04:00')),'{lines,0,quantity}','"1"'::jsonb)),
  now(),'90000000-0000-4000-a000-000000000001',jsonb_set(pg_temp.order_payload(
    'a2000000-0000-4000-a000-000000000040',
    'a3000000-0000-4000-a000-000000000040',
    public.app_business_date(now(),time '04:00')),'{lines,0,quantity}','"1"'::jsonb)
  )->>'status','malformed_payload','string quantity cannot masquerade as a JSON number');

select is(public.pay_billing_order('a1000000-0000-4000-a000-00000000003a',1,
  public.billing_payload_hash(pg_temp.pay_order_payload(
    'a4000000-0000-4000-a000-00000000003a',
    'a2000000-0000-4000-a000-000000000005',now(),
    public.app_business_date(now(),time '04:00')) || jsonb_build_object('billId',null)),
  now(),'90000000-0000-4000-a000-000000000001',pg_temp.pay_order_payload(
    'a4000000-0000-4000-a000-00000000003a',
    'a2000000-0000-4000-a000-000000000005',now(),
    public.app_business_date(now(),time '04:00')) || jsonb_build_object('billId',null)
  )->>'status','malformed_payload','pay-order refuses a null bill UUID cleanly');

select is(public.pay_billing_order('a1000000-0000-4000-a000-00000000003b',1,
  public.billing_payload_hash(pg_temp.pay_order_payload(
    'a4000000-0000-4000-a000-00000000003b',
    'a2000000-0000-4000-a000-000000000005',now(),
    public.app_business_date(now(),time '04:00')) || jsonb_build_object('paidAt',null)),
  now(),'90000000-0000-4000-a000-000000000001',pg_temp.pay_order_payload(
    'a4000000-0000-4000-a000-00000000003b',
    'a2000000-0000-4000-a000-000000000005',now(),
    public.app_business_date(now(),time '04:00')) || jsonb_build_object('paidAt',null)
  )->>'status','malformed_payload','pay-order refuses a null payment clock cleanly');

select is(public.pay_billing_order('a1000000-0000-4000-a000-00000000003c',1,
  public.billing_payload_hash(pg_temp.pay_order_payload(
    'a4000000-0000-4000-a000-00000000003c',
    'a2000000-0000-4000-a000-000000000005',now(),
    public.app_business_date(now(),time '04:00')) || jsonb_build_object('payments',null)),
  now(),'90000000-0000-4000-a000-000000000001',pg_temp.pay_order_payload(
    'a4000000-0000-4000-a000-00000000003c',
    'a2000000-0000-4000-a000-000000000005',now(),
    public.app_business_date(now(),time '04:00')) || jsonb_build_object('payments',null)
  )->>'status','malformed_payload','pay-order refuses null payment allocations cleanly');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is(public.manager_cancel_billing_order('a1000000-0000-4000-a000-000000000035',1,
  public.billing_payload_hash(jsonb_build_object('orderId','not-a-uuid','reason','Invalid')),
  now(),null,jsonb_build_object('orderId','not-a-uuid','reason','Invalid'))->>'status',
  'malformed_payload','manager cancellation parses order UUIDs into a permanent refusal');
select is(public.void_billing_bill('a1000000-0000-4000-a000-000000000036',1,
  public.billing_payload_hash(jsonb_build_object('billId','not-a-uuid','reason','Invalid')),
  now(),null,jsonb_build_object('billId','not-a-uuid','reason','Invalid'))->>'status',
  'malformed_payload','void parses bill UUIDs into a permanent refusal');
select is(public.manager_cancel_billing_order('a1000000-0000-4000-a000-00000000003d',1,
  public.billing_payload_hash(jsonb_build_object('orderId',null,'reason','Invalid')),
  now(),null,jsonb_build_object('orderId',null,'reason','Invalid'))->>'status',
  'malformed_payload','manager cancellation refuses a null order UUID cleanly');
select is(public.void_billing_bill('a1000000-0000-4000-a000-00000000003e',1,
  public.billing_payload_hash(jsonb_build_object('billId',null,'reason','Invalid')),
  now(),null,jsonb_build_object('billId',null,'reason','Invalid'))->>'status',
  'malformed_payload','void refuses a null bill UUID cleanly');
select is(public.manager_cancel_billing_order('a1000000-0000-4000-a000-000000000041',1,
  public.billing_payload_hash(jsonb_build_object(
    'orderId','a2000000-0000-4000-a000-000000000005','reason',7)),
  now(),null,jsonb_build_object(
    'orderId','a2000000-0000-4000-a000-000000000005','reason',7))->>'status',
  'malformed_payload','a numeric reason cannot masquerade as text');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(public.confirm_billing_end_of_day('a1000000-0000-4000-a000-000000000044',1,
  public.billing_payload_hash(jsonb_build_object('outletId','not-a-uuid',
    'businessDate',current_date,'unsentCount',0,'needsAttentionCount',0)),now(),null,
  jsonb_build_object('outletId','not-a-uuid','businessDate',current_date,
    'unsentCount',0,'needsAttentionCount',0))->>'status',
  'malformed_payload','end-of-day parses outlet UUIDs into a permanent refusal');

select is(public.confirm_billing_end_of_day('a1000000-0000-4000-a000-000000000100',1,
  public.billing_payload_hash(jsonb_build_object(
    'outletId','00000000-0000-4000-a000-000000000001',
    'businessDate',public.app_business_date(now(),time '04:00'),
    'unsentCount',0,'needsAttentionCount',0)),now(),null,
  jsonb_build_object('outletId','00000000-0000-4000-a000-000000000001',
    'businessDate',public.app_business_date(now(),time '04:00'),
    'unsentCount',0,'needsAttentionCount',0))->>'status',
  'unresolved_operations','finish-day refuses while an open order remains');
select ok((select ended_at is null from public.counter_shifts
    where id='90000000-0000-4000-a000-000000000001'),
  'a refused finish leaves the live shift open');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000005');
select is(public.confirm_billing_end_of_day('a1000000-0000-4000-a000-000000000101',1,
  public.billing_payload_hash(jsonb_build_object(
    'outletId','00000000-0000-4000-a000-000000000002',
    'businessDate',public.app_business_date(now(),time '04:00'),
    'unsentCount',0,'needsAttentionCount',0)),now(),null,
  jsonb_build_object('outletId','00000000-0000-4000-a000-000000000002',
    'businessDate',public.app_business_date(now(),time '04:00'),
    'unsentCount',0,'needsAttentionCount',0))->>'status',
  'accepted','finish-day ends a clear shift and records its confirmation atomically');
reset role;
select ok((select ended_at is not null from public.counter_shifts
    where id='90000000-0000-4000-a000-000000000002'),
  'the accepted finish ends the tablet shift');
select is((select count(*) from public.billing_end_of_day_confirmations
    where device_id='10000000-0000-4000-a000-000000000005'
      and business_date=public.app_business_date(now(),time '04:00')),1::bigint,
  'the same accepted finish leaves one server confirmation');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select ok(
  (public.billing_day_readiness(
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00')) ->> 'openOrders')::integer > 0,
  'an open order is a server-side sign-off blocker');
select ok(
  (public.billing_day_readiness(
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00')) ->> 'liveShifts')::integer > 0,
  'a live shift is a server-side sign-off blocker');
select ok(
  (public.billing_day_readiness(
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(), time '04:00')) ->> 'missingConfirmations')::integer > 0,
  'a participating tablet without confirmation is a blocker');

reset role;
update public.profiles set is_active=false
 where id='10000000-0000-4000-a000-000000000002';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is(
  public.billing_day_readiness(
    '00000000-0000-4000-a000-000000000001',
    public.app_business_date(now(),time '04:00')) ->> 'status',
  'authorization_refused',
  'a deactivated manager cannot read operational readiness with a stale token');

select * from finish();
rollback;
