begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub',p_sub,'role','authenticated')::text,true);
  execute 'set local role authenticated';
end;
$$;

select has_table('public','bill_payment_corrections','payment correction audit exists');
select has_table('public','bill_payment_correction_allocations','replacement allocations exist');
select has_view('public','effective_bill_payments','effective tender has one shared read boundary');
select has_function('public','correct_bill_payment',
  array['uuid','integer','text','timestamp with time zone','uuid','jsonb'],
  'payment correction uses the billing envelope signature');

create temporary table pg_temp.values(name text primary key,value jsonb,created_at timestamptz);
grant select,insert on pg_temp.values to authenticated;
insert into pg_temp.values values (
  'payment',
  jsonb_build_object(
    'billId','b4000000-0000-4000-a000-000000000001',
    'businessDate',public.app_business_date(now(),time '04:00'),
    'paymentBusinessDate',public.app_business_date(now(),time '04:00'),
    'customerId',null,'customerName',null,'customerPhone',null,
    'subtotalPaise',13900,'discountPaise',0,'taxPaise',0,'totalPaise',13900,
    'pricingMode','no_tax',
    'payments',jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13900)),
    'lines',jsonb_build_array(jsonb_build_object(
      'id','b3000000-0000-4000-a000-000000000001',
      'menuItemId','31000000-0000-4000-a000-000000000001',
      'itemName','Classic Chicken Shawarma','unitPricePaise',13900,
      'quantity',1,'lineTotalPaise',13900))),
  now());

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(public.pay_billing_now(
  'b1000000-0000-4000-a000-000000000001',1,
  public.billing_payload_hash((select value from pg_temp.values where name='payment')),
  (select created_at from pg_temp.values where name='payment'),
  '90000000-0000-4000-a000-000000000001',
  (select value from pg_temp.values where name='payment'))->>'status',
  'accepted','the correction fixture bill is paid as Cash');

insert into pg_temp.values values (
  'correction',
  jsonb_build_object('billId','b4000000-0000-4000-a000-000000000001',
    'expectedRevision',0,
    'payments',jsonb_build_array(jsonb_build_object('method','upi','amountPaise',13900))),
  (select created_at+interval '1 second' from pg_temp.values where name='payment'));
select is(public.correct_bill_payment(
  'b1000000-0000-4000-a000-000000000002',1,
  public.billing_payload_hash((select value from pg_temp.values where name='correction')),
  (select created_at from pg_temp.values where name='correction'),
  '90000000-0000-4000-a000-000000000001',
  (select value from pg_temp.values where name='correction'))->>'status',
  'accepted','the originating tablet appends revision one inside five minutes');

reset role;
select results_eq(
  $$select method::text,amount_paise from public.bill_payments
    where bill_id='b4000000-0000-4000-a000-000000000001'$$,
  $$values ('cash',13900::bigint)$$,
  'the original allocation remains immutable');
select results_eq(
  $$select method::text,amount_paise,revision from public.effective_bill_payments
    where bill_id='b4000000-0000-4000-a000-000000000001'$$,
  $$values ('upi',13900::bigint,1)$$,
  'the effective boundary returns only the latest replacement');
select is((select count(*) from public.bill_payment_corrections
  where bill_id='b4000000-0000-4000-a000-000000000001'),1::bigint,
  'one correction header was appended');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(public.correct_bill_payment(
  'b1000000-0000-4000-a000-000000000002',1,
  public.billing_payload_hash((select value from pg_temp.values where name='correction')),
  (select created_at from pg_temp.values where name='correction'),
  '90000000-0000-4000-a000-000000000001',
  (select value from pg_temp.values where name='correction'))->>'status',
  'replay','response loss replays the same revision');
select is((select count(*) from public.bill_payment_corrections
  where bill_id='b4000000-0000-4000-a000-000000000001'),1::bigint,
  'exact replay appends nothing');

insert into pg_temp.values values (
  'correction_two',
  jsonb_build_object('billId','b4000000-0000-4000-a000-000000000001',
    'expectedRevision',1,
    'payments',jsonb_build_array(
      jsonb_build_object('method','cash','amountPaise',10000),
      jsonb_build_object('method','upi','amountPaise',3900))),
  (select created_at+interval '2 seconds' from pg_temp.values where name='payment'));
select is(public.correct_bill_payment(
  'b1000000-0000-4000-a000-000000000007',1,
  public.billing_payload_hash((select value from pg_temp.values where name='correction_two')),
  (select created_at from pg_temp.values where name='correction_two'),
  '90000000-0000-4000-a000-000000000001',
  (select value from pg_temp.values where name='correction_two'))->>'paymentRevision',
  '2','a second correction appends the next revision without resetting the deadline');

reset role;
select results_eq(
  $$select method::text,amount_paise,revision from public.effective_bill_payments
    where bill_id='b4000000-0000-4000-a000-000000000001' order by method$$,
  $$values ('cash',10000::bigint,2),('upi',3900::bigint,2)$$,
  'only revision two contributes to the effective split');
select throws_ok($q$
  update public.bill_payment_corrections set revision=3
    where bill_id='b4000000-0000-4000-a000-000000000001' and revision=2
$q$,'P0001',null,'correction headers reject update');
select throws_ok($q$
  delete from public.bill_payment_correction_allocations
    where correction_id=(select id from public.bill_payment_corrections
      where bill_id='b4000000-0000-4000-a000-000000000001' and revision=2)
$q$,'P0001',null,'correction allocations reject delete');
select throws_ok($q$
  insert into public.billing_end_of_day_confirmations
    (outlet_id,device_id,business_date,shift_id,command_watermark)
  values ('00000000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-000000000004',
    public.app_business_date(now(),time '04:00'),
    '90000000-0000-4000-a000-000000000001',0)
$q$,'P0001',null,'finish day refuses while the payment edit window remains open');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');

select is(public.correct_bill_payment(
  'b1000000-0000-4000-a000-000000000003',1,
  public.billing_payload_hash((select value from pg_temp.values where name='correction')),
  (select created_at+interval '1 second' from pg_temp.values where name='correction'),
  '90000000-0000-4000-a000-000000000001',
  (select value from pg_temp.values where name='correction'))->>'status',
  'stale_revision','a stale expected revision cannot overwrite the latest choice');

select is(public.correct_bill_payment(
  'b1000000-0000-4000-a000-000000000004',1,
  public.billing_payload_hash(jsonb_build_object(
    'billId','b4000000-0000-4000-a000-000000000001','expectedRevision',2,
    'payments',jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13899)))),
  (select created_at+interval '2 seconds' from pg_temp.values where name='correction'),
  '90000000-0000-4000-a000-000000000001',
  jsonb_build_object(
    'billId','b4000000-0000-4000-a000-000000000001','expectedRevision',2,
    'payments',jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13899))))->>'status',
  'arithmetic_invalid','bad replacement arithmetic appends nothing');

select is(public.correct_bill_payment(
  'b1000000-0000-4000-a000-000000000008',1,
  public.billing_payload_hash(jsonb_build_object(
    'billId','b4000000-0000-4000-a000-000000000001','expectedRevision',2,
    'payments',jsonb_build_array(jsonb_build_object('method','card','amountPaise',13900)))),
  (select created_at+interval '3 seconds' from pg_temp.values where name='payment'),
  '90000000-0000-4000-a000-000000000001',
  jsonb_build_object(
    'billId','b4000000-0000-4000-a000-000000000001','expectedRevision',2,
    'payments',jsonb_build_array(jsonb_build_object('method','card','amountPaise',13900))))->>'status',
  'arithmetic_invalid','an unsupported payment method appends nothing');

select is(public.correct_bill_payment(
  'b1000000-0000-4000-a000-000000000005',1,
  public.billing_payload_hash(jsonb_build_object(
    'billId','b4000000-0000-4000-a000-000000000001','expectedRevision',2,
    'payments',jsonb_build_array(jsonb_build_object('method','upi','amountPaise',13900)))),
  (select created_at+interval '5 minutes' from pg_temp.values where name='payment'),
  '90000000-0000-4000-a000-000000000001',
  jsonb_build_object(
    'billId','b4000000-0000-4000-a000-000000000001','expectedRevision',2,
    'payments',jsonb_build_array(jsonb_build_object('method','upi','amountPaise',13900))))->>'status',
  'payment_edit_expired','the database enforces the original strict five-minute deadline');

reset role;
select pg_temp.impersonate('10000000-0000-4000-a000-000000000005');
select is((select count(*) from public.bill_payment_corrections),0::bigint,
  'another outlet tablet reads no correction audit');
select is(public.correct_bill_payment(
  'b1000000-0000-4000-a000-000000000006',1,
  public.billing_payload_hash(jsonb_build_object(
    'billId','b4000000-0000-4000-a000-000000000001','expectedRevision',2,
    'payments',jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13900)))),
  clock_timestamp(),'90000000-0000-4000-a000-000000000002',
  jsonb_build_object(
    'billId','b4000000-0000-4000-a000-000000000001','expectedRevision',2,
    'payments',jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13900))))->>'status',
  'authorization_refused','another tablet cannot correct the bill');

select * from finish();
rollback;
