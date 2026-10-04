begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  set local role authenticated;
end; $$;
create function pg_temp.as_server() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end; $$;
create function pg_temp.flush() returns void language plpgsql as $$
begin set constraints all immediate; set constraints all deferred; end; $$;
create function pg_temp.bill(p_n integer, p_phone text default '+919000000101',
  p_paid timestamptz default now(), p_outlet uuid default '00000000-0000-4000-a000-000000000001')
returns uuid language plpgsql as $$
declare v_id uuid := ('b5900000-0000-4000-a000-' || lpad(p_n::text, 12, '0'))::uuid; v_customer uuid;
begin
  if p_phone is not null then
    insert into public.customers(phone) values (p_phone) on conflict(phone) do nothing;
    select id into v_customer from public.customers where phone = p_phone;
  end if;
  insert into public.bills(id, outlet_id, bill_number, business_date, payment_business_date,
    biller_profile_id, counter_device_id, shift_id, customer_id, customer_phone,
    subtotal_paise, discount_paise, tax_paise, rounding_paise, total_paise,
    payment_method, created_at, ordered_at, paid_at)
  values(v_id, p_outlet, 0, public.app_business_date(p_paid, time '04:00'),
    public.app_business_date(p_paid, time '04:00'),
    '10000000-0000-4000-a000-00000000000a',
    '10000000-0000-4000-a000-000000000004',
    '40000000-0000-4000-a000-000000000001', v_customer, p_phone,
    20000, 0, 0, 0, 20000, 'cash', p_paid, p_paid, p_paid);
  insert into public.bill_payments(bill_id, outlet_id, method, amount_paise)
    values(v_id, p_outlet, 'cash', 20000);
  insert into public.bill_items(bill_id, menu_item_id, item_name, unit_price_paise,
    quantity, line_total_paise, discount_paise, kind)
    values(v_id, case when p_outlet = '00000000-0000-4000-a000-000000000001' then
      '31000000-0000-4000-a000-000000000001'::uuid else
      '32000000-0000-4000-a000-000000000001'::uuid end,
      'Synthetic receipt test', 20000, 1, 20000, 0, 'item');
  perform pg_temp.flush();
  return v_id;
end; $$;

select is((select enabled from public.bill_receipt_delivery_settings), false, 'starts disabled');
select pg_temp.bill(1);
select is((select count(*) from public.bill_receipt_deliveries), 0::bigint, 'disabled creates no sends');
update public.bill_receipt_delivery_settings set enabled = true, enabled_at = now() - interval '1 second';
update public.outlets set points_enabled = true, points_use_cap_bp = 1000, points_earn_block_paise = 20000,
  points_earn_per_block = 5 where id = '00000000-0000-4000-a000-000000000001';
select pg_temp.bill(2, null);
select pg_temp.bill(3, '+919000000101', now() - interval '1 day');
select is((select count(*) from public.bill_receipt_deliveries), 0::bigint, 'no number and pre-launch bills stay silent');
select pg_temp.bill(4);
select is((select earned_points from public.bill_receipt_deliveries), 5, 'deferred snapshot follows earned points');
select is((select balance_points from public.bill_receipt_deliveries),
  (select sum(points)::integer from public.customer_points_entries where outlet_id = '00000000-0000-4000-a000-000000000001'
    and customer_id = (select customer_id from public.bills where id = 'b5900000-0000-4000-a000-000000000004')),
  'snapshot carries the balance after payment');
update public.outlets set points_earn_block_paise = 1000000 where id = '00000000-0000-4000-a000-000000000001';
select pg_temp.bill(5);
select is((select earned_points from public.bill_receipt_deliveries where bill_id = 'b5900000-0000-4000-a000-000000000005'), 0, 'zero earn is explicit');
select is((select balance_points from public.bill_receipt_deliveries where bill_id = 'b5900000-0000-4000-a000-000000000005'),
  (select balance_points from public.bill_receipt_deliveries where bill_id = 'b5900000-0000-4000-a000-000000000004'), 'zero earn keeps existing balance');
select pg_temp.bill(6, '+919000000102', now(), '00000000-0000-4000-a000-000000000002');

select pg_temp.as_user('10000000-0000-4000-a000-000000000002');
select is((select count(*) from public.bill_receipt_deliveries), 2::bigint, 'manager sees own delivery positive control');
select is((select count(*) from public.bill_receipt_deliveries where outlet_id = '00000000-0000-4000-a000-000000000002'), 0::bigint, 'manager cannot read other outlet');
select throws_ok('select * from public.bill_receipt_claim(10)', '42501', null, 'manager cannot claim');
select throws_ok($$select public.bill_receipt_configure(true)$$, '42501', null, 'manager cannot enable sending');
select throws_ok($$select public.bill_receipt_report('b5900000-0000-4000-a000-000000000004', 'request123456789', 'delivered')$$,
  '42501', null, 'manager cannot manufacture reports');
select throws_ok($$update public.bill_receipt_deliveries set state = 'queued'$$, '42501', null, 'manager cannot reset jobs');
select pg_temp.as_user('10000000-0000-4000-a000-000000000004');
select is((select count(*) from public.bill_receipt_deliveries), 0::bigint, 'tablet has no delivery read');
select pg_temp.as_server();

create temporary table claimed as select * from public.bill_receipt_claim(10);
select is((select count(*) from claimed), 3::bigint, 'one claim takes each pending bill');
select is((select count(*) from public.bill_receipt_claim(10)), 0::bigint, 'another worker cannot claim a sending job');
select public.bill_receipt_report('b5900000-0000-4000-a000-000000000004', 'request123456789', 'delivered');
select public.bill_receipt_finish('b5900000-0000-4000-a000-000000000004', 'submitted', 'request123456789');
select is((select state from public.bill_receipt_deliveries where bill_id = 'b5900000-0000-4000-a000-000000000004'), 'delivered', 'callback before response stays delivered');
select public.bill_receipt_report('b5900000-0000-4000-a000-000000000004', 'request123456789', 'failed');
select is((select state from public.bill_receipt_deliveries where bill_id = 'b5900000-0000-4000-a000-000000000004'), 'delivered', 'stale failure cannot overwrite delivered');
select is(public.bill_receipt_report('b5900000-0000-4000-a000-000000000004', 'otherRequest123456', 'delivered'), false, 'mismatched provider request refused');
select public.bill_receipt_finish('b5900000-0000-4000-a000-000000000005', 'unknown', null, 'submission_unknown');
select is((select count(*) from public.bill_receipt_claim(10)), 0::bigint, 'uncertain submission is never retried');
update public.bill_receipt_deliveries set claimed_at = now() - interval '5 minutes' where bill_id = 'b5900000-0000-4000-a000-000000000006';
select public.bill_receipt_recover();
select is((select state from public.bill_receipt_deliveries where bill_id = 'b5900000-0000-4000-a000-000000000006'), 'unknown', 'abandoned claim becomes uncertain');
select pg_temp.bill(7);
select public.revoke_bill_public_link('b5900000-0000-4000-a000-000000000007');
select is((select count(*) from public.bill_receipt_claim(10)), 0::bigint, 'revoked receipt is not submitted');
select is((select state from public.bill_receipt_deliveries where bill_id = 'b5900000-0000-4000-a000-000000000007'), 'skipped', 'revoked job is visible as skipped');
select ok(not has_function_privilege('anon', 'public.bill_receipt_claim(integer)', 'execute'), 'anonymous cannot submit');
select ok(not has_table_privilege('authenticated', 'public.bill_receipt_delivery_settings', 'select'), 'configuration is service only');
select * from finish();
rollback;
