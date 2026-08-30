-- Remote departure is a qualified attribution boundary, never lost money and
-- never a silent handoff to the next person.

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

create temporary table pg_temp.case_values (
  name text primary key,
  value jsonb,
  created_at timestamptz
);
grant select on pg_temp.case_values to authenticated;

select has_column('public','billing_commands','recorded_after_shift_end',
  'command receipts qualify post-departure capture');
select has_column('public','bills','recorded_after_shift_end',
  'immutable bills qualify post-departure capture');
select has_table('public','billing_attribution_reviews',
  'attribution reviews have an append-only relation');
select has_function('public','review_billing_attribution',
  array['uuid','text','uuid','text'],
  'manager review has one typed server boundary');

-- The seeded Kalyani tablet shift belongs to the seeded Kalyani biller. End it
-- remotely one minute ago; the device has not learned that fact yet.
update public.counter_shifts
   set ended_at = now() - interval '1 minute', ended_reason = 'operator'
 where id = '90000000-0000-4000-a000-000000000001';

insert into pg_temp.case_values values (
  'after_leave',
  jsonb_build_object(
    'billId','f4000000-0000-4000-a000-000000000001',
    'businessDate',public.app_business_date(now(),time '04:00'),
    'paymentBusinessDate',public.app_business_date(now(),time '04:00'),
    'customerId',null,'customerName',null,'customerPhone',null,
    'subtotalPaise',13900,'discountPaise',0,'taxPaise',0,'totalPaise',13900,
    'pricingMode','no_tax',
    'payments',jsonb_build_array(jsonb_build_object('method','cash','amountPaise',13900)),
    'lines',jsonb_build_array(jsonb_build_object(
      'id','f3000000-0000-4000-a000-000000000001',
      'menuItemId','31000000-0000-4000-a000-000000000001',
      'itemName','Classic Chicken Shawarma','unitPricePaise',13900,
      'quantity',1,'lineTotalPaise',13900))),
  now() - interval '30 seconds');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  public.pay_billing_now(
    'f1000000-0000-4000-a000-000000000001',1,
    public.billing_payload_hash((select value from pg_temp.case_values where name='after_leave')),
    (select created_at from pg_temp.case_values where name='after_leave'),
    '90000000-0000-4000-a000-000000000001',
    (select value from pg_temp.case_values where name='after_leave')) ->> 'status',
  'accepted',
  'a sale captured after remote leave is accepted as real money');

select is(
  public.pay_billing_now(
    'f1000000-0000-4000-a000-000000000001',1,
    public.billing_payload_hash((select value from pg_temp.case_values where name='after_leave')),
    (select created_at from pg_temp.case_values where name='after_leave'),
    '90000000-0000-4000-a000-000000000001',
    (select value from pg_temp.case_values where name='after_leave')) ->> 'status',
  'replay',
  'the flagged sale still replays exactly once');

reset role;
select is((select count(*) from public.bills
    where id='f4000000-0000-4000-a000-000000000001'),1::bigint,
  'exact replay created one bill');
select is((select count(*) from public.bill_payments
    where bill_id='f4000000-0000-4000-a000-000000000001'),1::bigint,
  'the deferred money guard sees the accepted allocation after authority ended');
select ok((select recorded_after_shift_end from public.bills
    where id='f4000000-0000-4000-a000-000000000001'),
  'the bill carries the immutable exception');
select is((select attribution_shift_ended_at from public.bills
    where id='f4000000-0000-4000-a000-000000000001'),
  (select ended_at from public.counter_shifts
    where id='90000000-0000-4000-a000-000000000001'),
  'the bill snapshots the exact remote departure time');
select is((select biller_profile_id from public.bills
    where id='f4000000-0000-4000-a000-000000000001'),
  (select person_id from public.counter_shifts
    where id='90000000-0000-4000-a000-000000000001'),
  'the bill keeps Rahul-like last-known operator context');
select is((select total_paise from public.bills
    where id='f4000000-0000-4000-a000-000000000001' and status='settled'),
  13900::bigint,
  'the exception remains ordinary settled revenue');

-- A later shift is the ownership wall. The old shift cannot leak into Priya.
insert into public.counter_shifts
  (id,device_id,outlet_id,person_id,opened_at,business_date,expires_at)
values (
  'f9000000-0000-4000-a000-000000000002',
  '10000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000002',
  now()-interval '20 seconds',
  public.app_business_date(now(),time '04:00'),
  now()+interval '1 hour');

insert into pg_temp.case_values values (
  'overlap',
  jsonb_set((select value from pg_temp.case_values where name='after_leave'),
    '{billId}','"f4000000-0000-4000-a000-000000000002"'),
  now()-interval '10 seconds');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  public.pay_billing_now(
    'f1000000-0000-4000-a000-000000000002',1,
    public.billing_payload_hash((select value from pg_temp.case_values where name='overlap')),
    (select created_at from pg_temp.case_values where name='overlap'),
    '90000000-0000-4000-a000-000000000001',
    (select value from pg_temp.case_values where name='overlap')) ->> 'status',
  'authorization_refused',
  'old-shift work created after Priya opened is refused, not reassigned');

-- A deliberate finish is stricter than remote leave.
reset role;
update public.counter_shifts
   set ended_at=now()-interval '5 seconds', ended_reason='day_finished'
 where id='f9000000-0000-4000-a000-000000000002';
insert into pg_temp.case_values values (
  'after_finish',
  jsonb_set((select value from pg_temp.case_values where name='after_leave'),
    '{billId}','"f4000000-0000-4000-a000-000000000003"'),
  now());
select pg_temp.impersonate('10000000-0000-4000-a000-000000000004');
select is(
  public.pay_billing_now(
    'f1000000-0000-4000-a000-000000000003',1,
    public.billing_payload_hash((select value from pg_temp.case_values where name='after_finish')),
    (select created_at from pg_temp.case_values where name='after_finish'),
    'f9000000-0000-4000-a000-000000000002',
    (select value from pg_temp.case_values where name='after_finish')) ->> 'status',
  'authorization_refused',
  'Finish Day cannot be reopened by a stale tablet view');

-- Review belongs to the manager/owner, never the incoming operator or another
-- outlet's manager, and it never rewrites the original bill.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is((public.review_billing_attribution(
    'f4000000-0000-4000-a000-000000000001','confirmed_original',null,null)).outcome,
  'confirmed_original',
  'the assigned Franchise Admin may confirm the original context');
reset role;
select throws_ok($q$
  update public.billing_attribution_reviews set outcome='operator_unknown'
$q$,'P0001',null,'the review itself is append-only');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000003');
select is((select count(*) from public.billing_attribution_reviews
    where bill_id='f4000000-0000-4000-a000-000000000001'),0::bigint,
  'the other outlet manager cannot read the review');
select throws_ok($q$
  select public.review_billing_attribution(
    'f4000000-0000-4000-a000-000000000001','operator_unknown',null,'Not known')
$q$,'42501',null,'the other outlet manager cannot review the bill by hand-crafted request');

reset role;
select * from finish();
rollback;
