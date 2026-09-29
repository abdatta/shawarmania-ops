-- the-menu-is-public: the outlet's public address, and the one reader a
-- customer's menu comes through.
--
-- What has to hold, and how each would fail silently:
--
--   * every outlet has a slug, derived from its name, unique and URL-safe --
--     an outlet created without one would have no public menu and nobody
--     would notice until a QR code was printed for it;
--   * a blank slug never un-publishes a menu, and a slug another outlet holds
--     is refused rather than shared;
--   * `public_menu` answers the service role only, with exactly what a customer
--     may see: active sections and items in order, unavailable ones flagged
--     rather than hidden, removed ones absent, and nothing at all for a closed
--     outlet, an empty menu or a slug nobody holds.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text,
    true);
  execute 'set local role authenticated';
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. The slug.

select is(public.menu_slug_from('  Kalyani   Cafe & Grill! '), 'kalyani-cafe-grill',
  'a name becomes lowercase words joined by single hyphens');
select is(public.menu_slug_from('!!!'), '', 'a name with no letters or digits has no slug of its own');

select results_eq(
  $q$select menu_slug from public.outlets
      where id in ('00000000-0000-4000-a000-000000000001',
                   '00000000-0000-4000-a000-000000000002')
      order by id$q$,
  $q$values ('shawarmania-kalyani'), ('shawarmania-kanchrapara')$q$,
  'every existing outlet was given the slug of its name');

-- The owner creates outlets; the slug is derived without being asked for.
select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');

insert into public.outlets (id, code, name, location_label)
values ('00000000-0000-4000-a000-0000000000c1', 'skcafe-probe', 'Kalyani Cafe', 'Probe');
select is((select menu_slug from public.outlets where id = '00000000-0000-4000-a000-0000000000c1'),
  'kalyani-cafe', 'a new outlet is given the slug of its name');

insert into public.outlets (id, code, name, location_label)
values ('00000000-0000-4000-a000-0000000000c2', 'skcafe-probe-2', 'Kalyani Cafe', 'Probe');
select is((select menu_slug from public.outlets where id = '00000000-0000-4000-a000-0000000000c2'),
  'kalyani-cafe-2', 'a second outlet with the same name is given the next free slug, not a clash');

insert into public.outlets (id, code, name, location_label)
values ('00000000-0000-4000-a000-0000000000c3', 'plaza', '???', 'Probe');
select is((select menu_slug from public.outlets where id = '00000000-0000-4000-a000-0000000000c3'),
  'plaza', 'a name with no usable letters falls back to the code');

update public.outlets set menu_slug = '  Cafe-Adda ' where id = '00000000-0000-4000-a000-0000000000c1';
select is((select menu_slug from public.outlets where id = '00000000-0000-4000-a000-0000000000c1'),
  'cafe-adda', 'an owner may choose the slug, and it is trimmed and lowercased');

update public.outlets set menu_slug = '' where id = '00000000-0000-4000-a000-0000000000c1';
select is((select menu_slug from public.outlets where id = '00000000-0000-4000-a000-0000000000c1'),
  'cafe-adda', 'clearing the slug keeps the one it had rather than un-publishing the menu');

update public.outlets set name = 'Renamed Cafe' where id = '00000000-0000-4000-a000-0000000000c1';
select is((select menu_slug from public.outlets where id = '00000000-0000-4000-a000-0000000000c1'),
  'cafe-adda', 'renaming an outlet does not move its public address');

select throws_ok(
  $q$update public.outlets set menu_slug = 'shawarmania-kalyani'
      where id = '00000000-0000-4000-a000-0000000000c2'$q$,
  '23505', null, 'a slug another outlet holds is refused');

select throws_ok(
  $q$update public.outlets set menu_slug = 'cafe adda!'
      where id = '00000000-0000-4000-a000-0000000000c2'$q$,
  '23514', null, 'a slug that is not URL-safe is refused by the database');

select throws_ok(
  $q$update public.outlets set menu_slug = repeat('a', 61)
      where id = '00000000-0000-4000-a000-0000000000c2'$q$,
  '23514', null, 'a slug longer than sixty characters is refused');

-- ---------------------------------------------------------------------------
-- 2. Who may call the reader.

select pg_temp.impersonate('10000000-0000-4000-a000-000000000001');
select throws_ok($q$select public.public_menu('shawarmania-kalyani')$q$, '42501', null,
  'a signed-in session, even the owner''s, cannot call the public reader');

reset role;
set local role anon;
select throws_ok($q$select public.public_menu('shawarmania-kalyani')$q$, '42501', null,
  'the anonymous role cannot call the public reader');

-- ---------------------------------------------------------------------------
-- 3. What it answers.

reset role;
-- Arrange as the table owner: one item unavailable, one removed.
update public.menu_items set is_available = false
 where id = '31000000-0000-4000-a000-000000000002';
update public.menu_items set is_active = false, is_available = false
 where id = '31000000-0000-4000-a000-000000000003';

set local role service_role;

select is(
  (select public.public_menu('shawarmania-kalyani') -> 'outlet'),
  '{"name": "Shawarmania Kalyani", "slug": "shawarmania-kalyani"}'::jsonb,
  'the answer names the outlet and its slug, and nothing else about it');

select is(
  (select jsonb_agg(s -> 'name') from jsonb_array_elements(
     public.public_menu('shawarmania-kalyani') -> 'sections') s),
  '["Shawarma", "Salads", "Burgers"]'::jsonb,
  'sections come in the order the counter groups them');

select is(
  (select public.public_menu('shawarmania-kalyani') -> 'sections' -> 0 -> 'items' -> 0),
  '{"name": "Classic Chicken Shawarma", "description": "Bestseller", "price_paise": 13900, "is_veg": false, "is_available": true}'::jsonb,
  'an item carries exactly its name, description, price, veg flag and availability');

select is(
  (select i ->> 'is_available' from jsonb_array_elements(
     public.public_menu('shawarmania-kalyani') -> 'sections' -> 0 -> 'items') i
    where i ->> 'name' = 'Mayonnaise Chicken Shawarma'),
  'false', 'an unavailable item is listed, flagged unavailable, not hidden');

select is(
  (select count(*)::int from jsonb_array_elements(
     public.public_menu('shawarmania-kalyani') -> 'sections' -> 0 -> 'items') i
    where i ->> 'name' = 'Double Chicken Shawarma'),
  0, 'a removed item is not on the public menu');

select is(public.public_menu('  SHAWARMANIA-KALYANI '), public.public_menu('shawarmania-kalyani'),
  'the slug is matched as the database stores it, whatever the case or spacing of the address');

select is(public.public_menu('nobody-holds-this'), null, 'a slug nobody holds answers null');
select is(public.public_menu('cafe-adda'), null, 'an outlet with nothing on its menu answers null');

reset role;
update public.outlets set is_active = false where id = '00000000-0000-4000-a000-000000000002';
set local role service_role;
select is(public.public_menu('shawarmania-kanchrapara'), null,
  'a closed outlet answers null, exactly as a slug nobody holds');

select * from finish();
rollback;
