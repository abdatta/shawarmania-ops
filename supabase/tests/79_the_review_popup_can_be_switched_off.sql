-- the-review-popup-can-be-switched-off: the popup is one more switch of the
-- review ask, on by default, written through the same narrow function, and
-- carried by public_menu's `review`.
--
--   outlets  00000000-…0001 Kalyani   00000000-…0002 Kanchrapara
--   people   10000000-…0002 fa_kalyani    …0003 fa_kanchrapara
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

select is((select count(*)::int from public.outlets where not review_ask_popup), 0,
  'every outlet keeps the popup until somebody switches it off');

select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select lives_ok($q$select public.set_outlet_review_ask('00000000-0000-4000-a000-000000000001', true,
  'https://g.page/r/Cef3CrZy-ZyuEBE/review', 5, false)$q$, 'a manager keeps only the banner');
select throws_ok($q$select public.set_outlet_review_ask('00000000-0000-4000-a000-000000000002', true,
  'https://g.page/r/x/review', 5, false)$q$, '42501', null, 'not at another outlet');

reset role;
set local role service_role;
select is(public.public_menu('shawarmania-kalyani')->'review',
  '{"url":"https://g.page/r/Cef3CrZy-ZyuEBE/review","percent":5,"popup":false}'::jsonb,
  'the public menu says banner only');

reset role;
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select lives_ok($q$select public.set_outlet_review_ask('00000000-0000-4000-a000-000000000001', true,
  'https://g.page/r/Cef3CrZy-ZyuEBE/review', 5, null)$q$, 'an unsaid popup switch is not refused');
reset role;
select is((select review_ask_popup from public.outlets where id='00000000-0000-4000-a000-000000000001'), true,
  'and means the popup');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='set_outlet_review_ask'), 1,
  'the four-argument write is gone, so no caller can leave the switch behind');

select * from finish();
rollback;
