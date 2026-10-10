begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select * from no_plan();
create function pg_temp.impersonate(p_sub uuid) returns void language plpgsql as $$ begin
  execute 'reset role';
  perform set_config('request.jwt.claims',json_build_object('sub',p_sub,'role','authenticated')::text,true);
  execute 'set local role authenticated';
end; $$;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$select public.sales_analytics('00000000-0000-4000-a000-000000000002','2026-01-01','2026-01-07')$q$,'42501',null,'crafted foreign outlet analytics refused');
select throws_ok($q$select public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-06-01')$q$,'22023',null,'unbounded query refused');
select is(jsonb_array_length(public.sales_analytics('00000000-0000-4000-a000-000000000001','2020-01-01','2020-01-07')->'days'),14,'equal adjacent periods include every zero day');
select ok(jsonb_array_length(public.sales_analytics('00000000-0000-4000-a000-000000000001','2020-01-01','2020-01-07')->'items')>0,'active unsold dishes are included');
select is((select sum((d->>'revenue')::bigint) from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001','2020-01-01','2020-01-07')->'days') d),0::numeric,'empty period has zero revenue');

reset role;
create temp table expected as select business_date,sum(total_paise) as revenue,count(*) as orders from public.bills where outlet_id='00000000-0000-4000-a000-000000000001' and status='settled' group by business_date;
select ok((select count(*) from expected)>0,'reconciliation fixture contains settled sales');
grant select on expected to authenticated;
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select ok(not exists(select 1 from expected e where not exists(select 1 from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001',e.business_date,e.business_date)->'days') d where d->>'date'=e.business_date::text and (d->>'revenue')::bigint=e.revenue and (d->>'orders')::bigint=e.orders)),'revenue and order counts reconcile to settled snapshots');
select ok(not (public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-07')::text ~ 'customer_phone|customer_name|customer_id'),'aggregate exposes no customer fields');

reset role;
create temp table expected_lines as select b.business_date,i.menu_item_id,sum(i.quantity) as units,sum(i.line_total_paise-i.discount_paise) as revenue from public.bills b join public.bill_items i on i.bill_id=b.id where b.outlet_id='00000000-0000-4000-a000-000000000001' and b.status='settled' and i.kind='item' and i.menu_item_id is not null group by b.business_date,i.menu_item_id;
grant select on expected_lines to authenticated;
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select ok(not exists(select 1 from expected_lines e where not exists(select 1 from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001',e.business_date,e.business_date)->'items') i where i->>'key'=e.menu_item_id::text and (i->>'units')::bigint=e.units and (i->>'revenue')::bigint=e.revenue)),'item metrics reconcile to captured lines excluding service packaging');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select throws_ok($q$select public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-07')$q$,'42501',null,'biller analytics refused');
reset role;
set local role anon;
select throws_ok($q$select public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-07')$q$,'42501',null,'anonymous analytics refused');
reset role;
reset role;
select ok(to_regclass('public.menu_engagement_visits') is null,'no tracking table introduced');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select is(jsonb_array_length(public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30','sales',4)->'days'),120,'four thirty-day windows are bounded');
select is(jsonb_array_length(public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30','sales',4)->'items'),0,'Sales omits dishes');
select is(jsonb_array_length(public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30','sales',4)->'categories'),0,'Sales omits categories');
select is(jsonb_array_length(public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30','items',2)->'days'),2,'Items collapses sixty daily facts to two summaries');
select is(jsonb_array_length(public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30','items',2)->'hours'),0,'Items omits hours');
select is(jsonb_array_length(public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30','items',2)->'delivery'),0,'Items omits delivery');
select throws_ok($q$select public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-07','sales',5)$q$,'22023',null,'more than four windows rejected');
select throws_ok($q$select public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-07','unknown',2)$q$,'22023',null,'unknown view rejected');
select ok(not exists(select 1 from expected e where (select sum((h->>'orders')::bigint) from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001',e.business_date,e.business_date,'sales',4)->'hours') h where (h->>'period')::int=0)<>e.orders or (select sum((h->>'revenue')::bigint) from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001',e.business_date,e.business_date,'sales',4)->'hours') h where (h->>'period')::int=0)<>e.revenue),'current hourly aggregates reconcile to settled bill totals');
select ok(not exists(select 1 from expected e where jsonb_array_length(public.sales_analytics('00000000-0000-4000-a000-000000000001',e.business_date,e.business_date,'sales',4)->'hours')>96),'hours capped at twenty-four times selected windows');
select ok(not exists(select 1 from expected e where (select sum((d->>'revenue')::bigint) from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001',e.business_date,e.business_date,'items',2)->'days') d where d->>'date'=e.business_date::text)<>e.revenue),'compressed Items current revenue reconciles');
-- Each dish and category carries its units in every window, current first.
select ok(not exists(select 1 from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30','items',4)->'items') i where jsonb_array_length(i->'periodUnits')<>4 or (i->'periodUnits'->>0)::bigint<>(i->>'units')::bigint or (i->'periodUnits'->>1)::bigint<>(i->>'previousUnits')::bigint),'every dish carries its units per window, current first');
select ok(not exists(select 1 from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30','items',4)->'categories') c where jsonb_array_length(c->'periodUnits')<>4 or (c->'periodUnits'->>0)::bigint<>(c->>'units')::bigint or (c->'periodUnits'->>1)::bigint<>(c->>'previousUnits')::bigint),'every category carries its units per window, current first');
select ok(not exists(select 1 from expected e where (select sum((i->'periodUnits'->>1)::bigint) from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001',e.business_date+1,e.business_date+1,'items',3)->'items') i)<>(select coalesce(sum(units),0) from expected_lines l where l.business_date=e.business_date)+(select coalesce(sum(i.quantity),0) from public.bills b join public.bill_items i on i.bill_id=b.id where b.outlet_id='00000000-0000-4000-a000-000000000001' and b.status='settled' and i.kind='item' and i.menu_item_id is null and b.business_date=e.business_date)),'an earlier window''s dish units reconcile to its lines');

-- The Items chart: one subject, two arrays, one value per day of every window.
select is(jsonb_array_length(public.sales_analytics_series('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30',4)->'units'),120,'series carries one day per day of every window');
select is((public.sales_analytics_series('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30',4)->>'from'),'2025-10-03','series names its first day');
select is((select array_agg(k order by k) from jsonb_object_keys(public.sales_analytics_series('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30',2)) k),array['from','hourRevenue','hourUnits','revenue','units'],'series carries only its dates, days and hours');
select is(jsonb_array_length(public.sales_analytics_series('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-30',4)->'hourUnits'),96,'series hours are 24 per window');
select ok(not exists(select 1 from expected e, lateral (select public.sales_analytics_series('00000000-0000-4000-a000-000000000001',e.business_date,e.business_date,2) as s) x where (select sum(v::bigint) from jsonb_array_elements_text(x.s->'hourUnits') with ordinality t(v,n) where n<=24)<>(x.s->'units'->>1)::bigint or (select sum(v::bigint) from jsonb_array_elements_text(x.s->'hourRevenue') with ordinality t(v,n) where n<=24)<>(x.s->'revenue'->>1)::bigint),'the current window''s hours add up to its day');
select ok(not exists(select 1 from expected_lines e where (public.sales_analytics_series('00000000-0000-4000-a000-000000000001',e.business_date,e.business_date,1,e.menu_item_id::text)->'units'->>0)::bigint<>e.units or (public.sales_analytics_series('00000000-0000-4000-a000-000000000001',e.business_date,e.business_date,1,e.menu_item_id::text)->'revenue'->>0)::bigint<>e.revenue),'a dish series reconciles to its captured lines');
reset role;
create temp table expected_categories as select b.business_date,coalesce(i.category_name,'Uncategorised') as category,sum(i.quantity) as units from public.bills b join public.bill_items i on i.bill_id=b.id where b.outlet_id='00000000-0000-4000-a000-000000000001' and b.status='settled' and i.kind='item' group by 1,2;
grant select on expected_categories to authenticated;
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select ok((select count(*) from expected_categories)>0,'category fixture contains sales');
select ok(not exists(select 1 from expected_categories e where (public.sales_analytics_series('00000000-0000-4000-a000-000000000001',e.business_date,e.business_date,1,null,e.category)->'units'->>0)::bigint<>e.units),'a category series reconciles to captured categories');
select ok(not exists(select 1 from expected e where (public.sales_analytics_series('00000000-0000-4000-a000-000000000001',e.business_date,e.business_date,1)->'units'->>0)::bigint<>(select coalesce(sum(units),0) from expected_lines l where l.business_date=e.business_date) + (select coalesce(sum(i.quantity),0) from public.bills b join public.bill_items i on i.bill_id=b.id where b.outlet_id='00000000-0000-4000-a000-000000000001' and b.status='settled' and i.kind='item' and i.menu_item_id is null and b.business_date=e.business_date)),'the all-dishes series counts every dish');
select ok(not exists(select 1 from (select c->>'name' as name,(c->>'units')::bigint as units from jsonb_array_elements(public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-07','items',2)->'categories') c) c where c.units<>(select coalesce(sum(units),0) from expected_categories e where e.category=c.name and e.business_date between '2026-01-01' and '2026-01-07')),'category totals reconcile');
select throws_ok($q$select public.sales_analytics_series('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-07',2,'not-a-dish')$q$,'22023',null,'an unknown dish key is refused');
select throws_ok($q$select public.sales_analytics_series('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-07',2,'snapshot:x','Shawarmas')$q$,'22023',null,'a dish and a category together are refused');
select throws_ok($q$select public.sales_analytics_series('00000000-0000-4000-a000-000000000001','2026-01-01','2026-06-01',2)$q$,'22023',null,'an unbounded series is refused');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select throws_ok($q$select public.sales_analytics_series('00000000-0000-4000-a000-000000000002','2026-01-01','2026-01-07',2)$q$,'42501',null,'a crafted foreign-outlet series is refused');
select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select throws_ok($q$select public.sales_analytics_series('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-07',2)$q$,'42501',null,'a biller series is refused');

reset role;
update public.profiles set is_active = false where id = '10000000-0000-4000-a000-000000000001';
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select throws_ok($q$select public.sales_analytics('00000000-0000-4000-a000-000000000001','2026-01-01','2026-01-07','sales',1)$q$,'42501',null,'a deactivated owner is refused while the assignment lingers');
select * from finish();
rollback;
