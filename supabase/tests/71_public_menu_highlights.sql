begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',json_build_object('sub',p_sub,'role','authenticated')::text,true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select public.set_menu_highlights('00000000-0000-4000-a000-000000000001','Shawarma',array['31000000-0000-4000-a000-000000000005','31000000-0000-4000-a000-000000000001']::uuid[]);
select public.reorder_menu_items('30000000-0000-4000-a000-000000000001',array['31000000-0000-4000-a000-000000000006','31000000-0000-4000-a000-000000000004','31000000-0000-4000-a000-000000000003','31000000-0000-4000-a000-000000000002','31000000-0000-4000-a000-000000000001']::uuid[]);
select throws_ok($q$select public.public_menu('shawarmania-kalyani')$q$,'42501',null,'manager still cannot call the public reader');
reset role;
set local role service_role;
select is((select jsonb_agg(s->'name') from jsonb_array_elements(public.public_menu('shawarmania-kalyani')->'sections') s),
 '["Shawarma","Shawarma","Salads","Burgers"]'::jsonb,'highlight heading may match a category and leads ordinary headings');
select is(public.public_menu('shawarmania-kalyani')->'sections'->0->'items',
 '[{"name":"Healthy Chicken Shawarma Salad","description":"Viral; 25.8g protein per 100g","price_paise":21900,"is_veg":false,"is_available":true},{"name":"Classic Chicken Shawarma","description":"Bestseller","price_paise":13900,"is_veg":false,"is_available":true}]'::jsonb,
 'highlights use independent order and the exact existing public item projection');
select is(public.public_menu('shawarmania-kalyani')->'sections'->1->'items'->0->>'name','Stuffed Lebanese Chicken Shawarma','ordinary item order follows the saved reorder');
select is(public.public_menu('shawarmania-kalyani')->'sections'->1->'items'->4->>'name','Classic Chicken Shawarma','a highlighted dish remains in its ordinary category');
select is(jsonb_array_length(public.public_menu('shawarmania-kanchrapara')->'sections'),3,'another outlet has no borrowed highlights');

reset role;
update public.menu_items set is_available=false,price_paise=14900 where id='31000000-0000-4000-a000-000000000001';
set local role service_role;
select is(public.public_menu('shawarmania-kalyani')->'sections'->0->'items'->1->>'is_available','false','highlight reflects temporary unavailability');
select is(public.public_menu('shawarmania-kalyani')->'sections'->1->'items'->4->>'is_available','false','ordinary appearance has the same availability');
select is(public.public_menu('shawarmania-kalyani')->'sections'->0->'items'->1->>'price_paise','14900','highlight reflects current price, without a price clone');
reset role;
update public.menu_items set is_active=false where id='31000000-0000-4000-a000-000000000001';
set local role service_role;
select is(jsonb_array_length(public.public_menu('shawarmania-kalyani')->'sections'->0->'items'),1,'removed dish is omitted from highlights');
select is(jsonb_array_length(public.public_menu('shawarmania-kalyani')->'sections'->1->'items'),4,'removed dish is omitted from its category too');
reset role;
update public.menu_categories set is_active=false where id='30000000-0000-4000-a000-000000000002';
set local role service_role;
select is(public.public_menu('shawarmania-kalyani')->'sections'->0->'items'->0->>'name','Stuffed Lebanese Chicken Shawarma','removed-only/inactive-category highlights produce no leading empty section');
select is(jsonb_array_length(public.public_menu('shawarmania-kalyani')->'sections'),2,'no empty highlights or inactive category is emitted');
select is(public.public_menu('no-such-outlet'),null,'invented slug remains null');
reset role;
update public.outlets set is_active=false where id='00000000-0000-4000-a000-000000000001';
set local role service_role;
select is(public.public_menu('shawarmania-kalyani'),null,'closed outlet remains null even with saved highlights');
reset role;
update public.outlets set is_active=true where id='00000000-0000-4000-a000-000000000001';
update public.menu_items set is_active=false where outlet_id='00000000-0000-4000-a000-000000000001';
set local role service_role;
select is(public.public_menu('shawarmania-kalyani'),null,'empty ordinary menu and removed selections remain null');
reset role;
set local role anon;
select throws_ok($q$select public.public_menu('shawarmania-kalyani')$q$,'42501',null,'anonymous reader remains refused');
select * from finish();
rollback;
