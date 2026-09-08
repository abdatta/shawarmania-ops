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
