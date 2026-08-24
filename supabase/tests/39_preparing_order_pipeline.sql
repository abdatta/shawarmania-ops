-- #45 preparing-order-pipeline: preparation is an axis beside payment, and the
-- counter's payment unwinds are typed atomic commands bounded by the same
-- five-minute clock as tender corrections. Every rule here is the database's,
-- not the interface's.

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

create function pg_temp.unimpersonate()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- The active Kalyani tablet session answers auth.uid() with its device UUID.
\set DEVICE_KAL '10000000-0000-4000-a000-000000000004'
\set DEVICE_KPA '10000000-0000-4000-a000-000000000005'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set BILLER_KPA '10000000-0000-4000-a000-00000000000b'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

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

create function pg_temp.prepare_payload(p_order_id uuid, p_prepared boolean)
returns jsonb language sql immutable as $$
  select jsonb_build_object('orderId', p_order_id, 'prepared', p_prepared)
$$;

create function pg_temp.unwind_payload(
  p_order_id uuid,
  p_bill_id uuid,
  p_reason text default 'Wrong tender taken back'
)
returns jsonb language sql immutable as $$
  select jsonb_build_object('orderId', p_order_id, 'billId', p_bill_id, 'reason', p_reason)
$$;

select has_function('public', 'prepare_billing_order',
  array['uuid','integer','text','timestamp with time zone','uuid','jsonb'],
  'set-order-preparation command has the settled envelope signature');
select has_function('public', 'unpay_billing_order',
  array['uuid','integer','text','timestamp with time zone','uuid','jsonb'],
  'void-order-payment command has the settled envelope signature');
select has_function('public', 'cancel_paid_billing_order',
  array['uuid','integer','text','timestamp with time zone','uuid','jsonb'],
  'cancel-paid-order command has the settled envelope signature');

-- One fresh shift on the active Kalyani tablet, wide enough to host every
-- command time this file uses. The seed's own open shift for this device ends
-- first: one live shift per device is the database's own rule.
select pg_temp.unimpersonate();
update public.counter_shifts set ended_at=((current_date - 1) + time '09:00') at time zone 'Asia/Kolkata',
  ended_reason='operator'
 where device_id=:'DEVICE_KAL' and ended_at is null;
insert into public.counter_shifts
  (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at)
values
  ('e5000000-0000-4000-a000-000000000001',
   :'DEVICE_KAL',
   :'KAL',
   :'BILLER_KAL',
   ((current_date - 1) + time '10:00') at time zone 'Asia/Kolkata',
   current_date - 1,
   ((current_date + 1) + time '04:00') at time zone 'Asia/Kolkata');

-- ---------------------------------------------------------------------------
-- Preparation is an axis.

select pg_temp.impersonate(:'DEVICE_KAL');
select is(
  public.create_billing_order(
    'e1000000-0000-4000-a000-000000000001', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e3000000-0000-4000-a000-000000000001', current_date - 1)),
    ((current_date - 1) + time '12:00') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e3000000-0000-4000-a000-000000000001', current_date - 1)
  ) ->> 'status',
  'accepted', 'the fixture order is accepted');

select is((select prepared_at from public.orders where id='e2000000-0000-4000-a000-000000000001'),
  null, 'a new order is still preparing (null prepared_at)');

select is(
  public.prepare_billing_order(
    'e1000000-0000-4000-a000-000000000002', 1,
    public.billing_payload_hash(pg_temp.prepare_payload(
      'e2000000-0000-4000-a000-000000000001', true)),
    ((current_date - 1) + time '12:05') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.prepare_payload('e2000000-0000-4000-a000-000000000001', true)
  ) ->> 'status',
  'accepted', 'marking prepared is accepted');

select is((select prepared_at from public.orders where id='e2000000-0000-4000-a000-000000000001'),
  ((current_date - 1) + time '12:05') at time zone 'Asia/Kolkata',
  'prepared_at carries the command time');

select is(
  public.prepare_billing_order(
    'e1000000-0000-4000-a000-000000000003', 1,
    public.billing_payload_hash(pg_temp.prepare_payload(
      'e2000000-0000-4000-a000-000000000001', false)),
    ((current_date - 1) + time '12:06') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.prepare_payload('e2000000-0000-4000-a000-000000000001', false)
  ) ->> 'status',
  'accepted', 'reprepare while unpaid is accepted');

select is((select prepared_at from public.orders where id='e2000000-0000-4000-a000-000000000001'),
  null::timestamptz, 'reprepare clears prepared_at');

-- Reprepare after payment is refused: the bills border is terminal that way.
select is(
  public.pay_billing_order(
    'e1000000-0000-4000-a000-000000000004', 1,
    public.billing_payload_hash(pg_temp.pay_order_payload(
      'e6000000-0000-4000-a000-000000000001',
      'e2000000-0000-4000-a000-000000000001',
      ((current_date - 1) + time '12:10') at time zone 'Asia/Kolkata',
      current_date - 1)),
    ((current_date - 1) + time '12:10') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.pay_order_payload(
      'e6000000-0000-4000-a000-000000000001',
      'e2000000-0000-4000-a000-000000000001',
      ((current_date - 1) + time '12:10') at time zone 'Asia/Kolkata',
      current_date - 1)
  ) ->> 'status',
  'accepted', 'the order pays');

select is(
  public.prepare_billing_order(
    'e1000000-0000-4000-a000-000000000005', 1,
    public.billing_payload_hash(pg_temp.prepare_payload(
      'e2000000-0000-4000-a000-000000000001', false)),
    ((current_date - 1) + time '12:11') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.prepare_payload('e2000000-0000-4000-a000-000000000001', false)
  ) ->> 'status',
  'order_not_open', 'repreparing a paid order is refused');

-- The upfront payer: paid while still preparing completes into prepared.
select pg_temp.impersonate(:'DEVICE_KAL');
select is(
  public.create_billing_order(
    'e1000000-0000-4000-a000-000000000006', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'e2000000-0000-4000-a000-000000000002',
      'e3000000-0000-4000-a000-000000000002', current_date - 1)),
    ((current_date - 1) + time '13:00') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'e2000000-0000-4000-a000-000000000002',
      'e3000000-0000-4000-a000-000000000002', current_date - 1)
  ) ->> 'status',
  'accepted', 'the upfront payer order is created');

select is(
  public.pay_billing_order(
    'e1000000-0000-4000-a000-000000000007', 1,
    public.billing_payload_hash(pg_temp.pay_order_payload(
      'e6000000-0000-4000-a000-000000000002',
      'e2000000-0000-4000-a000-000000000002',
      ((current_date - 1) + time '13:01') at time zone 'Asia/Kolkata',
      current_date - 1)),
    ((current_date - 1) + time '13:01') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.pay_order_payload(
      'e6000000-0000-4000-a000-000000000002',
      'e2000000-0000-4000-a000-000000000002',
      ((current_date - 1) + time '13:01') at time zone 'Asia/Kolkata',
      current_date - 1)
  ) ->> 'status',
  'accepted', 'paying before preparing succeeds');

select is(
  public.prepare_billing_order(
    'e1000000-0000-4000-a000-000000000008', 1,
    public.billing_payload_hash(pg_temp.prepare_payload(
      'e2000000-0000-4000-a000-000000000002', true)),
    ((current_date - 1) + time '13:02') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.prepare_payload('e2000000-0000-4000-a000-000000000002', true)
  ) ->> 'status',
  'accepted', 'marking a paid-but-unprepared order prepared succeeds');

select throws_ok($$
  update public.orders set prepared_at = now()
   where id = 'e2000000-0000-4000-a000-000000000002'
$$, '42501', null, 'a direct write cannot move preparation');

-- ---------------------------------------------------------------------------
-- Payment unwinds: within the window, from the paying tablet, atomic.

-- Take the payment back: bill voids kinded, order reopens, sale fields intact.
select pg_temp.impersonate(:'DEVICE_KAL');
select is(
  public.unpay_billing_order(
    'e1000000-0000-4000-a000-000000000009', 1,
    public.billing_payload_hash(pg_temp.unwind_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e6000000-0000-4000-a000-000000000001')),
    ((current_date - 1) + time '12:14') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.unwind_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e6000000-0000-4000-a000-000000000001')
  ) ->> 'status',
  'accepted', 'taking the payment back inside the window is accepted');

select is((select status from public.bills where id='e6000000-0000-4000-a000-000000000001'),
  'void', 'the unwound bill reads void');
select is((select void_kind from public.bills where id='e6000000-0000-4000-a000-000000000001'),
  'counter_unpay', 'the unwound bill carries its structured kind');
select is((select status from public.orders where id='e2000000-0000-4000-a000-000000000001'),
  'open', 'the order reopens');
select is((select paid_at from public.orders where id='e2000000-0000-4000-a000-000000000001'),
  null::timestamptz, 'the reopened order sheds its paid attribution');
select is((select count(*) from public.bill_items where bill_id='e6000000-0000-4000-a000-000000000001'),
  1::bigint, 'the unwound bill keeps its item snapshots');
select is((select total_paise from public.bills where id='e6000000-0000-4000-a000-000000000001'),
  13900::bigint, 'the unwound bill keeps its total byte-for-byte');

-- Exact replay returns its original result without repeating effects.
select is(
  public.unpay_billing_order(
    'e1000000-0000-4000-a000-000000000009', 1,
    public.billing_payload_hash(pg_temp.unwind_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e6000000-0000-4000-a000-000000000001')),
    ((current_date - 1) + time '12:14') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.unwind_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e6000000-0000-4000-a000-000000000001')
  ) ->> 'status',
  'replay', 'an exact unwind replay reports replay and changes nothing');

-- Outside the window it is refused permanently.
select is(
  public.pay_billing_order(
    'e1000000-0000-4000-a000-000000000010', 1,
    public.billing_payload_hash(pg_temp.pay_order_payload(
      'e6000000-0000-4000-a000-000000000003',
      'e2000000-0000-4000-a000-000000000001',
      ((current_date - 1) + time '12:20') at time zone 'Asia/Kolkata',
      current_date - 1)),
    ((current_date - 1) + time '12:20') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.pay_order_payload(
      'e6000000-0000-4000-a000-000000000003',
      'e2000000-0000-4000-a000-000000000001',
      ((current_date - 1) + time '12:20') at time zone 'Asia/Kolkata',
      current_date - 1))
  ->> 'status',
  'accepted', 'the order pays again');

select is(
  public.cancel_paid_billing_order(
    'e1000000-0000-4000-a000-000000000011', 1,
    public.billing_payload_hash(pg_temp.unwind_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e6000000-0000-4000-a000-000000000003',
      'Customer left')),
    ((current_date - 1) + time '12:30') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.unwind_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e6000000-0000-4000-a000-000000000003',
      'Customer left'))
  ->> 'status',
  'payment_edit_expired', 'cancelling after payment outside five minutes is refused');

-- A foreign tablet of another outlet cannot unwind what it did not take. It
-- holds a valid shift of its own, so the refusal is the device guard and not
-- a malformed envelope.
select pg_temp.unimpersonate();
update public.counter_shifts set ended_at=((current_date - 1) + time '09:00') at time zone 'Asia/Kolkata',
  ended_reason='operator'
 where device_id=:'DEVICE_KPA' and ended_at is null;
insert into public.counter_shifts
  (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at)
values
  ('e5000000-0000-4000-a000-000000000002',
   :'DEVICE_KPA',
   :'KPA',
   :'BILLER_KPA',
   ((current_date - 1) + time '10:00') at time zone 'Asia/Kolkata',
   current_date - 1,
   ((current_date + 1) + time '04:00') at time zone 'Asia/Kolkata');
select pg_temp.impersonate(:'DEVICE_KPA');
select is(
  public.unpay_billing_order(
    'e1000000-0000-4000-a000-000000000012', 1,
    public.billing_payload_hash(pg_temp.unwind_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e6000000-0000-4000-a000-000000000003',
      'Wrong tender taken back')),
    ((current_date - 1) + time '12:25') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000002',
    pg_temp.unwind_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e6000000-0000-4000-a000-000000000003',
      'Wrong tender taken back'))
  ->> 'status',
  'authorization_refused', 'another outlet''s tablet cannot take the payment back');

-- A hand-crafted direct void stays impossible for an ordinary client write.
select pg_temp.impersonate(:'BILLER_KAL');
select throws_ok($$
  update public.bills set status='void', voided_by='10000000-0000-4000-a000-00000000000a',
    voided_at=now(), void_reason='hand-crafted'
   where id='e6000000-0000-4000-a000-000000000003'
$$, null, null, 'a direct table void is impossible whatever the window');

-- Cancel-after-paid inside the window: one transaction, both effects.
select pg_temp.impersonate(:'DEVICE_KAL');
select is(
  public.cancel_paid_billing_order(
    'e1000000-0000-4000-a000-000000000013', 1,
    public.billing_payload_hash(pg_temp.unwind_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e6000000-0000-4000-a000-000000000003',
      'Customer left')),
    ((current_date - 1) + time '12:24') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.unwind_payload(
      'e2000000-0000-4000-a000-000000000001',
      'e6000000-0000-4000-a000-000000000003',
      'Customer left'))
  ->> 'status',
  'accepted', 'cancelling after payment inside the window is accepted');

select is((select status from public.orders where id='e2000000-0000-4000-a000-000000000001'),
  'cancelled', 'the paid order becomes cancelled history');
select is((select cancel_reason from public.orders where id='e2000000-0000-4000-a000-000000000001'),
  'Customer left', 'the cancellation carries its reason');
select is((select status from public.bills where id='e6000000-0000-4000-a000-000000000003'),
  'void', 'its bill is void');
select is((select void_kind from public.bills where id='e6000000-0000-4000-a000-000000000003'),
  'cancelled_after_paid', 'the marker kind is stamped at write time');

-- A cancelled order refuses preparation like everything else.
select is(
  public.prepare_billing_order(
    'e1000000-0000-4000-a000-000000000014', 1,
    public.billing_payload_hash(pg_temp.prepare_payload(
      'e2000000-0000-4000-a000-000000000001', true)),
    ((current_date - 1) + time '12:26') at time zone 'Asia/Kolkata',
    'e5000000-0000-4000-a000-000000000001',
    pg_temp.prepare_payload('e2000000-0000-4000-a000-000000000001', true))
  ->> 'status',
  'order_not_open', 'preparation on a cancelled order is refused');

select * from finish();
rollback;
