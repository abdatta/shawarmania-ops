-- the-menu-asks-for-a-review: the outlet's Google review ask in the database.
--
--   * every outlet starts with it off, and the database refuses an ask with
--     nowhere to send the customer, a link that is not https, and a thank-you
--     outside 1–50 %, however it is asked;
--   * the owner writes any outlet's ask and a manager their own outlet's, through
--     one narrow function; nobody else does;
--   * public_menu carries it beside the sections while it is on, null while off,
--     and still refuses every client role.
--
--   outlets  00000000-…0001 Kalyani   00000000-…0002 Kanchrapara
--   people   10000000-…0001 owner     …0002 fa_kalyani    …0003 fa_kanchrapara
--            …0006 employee_kalyani
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

-- ---------------------------------------------------------------------------
-- Every outlet starts with it off.
select is((select count(*)::int from public.outlets where review_ask_enabled), 0,
  'no outlet in a fresh database asks for a review');
select is((select review_ask_percent from public.outlets where id='00000000-0000-4000-a000-000000000001'), 5,
  'the thank-you starts at five percent');
select is(public.public_menu('shawarmania-kalyani')->'review', 'null'::jsonb,
  'the public menu says null while the outlet does not ask');

-- ---------------------------------------------------------------------------
-- The database refuses what does not make sense, however it is asked.
select throws_ok($q$update public.outlets set review_ask_enabled=true, review_ask_url=null
  where id='00000000-0000-4000-a000-000000000001'$q$, '23514', null, 'asking needs a link');
select throws_ok($q$update public.outlets set review_ask_url='http://g.page/r/x/review'
  where id='00000000-0000-4000-a000-000000000001'$q$, '23514', null, 'the link must be https');
select throws_ok($q$update public.outlets set review_ask_url='https://g.page/r/x" onclick="y'
  where id='00000000-0000-4000-a000-000000000001'$q$, '23514', null, 'the link cannot break out of an attribute');
select throws_ok($q$update public.outlets set review_ask_percent=0
  where id='00000000-0000-4000-a000-000000000001'$q$, '23514', null, 'a thank-you is at least one percent');
select throws_ok($q$update public.outlets set review_ask_percent=51
  where id='00000000-0000-4000-a000-000000000001'$q$, '23514', null, 'a thank-you is at most fifty percent');

-- ---------------------------------------------------------------------------
-- The owner writes any outlet's ask through the one function.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select lives_ok($q$select public.set_outlet_review_ask('00000000-0000-4000-a000-000000000002', true,
  '  https://g.page/r/kanchrapara/review  ', 7)$q$, 'the owner sets another outlet''s ask');
reset role;
select is((select row(review_ask_enabled, review_ask_url, review_ask_percent)::text from public.outlets
  where id='00000000-0000-4000-a000-000000000002'), '(t,https://g.page/r/kanchrapara/review,7)',
  'the link is stored trimmed');

-- A manager writes their own outlet's ask, and not another's.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000002');
select lives_ok($q$select public.set_outlet_review_ask('00000000-0000-4000-a000-000000000001', true,
  'https://g.page/r/Cef3CrZy-ZyuEBE/review', 5)$q$, 'a manager sets their own outlet''s ask');
select throws_ok($q$select public.set_outlet_review_ask('00000000-0000-4000-a000-000000000002', false, null, 5)$q$,
  '42501', null, 'a manager cannot set another outlet''s ask');
select throws_ok($q$select public.set_outlet_review_ask('00000000-0000-4000-a000-000000000001', true, '', 5)$q$,
  '23514', null, 'a blank link is no link, so asking with it is refused');

-- Staff cannot set it at all.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000006');
select throws_ok($q$select public.set_outlet_review_ask('00000000-0000-4000-a000-000000000001', false, null, 5)$q$,
  '42501', null, 'an employee cannot change the ask');

-- ---------------------------------------------------------------------------
-- The public reader carries it beside the sections, and nothing about it leaks
-- to a client role.
reset role;
set local role service_role;
select is(public.public_menu('shawarmania-kalyani')->'review',
  '{"url":"https://g.page/r/Cef3CrZy-ZyuEBE/review","percent":5}'::jsonb,
  'the public menu carries the outlet''s own ask');
select is(public.public_menu('shawarmania-kanchrapara')->'review'->>'percent', '7',
  'each outlet carries its own thank-you');
select ok(jsonb_array_length(public.public_menu('shawarmania-kalyani')->'sections') > 0,
  'the sections are unchanged beside it');

reset role;
update public.outlets set review_ask_enabled=false where id='00000000-0000-4000-a000-000000000001';
set local role service_role;
select is(public.public_menu('shawarmania-kalyani')->'review', 'null'::jsonb,
  'switched off, the public menu says null though the link is kept');

reset role;
set local role anon;
select throws_ok($q$select public.public_menu('shawarmania-kalyani')$q$, '42501', null,
  'the anonymous role still cannot read the public menu');
select throws_ok($q$select public.set_outlet_review_ask('00000000-0000-4000-a000-000000000001', false, null, 5)$q$,
  '42501', null, 'the anonymous role cannot call the write');

select * from finish();
rollback;
