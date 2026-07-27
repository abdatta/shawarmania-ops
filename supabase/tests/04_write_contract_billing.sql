-- The billing write contract: server-assigned gapless numbers, idempotent
-- client UUIDs, arithmetic constraints, validated business dates, and
-- append-only bills whose one legal transition is settled → void.

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

create function pg_temp.rows_touched(q text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Seeded Kalyani bills end at number 9.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid,
  'biller', '00000000-0000-4000-a000-000000000001'::uuid);

-- ---------------------------------------------------------------------------
-- Allocation.

select lives_ok($q$
  insert into public.bills (id, outlet_id, business_date, biller_profile_id, counter_device_id,
                            shift_id, subtotal_paise, total_paise, payment_method, created_at)
  values ('aaaaaaaa-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
          '40000000-0000-4000-a000-000000000002', 13900, 13900, 'cash', now())
$q$, 'the device settles a bill on its open shift');

select is(
  (select bill_number from public.bills where id = 'aaaaaaaa-0000-4000-a000-000000000001'),
  10::bigint,
  'the new bill gets the next number in the outlet sequence');

select lives_ok($q$
  insert into public.bills (id, outlet_id, bill_number, business_date, biller_profile_id,
                            counter_device_id, shift_id, subtotal_paise, total_paise,
                            payment_method, created_at)
  values ('aaaaaaaa-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001',
          9999,
          public.app_business_date(now(), time '04:00'),
          '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
          '40000000-0000-4000-a000-000000000002', 15900, 15900, 'upi', now())
$q$, 'a bill carrying a client-chosen number inserts');

select is(
  (select bill_number from public.bills where id = 'aaaaaaaa-0000-4000-a000-000000000002'),
  11::bigint,
  'the client-supplied number is overridden by the server sequence');

-- Idempotency: the same client UUID again is a duplicate, not a second row.
select throws_ok($q$
  insert into public.bills (id, outlet_id, business_date, biller_profile_id, counter_device_id,
                            shift_id, subtotal_paise, total_paise, payment_method, created_at)
  values ('aaaaaaaa-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
          '40000000-0000-4000-a000-000000000002', 13900, 13900, 'cash', now())
$q$, '23505', null, 'a duplicate client UUID is rejected as a duplicate');

select is(
  (select count(*) from public.bills where id = 'aaaaaaaa-0000-4000-a000-000000000001'),
  1::bigint,
  'exactly one row exists for the retried UUID');

select lives_ok($q$
  insert into public.bills (id, outlet_id, business_date, biller_profile_id, counter_device_id,
                            shift_id, subtotal_paise, total_paise, payment_method, created_at)
  values ('aaaaaaaa-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
          '40000000-0000-4000-a000-000000000002', 17900, 17900, 'cash', now())
$q$, 'settlement continues after the failed retry');

select is(
  (select bill_number from public.bills where id = 'aaaaaaaa-0000-4000-a000-000000000003'),
  12::bigint,
  'the failed duplicate burned no number — the sequence is gapless');

-- ---------------------------------------------------------------------------
-- Arithmetic and v1 constraints.

select throws_ok($q$
  insert into public.bills (id, outlet_id, business_date, biller_profile_id, counter_device_id,
                            shift_id, subtotal_paise, discount_paise, total_paise, payment_method, created_at)
  values (gen_random_uuid(), '00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
          '40000000-0000-4000-a000-000000000002', 10000, 0, 9000, 'cash', now())
$q$, '23514', null, 'a bill whose total does not equal subtotal - discount + tax is rejected');

select throws_ok($q$
  insert into public.bills (id, outlet_id, business_date, biller_profile_id, counter_device_id,
                            shift_id, subtotal_paise, tax_paise, total_paise, payment_method, created_at)
  values (gen_random_uuid(), '00000000-0000-4000-a000-000000000001',
          public.app_business_date(now(), time '04:00'),
          '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
          '40000000-0000-4000-a000-000000000002', 10000, 100, 10100, 'cash', now())
$q$, '23514', null, 'v1 rejects any bill carrying tax');

select throws_ok($q$
  insert into public.bill_items (bill_id, item_name, unit_price_paise, quantity, line_total_paise)
  values ('aaaaaaaa-0000-4000-a000-000000000001', 'Bad Line', 13900, 2, 13900)
$q$, '23514', null, 'a line whose total does not equal unit price x quantity is rejected');

select throws_ok($q$
  insert into public.bill_items (bill_id, item_name, unit_price_paise, quantity, line_total_paise)
  values ('aaaaaaaa-0000-4000-a000-000000000001', 'Zero Line', 13900, 0, 0)
$q$, '23514', null, 'zero quantity is rejected');

select lives_ok($q$
  insert into public.bill_items (bill_id, menu_item_id, item_name, unit_price_paise, quantity, line_total_paise)
  values ('aaaaaaaa-0000-4000-a000-000000000001', '31000000-0000-4000-a000-000000000001',
          'Classic Chicken Shawarma', 13900, 1, 13900)
$q$, 'a consistent snapshot line inserts');

-- ---------------------------------------------------------------------------
-- Business date vs cutover.

select throws_ok($q$
  insert into public.bills (id, outlet_id, business_date, biller_profile_id, counter_device_id,
                            shift_id, subtotal_paise, total_paise, payment_method, created_at)
  values (gen_random_uuid(), '00000000-0000-4000-a000-000000000001',
          current_date - 5,
          '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
          '40000000-0000-4000-a000-000000000002', 13900, 13900, 'cash', now())
$q$, 'P0001', null, 'a business date the cutover cannot produce is rejected');

select lives_ok($q$
  insert into public.bills (id, outlet_id, business_date, biller_profile_id, counter_device_id,
                            shift_id, subtotal_paise, total_paise, payment_method, created_at)
  values ('aaaaaaaa-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001',
          current_date - 2,
          '10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-000000000004',
          '40000000-0000-4000-a000-000000000002', 13900, 13900, 'cash',
          ((current_date - 1) + time '00:20') at time zone 'Asia/Kolkata')
$q$, 'a bill rung at 00:20 carries the previous business date and is accepted');

-- ---------------------------------------------------------------------------
-- Append-only and the void transition.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002'::uuid,
  'franchise_admin', '00000000-0000-4000-a000-000000000001'::uuid);

select lives_ok($q$
  update public.bills
     set status = 'void',
         voided_by = '10000000-0000-4000-a000-000000000002',
         voided_at = now(),
         void_reason = 'Test void (synthetic)'
   where id = 'aaaaaaaa-0000-4000-a000-000000000001'
$q$, 'the franchise admin voids a bill with attribution');

select is(
  (select status::text from public.bills where id = 'aaaaaaaa-0000-4000-a000-000000000001'),
  'void', 'the bill is void with everything else untouched');

select throws_ok($q$
  update public.bills set total_paise = 1, subtotal_paise = 1
   where id = 'aaaaaaaa-0000-4000-a000-000000000002'
$q$, 'P0001', null, 'editing a settled bill''s amounts is refused');

select throws_ok($q$
  update public.bills
     set status = 'void',
         voided_by = '10000000-0000-4000-a000-000000000002',
         voided_at = now(),
         void_reason = 'x',
         total_paise = 1, subtotal_paise = 1
   where id = 'aaaaaaaa-0000-4000-a000-000000000002'
$q$, 'P0001', null, 'a void that also edits amounts is refused');

select throws_ok($q$
  update public.bills
     set status = 'settled', voided_by = null, voided_at = null, void_reason = null
   where id = 'aaaaaaaa-0000-4000-a000-000000000001'
$q$, 'P0001', null, 'un-voiding is refused');

select throws_ok($q$
  update public.bills
     set status = 'void',
         voided_by = '10000000-0000-4000-a000-000000000001',
         voided_at = now(),
         void_reason = 'x'
   where id = 'aaaaaaaa-0000-4000-a000-000000000002'
$q$, 'P0001', null, 'voiding under someone else''s name is refused');

-- The device cannot void: its session reaches no bill via the update policy.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004'::uuid,
  'biller', '00000000-0000-4000-a000-000000000001'::uuid);

select is(
  pg_temp.rows_touched($q$
    update public.bills
       set status = 'void',
           voided_by = '10000000-0000-4000-a000-000000000004',
           voided_at = now(),
           void_reason = 'x'
     where id = 'aaaaaaaa-0000-4000-a000-000000000002'
  $q$),
  0::bigint,
  'the counter device cannot void — no bill is reachable for update');

-- Deletion is impossible for clients (no grant at all) and refused at the
-- trigger even for the database owner.
select throws_ok($q$
  delete from public.bills where id = 'aaaaaaaa-0000-4000-a000-000000000003'
$q$, '42501', null, 'clients hold no delete privilege on bills');

reset role;

select throws_ok($q$
  delete from public.bills where id = 'aaaaaaaa-0000-4000-a000-000000000003'
$q$, 'P0001', null, 'even the owner cannot delete a bill');

select throws_ok($q$
  update public.bill_items set quantity = 2, line_total_paise = 27800
   where bill_id = 'aaaaaaaa-0000-4000-a000-000000000001'
$q$, 'P0001', null, 'bill items are immutable once written');

select throws_ok($q$
  delete from public.bill_items where bill_id = 'aaaaaaaa-0000-4000-a000-000000000001'
$q$, 'P0001', null, 'bill items cannot be deleted');

select * from finish();
rollback;
