-- The inventory ledger and the daily cash snapshot: the two places where a
-- derived figure must be structurally trustworthy.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

create function pg_temp.impersonate(p_sub uuid, p_role text, p_outlet uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_sub, 'role', 'authenticated',
      'app_role', p_role, 'app_outlet_id', p_outlet
    )::text,
    true);
  execute 'set local role authenticated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger → cache.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

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

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

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

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001'::uuid,
  'super_admin', null);

select throws_ok($q$
  select public.close_business_day(
    '00000000-0000-4000-a000-000000000001', current_date, 100000, 100000, null)
$q$, 'P0001', null, 'even the super admin cannot close a day — deliberately');

-- A late bill against the closed D-1 does not rewrite the snapshot.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid,
  'biller', '00000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  insert into public.bills (id, outlet_id, business_date, biller_profile_id, counter_device_id,
                            shift_id, subtotal_paise, total_paise, payment_method, created_at)
  values ('bbbbbbbb-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
          current_date - 1,
          '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
          '40000000-0000-4000-a000-000000000002', 13900, 13900, 'cash',
          ((current_date - 1) + time '22:00') at time zone 'Asia/Kolkata')
$q$, 'a late offline bill lands with its true business date');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select is(
  (select cash_sales_paise from public.daily_cash_records
    where outlet_id = '00000000-0000-4000-a000-000000000001'
      and business_date = current_date - 1),
  0::bigint,
  'the closed record is a snapshot: the late bill changed nothing');

reset role;

select * from finish();
rollback;
