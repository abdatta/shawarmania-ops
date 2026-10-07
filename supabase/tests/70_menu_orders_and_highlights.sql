begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Pin the snapshot facts ordering/highlighting must never rewrite.
create temporary table original_items as select id, outlet_id, category_id, name, price_paise, is_available from public.menu_items;
create temporary table original_lines as select * from public.bill_items;
update public.menu_items set sort_order = 0 where category_id = '30000000-0000-4000-a000-000000000001';

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select lives_ok($q$select public.reorder_menu_items('30000000-0000-4000-a000-000000000001', array[
  '31000000-0000-4000-a000-000000000006','31000000-0000-4000-a000-000000000004',
  '31000000-0000-4000-a000-000000000003','31000000-0000-4000-a000-000000000002',
  '31000000-0000-4000-a000-000000000001']::uuid[])$q$, 'tied positions reorder atomically');
select results_eq($q$select id from public.menu_items where category_id = '30000000-0000-4000-a000-000000000001' order by sort_order$q$,
 $q$select unnest(array['31000000-0000-4000-a000-000000000006','31000000-0000-4000-a000-000000000004','31000000-0000-4000-a000-000000000003','31000000-0000-4000-a000-000000000002','31000000-0000-4000-a000-000000000001']::uuid[])$q$, 'the requested order is saved');
select results_eq($q$select sort_order from public.menu_items where category_id = '30000000-0000-4000-a000-000000000001' order by sort_order$q$,
 $q$select generate_series(1,5)$q$, 'positions normalize to consecutive integers');
select throws_ok($q$select public.reorder_menu_items('30000000-0000-4000-a000-000000000001',array['31000000-0000-4000-a000-000000000001']::uuid[])$q$,
 '22023', null, 'stale membership is refused');
select throws_ok($q$select public.reorder_menu_items('30000000-0000-4000-a000-000000000001',array['31000000-0000-4000-a000-000000000001','31000000-0000-4000-a000-000000000001','31000000-0000-4000-a000-000000000002','31000000-0000-4000-a000-000000000003','31000000-0000-4000-a000-000000000004']::uuid[])$q$,
 '22023', null, 'duplicate ordering identities are refused');
select throws_ok($q$select public.reorder_menu_items('30000000-0000-4000-a000-000000000011',array[]::uuid[])$q$,
 '42501', null, 'foreign category order is refused');
select is((select sort_order from public.menu_items where id='31000000-0000-4000-a000-000000000006'),1,'refused writes leave the saved order intact');

select is(public.read_menu_highlights('00000000-0000-4000-a000-000000000001'),
 '{"title":"Highlights","itemIds":[]}'::jsonb,'an unconfigured outlet has the default empty selection');
select is(public.set_menu_highlights('00000000-0000-4000-a000-000000000001','  Newly Launched  ',array['31000000-0000-4000-a000-000000000005','31000000-0000-4000-a000-000000000001']::uuid[]),
 '{"title":"Newly Launched","itemIds":["31000000-0000-4000-a000-000000000005","31000000-0000-4000-a000-000000000001"]}'::jsonb,'title and independent selection save together and trim the title');
select is(public.read_menu_highlights('00000000-0000-4000-a000-000000000001'),
 '{"title":"Newly Launched","itemIds":["31000000-0000-4000-a000-000000000005","31000000-0000-4000-a000-000000000001"]}'::jsonb,'the configuration round-trips');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001',' ',array[]::uuid[])$q$,'22023',null,'blank title refused');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001',repeat('x',61),array[]::uuid[])$q$,'22023',null,'overlong title refused');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001','Changed',null)$q$,'22023',null,'null selection refused');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001','Changed',array[null]::uuid[])$q$,'22023',null,'null identity refused');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001','Changed',array['31000000-0000-4000-a000-000000000001','31000000-0000-4000-a000-000000000001']::uuid[])$q$,'22023',null,'duplicate selection refused');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001','Changed',array['32000000-0000-4000-a000-000000000001']::uuid[])$q$,'22023',null,'foreign dish refused');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001','Changed',array[['31000000-0000-4000-a000-000000000001','31000000-0000-4000-a000-000000000002'],['31000000-0000-4000-a000-000000000003','31000000-0000-4000-a000-000000000004']]::uuid[])$q$,'22023',null,'multidimensional selection cannot escape the flat ordered contract');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000002','Changed',array[]::uuid[])$q$,'42501',null,'foreign outlet write refused');
select throws_ok($q$select public.read_menu_highlights('00000000-0000-4000-a000-000000000002')$q$,'42501',null,'foreign configuration read refused');
select is(public.read_menu_highlights('00000000-0000-4000-a000-000000000001')->>'title','Newly Launched','invalid replacement does not partly save its title');
select is(jsonb_array_length(public.read_menu_highlights('00000000-0000-4000-a000-000000000001')->'itemIds'),2,'invalid replacement does not partly clear its selection');

reset role;
select throws_ok($q$insert into public.menu_highlight_items(outlet_id,item_id,sort_order) values('00000000-0000-4000-a000-000000000001','32000000-0000-4000-a000-000000000001',3)$q$,
 '23503',null,'same-outlet FK refuses foreign references even for privileged writes');
select results_eq($q$select id,outlet_id,category_id,name,price_paise,is_available from public.menu_items order by id$q$,
 $q$select * from original_items order by id$q$,'presentation changes no ordinary item facts');
select results_eq($q$select * from public.bill_items order by id$q$,$q$select * from original_lines order by id$q$,'captured bill lines remain unchanged');
select ok((select relrowsecurity from pg_class where oid='public.menu_highlight_sections'::regclass),'section table has RLS');
select ok((select relrowsecurity from pg_class where oid='public.menu_highlight_items'::regclass),'selection table has RLS');

-- Owner seeds the other outlet so a zero-row isolation assertion cannot pass
-- merely because there is nothing to conceal.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select lives_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000002','Recommended',array['32000000-0000-4000-a000-000000000001']::uuid[])$q$,'owner writes the second outlet');
select is((select count(*) from public.menu_highlight_sections),2::bigint,'owner reads both configurations');
select is((select count(*) from public.menu_highlight_items),3::bigint,'owner reads both selections');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select is((select count(*) from public.menu_highlight_sections where outlet_id='00000000-0000-4000-a000-000000000002'),0::bigint,'foreign section is hidden');
select is((select count(*) from public.menu_highlight_items where outlet_id='00000000-0000-4000-a000-000000000002'),0::bigint,'foreign selection is hidden');
select throws_ok($q$update public.menu_highlight_sections set title='Bypass'$q$,'42501',null,'direct section writes cannot bypass the atomic command');
select throws_ok($q$delete from public.menu_highlight_items$q$,'42501',null,'direct selection writes cannot bypass the atomic command');

-- Selection reads preserve unavailable dishes but omit removed/inactive ones.
update public.menu_items set is_available=false where id='31000000-0000-4000-a000-000000000001';
select is(jsonb_array_length(public.read_menu_highlights('00000000-0000-4000-a000-000000000001')->'itemIds'),2,'unavailable selections remain');
select public.remove_menu_item('31000000-0000-4000-a000-000000000001');
select is(jsonb_array_length(public.read_menu_highlights('00000000-0000-4000-a000-000000000001')->'itemIds'),1,'removed selections disappear');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001','Changed',array['31000000-0000-4000-a000-000000000001']::uuid[])$q$,'22023',null,'a removed dish cannot be selected again');
update public.menu_categories set is_active=false where id='30000000-0000-4000-a000-000000000002';
select is(jsonb_array_length(public.read_menu_highlights('00000000-0000-4000-a000-000000000001')->'itemIds'),0,'inactive category selections disappear');
select lives_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001','Best Sellers',array[]::uuid[])$q$,'an empty selection is valid');

select pg_temp.impersonate('10000000-0000-4000-a000-00000000000a');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001','No',array[]::uuid[])$q$,'42501',null,'biller cannot write highlights');
select throws_ok($q$select public.reorder_menu_items('30000000-0000-4000-a000-000000000001',array[]::uuid[])$q$,'42501',null,'biller cannot reorder');
select is((select count(*) from public.menu_highlight_sections),0::bigint,'biller cannot read configuration rows');
select is((select count(*) from public.menu_highlight_items),0::bigint,'biller cannot read selection rows');
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001','No',array[]::uuid[])$q$,'42501',null,'employee cannot write highlights');
select throws_ok($q$select public.reorder_menu_items('30000000-0000-4000-a000-000000000001',array[]::uuid[])$q$,'42501',null,'employee cannot reorder');
select is((select count(*) from public.menu_highlight_items),0::bigint,'employee cannot read selection rows');
select is((select count(*) from public.menu_highlight_sections),0::bigint,'employee cannot read configuration rows');
reset role;
set local role anon;
select throws_ok($q$select public.read_menu_highlights('00000000-0000-4000-a000-000000000001')$q$,'42501',null,'anonymous caller cannot read highlights configuration');
select throws_ok($q$select public.set_menu_highlights('00000000-0000-4000-a000-000000000001','No',array[]::uuid[])$q$,'42501',null,'anonymous caller cannot write highlights');

select * from finish();
rollback;
