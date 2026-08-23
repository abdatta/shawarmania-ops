-- #45 preparing-order-pipeline, production follow-up: history that predates
-- preparation. A paid order with a null prepared_at is the shape every row
-- worn before the axis existed -- and, briefly, every upfront payment made
-- between deploy and backfill. The backfill stamps such rows prepared at
-- their paid moment and touches nothing else: open work stays open, cancelled
-- stays immutable, bills stay byte-for-byte.

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

\set DEVICE_KAL '10000000-0000-4000-a000-000000000004'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set KAL '00000000-0000-4000-a000-000000000001'

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

create function pg_temp.unwind_payload(
  p_order_id uuid,
  p_bill_id uuid,
  p_reason text default 'Wrong tender taken back'
)
returns jsonb language sql immutable as $$
  select jsonb_build_object('orderId', p_order_id, 'billId', p_bill_id, 'reason', p_reason)
$$;

select has_function('public', 'backfill_prepared_history', array[]::text[],
  'the history backfill is a settled, callable maintenance function');

-- One fresh shift on the active Kalyani tablet. The seed's own open shift for
-- this device ends first: one live shift per device is the database's rule.
select pg_temp.unimpersonate();
update public.counter_shifts set ended_at=((current_date - 1) + time '09:00') at time zone 'Asia/Kolkata',
  ended_reason='operator'
 where device_id=:'DEVICE_KAL' and ended_at is null;
insert into public.counter_shifts
  (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at)
values
  ('f5000000-0000-4000-a000-000000000001',
   :'DEVICE_KAL',
   :'KAL',
   :'BILLER_KAL',
   ((current_date - 1) + time '10:00') at time zone 'Asia/Kolkata',
   current_date - 1,
   ((current_date + 1) + time '04:00') at time zone 'Asia/Kolkata');

-- The legacy shape: pay an order without any preparation command. This is
-- byte-for-byte what nine days of pre-deploy history looks like.
select pg_temp.impersonate(:'DEVICE_KAL');
select is(
  public.create_billing_order(
    'f1000000-0000-4000-a000-000000000001', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'f2000000-0000-4000-a000-000000000001',
      'f3000000-0000-4000-a000-000000000001', current_date - 1)),
    ((current_date - 1) + time '12:00') at time zone 'Asia/Kolkata',
    'f5000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'f2000000-0000-4000-a000-000000000001',
      'f3000000-0000-4000-a000-000000000001', current_date - 1)
  ) ->> 'status',
  'accepted', 'the fixture order is accepted');

select is(
  public.pay_billing_order(
    'f1000000-0000-4000-a000-000000000002', 1,
    public.billing_payload_hash(pg_temp.pay_order_payload(
      'f6000000-0000-4000-a000-000000000001',
      'f2000000-0000-4000-a000-000000000001',
      ((current_date - 1) + time '12:10') at time zone 'Asia/Kolkata',
      current_date - 1)),
    ((current_date - 1) + time '12:10') at time zone 'Asia/Kolkata',
    'f5000000-0000-4000-a000-000000000001',
    pg_temp.pay_order_payload(
      'f6000000-0000-4000-a000-000000000001',
      'f2000000-0000-4000-a000-000000000001',
      ((current_date - 1) + time '12:10') at time zone 'Asia/Kolkata',
      current_date - 1)
  ) ->> 'status',
  'accepted', 'the fixture order pays');

select is((select prepared_at from public.orders where id='f2000000-0000-4000-a000-000000000001'),
  null::timestamptz, 'a paid order wears the legacy shape (null prepared_at)');

-- An open order and a cancelled one stand beside it; neither may move.
select pg_temp.impersonate(:'DEVICE_KAL');
select is(
  public.create_billing_order(
    'f1000000-0000-4000-a000-000000000003', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'f2000000-0000-4000-a000-000000000002',
      'f3000000-0000-4000-a000-000000000002', current_date - 1)),
    ((current_date - 1) + time '13:00') at time zone 'Asia/Kolkata',
    'f5000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'f2000000-0000-4000-a000-000000000002',
      'f3000000-0000-4000-a000-000000000002', current_date - 1)
  ) ->> 'status',
  'accepted', 'the still-open fixture order is created');

select is(
  public.create_billing_order(
    'f1000000-0000-4000-a000-000000000004', 1,
    public.billing_payload_hash(pg_temp.order_payload(
      'f2000000-0000-4000-a000-000000000003',
      'f3000000-0000-4000-a000-000000000003', current_date - 1)),
    ((current_date - 1) + time '14:00') at time zone 'Asia/Kolkata',
    'f5000000-0000-4000-a000-000000000001',
    pg_temp.order_payload(
      'f2000000-0000-4000-a000-000000000003',
      'f3000000-0000-4000-a000-000000000003', current_date - 1)
  ) ->> 'status',
  'accepted', 'the to-be-cancelled fixture order is created');

select is(
  public.pay_billing_order(
    'f1000000-0000-4000-a000-000000000005', 1,
    public.billing_payload_hash(pg_temp.pay_order_payload(
      'f6000000-0000-4000-a000-000000000002',
      'f2000000-0000-4000-a000-000000000003',
      ((current_date - 1) + time '14:10') at time zone 'Asia/Kolkata',
      current_date - 1)),
    ((current_date - 1) + time '14:10') at time zone 'Asia/Kolkata',
    'f5000000-0000-4000-a000-000000000001',
    pg_temp.pay_order_payload(
      'f6000000-0000-4000-a000-000000000002',
      'f2000000-0000-4000-a000-000000000003',
      ((current_date - 1) + time '14:10') at time zone 'Asia/Kolkata',
      current_date - 1)
  ) ->> 'status',
  'accepted', 'the to-be-cancelled order pays');

select is(
  public.cancel_paid_billing_order(
    'f1000000-0000-4000-a000-000000000006', 1,
    public.billing_payload_hash(pg_temp.unwind_payload(
      'f2000000-0000-4000-a000-000000000003',
      'f6000000-0000-4000-a000-000000000002',
      'Customer left')),
    ((current_date - 1) + time '14:11') at time zone 'Asia/Kolkata',
    'f5000000-0000-4000-a000-000000000001',
    pg_temp.unwind_payload(
      'f2000000-0000-4000-a000-000000000003',
      'f6000000-0000-4000-a000-000000000002',
      'Customer left'))
  ->> 'status',
  'accepted', 'the fixture order cancels after paid');

-- The backfill itself.
select pg_temp.unimpersonate();
select is(
  public.backfill_prepared_history() >= 1,
  true, 'the backfill moves the legacy-shaped row');

select is((select prepared_at from public.orders where id='f2000000-0000-4000-a000-000000000001'),
  (select paid_at from public.orders where id='f2000000-0000-4000-a000-000000000001'),
  'history reads as prepared at the moment it was paid');

select is((select status from public.bills where id='f6000000-0000-4000-a000-000000000001'),
  'settled', 'the settled bill is untouched by the backfill');
select is((select total_paise from public.bills where id='f6000000-0000-4000-a000-000000000001'),
  13900::bigint, 'the bill keeps its total byte-for-byte');

select is((select prepared_at from public.orders where id='f2000000-0000-4000-a000-000000000002'),
  null::timestamptz, 'an open order is nobody''s history and stays preparing');
select is((select status from public.orders where id='f2000000-0000-4000-a000-000000000003'),
  'cancelled', 'the cancelled order keeps its terminal state');
select is((select prepared_at from public.orders where id='f2000000-0000-4000-a000-000000000003'),
  null::timestamptz, 'a cancelled order is untouched');

-- Running it again changes nothing anywhere.
select is(
  public.backfill_prepared_history(),
  0, 'a second run finds nothing left to move');

select is((select prepared_at from public.orders where id='f2000000-0000-4000-a000-000000000001'),
  (select paid_at from public.orders where id='f2000000-0000-4000-a000-000000000001'),
  'the second run leaves stamped history exactly as it was');

select * from finish();
rollback;
