-- #55 the-ticket-is-two-switches, part two: the ticket's edit window.
--
-- The five-minute clock used to run from `paid_at` alone, which treated one of
-- an order's two switches as if it ended the whole ticket. It now ends five
-- minutes after the LATER of payment and preparation, and does not start at all
-- while preparation is unrecorded -- except for a bill that settles no order,
-- which has no preparation to wait for and keeps the payment-time rule.
--
-- Three commands answer to that window and each is exercised on both sides of
-- it here, through hand-crafted requests rather than adapter calls: the database
-- is the only reader that decides.
--
-- The file also proves what replaces `billing_end_of_day_payment_edit_guard`,
-- the trigger #55 removes. The claim the removal rests on is that a closed day
-- ends the shift and `billing_device_context` refuses every command issued
-- afterwards. That is asserted here, not assumed.

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
\set DEVICE_KPA '10000000-0000-4000-a000-000000000005'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set KAL '00000000-0000-4000-a000-000000000001'
-- The tablet's own live shift from the seed, which part one below finishes.
\set TODAYS_SHIFT '90000000-0000-4000-a000-000000000001'
-- A shift of this file's own, for the window cases, opened on the business date
-- before it so its command times are unambiguously in the past.
\set OPEN_SHIFT 'f5000000-0000-4000-a000-000000000001'

-- ---------------------------------------------------------------------------
-- Payload shapes and one wrapper per command, so the assertions below read as
-- the rule they are about rather than as six lines of envelope each.

/** IST wall-clock on a business date, which is how a counter's day reads. */
create function pg_temp.ist(p_date date, p_time time)
returns timestamptz language sql immutable as $$
  select (p_date + p_time) at time zone 'Asia/Kolkata'
$$;

create function pg_temp.order_payload(p_order uuid, p_line uuid, p_date date)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'orderId', p_order,
    'businessDate', p_date,
    'customerId', null, 'customerName', null, 'customerPhone', null,
    'subtotalPaise', 13900, 'discountPaise', 0, 'taxPaise', 0, 'totalPaise', 13900,
    'pricingMode', 'no_tax',
    'lines', jsonb_build_array(jsonb_build_object(
      'id', p_line,
      'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma',
      'unitPricePaise', 13900, 'quantity', 1, 'lineTotalPaise', 13900)))
$$;

create function pg_temp.take_order(p_order uuid, p_cmd uuid, p_at timestamptz,
  p_date date, p_shift uuid)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := pg_temp.order_payload(p_order, gen_random_uuid(), p_date);
  return public.create_billing_order(
    p_cmd, 1, public.billing_payload_hash(v), p_at, p_shift, v) ->> 'status';
end;
$$;

create function pg_temp.pay_order(p_bill uuid, p_order uuid, p_cmd uuid,
  p_at timestamptz, p_date date, p_shift uuid)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object(
    'billId', p_bill, 'orderId', p_order,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amountPaise', 13900)),
    'paidAt', p_at, 'paymentBusinessDate', p_date);
  return public.pay_billing_order(
    p_cmd, 1, public.billing_payload_hash(v), p_at, p_shift, v) ->> 'status';
end;
$$;

create function pg_temp.set_prepared(p_order uuid, p_cmd uuid, p_at timestamptz,
  p_shift uuid)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object('orderId', p_order, 'prepared', true);
  return public.prepare_billing_order(
    p_cmd, 1, public.billing_payload_hash(v), p_at, p_shift, v) ->> 'status';
end;
$$;

create function pg_temp.take_back(p_order uuid, p_bill uuid, p_cmd uuid,
  p_at timestamptz, p_shift uuid)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object('orderId', p_order, 'billId', p_bill, 'reason', 'Wrong tender');
  return public.unpay_billing_order(
    p_cmd, 1, public.billing_payload_hash(v), p_at, p_shift, v) ->> 'status';
end;
$$;

create function pg_temp.cancel_paid(p_order uuid, p_bill uuid, p_cmd uuid,
  p_at timestamptz, p_shift uuid)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object('orderId', p_order, 'billId', p_bill, 'reason', 'Customer left');
  return public.cancel_paid_billing_order(
    p_cmd, 1, public.billing_payload_hash(v), p_at, p_shift, v) ->> 'status';
end;
$$;

create function pg_temp.correct(p_bill uuid, p_revision integer, p_cmd uuid,
  p_at timestamptz, p_shift uuid, p_method text)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object('billId', p_bill, 'expectedRevision', p_revision,
    'payments', jsonb_build_array(jsonb_build_object('method', p_method, 'amountPaise', 13900)));
  return public.correct_bill_payment(
    p_cmd, 1, public.billing_payload_hash(v), p_at, p_shift, v) ->> 'status';
end;
$$;

create function pg_temp.finish_day(p_cmd uuid, p_at timestamptz, p_date date)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object('outletId', '00000000-0000-4000-a000-000000000001',
    'businessDate', p_date, 'unsentCount', 0, 'needsAttentionCount', 0);
  return public.confirm_billing_end_of_day(
    p_cmd, 1, public.billing_payload_hash(v), p_at, null, v) ->> 'status';
end;
$$;

-- ---------------------------------------------------------------------------
-- The window is named once, in the database, and the three commands read it
-- from there rather than from three copies of an expression.

select has_function('public', 'billing_edit_window_end',
  array['timestamp with time zone','timestamp with time zone','boolean'],
  'the ticket edit window is one named derivation');

select is(public.billing_edit_window_end(
  pg_temp.ist(current_date - 1, time '12:00'), null, true),
  null::timestamptz,
  'an order whose food is still owed has no deadline at all');
select is(public.billing_edit_window_end(
  pg_temp.ist(current_date - 1, time '12:00'),
  pg_temp.ist(current_date - 1, time '12:30'), true),
  pg_temp.ist(current_date - 1, time '12:35'),
  'the upfront payer''s clock starts when the food is made');
select is(public.billing_edit_window_end(
  pg_temp.ist(current_date - 1, time '12:30'),
  pg_temp.ist(current_date - 1, time '12:00'), true),
  pg_temp.ist(current_date - 1, time '12:35'),
  'the handover payer''s clock starts when the money is taken');
select is(public.billing_edit_window_end(
  pg_temp.ist(current_date - 1, time '12:00'), null, false),
  pg_temp.ist(current_date - 1, time '12:05'),
  'a bill with no order behind it keeps the payment-time clock');

-- ---------------------------------------------------------------------------
-- Part one: Finish Day, and what replaces the trigger it no longer needs.
--
-- Run first, on the tablet's own live shift, so the shift this part finishes is
-- the newest one this device has when the three refusals below are crafted.
-- Their refusal is then unambiguously the closed day and not some later shift
-- having opened.

select pg_temp.unimpersonate();
select hasnt_function('public', 'reject_open_payment_edit_at_finish',
  'the end-of-day payment-edit guard is gone');
select is((select count(*) from pg_trigger
    where tgname = 'billing_end_of_day_payment_edit_guard' and not tgisinternal),
  0::bigint, 'and so is the trigger that called it');

select pg_temp.impersonate(:'DEVICE_KAL');
select is(pg_temp.take_order('f2000000-0000-4000-a000-0000000000b1',
  'f1000000-0000-4000-a000-000000000001', now(),
  public.app_business_date(now(), time '04:00'), :'TODAYS_SHIFT'),
  'accepted', 'the day to be closed has one order on it');
select is(pg_temp.pay_order('f6000000-0000-4000-a000-0000000000b1',
  'f2000000-0000-4000-a000-0000000000b1', 'f1000000-0000-4000-a000-000000000002',
  now(), public.app_business_date(now(), time '04:00'), :'TODAYS_SHIFT'),
  'accepted', 'and it is paid upfront, before the food is made');

-- Closing a day while a paying customer is still owed food is wrong on its own
-- terms, and under the derived window it would leave an unbounded undo open
-- behind a confirmed day. It is its own refusal, not an open order and not a
-- recent payment, because it sends the biller to different work.
select is(pg_temp.finish_day('f1000000-0000-4000-a000-000000000003', now(),
  public.app_business_date(now(), time '04:00')),
  'unresolved_preparation',
  'Finish Day refuses while an order is paid and not prepared, in its own words');
select ok((select ended_at is null from public.counter_shifts where id = :'TODAYS_SHIFT'),
  'a refused finish leaves the live shift open');

select is(pg_temp.set_prepared('f2000000-0000-4000-a000-0000000000b1',
  'f1000000-0000-4000-a000-000000000004', now(), :'TODAYS_SHIFT'),
  'accepted', 'the food is made');
-- However recent the payment: no guard refuses a day close on the grounds that
-- a payment is still editable. Closing the day ends the window instead.
select is(pg_temp.finish_day('f1000000-0000-4000-a000-000000000005', now(),
  public.app_business_date(now(), time '04:00')),
  'accepted', 'and the day then closes at once, a minute after the money landed');
-- Read unimpersonated: an ended shift is no longer the tablet's own live shift,
-- and the tablet cannot see it.
select pg_temp.unimpersonate();
select is((select ended_reason from public.counter_shifts where id = :'TODAYS_SHIFT'),
  'day_finished', 'the closed day ended its shift');
select pg_temp.impersonate(:'DEVICE_KAL');

-- Now the claim the trigger's removal rests on, proved three times: a command
-- created after the day closed reaches `billing_device_context` first, finds a
-- shift ended for a reason other than an operator's departure, and is refused.
select is(pg_temp.take_back('f2000000-0000-4000-a000-0000000000b1',
  'f6000000-0000-4000-a000-0000000000b1', 'f1000000-0000-4000-a000-000000000006',
  clock_timestamp(), :'TODAYS_SHIFT'),
  'authorization_refused', 'a take-back after the day is finished is refused');
select is(pg_temp.cancel_paid('f2000000-0000-4000-a000-0000000000b1',
  'f6000000-0000-4000-a000-0000000000b1', 'f1000000-0000-4000-a000-000000000007',
  clock_timestamp(), :'TODAYS_SHIFT'),
  'authorization_refused', 'a cancel-after-paid after the day is finished is refused');
select is(pg_temp.correct('f6000000-0000-4000-a000-0000000000b1', 0,
  'f1000000-0000-4000-a000-000000000008', clock_timestamp(), :'TODAYS_SHIFT', 'upi'),
  'authorization_refused', 'a tender correction after the day is finished is refused');

select pg_temp.unimpersonate();
select is((select status from public.bills where id = 'f6000000-0000-4000-a000-0000000000b1'),
  'settled', 'and none of the three moved the money');

-- ---------------------------------------------------------------------------
-- Part two: the window itself, on a shift of this file's own.

insert into public.counter_shifts
  (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at)
values (:'OPEN_SHIFT', :'DEVICE_KAL', :'KAL', :'BILLER_KAL',
  pg_temp.ist(current_date - 1, time '10:00'), current_date - 1,
  pg_temp.ist(current_date + 1, time '04:00'));
select pg_temp.impersonate(:'DEVICE_KAL');

/** An order paid before its food is made: the case that started #55. */
create function pg_temp.upfront_payer(p_order uuid, p_bill uuid, p_seq text)
returns void language plpgsql as $$
begin
  perform pg_temp.take_order(p_order, ('f1000000-0000-4000-a000-0000000001' || p_seq)::uuid,
    pg_temp.ist(current_date - 1, time '11:00'), current_date - 1,
    'f5000000-0000-4000-a000-000000000001');
  perform pg_temp.pay_order(p_bill, p_order,
    ('f1000000-0000-4000-a000-0000000002' || p_seq)::uuid,
    pg_temp.ist(current_date - 1, time '11:01'), current_date - 1,
    'f5000000-0000-4000-a000-000000000001');
end;
$$;

/** An order prepared at 11:30 and paid on handover at 11:40. */
create function pg_temp.handover_payer(p_order uuid, p_bill uuid, p_seq text)
returns void language plpgsql as $$
begin
  perform pg_temp.take_order(p_order, ('f1000000-0000-4000-a000-0000000001' || p_seq)::uuid,
    pg_temp.ist(current_date - 1, time '11:00'), current_date - 1,
    'f5000000-0000-4000-a000-000000000001');
  perform pg_temp.set_prepared(p_order, ('f1000000-0000-4000-a000-0000000003' || p_seq)::uuid,
    pg_temp.ist(current_date - 1, time '11:30'), 'f5000000-0000-4000-a000-000000000001');
  perform pg_temp.pay_order(p_bill, p_order,
    ('f1000000-0000-4000-a000-0000000002' || p_seq)::uuid,
    pg_temp.ist(current_date - 1, time '11:40'), current_date - 1,
    'f5000000-0000-4000-a000-000000000001');
end;
$$;

-- --- Taking a payment back -------------------------------------------------

-- The complaint that started #55: the customer pays when they order, the
-- shawarma takes eight minutes, and at minute six the biller notices the tender
-- was wrong. The ticket is not finished, so the undo is still there.
select pg_temp.upfront_payer('f2000000-0000-4000-a000-000000000001',
  'f6000000-0000-4000-a000-000000000001', '01');
select is(pg_temp.take_back('f2000000-0000-4000-a000-000000000001',
  'f6000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000401',
  pg_temp.ist(current_date - 1, time '12:30'), :'OPEN_SHIFT'),
  'accepted',
  'a take-back on an unprepared order is accepted an hour and a half after paying');
select is((select status from public.orders where id='f2000000-0000-4000-a000-000000000001'),
  'open', 'and the order is back in the pipeline, ready to be paid again');

-- Preparation starts the clock. Inside it, still reversible.
select pg_temp.upfront_payer('f2000000-0000-4000-a000-000000000002',
  'f6000000-0000-4000-a000-000000000002', '02');
select is(pg_temp.set_prepared('f2000000-0000-4000-a000-000000000002',
  'f1000000-0000-4000-a000-000000000402', pg_temp.ist(current_date - 1, time '12:00'),
  :'OPEN_SHIFT'),
  'accepted', 'an upfront payer''s food is made at noon');
select is(pg_temp.take_back('f2000000-0000-4000-a000-000000000002',
  'f6000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000403',
  pg_temp.ist(current_date - 1, time '12:04'), :'OPEN_SHIFT'),
  'accepted', 'a take-back four minutes after preparation is accepted');

-- Outside it, refused permanently.
select pg_temp.upfront_payer('f2000000-0000-4000-a000-000000000003',
  'f6000000-0000-4000-a000-000000000003', '03');
select is(pg_temp.set_prepared('f2000000-0000-4000-a000-000000000003',
  'f1000000-0000-4000-a000-000000000404', pg_temp.ist(current_date - 1, time '12:00'),
  :'OPEN_SHIFT'),
  'accepted', 'another upfront payer''s food is made at noon');
select is(pg_temp.take_back('f2000000-0000-4000-a000-000000000003',
  'f6000000-0000-4000-a000-000000000003', 'f1000000-0000-4000-a000-000000000405',
  pg_temp.ist(current_date - 1, time '12:05'), :'OPEN_SHIFT'),
  'payment_edit_expired', 'and five minutes after preparation it is refused');

-- When payment came last, the clock runs from the payment: `greatest`, not
-- `prepared_at`, or the handover payer's undo would land already expired.
select pg_temp.handover_payer('f2000000-0000-4000-a000-000000000004',
  'f6000000-0000-4000-a000-000000000004', '04');
select is(pg_temp.take_back('f2000000-0000-4000-a000-000000000004',
  'f6000000-0000-4000-a000-000000000004', 'f1000000-0000-4000-a000-000000000406',
  pg_temp.ist(current_date - 1, time '11:44'), :'OPEN_SHIFT'),
  'accepted',
  'a handover payment is reversible four minutes after the money, ten past the food');
select pg_temp.handover_payer('f2000000-0000-4000-a000-000000000005',
  'f6000000-0000-4000-a000-000000000005', '05');
select is(pg_temp.take_back('f2000000-0000-4000-a000-000000000005',
  'f6000000-0000-4000-a000-000000000005', 'f1000000-0000-4000-a000-000000000407',
  pg_temp.ist(current_date - 1, time '11:45'), :'OPEN_SHIFT'),
  'payment_edit_expired',
  'and five minutes past a payment that came last, it is refused');

-- --- Cancelling after payment ----------------------------------------------

select pg_temp.upfront_payer('f2000000-0000-4000-a000-000000000007',
  'f6000000-0000-4000-a000-000000000007', '07');
select is(pg_temp.cancel_paid('f2000000-0000-4000-a000-000000000007',
  'f6000000-0000-4000-a000-000000000007', 'f1000000-0000-4000-a000-000000000409',
  pg_temp.ist(current_date - 1, time '12:30'), :'OPEN_SHIFT'),
  'accepted',
  'the customer who leaves while the food is being made is cancelled, money returned');

select pg_temp.upfront_payer('f2000000-0000-4000-a000-000000000008',
  'f6000000-0000-4000-a000-000000000008', '08');
select is(pg_temp.set_prepared('f2000000-0000-4000-a000-000000000008',
  'f1000000-0000-4000-a000-000000000410', pg_temp.ist(current_date - 1, time '12:00'),
  :'OPEN_SHIFT'),
  'accepted', 'its food is made at noon');
select is(pg_temp.cancel_paid('f2000000-0000-4000-a000-000000000008',
  'f6000000-0000-4000-a000-000000000008', 'f1000000-0000-4000-a000-000000000411',
  pg_temp.ist(current_date - 1, time '12:04'), :'OPEN_SHIFT'),
  'accepted', 'a cancel-after-paid four minutes after preparation is accepted');

select pg_temp.upfront_payer('f2000000-0000-4000-a000-000000000009',
  'f6000000-0000-4000-a000-000000000009', '09');
select is(pg_temp.set_prepared('f2000000-0000-4000-a000-000000000009',
  'f1000000-0000-4000-a000-000000000412', pg_temp.ist(current_date - 1, time '12:00'),
  :'OPEN_SHIFT'),
  'accepted', 'and another''s at noon');
select is(pg_temp.cancel_paid('f2000000-0000-4000-a000-000000000009',
  'f6000000-0000-4000-a000-000000000009', 'f1000000-0000-4000-a000-000000000413',
  pg_temp.ist(current_date - 1, time '12:05'), :'OPEN_SHIFT'),
  'payment_edit_expired', 'five minutes after preparation it is refused');

select pg_temp.handover_payer('f2000000-0000-4000-a000-000000000010',
  'f6000000-0000-4000-a000-000000000010', '10');
select is(pg_temp.cancel_paid('f2000000-0000-4000-a000-000000000010',
  'f6000000-0000-4000-a000-000000000010', 'f1000000-0000-4000-a000-000000000414',
  pg_temp.ist(current_date - 1, time '11:45'), :'OPEN_SHIFT'),
  'payment_edit_expired',
  'and five minutes past a payment that came last, it is refused too');

-- --- Correcting the tender --------------------------------------------------

select pg_temp.upfront_payer('f2000000-0000-4000-a000-000000000011',
  'f6000000-0000-4000-a000-000000000011', '11');
select is(pg_temp.correct('f6000000-0000-4000-a000-000000000011', 0,
  'f1000000-0000-4000-a000-000000000415', pg_temp.ist(current_date - 1, time '12:30'),
  :'OPEN_SHIFT', 'upi'),
  'accepted',
  'the Cash-for-UPI slip is corrected an hour and a half later, the food still being made');
select is(pg_temp.set_prepared('f2000000-0000-4000-a000-000000000011',
  'f1000000-0000-4000-a000-000000000416', pg_temp.ist(current_date - 1, time '13:00'),
  :'OPEN_SHIFT'),
  'accepted', 'then the food is made at one');
select is(pg_temp.correct('f6000000-0000-4000-a000-000000000011', 1,
  'f1000000-0000-4000-a000-000000000417', pg_temp.ist(current_date - 1, time '13:04'),
  :'OPEN_SHIFT', 'cash'),
  'accepted', 'a correction four minutes after preparation is accepted');
select is(pg_temp.correct('f6000000-0000-4000-a000-000000000011', 2,
  'f1000000-0000-4000-a000-000000000418', pg_temp.ist(current_date - 1, time '13:05'),
  :'OPEN_SHIFT', 'upi'),
  'payment_edit_expired', 'and five minutes after preparation it is refused');

select pg_temp.handover_payer('f2000000-0000-4000-a000-000000000012',
  'f6000000-0000-4000-a000-000000000012', '12');
select is(pg_temp.correct('f6000000-0000-4000-a000-000000000012', 0,
  'f1000000-0000-4000-a000-000000000419', pg_temp.ist(current_date - 1, time '11:45'),
  :'OPEN_SHIFT', 'upi'),
  'payment_edit_expired',
  'a correction five minutes past a payment that came last is refused');

-- A bill with no order behind it keeps today's rule. `bills.order_id` is
-- nullable and that null IS the direct sale, so a correction reaching
-- preparation through a join that dropped the null would hand every direct bill
-- an unbounded window. Both sides are asserted, because only the pair rules
-- that out.
select is(public.pay_billing_now(
  'f1000000-0000-4000-a000-000000000420', 1,
  public.billing_payload_hash(jsonb_build_object(
    'billId', 'f6000000-0000-4000-a000-0000000000d1',
    'businessDate', current_date - 1, 'paymentBusinessDate', current_date - 1,
    'customerId', null, 'customerName', null, 'customerPhone', null,
    'subtotalPaise', 13900, 'discountPaise', 0, 'taxPaise', 0, 'totalPaise', 13900,
    'pricingMode', 'no_tax',
    'payments', jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13900)),
    'lines', jsonb_build_array(jsonb_build_object(
      'id', 'f3000000-0000-4000-a000-0000000000d1',
      'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma',
      'unitPricePaise', 13900, 'quantity', 1, 'lineTotalPaise', 13900)))),
  pg_temp.ist(current_date - 1, time '14:00'), :'OPEN_SHIFT',
  jsonb_build_object(
    'billId', 'f6000000-0000-4000-a000-0000000000d1',
    'businessDate', current_date - 1, 'paymentBusinessDate', current_date - 1,
    'customerId', null, 'customerName', null, 'customerPhone', null,
    'subtotalPaise', 13900, 'discountPaise', 0, 'taxPaise', 0, 'totalPaise', 13900,
    'pricingMode', 'no_tax',
    'payments', jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13900)),
    'lines', jsonb_build_array(jsonb_build_object(
      'id', 'f3000000-0000-4000-a000-0000000000d1',
      'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma',
      'unitPricePaise', 13900, 'quantity', 1, 'lineTotalPaise', 13900)))
  ) ->> 'status',
  'accepted', 'a direct sale is rung and paid without an order');
select is((select order_id from public.bills where id='f6000000-0000-4000-a000-0000000000d1'),
  null::uuid, 'and it really does carry no order');
select is(pg_temp.correct('f6000000-0000-4000-a000-0000000000d1', 0,
  'f1000000-0000-4000-a000-000000000421', pg_temp.ist(current_date - 1, time '14:04'),
  :'OPEN_SHIFT', 'upi'),
  'accepted', 'its tender is correctable for five minutes after payment');
select is(pg_temp.correct('f6000000-0000-4000-a000-0000000000d1', 1,
  'f1000000-0000-4000-a000-000000000422', pg_temp.ist(current_date - 1, time '14:05'),
  :'OPEN_SHIFT', 'cash'),
  'payment_edit_expired',
  'and refused after them, because there is no preparation for its clock to wait on');

-- ---------------------------------------------------------------------------
-- The window moved a deadline, not an authority: every ownership check still
-- runs ahead of it, so a widened window never widens who may use it.

select pg_temp.upfront_payer('f2000000-0000-4000-a000-000000000013',
  'f6000000-0000-4000-a000-000000000013', '13');
select pg_temp.impersonate(:'DEVICE_KPA');
select is(pg_temp.take_back('f2000000-0000-4000-a000-000000000013',
  'f6000000-0000-4000-a000-000000000013', 'f1000000-0000-4000-a000-000000000423',
  pg_temp.ist(current_date - 1, time '11:02'), :'OPEN_SHIFT'),
  'authorization_refused',
  'another tablet cannot take back a payment it did not take, deadline or no deadline');
select pg_temp.unimpersonate();
select is((select status from public.bills where id='f6000000-0000-4000-a000-000000000013'),
  'settled', 'and the money it could not reach is untouched');

select * from finish();
rollback;
