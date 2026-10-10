begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select * from no_plan();
create function pg_temp.impersonate(p_sub uuid) returns void language plpgsql as $$ begin
  execute 'reset role';
  perform set_config('request.jwt.claims',json_build_object('sub',p_sub,'role','authenticated')::text,true);
  execute 'set local role authenticated';
end; $$;

-- Dish revenue per dish and day: line totals less line discounts, settled only.
create temp table expected_revenue as select b.business_date,coalesce(i.menu_item_id::text,'snapshot:'||i.item_name) as key,sum(i.line_total_paise-i.discount_paise) as revenue from public.bills b join public.bill_items i on i.bill_id=b.id where b.outlet_id='00000000-0000-4000-a000-000000000001' and b.status='settled' and i.kind='item' group by 1,2;
grant select on expected_revenue to authenticated;
select ok((select count(*) from expected_revenue)>0,'the fixture has dish revenue');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');

select ok(not exists(select 1 from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30','items',4)->'items') i where jsonb_array_length(i->'periodRevenue')<>4 or (i->'periodRevenue'->>0)::bigint<>(i->>'revenue')::bigint or (i->'periodRevenue'->>1)::bigint<>(i->>'previousRevenue')::bigint),'every dish carries its revenue per window, current first, and its previous revenue');
select ok(not exists(select 1 from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30','items',4)->'categories') c where jsonb_array_length(c->'periodRevenue')<>4 or (c->'periodRevenue'->>0)::bigint<>(c->>'revenue')::bigint or (c->'periodRevenue'->>1)::bigint<>(c->>'previousRevenue')::bigint),'every category carries its revenue per window, current first');
select ok(not exists(select 1 from (select distinct business_date from expected_revenue) e, jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001',e.business_date+1,e.business_date+1,'items',2)->'items') i where (i->>'previousRevenue')::bigint<>coalesce((select r.revenue from expected_revenue r where r.business_date=e.business_date and r.key=i->>'key'),0)),'a dish''s previous revenue reconciles to its lines');
select ok(not exists(select 1 from (select distinct business_date from expected_revenue) e, jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001',e.business_date+2,e.business_date+2,'items',3)->'items') i where (i->'periodRevenue'->>2)::bigint<>coalesce((select r.revenue from expected_revenue r where r.business_date=e.business_date and r.key=i->>'key'),0)),'an older window''s dish revenue reconciles to its lines');

-- The replacement keeps the function's authority.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$select public.sales_analytics('00000000-0000-4000-a000-000000000002','2026-01-01','2026-01-07','items',2)$q$,'42501',null,'a crafted foreign-outlet read is still refused');
reset role;
set local role anon;
select throws_ok($q$select public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-07','items',2)$q$,'42501',null,'an anonymous read is still refused');
reset role;
select * from finish();
rollback;
