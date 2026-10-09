-- #69 the-day-change-finishes-paid-orders.
--
-- A paid order is eventually served, and the outlet's cutover is the first
-- instant that is reliably true. The day change marks every paid, unprepared
-- order prepared AT the cutover ending its payment's business day, as
-- `prepared_source = 'day_change'`, from stored facts only -- so a sweep that
-- runs late writes what a sweep on the minute would have written. A tick queued
-- offline before the cutover supersedes the stamp; a take-back clears it. No
-- client role can write the source or run the sweep.
--
-- Every instant is built from a business date three days back, so every
-- cutover named here has passed whatever the hour this runs at, and the sweep is
-- driven through `p_now` rather than waiting for a real one.

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
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set OWNER '10000000-0000-4000-a000-000000000001'
\set KAL '00000000-0000-4000-a000-000000000001'
\set SHIFT 'e5000000-0000-4000-a000-000000000001'

-- The cutover is read once, while the session is still privileged.
do $do$ begin
  execute format(
    'create function pg_temp.business_today() returns date language sql stable as %L',
    format('select public.app_business_date(now(), %L::time)',
      (select business_day_cutover from public.outlets
        where id = '00000000-0000-4000-a000-000000000001')));
end $do$;

/** The trading day under test: three days back, so its cutovers have passed. */
create function pg_temp.d() returns date language sql stable as $$
  select pg_temp.business_today() - 3
$$;

create function pg_temp.ist(p_date date, p_time time)
returns timestamptz language sql immutable as $$
  select (p_date + p_time) at time zone 'Asia/Kolkata'
$$;

/** When business day p_date ends at Kalyani (04:00 cutover). */
create function pg_temp.day_end(p_date date)
returns timestamptz language sql immutable as $$
  select ((p_date + 1) + time '04:00') at time zone 'Asia/Kolkata'
$$;

create function pg_temp.take_order(p_order uuid, p_at timestamptz, p_date date)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object(
    'orderId', p_order,
    'businessDate', p_date,
    'customerId', null, 'customerName', null, 'customerPhone', null,
    'subtotalPaise', 13900, 'discountPaise', 0, 'taxPaise', 0, 'totalPaise', 13900,
    'pricingMode', 'no_tax',
    'lines', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(),
      'menuItemId', '31000000-0000-4000-a000-000000000001',
      'itemName', 'Classic Chicken Shawarma',
      'unitPricePaise', 13900, 'quantity', 1, 'lineTotalPaise', 13900)));
  return public.create_billing_order(
    gen_random_uuid(), 1, public.billing_payload_hash(v), p_at,
    'e5000000-0000-4000-a000-000000000001', v) ->> 'status';
end;
$$;

create function pg_temp.pay_order(p_bill uuid, p_order uuid, p_at timestamptz, p_date date)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object(
    'billId', p_bill, 'orderId', p_order,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amountPaise', 13900)),
    'paidAt', p_at, 'paymentBusinessDate', p_date);
  return public.pay_billing_order(
    gen_random_uuid(), 1, public.billing_payload_hash(v), p_at,
    'e5000000-0000-4000-a000-000000000001', v) ->> 'status';
end;
$$;

create function pg_temp.set_prepared(p_order uuid, p_prepared boolean, p_at timestamptz)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object('orderId', p_order, 'prepared', p_prepared);
  return public.prepare_billing_order(
    gen_random_uuid(), 1, public.billing_payload_hash(v), p_at,
    'e5000000-0000-4000-a000-000000000001', v) ->> 'status';
end;
$$;

create function pg_temp.take_back(p_order uuid, p_bill uuid, p_at timestamptz)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object('orderId', p_order, 'billId', p_bill, 'reason', 'Wrong tender');
  return public.unpay_billing_order(
    gen_random_uuid(), 1, public.billing_payload_hash(v), p_at,
    'e5000000-0000-4000-a000-000000000001', v) ->> 'status';
end;
$$;

create function pg_temp.cancel_order(p_order uuid, p_at timestamptz)
returns text language plpgsql as $$
declare v jsonb;
begin
  v := jsonb_build_object('orderId', p_order, 'reason', 'Customer left');
  return public.cancel_billing_order(
    gen_random_uuid(), 1, public.billing_payload_hash(v), p_at,
    'e5000000-0000-4000-a000-000000000001', v) ->> 'status';
end;
$$;

/** A paid order nobody ticked: taken at p_take, paid at p_pay. */
create function pg_temp.paid_unticked(p_order uuid, p_bill uuid, p_take timestamptz,
  p_pay timestamptz)
returns void language plpgsql as $$
begin
  perform pg_temp.take_order(p_order, p_take,
    public.app_business_date(p_take, time '04:00'));
  perform pg_temp.pay_order(p_bill, p_order, p_pay,
    public.app_business_date(p_pay, time '04:00'));
end;
$$;

create function pg_temp.sweep(p_now timestamptz) returns integer
language sql as $$ select public.finish_paid_orders_at_day_change(p_now) $$;

-- ---------------------------------------------------------------------------
-- Shape: the column, its pairing, the helper, the job, and what was retired.

select has_column('public', 'orders', 'prepared_source', 'an order records who finished it');
select has_function('public', 'app_business_day_end', array['date', 'time without time zone'],
  'when a business day ends has one definition');
select is(public.app_business_day_end(date '2026-09-17', time '04:00'),
  timestamptz '2026-09-18 04:00:00+05:30',
  'business day 17 Sep ends at 04:00 IST on 18 Sep');
select is(public.app_next_cutover(timestamptz '2026-09-17 22:05:00+05:30', time '04:00'),
  timestamptz '2026-09-18 04:00:00+05:30',
  'a shift''s expiry still reads the same, through the shared definition');
select is(public.app_next_cutover(timestamptz '2026-09-18 01:46:00+05:30', time '04:00'),
  timestamptz '2026-09-18 04:00:00+05:30',
  'and from after midnight, the same cutover');
select is((select count(*) from cron.job
    where jobname = 'day-change-finishes-paid-orders'
      and schedule = '*/10 * * * *'),
  1::bigint, 'the day change runs every ten minutes: its stamp is the cutover, whenever it runs');
select is((select count(*) from cron.job
    where jobname = 'cron-run-history-keeps-a-week'
      and schedule = '30 23 * * *'
      and command like '%delete from cron.job_run_details%7 days%'),
  1::bigint, 'and the run history of every job keeps a week, purged daily at 05:00 IST');
select hasnt_function('public', 'backfill_prepared_history',
  'the laptop repair is retired');
select is((select count(*) from public.orders
    where (prepared_at is null) <> (prepared_source is null)),
  0::bigint, 'every existing preparation carries a source, and no source stands alone');

-- ---------------------------------------------------------------------------
-- A shift of this file's own, opened on the trading day under test and still
-- live, so every command below is a present-tense counter command.

-- The seed's own live shift on this tablet steps aside first: one open shift
-- per tablet.
update public.counter_shifts set ended_at = now(), ended_reason = 'operator'
 where device_id = :'DEVICE_KAL' and ended_at is null;

insert into public.counter_shifts
  (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at)
values (:'SHIFT', :'DEVICE_KAL', :'KAL', :'BILLER_KAL',
  pg_temp.ist(pg_temp.d(), time '10:00'), pg_temp.d(),
  pg_temp.ist(pg_temp.business_today() + 1, time '04:00'));

select pg_temp.impersonate(:'DEVICE_KAL');

-- A: the forgotten tick. Paid 22:05, never ticked.
select pg_temp.paid_unticked('e2000000-0000-4000-a000-00000000000a',
  'e6000000-0000-4000-a000-00000000000a',
  pg_temp.ist(pg_temp.d(), time '21:44'), pg_temp.ist(pg_temp.d(), time '22:05'));
-- B: taken 03:55 on the next calendar day (business date D), paid 04:05 (D+1).
select is(pg_temp.take_order('e2000000-0000-4000-a000-00000000000b',
  pg_temp.ist(pg_temp.d() + 1, time '03:55'), pg_temp.d()),
  'accepted', 'an order taken five minutes before the cutover');
select is(pg_temp.pay_order('e6000000-0000-4000-a000-00000000000b',
  'e2000000-0000-4000-a000-00000000000b',
  pg_temp.ist(pg_temp.d() + 1, time '04:05'), pg_temp.d() + 1),
  'accepted', 'is paid five minutes after it, on the next payment day');
-- C: swept for the first time three hours late.
select pg_temp.paid_unticked('e2000000-0000-4000-a000-00000000000c',
  'e6000000-0000-4000-a000-00000000000c',
  pg_temp.ist(pg_temp.d(), time '20:00'), pg_temp.ist(pg_temp.d(), time '20:10'));
-- E: open and unpaid. F: paid and ticked by the counter. X: cancelled.
select pg_temp.take_order('e2000000-0000-4000-a000-00000000000e',
  pg_temp.ist(pg_temp.d(), time '21:00'), pg_temp.d());
select pg_temp.paid_unticked('e2000000-0000-4000-a000-00000000000f',
  'e6000000-0000-4000-a000-00000000000f',
  pg_temp.ist(pg_temp.d(), time '19:00'), pg_temp.ist(pg_temp.d(), time '19:05'));
select is(pg_temp.set_prepared('e2000000-0000-4000-a000-00000000000f', true,
  pg_temp.ist(pg_temp.d(), time '19:12')), 'accepted', 'F is ticked at the counter');
select pg_temp.take_order('e2000000-0000-4000-a000-0000000000a1',
  pg_temp.ist(pg_temp.d(), time '21:10'), pg_temp.d());
select is(pg_temp.cancel_order('e2000000-0000-4000-a000-0000000000a1',
  pg_temp.ist(pg_temp.d(), time '21:12')), 'accepted', 'X is cancelled');
-- G: a tick queued offline at 23:40, delivered after the sweep.
-- H: a tick whose own time is after the stamp.
-- I: a take-back queued offline at 23:55, delivered after the sweep.
select pg_temp.paid_unticked('e2000000-0000-4000-a000-000000000001',
  'e6000000-0000-4000-a000-000000000001',
  pg_temp.ist(pg_temp.d(), time '22:00'), pg_temp.ist(pg_temp.d(), time '22:01'));
select pg_temp.paid_unticked('e2000000-0000-4000-a000-000000000002',
  'e6000000-0000-4000-a000-000000000002',
  pg_temp.ist(pg_temp.d(), time '22:10'), pg_temp.ist(pg_temp.d(), time '22:11'));
select pg_temp.paid_unticked('e2000000-0000-4000-a000-000000000003',
  'e6000000-0000-4000-a000-000000000003',
  pg_temp.ist(pg_temp.d(), time '23:45'), pg_temp.ist(pg_temp.d(), time '23:50'));

select pg_temp.unimpersonate();

-- ---------------------------------------------------------------------------
-- A tick writes the counter as its source; a reprepare clears both columns.

select is((select prepared_source from public.orders
    where id = 'e2000000-0000-4000-a000-00000000000f'),
  'counter', 'a counter tick records the counter as its source');

-- ---------------------------------------------------------------------------
-- The sweep, either side of the cutover ending day D.

create temporary table day_change_receipts as
  select count(*) as n from public.billing_commands;
create temporary table day_change_confirmations as
  select count(*) filter (where invalidated_at is null) as live
    from public.billing_end_of_day_confirmations;

select is(pg_temp.sweep(pg_temp.day_end(pg_temp.d()) - interval '1 second') >= 0, true,
  'a sweep one second before the cutover runs');
select is((select prepared_at from public.orders where id = 'e2000000-0000-4000-a000-00000000000a'),
  null::timestamptz, 'and finishes nothing paid on the day still trading');

select pg_temp.sweep(pg_temp.day_end(pg_temp.d()) + interval '1 second');

select is((select prepared_at from public.orders where id = 'e2000000-0000-4000-a000-00000000000a'),
  pg_temp.day_end(pg_temp.d()),
  'a forgotten tick reads prepared at the cutover itself, not when the sweep ran');
select is((select prepared_source from public.orders where id = 'e2000000-0000-4000-a000-00000000000a'),
  'day_change', 'and as the day change''s, not a person''s');
select is((select status from public.orders where id = 'e2000000-0000-4000-a000-00000000000a'),
  'paid', 'and its money is untouched');

select is((select prepared_at from public.orders where id = 'e2000000-0000-4000-a000-00000000000b'),
  null::timestamptz,
  'an order paid after midnight on the next payment day is not finished at the earlier cutover');

select is((select prepared_at from public.orders where id = 'e2000000-0000-4000-a000-00000000000e'),
  null::timestamptz, 'an unpaid open order is untouched');
select is((select status from public.orders where id = 'e2000000-0000-4000-a000-00000000000e'),
  'open', 'and stays open');
select is((select prepared_at from public.orders where id = 'e2000000-0000-4000-a000-00000000000f'),
  pg_temp.ist(pg_temp.d(), time '19:12'), 'a counter tick is untouched');
select is((select prepared_source from public.orders where id = 'e2000000-0000-4000-a000-0000000000a1'),
  null, 'a cancelled order is untouched');

select is((select count(*) from public.billing_commands),
  (select n from day_change_receipts),
  'the sweep writes no billing command receipt');
select is((select count(*) filter (where invalidated_at is null)
    from public.billing_end_of_day_confirmations),
  (select live from day_change_confirmations),
  'and invalidates no tablet''s day confirmation');

-- Late: C was first swept three hours after the cutover. Same stamp.
select is((select prepared_at from public.orders where id = 'e2000000-0000-4000-a000-00000000000c'),
  pg_temp.day_end(pg_temp.d()), 'a second order on the same day carries the same cutover');
select is(pg_temp.sweep(pg_temp.day_end(pg_temp.d()) + interval '3 hours') >= 0, true,
  'a sweep three hours later runs');
select is((select prepared_at from public.orders where id = 'e2000000-0000-4000-a000-00000000000a'),
  pg_temp.day_end(pg_temp.d()), 'and rewrites nothing it already finished');

-- B is finished only at the cutover ending its payment day.
select pg_temp.sweep(pg_temp.day_end(pg_temp.d() + 1) + interval '1 second');
select is((select prepared_at from public.orders where id = 'e2000000-0000-4000-a000-00000000000b'),
  pg_temp.day_end(pg_temp.d() + 1),
  'an order paid at 04:05 is finished at the cutover ending its payment day');
select ok((select prepared_at >= paid_at from public.orders
    where id = 'e2000000-0000-4000-a000-00000000000b'),
  'and never reads prepared before it was paid');

-- ---------------------------------------------------------------------------
-- A late tick supersedes; a later one changes nothing; a second tick on a
-- counter-ticked order is still refused.

select pg_temp.impersonate(:'DEVICE_KAL');
select is(pg_temp.set_prepared('e2000000-0000-4000-a000-000000000001', true,
  pg_temp.ist(pg_temp.d(), time '23:40')),
  'accepted', 'a tick queued offline at 23:40 and delivered after the sweep is accepted');
select is(pg_temp.set_prepared('e2000000-0000-4000-a000-000000000002', true,
  pg_temp.day_end(pg_temp.d()) + interval '10 minutes'),
  'accepted', 'a tick whose own time is after the stamp is accepted too');
select is(pg_temp.set_prepared('e2000000-0000-4000-a000-00000000000f', true,
  pg_temp.ist(pg_temp.d(), time '23:00')),
  'order_not_open', 'a second tick on an order the counter already ticked is refused');
select pg_temp.unimpersonate();

select is((select prepared_at from public.orders where id = 'e2000000-0000-4000-a000-000000000001'),
  pg_temp.ist(pg_temp.d(), time '23:40'), 'the counter''s own time replaces the cutover');
select is((select prepared_source from public.orders where id = 'e2000000-0000-4000-a000-000000000001'),
  'counter', 'and the counter becomes its source, so it is not counted as forgotten');
select is((select prepared_at from public.orders where id = 'e2000000-0000-4000-a000-000000000002'),
  pg_temp.day_end(pg_temp.d()), 'a tick later than the stamp leaves it as it was');
select is((select prepared_source from public.orders where id = 'e2000000-0000-4000-a000-000000000002'),
  'day_change', 'still the day change''s');

-- ---------------------------------------------------------------------------
-- A take-back delivered after the sweep clears the stamp: the preparation was
-- premised on the payment it removes.

select pg_temp.impersonate(:'DEVICE_KAL');
select is(pg_temp.take_back('e2000000-0000-4000-a000-000000000003',
  'e6000000-0000-4000-a000-000000000003', pg_temp.ist(pg_temp.d(), time '23:55')),
  'accepted', 'a take-back queued at 23:55 inside its window is accepted after the sweep');
select pg_temp.unimpersonate();
select is((select status from public.orders where id = 'e2000000-0000-4000-a000-000000000003'),
  'open', 'the order is open again');
select is((select prepared_at from public.orders where id = 'e2000000-0000-4000-a000-000000000003'),
  null::timestamptz, 'with no preparation');
select is((select prepared_source from public.orders where id = 'e2000000-0000-4000-a000-000000000003'),
  null, 'and no source');

-- A reprepare on an open, counter-ticked order clears both columns.
select pg_temp.impersonate(:'DEVICE_KAL');
select is(pg_temp.set_prepared('e2000000-0000-4000-a000-00000000000e', true,
  pg_temp.ist(pg_temp.d(), time '21:30')), 'accepted', 'an open order is ticked');
select is(pg_temp.set_prepared('e2000000-0000-4000-a000-00000000000e', false,
  pg_temp.ist(pg_temp.d(), time '21:31')), 'accepted', 'and reprepared');
select pg_temp.unimpersonate();
select is((select prepared_source from public.orders where id = 'e2000000-0000-4000-a000-00000000000e'),
  null, 'a reprepare clears the source with the time');

-- ---------------------------------------------------------------------------
-- Counting what the day change did, the query the owner was promised.

select is((select count(*) from public.orders x
    join public.bills b on b.id = x.bill_id
   where x.prepared_source = 'day_change'
     and x.id::text like 'e2000000-%'),
  4::bigint, 'the day change owns A, B, C and H; the reclaimed tick and the take-back are not counted');

-- ---------------------------------------------------------------------------
-- No client role writes the source or runs the sweep.

select pg_temp.impersonate(:'DEVICE_KAL');
select throws_ok(
  $$update public.orders set prepared_source = 'day_change'
      where id = 'e2000000-0000-4000-a000-00000000000f'$$,
  null, 'a tablet cannot write the source by hand');
select throws_ok($$select public.finish_paid_orders_at_day_change(now())$$,
  '42501', null, 'a tablet cannot run the sweep');

select pg_temp.impersonate(:'FA_KAL');
select throws_ok(
  $$update public.orders set prepared_source = 'day_change'
      where id = 'e2000000-0000-4000-a000-00000000000f'$$,
  null, 'a Franchise Admin cannot write the source by hand');
select throws_ok($$select public.finish_paid_orders_at_day_change(now())$$,
  '42501', null, 'a Franchise Admin cannot run the sweep');

select pg_temp.impersonate(:'OWNER');
select throws_ok(
  $$update public.orders set prepared_source = 'day_change'
      where id = 'e2000000-0000-4000-a000-00000000000f'$$,
  null, 'the owner cannot write the source by hand');
select throws_ok($$select public.finish_paid_orders_at_day_change(now())$$,
  '42501', null, 'the owner cannot run the sweep');
select pg_temp.unimpersonate();

select is((select prepared_source from public.orders where id = 'e2000000-0000-4000-a000-00000000000f'),
  'counter', 'and the source is unchanged');

select * from finish();
rollback;
