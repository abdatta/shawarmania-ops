-- Two tablets at one outlet: ownership, removal, and whose end of day counts.
--
-- Everything asserted here was already true of the command layer before this
-- change, and none of it had ever been run with two tablets, because a unique
-- index made a second one unwritable. So this file is the evidence rather than
-- the implementation: if it fails, the claim that the command contract was
-- always concurrency-safe was wrong.
--
-- Three properties, each asserted from both sides:
--
--   1. **Ownership survives having a neighbour.** Revise, pay, cancel and
--      preparation require the tablet that created the order, whoever holds the
--      shift. The neighbouring tablet sees the order on the outlet pipeline and
--      is refused if it acts, and no bill number is consumed by the refusal.
--   2. **Removal is per tablet.** Removing one stops it at the database at once
--      and leaves the other trading, with its shift, its orders and every human
--      assignment untouched.
--   3. **Every tablet that worked the date confirms its own end of day.** One
--      confirmation never covers another, and a later accepted command
--      invalidates only its own tablet's.
--
-- **The two-till shop is built here, not seeded.** The seed is one active tablet
-- per outlet, because that is what the business runs and what a third outlet
-- would open with, so almost every other suite has to keep seeing it. A spare
-- tablet is seeded removed; this file brings it back and opens a shift on it,
-- which makes two tills a state a test asks for rather than one every test
-- inherits.
--
-- It is held by Kalyani's second Biller. Not by its manager and not by its first
-- Biller: each of those is the subject of a test elsewhere asserting they hold
-- no counter. One person holding BOTH tills is legal and is exercised in section
-- 1 below, then put back.

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
  perform set_config('request.jwt.claims', null, true);
  execute 'reset role';
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

\set KAL '00000000-0000-4000-a000-000000000001'
\set TILL_ONE '10000000-0000-4000-a000-000000000004'
\set TILL_TWO '10000000-0000-4000-a000-00000000000f'
\set TILL_KPA '10000000-0000-4000-a000-000000000005'
\set SHIFT_ONE '90000000-0000-4000-a000-000000000001'
\set SHIFT_TWO '90000000-0000-4000-a000-000000000003'
\set BILLER_ONE '10000000-0000-4000-a000-00000000000a'
\set BILLER_TWO '10000000-0000-4000-a000-000000000010'
\set FA_KAL '10000000-0000-4000-a000-000000000002'

-- ---------------------------------------------------------------------------
-- 0. Build the two-till shop, and assert it is the one this file needs.
--
-- Bringing the spare back is what an admin does by setting a tablet up: it
-- becomes an active, proven counter at its own outlet with a shift on it. Doing
-- it by UPDATE rather than through the setup code keeps this file about
-- concurrency; the setup path itself is proved in
-- `23_counter_tablet_and_shift.sql`.

update public.counter_devices
   set removed_at = null, last_seen_at = now()
 where id = '10000000-0000-4000-a000-00000000000f';

insert into public.counter_shifts
  (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at)
select '90000000-0000-4000-a000-000000000003',
       '10000000-0000-4000-a000-00000000000f',
       '00000000-0000-4000-a000-000000000001',
       '10000000-0000-4000-a000-000000000010',
       now() - interval '1 hour',
       public.app_business_date(now(), o.business_day_cutover),
       public.app_next_cutover(now(), o.business_day_cutover)
  from public.outlets o
 where o.id = '00000000-0000-4000-a000-000000000001';

select is(
  (select count(*) from public.counter_devices
    where outlet_id = :'KAL' and removed_at is null and session_proven_at is not null),
  2::bigint,
  'the outlet holds two proven tablets');

select is(
  (select count(distinct device_id) from public.counter_shifts
    where outlet_id = :'KAL' and ended_at is null and expires_at > now()),
  2::bigint,
  'each of them has its own live shift');

select isnt(
  (select person_id from public.counter_shifts where id = :'SHIFT_ONE'),
  (select person_id from public.counter_shifts where id = :'SHIFT_TWO'),
  'held by two different people, so nothing below leans on one operator');

-- The manager's own read, asserted where two tills exist rather than in the
-- snapshot suite, which runs against the ordinary one-till shop.
select pg_temp.impersonate(:'FA_KAL'::uuid);

select is(
  (select count(*) from public.counter_operations_snapshot(array[:'KAL'::uuid])),
  2::bigint,
  'a manager reads every counter at their outlet, not one of them');

select is(
  (select count(distinct device_id) from public.counter_operations_snapshot(array[:'KAL'::uuid])),
  2::bigint,
  'and each row is its own tablet rather than the same one twice');

select pg_temp.unimpersonate();

-- ---------------------------------------------------------------------------
-- 1. One person may hold both counters.
--
-- Opened here rather than seeded. Nothing refuses it: shifts are per device and
-- `app_may_hold_counter_shift` never asks whether somebody already holds one
-- elsewhere. It matters because it is the case where every per-person
-- explanation of a refusal stops working -- the neighbour's order carries the
-- reader's own name -- and it is the reason the pipeline names the till.

select pg_temp.unimpersonate();

select lives_ok($$
  update public.counter_shifts set person_id = '10000000-0000-4000-a000-00000000000a'
   where id = '90000000-0000-4000-a000-000000000003'
$$, 'one person may hold a live shift on each of two tablets at one outlet');

select is(
  (select count(*) from public.counter_shifts
    where person_id = :'BILLER_ONE' and ended_at is null and expires_at > now()),
  2::bigint,
  'and both shifts stay live and distinct');

-- Put it back, so the rest of this file describes the shop it was seeded as.
update public.counter_shifts set person_id = :'BILLER_TWO' where id = :'SHIFT_TWO';

-- ---------------------------------------------------------------------------
-- 2. Ownership survives having a neighbour.

select pg_temp.impersonate(:'TILL_ONE'::uuid);

create temporary table pg_temp.owned as
select 'c1000000-0000-4000-a000-000000000001'::uuid as command_id,
       'a1000000-0000-4000-a000-000000000001'::uuid as order_id,
       'a1000000-0000-4000-a000-000000000002'::uuid as line_id,
       now() as created_at,
       public.app_business_date(now(), time '04:00') as business_date;
grant select on pg_temp.owned to authenticated;

select is(
  (select public.create_billing_order(
     command_id, 1,
     public.billing_payload_hash(pg_temp.order_payload(order_id, line_id, business_date)),
     created_at, :'SHIFT_ONE',
     pg_temp.order_payload(order_id, line_id, business_date)) ->> 'status'
   from pg_temp.owned),
  'accepted',
  'the first tablet creates an order on its own shift');

-- The neighbour can SEE it. That is the pipeline being outlet-wide, and it is
-- why the refusals below have to be refusals rather than absences.
select pg_temp.impersonate(:'TILL_TWO'::uuid);

select is(
  (select count(*) from public.orders o, pg_temp.owned w where o.id = w.order_id),
  1::bigint,
  'the neighbouring tablet reads the order on the outlet pipeline');

-- The widening stops at the outlet, and it is asserted from the other side
-- rather than inferred from the read above. The Kanchrapara tablet holds a live
-- shift of its own, so it is refused by scope and not by having no shift.
select pg_temp.impersonate(:'TILL_KPA'::uuid);

select is(
  (select count(*) from public.orders o, pg_temp.owned w where o.id = w.order_id),
  0::bigint,
  'a tablet at the other outlet reads none of this outlet''s orders');

select is(
  (select count(*) from public.order_items i, pg_temp.owned w where i.order_id = w.order_id),
  0::bigint,
  'nor any of their lines, which inherit the same rule rather than repeating it');

select pg_temp.impersonate(:'TILL_TWO'::uuid);

select is(
  (select count(*) from public.order_items i, pg_temp.owned w where i.order_id = w.order_id),
  1::bigint,
  'while the sibling till reads the lines it needs to know what the kitchen owes');

create temporary table pg_temp.numbers_before as
select coalesce(max(bill_number), 0) as high from public.bills where outlet_id = :'KAL';
grant select on pg_temp.numbers_before to authenticated;

select is(
  (select public.revise_billing_order(
     'c1000000-0000-4000-a000-000000000002'::uuid, 1,
     public.billing_payload_hash(pg_temp.order_payload(order_id, line_id, business_date, 27800)),
     now(), :'SHIFT_TWO',
     pg_temp.order_payload(order_id, line_id, business_date, 27800)) ->> 'status'
   from pg_temp.owned),
  'authorization_refused',
  'the neighbouring tablet cannot revise an order it does not own');

select is(
  (select public.pay_billing_order(
     'c1000000-0000-4000-a000-000000000003'::uuid, 1,
     public.billing_payload_hash(pg_temp.pay_order_payload(
       'b1000000-0000-4000-a000-000000000001'::uuid, order_id, now(), business_date)),
     now(), :'SHIFT_TWO',
     pg_temp.pay_order_payload(
       'b1000000-0000-4000-a000-000000000001'::uuid, order_id, now(), business_date)) ->> 'status'
   from pg_temp.owned),
  'authorization_refused',
  'nor pay it');

select is(
  (select public.cancel_billing_order(
     'c1000000-0000-4000-a000-000000000004'::uuid, 1,
     public.billing_payload_hash(jsonb_build_object('orderId', order_id, 'reason', 'not mine')),
     now(), :'SHIFT_TWO',
     jsonb_build_object('orderId', order_id, 'reason', 'not mine')) ->> 'status'
   from pg_temp.owned),
  'authorization_refused',
  'nor cancel it');

select is(
  (select public.prepare_billing_order(
     'c1000000-0000-4000-a000-000000000005'::uuid, 1,
     public.billing_payload_hash(jsonb_build_object('orderId', order_id, 'prepared', true)),
     now(), :'SHIFT_TWO',
     jsonb_build_object('orderId', order_id, 'prepared', true)) ->> 'status'
   from pg_temp.owned),
  'authorization_refused',
  'nor mark it prepared');

select is(
  (select o.status from public.orders o, pg_temp.owned w where o.id = w.order_id),
  'open',
  'four refusals later the order is exactly as its own tablet left it');

select is(
  (select coalesce(max(bill_number), 0) from public.bills where outlet_id = :'KAL'),
  (select high from pg_temp.numbers_before),
  'and no bill number was consumed by any of them');

-- ---------------------------------------------------------------------------
-- 3. A stranded order is the manager's to clear, and nothing is transferred.

select pg_temp.impersonate(:'FA_KAL'::uuid);

select is(
  (select public.manager_cancel_billing_order(
     'c1000000-0000-4000-a000-000000000006'::uuid, 1,
     public.billing_payload_hash(jsonb_build_object(
       'orderId', order_id, 'reason', 'tablet died mid-service')),
     now(), null,
     jsonb_build_object('orderId', order_id, 'reason', 'tablet died mid-service')) ->> 'status'
   from pg_temp.owned),
  'accepted',
  'the outlet manager cancels a stranded order with a reason, from their own device');

select is(
  (select o.status from public.orders o, pg_temp.owned w where o.id = w.order_id),
  'cancelled',
  'and it is cancelled rather than moved to the other tablet');

select is(
  (select o.device_id from public.orders o, pg_temp.owned w where o.id = w.order_id),
  :'TILL_ONE'::uuid,
  'the order keeps the tablet that took it, because nothing was transferred');

-- ---------------------------------------------------------------------------
-- 4. Removal is per tablet.

select pg_temp.unimpersonate();

create temporary table pg_temp.assignments_before as
select count(*) as total from public.assignments where ended_on is null;
grant select on pg_temp.assignments_before to authenticated;

select is(
  public.remove_counter_device(:'TILL_ONE', :'FA_KAL'),
  'ok',
  'the outlet manager removes one of its two tablets');

select is(
  (select ended_reason from public.counter_shifts where id = :'SHIFT_ONE'),
  'device_removed',
  'the removed tablet takes its own shift with it');

select is(
  (select ended_at from public.counter_shifts where id = :'SHIFT_TWO'),
  null,
  'the other tablet keeps trading, and its shift is untouched');

select pg_temp.impersonate(:'TILL_ONE'::uuid);

select is(
  public.app_device_ok(), false,
  'the removed tablet is refused at the database at its next request');

select is(
  public.app_counter_shift(), null,
  'and it holds no shift, whatever it still has in its browser');

select pg_temp.impersonate(:'TILL_TWO'::uuid);

select is(
  public.app_device_ok(), true,
  'the surviving tablet is unaffected');

select is(
  public.app_counter_shift(), :'SHIFT_TWO'::uuid,
  'and still holds its own live shift');

select pg_temp.unimpersonate();

select is(
  (select count(*) from public.assignments where ended_on is null),
  (select total from pg_temp.assignments_before),
  'and every human assignment is exactly as it was');

-- Put the tablet back, because the readiness section below needs two
-- participants for one date and removal is not what it is about.
update public.counter_devices set removed_at = null where id = :'TILL_ONE';
update public.counter_shifts
   set ended_at = null, ended_reason = null
 where id = :'SHIFT_ONE';

-- ---------------------------------------------------------------------------
-- 5. Every tablet that worked the date confirms its own end of day.
--
-- `billing_day_readiness` builds its participating set from every distinct
-- device with a shift for the outlet and date, and it always did. Nothing here
-- is new code; it is the first time it has been asked about two.
--
-- Read as the outlet's manager, because the function refuses a caller who is
-- neither a tablet of that outlet nor authorised over it, and `postgres` is
-- neither.

create temporary table pg_temp.today as
select public.app_business_date(now(), time '04:00') as business_date;
grant select on pg_temp.today to authenticated;

select pg_temp.impersonate(:'FA_KAL'::uuid);

select is(
  (select public.billing_day_readiness(:'KAL', business_date) ->> 'ready' from pg_temp.today),
  'false',
  'the date is not ready while both tablets still hold live shifts');

select is(
  (select (public.billing_day_readiness(:'KAL', business_date) ->> 'liveShifts')::integer
   from pg_temp.today),
  2::integer,
  'and it counts both of them, rather than one');

select pg_temp.unimpersonate();

-- End both shifts so the only thing outstanding is the confirmations
-- themselves, which is what this section is about.
update public.counter_shifts
   set ended_at = now(), ended_reason = 'operator'
 where id in (:'SHIFT_ONE', :'SHIFT_TWO');

select pg_temp.impersonate(:'FA_KAL'::uuid);

select is(
  (select (public.billing_day_readiness(:'KAL', business_date) ->> 'missingConfirmations')::integer
   from pg_temp.today),
  2::integer,
  'with the shifts closed, both tablets are outstanding');

select pg_temp.unimpersonate();

insert into public.billing_end_of_day_confirmations
  (outlet_id, device_id, business_date, shift_id, confirmed_at, command_watermark)
select :'KAL', :'TILL_ONE', t.business_date, :'SHIFT_ONE', now(),
       -- The watermark a real confirmation carries: everything this tablet had
       -- accepted by the time it confirmed. A zero here would read as stale for
       -- the wrong reason, and section 6 below would prove nothing.
       coalesce((select max(b.watermark) from public.billing_commands b
                  where b.device_id = :'TILL_ONE' and b.result_category = 'accepted'
                    and b.command_type <> 'confirm_end_of_day'
                    and t.business_date in (b.business_date, b.payment_business_date)), 0)
  from pg_temp.today t;

select pg_temp.impersonate(:'FA_KAL'::uuid);

select is(
  (select public.billing_day_readiness(:'KAL', business_date) ->> 'ready' from pg_temp.today),
  'false',
  'one tablet confirming does not make the date ready');

select is(
  (select (public.billing_day_readiness(:'KAL', business_date) ->> 'missingConfirmations')::integer
   from pg_temp.today),
  1::integer,
  'and exactly one tablet is still outstanding, so one confirmation covered only itself');

select pg_temp.unimpersonate();

insert into public.billing_end_of_day_confirmations
  (outlet_id, device_id, business_date, shift_id, confirmed_at, command_watermark)
select :'KAL', :'TILL_TWO', t.business_date, :'SHIFT_TWO', now(),
       coalesce((select max(b.watermark) from public.billing_commands b
                  where b.device_id = :'TILL_TWO' and b.result_category = 'accepted'
                    and b.command_type <> 'confirm_end_of_day'
                    and t.business_date in (b.business_date, b.payment_business_date)), 0)
  from pg_temp.today t;

select pg_temp.impersonate(:'FA_KAL'::uuid);

select is(
  (select public.billing_day_readiness(:'KAL', business_date) ->> 'ready' from pg_temp.today),
  'true',
  'the date is ready only once both tablets have confirmed their own end of day');

-- ---------------------------------------------------------------------------
-- 6. A later accepted command invalidates only its own tablet's confirmation.

select pg_temp.unimpersonate();

update public.billing_end_of_day_confirmations
   set invalidated_at = now(),
       -- Paired by constraint: an invalidation names the command that caused
       -- it, because "this confirmation no longer stands" with no reason is not
       -- a fact anybody can act on.
       invalidated_by_command_id = 'c1000000-0000-4000-a000-000000000001'
 where device_id = :'TILL_ONE' and business_date = (select business_date from pg_temp.today);

select pg_temp.impersonate(:'FA_KAL'::uuid);

select is(
  (select public.billing_day_readiness(:'KAL', business_date) ->> 'ready' from pg_temp.today),
  'false',
  'a tablet whose confirmation was invalidated reopens the date');

select is(
  (select (public.billing_day_readiness(:'KAL', business_date) ->> 'staleConfirmations')::integer
   from pg_temp.today),
  1::integer,
  'and only that tablet is stale: the other one still stands');

select * from finish();

rollback;
