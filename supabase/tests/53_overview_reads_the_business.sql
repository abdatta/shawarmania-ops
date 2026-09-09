begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.impersonate(p_sub uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text,true);
  execute 'set local role authenticated';
end $$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set MANAGER '10000000-0000-4000-a000-000000000002'
\set EMPLOYEE '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'

-- Explicit midnight/03:59/04:00 amounts pin the read's business_date boundary.
-- Synthetic historical bills follow the same timestamp validation as the seed.
with inserted as (insert into public.bills
  (id, outlet_id, business_date, biller_profile_id, counter_device_id,
   subtotal_paise, total_paise, payment_method, status, created_at,
   voided_at, voided_by, void_reason)
select gen_random_uuid(), :'KAL', business_day,
  '10000000-0000-4000-a000-00000000000a'::uuid,
  '10000000-0000-4000-a000-000000000004'::uuid,
  amount, amount, method::public.payment_method, state::public.bill_status, at_time,
  case when state='void' then at_time end,
  case when state='void' then :'OWNER'::uuid end,
  case when state='void' then 'Synthetic Overview exclusion' end
from (values
  ('2026-01-15'::date, '2026-01-16 00:00:00+05:30'::timestamptz, 12300, 'cash', 'settled'),
  ('2026-01-15'::date, '2026-01-16 03:59:59+05:30'::timestamptz, 67800, 'upi', 'settled'),
  ('2026-01-16'::date, '2026-01-16 04:00:00+05:30'::timestamptz, 111100, 'cash', 'settled'),
  ('2026-01-15'::date, '2026-01-15 20:00:00+05:30'::timestamptz, 999900, 'cash', 'void')
) as fixture(business_day, at_time, amount, method, state)
returning id, outlet_id, payment_method, total_paise, paid_at)
insert into public.bill_payments (bill_id, outlet_id, method, amount_paise, created_at)
select id, outlet_id, payment_method, total_paise, paid_at from inserted;

-- A bounded, nonzero delivery example: determined net, unknown commission,
-- another outlet, and a following day that must not enter the requested total.
insert into public.aggregator_channel_days
  (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise, settlement_state, origin)
values
  (:'KAL','zomato','2026-02-10',100000,20000,80000,'settled','settlement'),
  (:'KAL','swiggy','2026-02-10',60000,null,null,'provisional','daily_reader'),
  (:'KAL','zomato','2026-02-11',900000,100000,800000,'settled','settlement'),
  (:'KPA','zomato','2026-02-10',700000,100000,600000,'settled','settlement');
insert into public.outlet_channel_restaurants (outlet_id,channel,external_ref,state)
values (:'KAL','zomato','overview-synthetic-zomato','enabled'),
       (:'KAL','swiggy','overview-synthetic-swiggy','enabled');

select pg_temp.impersonate(:'OWNER');
select is(overview_sales(:'KAL','2026-01-15','2026-01-15'),
  '{"cashPaise":12300,"upiPaise":67800}'::jsonb,
  'midnight and 03:59 stay in the previous business day; voids and 04:00 are excluded');
select is(overview_sales(:'KAL','2026-01-16','2026-01-16'),
  '{"cashPaise":111100,"upiPaise":0}'::jsonb,
  '04:00 starts the next business day');
select is((overview_revenue(:'KAL','2026-01-15','2026-01-15')->>'revenuePaise')::bigint,
  80100::bigint, 'monthly counter revenue uses the same explicit business dates');
select is(overview_sales(:'KPA','2026-01-15','2026-01-15'),
  '{"cashPaise":0,"upiPaise":0}'::jsonb, 'counter amounts do not leak into the other outlet');
select is((overview_revenue(:'KAL','2026-02-10','2026-02-10')->>'revenuePaise')::bigint,
  140000::bigint, 'revenue uses known net plus qualified gross, excluding other outlet and following day');
select is((overview_revenue(:'KAL','2026-02-10','2026-02-10')->>'provisional')::boolean,
  true, 'an unstated commission qualifies the whole total');
select is((overview_revenue(:'KAL','2026-02-10','2026-02-10')->>'hasSales')::boolean,
  true, 'delivery-only trading counts as sales');
select is((overview_revenue(:'KAL','2026-02-10','2026-02-10')->>'incomplete')::boolean,
  false, 'both expected channels reported the requested day');
select is((overview_revenue(:'KAL','2026-02-10','2026-02-11')->>'incomplete')::boolean,
  true, 'a missing expected channel-day is not silently treated as zero');
select is((overview_revenue(:'KPA','2026-02-10','2026-02-10')->>'revenuePaise')::bigint,
  600000::bigint, 'the other outlet keeps its own net revenue');
select lives_ok(format('select overview_sales(%L,current_date,current_date)', :'KAL'), 'owner reads sales');
select lives_ok(format('select overview_revenue(%L,current_date,current_date)', :'KPA'), 'owner reads other outlet revenue');
select is((overview_sales(:'KAL',current_date,current_date)->>'cashPaise')::bigint,
  (select coalesce(sum(p.amount_paise),0)::bigint from bills b join effective_bill_payments p on p.bill_id=b.id
   where b.outlet_id=:'KAL' and b.business_date=current_date and b.status='settled' and p.method='cash'),
  'sales use effective cash allocations of settled bills');
select is(overview_expenses(:'KAL',current_date,current_date),
  (select coalesce(sum(amount_paise),0)::bigint from effective_expenses where outlet_id=:'KAL' and business_date=current_date),
  'expense total matches the Ledger source');
select is((overview_drawer(:'KAL')->>'leftPaise')::bigint,
  (select o.counted_total_paise - coalesce((select sum(amount_paise) from drawer_cash_out where observation_id=o.id),0)::bigint
   from drawer_observations o where outlet_id=:'KAL' and counted_at<=now() order by counted_at desc limit 1),
  'Last Left comes from the latest count minus its own removals');
select is((overview_drawer(:'KAL')->>'spentPaise')::bigint,
  coalesce((select drawer_cash_expenses_paise(:'KAL',counted_at,now()) from drawer_observations
    where outlet_id=:'KAL' and counted_at<=now() order by counted_at desc limit 1),0),
  'spent covers the interval since the last count');
select throws_ok(format('select overview_sales(%L,current_date-100,current_date)', :'KAL'),
  'P0001','Invalid Overview period','unbounded periods are refused');
select throws_ok(format('select overview_revenue(%L,current_date,current_date-1)', :'KAL'),
  'P0001','Invalid Overview period','reversed periods are refused');

select pg_temp.impersonate(:'MANAGER');
select lives_ok(format('select overview_revenue(%L,current_date,current_date)', :'KAL'), 'manager reads own monthly revenue');
select lives_ok(format('select overview_drawer(%L)', :'KAL'), 'manager reads own drawer');
select throws_ok(format('select overview_sales(%L,current_date,current_date)', :'KPA'),
  '42501','Overview is not available at this outlet','forged sales outlet refused');
select throws_ok(format('select overview_revenue(%L,current_date,current_date)', :'KPA'),
  '42501','Overview is not available at this outlet','forged revenue outlet refused');
select throws_ok(format('select overview_expenses(%L,current_date,current_date)', :'KPA'),
  '42501','Overview is not available at this outlet','forged expenses outlet refused');
select throws_ok(format('select overview_drawer(%L)', :'KPA'),
  '42501','Overview is not available at this outlet','forged drawer outlet refused');
select pg_temp.impersonate(:'EMPLOYEE');
select throws_ok(format('select overview_revenue(%L,current_date,current_date)', :'KAL'),
  '42501','Overview is not available at this outlet','employee cannot read financial aggregates');
reset role;
select * from finish();
rollback;
