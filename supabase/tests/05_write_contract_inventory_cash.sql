-- The inventory ledger and the daily cash snapshot: the two places where a
-- derived figure must be structurally trustworthy.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

select is(
  enum_range(null::public.payment_method)::text[],
  array['cash', 'upi', 'swiggy', 'zomato']::text[],
  'the payment enum contains the four methods the outlets actually accept');

select throws_ok(
  $q$ select 'card'::public.payment_method $q$,
  '22P02',
  null,
  'a handcrafted card payment is refused by the database type');

select throws_ok(
  $q$ select 'other'::public.payment_method $q$,
  '22P02',
  null,
  'a handcrafted other payment is refused by the database type');

-- Claims carry `sub` and nothing about authority (multi-outlet-people): scope
-- is resolved from the seeded `assignments` rows, exactly as a real session's
-- is.
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

-- ---------------------------------------------------------------------------
-- Ledger → cache.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

-- Seeded Kalyani chicken: 20 − 6.5 − 0.5 − 1 = 12.
select is(
  (select current_quantity from public.inventory_items
    where id = '60000000-0000-4000-a000-000000000001'),
  12::numeric,
  'the seeded ledger produced the expected cache value');

select lives_ok($q$
  insert into public.inventory_movements
    (outlet_id, inventory_item_id, movement_type, quantity_delta, unit_cost_paise, recorded_by, business_date)
  values ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
          'added', 5, 22000, '10000000-0000-4000-a000-000000000002', current_date)
$q$, 'a movement lands');

select is(
  (select current_quantity from public.inventory_items
    where id = '60000000-0000-4000-a000-000000000001'),
  17::numeric,
  'the cache moved by exactly the delta');

-- Sign and completeness constraints.
select throws_ok($q$
  insert into public.inventory_movements
    (outlet_id, inventory_item_id, movement_type, quantity_delta, recorded_by, business_date)
  values ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
          'used', 3, '10000000-0000-4000-a000-000000000002', current_date)
$q$, '23514', null, 'a positive "used" movement is rejected');

select throws_ok($q$
  insert into public.inventory_movements
    (outlet_id, inventory_item_id, movement_type, quantity_delta, recorded_by, business_date)
  values ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
          'added', 5, '10000000-0000-4000-a000-000000000002', current_date)
$q$, '23514', null, 'an "added" movement without a unit cost is rejected');

select throws_ok($q$
  insert into public.inventory_movements
    (outlet_id, inventory_item_id, movement_type, quantity_delta, recorded_by, business_date)
  values ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
          'correction', -1, '10000000-0000-4000-a000-000000000002', current_date)
$q$, '23514', null, 'a correction without a note is rejected');

-- A movement whose outlet does not match its item's outlet is refused even
-- when the session could otherwise write both sides.
select throws_ok($q$
  insert into public.inventory_movements
    (outlet_id, inventory_item_id, movement_type, quantity_delta, unit_cost_paise, recorded_by, business_date)
  values ('00000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000011',
          'added', 5, 1000, '10000000-0000-4000-a000-000000000002', current_date)
$q$, 'P0001', null, 'a movement pointing at another outlet''s item is refused');

-- Direct cache writes are a privilege violation, not just a policy one.
select throws_ok($q$
  update public.inventory_items set current_quantity = 999
   where id = '60000000-0000-4000-a000-000000000001'
$q$, '42501', null, 'no client writes the cache directly');

-- Items enter at zero; opening stock is a movement.
select throws_ok($q$
  insert into public.inventory_items (outlet_id, name, unit, current_quantity)
  values ('00000000-0000-4000-a000-000000000001', 'Smuggled Stock', 'kg', 100)
$q$, '42501', null, 'an item cannot be born with stock outside the ledger');

select lives_ok($q$
  update public.inventory_items set low_stock_threshold = 6
   where id = '60000000-0000-4000-a000-000000000001'
$q$, 'descriptive fields remain editable by the franchise admin');

-- Movements are history.
reset role;

select throws_ok($q$
  update public.inventory_movements set quantity_delta = 100
   where inventory_item_id = '60000000-0000-4000-a000-000000000001'
$q$, 'P0001', null, 'movements cannot be edited, even by the owner');

select throws_ok($q$
  delete from public.inventory_movements
   where inventory_item_id = '60000000-0000-4000-a000-000000000001'
$q$, 'P0001', null, 'movements cannot be deleted, even by the owner');

-- The invariant, across every item in the database.
select is(
  (select count(*) from (
     select i.id
       from public.inventory_items i
       left join public.inventory_movements m on m.inventory_item_id = i.id
      group by i.id, i.current_quantity
     having i.current_quantity <> coalesce(sum(m.quantity_delta), 0)
   ) mismatched),
  0::bigint,
  'every item''s cache equals the sum of its ledger');

-- ---------------------------------------------------------------------------
-- Day close.

reset role;

-- A historical tablet shift participated in D-1 and has explicitly confirmed
-- that date. It is ended, so it does not block close; the late command below
-- will invalidate this confirmation without rewriting the closed snapshot.
insert into public.counter_shifts
  (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at,
   ended_at, ended_reason)
values
  ('bbbbbbbb-0000-4000-a000-000000000010',
   '10000000-0000-4000-a000-000000000004',
   '00000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-00000000000a',
   ((current_date - 1) + time '21:00') at time zone 'Asia/Kolkata',
   current_date - 1,
   ((current_date - 1) + time '23:00') at time zone 'Asia/Kolkata',
   ((current_date - 1) + time '23:00') at time zone 'Asia/Kolkata',
   'operator');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);

select is(
  public.confirm_billing_end_of_day(
    'bbbbbbbb-0000-4000-a000-000000000015', 1,
    public.billing_payload_hash(jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', null,
      'needsAttentionCount', 0)),
    now(), null,
    jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', null,
      'needsAttentionCount', 0)
  ) ->> 'status',
  'malformed_payload',
  'an explicit null unsent count cannot bypass confirmation');

select is(
  public.confirm_billing_end_of_day(
    'bbbbbbbb-0000-4000-a000-000000000016', 1,
    public.billing_payload_hash(jsonb_build_object(
      'outletId', null,
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 0)),
    now(), null,
    jsonb_build_object(
      'outletId', null,
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 0)
  ) ->> 'status',
  'malformed_payload',
  'an explicit null outlet cannot bypass confirmation');

select is(
  public.confirm_billing_end_of_day(
    'bbbbbbbb-0000-4000-a000-000000000017', 1,
    public.billing_payload_hash(jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', '0',
      'needsAttentionCount', '0')),
    now(), null,
    jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', '0',
      'needsAttentionCount', '0')
  ) ->> 'status',
  'malformed_payload',
  'string counts cannot masquerade as JSON numbers');

select is(
  public.confirm_billing_end_of_day(
    'bbbbbbbb-0000-4000-a000-000000000012', 1,
    public.billing_payload_hash(jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 1)),
    now(), null,
    jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 1)
  ) ->> 'status',
  'unresolved_operations',
  'a needs-attention operation blocks end-of-day confirmation');

select is(
  public.confirm_billing_end_of_day(
    'bbbbbbbb-0000-4000-a000-000000000011', 1,
    public.billing_payload_hash(jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 0)),
    now(), null,
    jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 0)
  ) ->> 'status',
  'accepted',
  'the participating tablet confirms D-1 after its historical shift ended');

select is(
  public.confirm_billing_end_of_day(
    'bbbbbbbb-0000-4000-a000-000000000011', 1,
    public.billing_payload_hash(jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 0)),
    now(), null,
    jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 0)
  ) ->> 'watermark',
  (select watermark::text from public.billing_commands
    where id='bbbbbbbb-0000-4000-a000-000000000011'),
  'an exact confirmation replay returns its original watermark');

select is(
  public.confirm_billing_end_of_day(
    'bbbbbbbb-0000-4000-a000-000000000011', 1,
    public.billing_payload_hash(jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 0)),
    now(), null,
    jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 0)
  ) ->> 'status',
  'replay',
  'an exact confirmation retry is explicitly classified as replay');

reset role;
insert into public.counter_shifts
  (id, device_id, outlet_id, person_id, opened_at, business_date, expires_at,
   ended_at, ended_reason)
values
  ('bbbbbbbb-0000-4000-a000-000000000013',
   '10000000-0000-4000-a000-000000000004',
   '00000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-00000000000a',
   ((current_date - 1) + time '23:10') at time zone 'Asia/Kolkata',
   current_date - 1,
   ((current_date - 1) + time '23:20') at time zone 'Asia/Kolkata',
   ((current_date - 1) + time '23:20') at time zone 'Asia/Kolkata',
   'operator');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);
select ok(
  (public.billing_day_readiness(
    '00000000-0000-4000-a000-000000000001', current_date - 1
  )->>'staleConfirmations')::integer > 0,
  'a later no-sale shift invalidates the earlier tablet confirmation');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);
select is(
  public.confirm_billing_end_of_day(
    'bbbbbbbb-0000-4000-a000-000000000014', 1,
    public.billing_payload_hash(jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 0)),
    now(), null,
    jsonb_build_object(
      'outletId', '00000000-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'unsentCount', 0,
      'needsAttentionCount', 0)
  ) ->> 'status',
  'accepted',
  'the tablet must reconfirm after its final shift');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

-- D-1 at Kalyani: no cash bills (the 00:20 bill belongs to D-2), one cash
-- expense of 50000, no withdrawals.
select lives_ok($q$
  select public.close_business_day(
    '00000000-0000-4000-a000-000000000001', current_date - 1, 100000, 50000,
    'Test close (synthetic)')
$q$, 'the franchise admin closes D-1');

select results_eq(
  $q$ select cash_sales_paise, cash_expenses_paise, cash_withdrawn_paise,
             expected_closing_paise, difference_paise
        from public.daily_cash_records
       where outlet_id = '00000000-0000-4000-a000-000000000001'
         and business_date = current_date - 1 $q$,
  $q$ values (0::bigint, 50000::bigint, 0::bigint, 50000::bigint, 0::bigint) $q$,
  'the snapshot figures are computed by the database, not supplied');

select throws_ok($q$
  select public.close_business_day(
    '00000000-0000-4000-a000-000000000001', current_date - 2, 100000, 100000, null)
$q$, 'P0001', null, 'closing an already-closed day is refused');

select throws_ok($q$
  select public.close_business_day(
    '00000000-0000-4000-a000-000000000002', current_date - 1, 100000, 100000, null)
$q$, 'P0001', null, 'closing another outlet''s day is refused');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select throws_ok($q$
  select public.close_business_day(
    '00000000-0000-4000-a000-000000000001', current_date, 100000, 100000, null)
$q$, 'P0001', null, 'even the super admin cannot close a day — deliberately');

-- A late payment command against the closed D-1 does not rewrite the snapshot.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid);

select is(
  public.pay_billing_now(
    'bbbbbbbb-0000-4000-a000-000000000012', 1,
    public.billing_payload_hash(jsonb_build_object(
      'billId', 'bbbbbbbb-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'paymentBusinessDate', current_date - 1,
      'customerId', null, 'customerName', null, 'customerPhone', null,
      'subtotalPaise', 13900, 'discountPaise', 0, 'taxPaise', 0,
      'totalPaise', 13900, 'pricingMode', 'no_tax',
      'payments', jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13900)),
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'bbbbbbbb-0000-4000-a000-000000000013',
        'menuItemId', '31000000-0000-4000-a000-000000000001',
        'itemName', 'Classic Chicken Shawarma', 'unitPricePaise', 13900,
        'quantity', 1, 'lineTotalPaise', 13900)))),
    ((current_date - 1) + time '22:00') at time zone 'Asia/Kolkata',
    'bbbbbbbb-0000-4000-a000-000000000010',
    jsonb_build_object(
      'billId', 'bbbbbbbb-0000-4000-a000-000000000001',
      'businessDate', current_date - 1,
      'paymentBusinessDate', current_date - 1,
      'customerId', null, 'customerName', null, 'customerPhone', null,
      'subtotalPaise', 13900, 'discountPaise', 0, 'taxPaise', 0,
      'totalPaise', 13900, 'pricingMode', 'no_tax',
      'payments', jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13900)),
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'bbbbbbbb-0000-4000-a000-000000000013',
        'menuItemId', '31000000-0000-4000-a000-000000000001',
        'itemName', 'Classic Chicken Shawarma', 'unitPricePaise', 13900,
        'quantity', 1, 'lineTotalPaise', 13900)))
  ) ->> 'status',
  'accepted',
  'a late offline payment lands with its true payment business date');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid);

select is(
  (select cash_sales_paise from public.daily_cash_records
    where outlet_id = '00000000-0000-4000-a000-000000000001'
      and business_date = current_date - 1),
  0::bigint,
  'the closed record is a snapshot: the late bill changed nothing');

select is(
  (public.billing_day_readiness(
    '00000000-0000-4000-a000-000000000001', current_date - 1
  ) ->> 'staleConfirmations')::integer,
  1,
  'a command accepted after confirmation makes that tablet stale at the database');

-- ---------------------------------------------------------------------------
-- The owner's bounded remote writes (multi-outlet-people, design D8).
--
-- The Super Admin records into an outlet they hold NO assignment at. Two
-- entries are available and everything cash is not — and "not" is the
-- database's word, not a form's. `correction` rather than every movement type
-- because "the count is wrong" is the entry that genuinely needs to be
-- possible from a distance; receiving and consuming stock is done standing in
-- the shop.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  insert into public.inventory_movements
    (outlet_id, inventory_item_id, movement_type, quantity_delta, note, recorded_by, business_date)
  values ('00000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000011',
          'correction', -2, 'Owner audit (synthetic)',
          '10000000-0000-4000-a000-000000000001', current_date)
$q$, 'the owner records a stock correction at an outlet they are not assigned to');

select is(
  (select current_quantity from public.inventory_items
    where id = '60000000-0000-4000-a000-000000000011'),
  (select sum(quantity_delta)::numeric from public.inventory_movements
    where inventory_item_id = '60000000-0000-4000-a000-000000000011'),
  'and the ledger still reconciles exactly to the cache after it');

select is(
  (select recorded_by from public.inventory_movements
    where inventory_item_id = '60000000-0000-4000-a000-000000000011'
      and note = 'Owner audit (synthetic)'),
  '10000000-0000-4000-a000-000000000001'::uuid,
  'the row is visibly the owner''s wherever it is read');

select throws_ok($q$
  insert into public.inventory_movements
    (outlet_id, inventory_item_id, movement_type, quantity_delta, unit_cost_paise, recorded_by, business_date)
  values ('00000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000011',
          'added', 5, 21500, '10000000-0000-4000-a000-000000000001', current_date)
$q$, '42501', null, 'but not a stock receipt — that is done standing in the shop');

select throws_ok($q$
  insert into public.inventory_movements
    (outlet_id, inventory_item_id, movement_type, quantity_delta, recorded_by, business_date)
  values ('00000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000011',
          'used', -1, '10000000-0000-4000-a000-000000000001', current_date)
$q$, '42501', null, 'nor a consumption');

select lives_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, amount_paise, payment_method, recorded_by)
  values ('00000000-0000-4000-a000-000000000002', current_date, 'other', 62000, 'upi',
          '10000000-0000-4000-a000-000000000001')
$q$, 'the owner records a NON-CASH expense remotely');

select throws_ok($q$
  insert into public.expenses
    (outlet_id, business_date, category, amount_paise, payment_method, recorded_by)
  values ('00000000-0000-4000-a000-000000000002', current_date, 'other', 62000, 'cash',
          '10000000-0000-4000-a000-000000000001')
$q$, '42501', null, 'and a CASH expense from that path is refused by the database');

select throws_ok($q$
  insert into public.cash_withdrawals
    (outlet_id, business_date, amount_paise, withdrawn_by, recorded_by)
  values ('00000000-0000-4000-a000-000000000002', current_date, 5000, 'Synthetic Owner',
          '10000000-0000-4000-a000-000000000001')
$q$, '42501', null, 'the drawer is not reachable from the owner''s remote path at all');

select throws_ok($q$
  select public.close_business_day('00000000-0000-4000-a000-000000000002', current_date, 0, 0)
$q$, 'P0001', null, 'nor is the day close — it stays that outlet''s manager''s');

-- The whole point of the non-cash bound: an owner's remote entry is
-- mathematically incapable of moving a drawer, because the cash sum filters on
-- payment method.
select is(
  (select coalesce(sum(amount_paise), 0)::bigint from public.expenses
    where outlet_id = '00000000-0000-4000-a000-000000000002'
      and business_date = current_date
      and payment_method = 'cash'),
  0::bigint,
  'so the outlet''s cash expenses for the day are untouched by anything the owner did');

reset role;

select * from finish();
rollback;
