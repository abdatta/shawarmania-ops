-- A dish's photo (a-dish-can-show-its-photo, #84, behind `dish-photos`).
--
-- Held here: the photo row and the photo files belong to the dish's outlet, by
-- the database, for a hand-crafted request as much as a screen; nobody writes
-- the row but the two functions, which refuse while the gate is off, for a
-- biller, for another outlet, for a removed dish and for files not all
-- uploaded under that outlet; the table refuses a bad key, format, shape or
-- framing; and the Worker's two reads send a photo only while the gate is on,
-- never the kept original, and leave `public_menu` as it was.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set FA_KPA '10000000-0000-4000-a000-000000000003'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set KAL '00000000-0000-4000-a000-000000000001'
\set KPA '00000000-0000-4000-a000-000000000002'
\set DISH '31000000-0000-4000-a000-000000000001'
\set DISH2 '31000000-0000-4000-a000-000000000002'

-- Keys: a large photo and thumbnail pair, its replacement, and an original.
\set K1 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set K2 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
\set SRC 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'

create temp table fixture (name text primary key, value text) on commit drop;
grant all on fixture to authenticated, service_role;
insert into fixture values
  ('kpa_dish', (select id::text from public.menu_items
                 where outlet_id = :'KPA' and is_active order by sort_order, id limit 1)),
  ('kal_slug', (select menu_slug from public.outlets where id = :'KAL'));

-- Three uploaded files, as the storage API leaves them.
create function pg_temp.upload(outlet uuid, key text, src text)
returns void language sql as $$
  insert into storage.objects (bucket_id, name) values
    ('menu-photos', outlet::text || '/' || key || '.webp'),
    ('menu-photos', outlet::text || '/' || key || '-sm.webp'),
    ('menu-photos', outlet::text || '/' || src || '-src.webp')
  on conflict do nothing
$$;

create function pg_temp.set_photo(item uuid, key text)
returns jsonb language sql as $$
  select public.set_menu_item_photo(item, key, 'webp', '4:3',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'webp',
    '{"x":0,"y":0.1,"w":1,"h":0.75}', '{"x":0.25,"y":0.1,"w":0.5,"h":0.6667}')
$$;

update public.change_gates set enabled = true where key = 'dish-photos';

-- ---------------------------------------------------------------------------
-- 1. The table refuses what is not a photo, and names only the dish's outlet.

select throws_ok(
  format($q$insert into public.menu_item_photos (item_id, outlet_id, photo_key, photo_format,
    aspect, source_key, source_format, large_crop, thumb_crop)
    values (%L, %L, %L, 'png', '4:3', %L, 'webp', '{"x":0,"y":0,"w":1,"h":1}', '{"x":0,"y":0,"w":1,"h":1}')$q$,
    :'DISH', :'KAL', :'K1', :'SRC'),
  '23514', null, 'a format other than WebP or JPEG is refused');

select throws_ok(
  format($q$insert into public.menu_item_photos (item_id, outlet_id, photo_key, photo_format,
    aspect, source_key, source_format, large_crop, thumb_crop)
    values (%L, %L, %L, 'webp', '16:9', %L, 'webp', '{"x":0,"y":0,"w":1,"h":1}', '{"x":0,"y":0,"w":1,"h":1}')$q$,
    :'DISH', :'KAL', :'K1', :'SRC'),
  '23514', null, 'a shape other than 4:3, 1:1 or 4:5 is refused');

select throws_ok(
  format($q$insert into public.menu_item_photos (item_id, outlet_id, photo_key, photo_format,
    aspect, source_key, source_format, large_crop, thumb_crop)
    values (%L, %L, %L, 'webp', '4:3', %L, 'webp', '{"x":0.5,"y":0,"w":0.6,"h":1}', '{"x":0,"y":0,"w":1,"h":1}')$q$,
    :'DISH', :'KAL', :'K1', :'SRC'),
  '23514', null, 'a framing that runs off the photo is refused');

select throws_ok(
  format($q$insert into public.menu_item_photos (item_id, outlet_id, photo_key, photo_format,
    aspect, source_key, source_format, large_crop, thumb_crop)
    values (%L, %L, 'NOT-A-KEY', 'webp', '4:3', %L, 'webp', '{"x":0,"y":0,"w":1,"h":1}', '{"x":0,"y":0,"w":1,"h":1}')$q$,
    :'DISH', :'KAL', :'SRC'),
  '23514', null, 'a key that is not 64 lowercase hex is refused');

select throws_ok(
  format($q$insert into public.menu_item_photos (item_id, outlet_id, photo_key, photo_format,
    aspect, source_key, source_format, large_crop, thumb_crop)
    values (%L, %L, %L, 'webp', '4:3', %L, 'webp', '{"x":0,"y":0,"w":1,"h":1}', '{"x":0,"y":0,"w":1,"h":1}')$q$,
    :'DISH', :'KPA', :'K1', :'SRC'),
  '23503', null, 'a photo row naming another outlet than its dish''s is refused, even for a privileged write');

-- ---------------------------------------------------------------------------
-- 2. The bucket: the owner and the outlet's manager, nobody else.

select pg_temp.impersonate(:'FA_KPA');
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name) values ('menu-photos', %L)$q$,
    :'KAL' || '/' || :'K1' || '.webp'),
  '42501', null, 'another outlet''s manager cannot upload under this outlet''s folder');

select pg_temp.impersonate(:'BILLER_KAL');
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name) values ('menu-photos', %L)$q$,
    :'KAL' || '/' || :'K1' || '.webp'),
  '42501', null, 'a biller cannot upload a photo, even at their own outlet');

select pg_temp.impersonate(:'FA_KAL');
select throws_ok(
  $q$insert into storage.objects (bucket_id, name) values ('menu-photos', 'not-an-outlet/x.webp')$q$,
  '42501', null, 'a path that is not an outlet folder is reachable by nobody');
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name) values ('menu-photos', %L)$q$,
    :'KAL' || '/deeper/' || :'K1' || '.webp'),
  '42501', null, 'nor is a file in a folder beneath the outlet''s');
select lives_ok(
  format($q$insert into storage.objects (bucket_id, name) values ('menu-photos', %L)$q$,
    :'KAL' || '/' || :'K1' || '.webp'),
  'the outlet''s own manager uploads under its folder');

select pg_temp.impersonate(:'FA_KPA');
select is((select count(*)::int from storage.objects
            where bucket_id = 'menu-photos' and name like :'KAL' || '/%'),
          0, 'another outlet''s manager reads none of this outlet''s files');
-- Storage refuses a direct DELETE from SQL; its API deletes under these same
-- policies, whose shared predicate is checked here (and end to end by the
-- authenticated suite, e2e-auth/dish-photos.spec.ts).
select is(public.may_reach_menu_photo(:'KAL' || '/' || :'K1' || '.webp'), false,
  'and may not delete them: the delete policy''s predicate refuses');
select pg_temp.impersonate(:'FA_KAL');
select is(public.may_reach_menu_photo(:'KAL' || '/' || :'K1' || '.webp'), true,
  'while the outlet''s own manager may');
select pg_temp.as_postgres();

update public.change_gates set enabled = false where key = 'dish-photos';
select pg_temp.impersonate(:'FA_KAL');
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name) values ('menu-photos', %L)$q$,
    :'KAL' || '/' || :'K2' || '.webp'),
  '42501', null, 'with dish-photos off, not even the manager reaches the bucket');
select pg_temp.as_postgres();
update public.change_gates set enabled = true where key = 'dish-photos';

-- ---------------------------------------------------------------------------
-- 3. Setting a photo: the files first, under the dish's own outlet.

select pg_temp.as_postgres();
select pg_temp.upload(:'KAL', :'K1', :'SRC');
select pg_temp.upload(:'KPA', :'K2', :'SRC');

select pg_temp.impersonate(:'FA_KAL');
select throws_ok(
  format($q$insert into public.menu_item_photos (item_id, outlet_id, photo_key, photo_format,
    aspect, source_key, source_format, large_crop, thumb_crop)
    values (%L, %L, %L, 'webp', '4:3', %L, 'webp', '{"x":0,"y":0,"w":1,"h":1}', '{"x":0,"y":0,"w":1,"h":1}')$q$,
    :'DISH', :'KAL', :'K1', :'SRC'),
  '42501', null, 'nobody writes the photo row directly, not even the manager');

select throws_ok(format('select pg_temp.set_photo(%L, %L)', :'DISH', :'K2'),
  '22023', null, 'a key whose files are under another outlet is refused');
select throws_ok(format('select pg_temp.set_photo(%L, %L)', :'DISH',
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'),
  '22023', null, 'a key whose files were never uploaded is refused');

select is(pg_temp.set_photo(:'DISH', :'K1'), null::jsonb,
  'the manager sets the dish''s first photo, and there was none before');
select is((select photo_key from public.menu_item_photos where item_id = :'DISH'), :'K1',
  'the row holds the key');

select pg_temp.impersonate(:'FA_KPA');
select throws_ok(format('select pg_temp.set_photo(%L, %L)', :'DISH', :'K1'),
  '42501', null, 'another outlet''s manager cannot set this dish''s photo');
select throws_ok(format('select public.clear_menu_item_photo(%L)', :'DISH'),
  '42501', null, 'nor clear it');
select is((select count(*)::int from public.menu_item_photos where item_id = :'DISH'), 0,
  'nor read its photo row');

select pg_temp.impersonate(:'BILLER_KAL');
select throws_ok(format('select pg_temp.set_photo(%L, %L)', :'DISH2', :'K1'),
  '42501', null, 'a biller cannot set a photo');
select is((select count(*)::int from public.menu_item_photos where item_id = :'DISH'), 1,
  'though a biller may read the row of a dish they may read');

-- A replacement: the previous keys come back for the client to delete.
select pg_temp.as_postgres();
select pg_temp.upload(:'KAL', :'K2', :'SRC');
select pg_temp.impersonate(:'OWNER');
select is(pg_temp.set_photo(:'DISH', :'K2'),
  jsonb_build_object('key', :'K1', 'format', 'webp', 'sourceKey', :'SRC', 'sourceFormat', 'webp'),
  'the owner replaces it, and is told what it replaced');

-- The gate off: neither function moves.
select pg_temp.as_postgres();
update public.change_gates set enabled = false where key = 'dish-photos';
select pg_temp.impersonate(:'FA_KAL');
select throws_ok(format('select pg_temp.set_photo(%L, %L)', :'DISH', :'K1'),
  'P0001', null, 'with dish-photos off, setting a photo is refused');
select throws_ok(format('select public.clear_menu_item_photo(%L)', :'DISH'),
  'P0001', null, 'and so is clearing one');
select pg_temp.as_postgres();
update public.change_gates set enabled = true where key = 'dish-photos';

-- Clearing hands back what it took off; setting it again restores it.
select pg_temp.impersonate(:'FA_KAL');
select is(public.clear_menu_item_photo(:'DISH'),
  jsonb_build_object('key', :'K2', 'format', 'webp', 'sourceKey', :'SRC', 'sourceFormat', 'webp'),
  'the manager clears the photo, and is told what it was');
select is(public.clear_menu_item_photo(:'DISH'), null::jsonb, 'clearing a dish with no photo is a no-op');
select pg_temp.set_photo(:'DISH', :'K2');

-- ---------------------------------------------------------------------------
-- 4. The Worker's reads.

select pg_temp.as_postgres();
set local role service_role;

select is(
  (select item -> 'photo' from jsonb_array_elements(public.public_menu_v2((select value from fixture where name = 'kal_slug')) -> 'sections') s,
          jsonb_array_elements(s -> 'items') item
    where item ->> 'name' = 'Classic Chicken Shawarma' limit 1),
  jsonb_build_object('key', :'K2', 'format', 'webp', 'aspect', '4:3'),
  'public_menu_v2 sends the photographed dish''s key, format and shape');
select is(
  (select count(*)::int from jsonb_array_elements(public.public_menu_v2((select value from fixture where name = 'kal_slug')) -> 'sections') s,
          jsonb_array_elements(s -> 'items') item
    where item ? 'photo' and item -> 'photo' = 'null'::jsonb),
  (select count(*)::int - 1 from jsonb_array_elements(public.public_menu_v2((select value from fixture where name = 'kal_slug')) -> 'sections') s,
          jsonb_array_elements(s -> 'items') item),
  'and null for every other dish');
select ok(
  position(:'SRC' in public.public_menu_v2((select value from fixture where name = 'kal_slug'))::text) = 0
  and position('crop' in public.public_menu_v2((select value from fixture where name = 'kal_slug'))::text) = 0,
  'neither the kept original''s key nor a framing is ever sent');
select ok(position('photo' in public.public_menu((select value from fixture where name = 'kal_slug'))::text) = 0,
  'public_menu is as it was: no photo field');
select is(public.public_menu_v2('no-such-menu'), null::jsonb, 'an unknown address is null, as before');

select is(public.public_menu_photo((select value from fixture where name = 'kal_slug'), :'K2'),
  jsonb_build_object('object', :'KAL' || '/' || :'K2', 'format', 'webp'),
  'public_menu_photo names the current photo''s file');
select is(public.public_menu_photo((select value from fixture where name = 'kal_slug'), :'K1'), null::jsonb,
  'but not the photo it replaced');
select is(public.public_menu_photo((select value from fixture where name = 'kal_slug'), :'SRC'), null::jsonb,
  'nor the kept original');
select is(public.public_menu_photo('no-such-menu', :'K2'), null::jsonb,
  'nor a key asked for under another address');

-- Highlights carry the same field.
select pg_temp.impersonate(:'FA_KAL');
select public.set_menu_highlights(:'KAL', 'Highlights', array[:'DISH'::uuid]);
select pg_temp.as_postgres();
set local role service_role;
select is(
  (select s -> 'items' -> 0 -> 'photo' from jsonb_array_elements(public.public_menu_v2((select value from fixture where name = 'kal_slug')) -> 'sections') s
    where s ->> 'name' = 'Highlights'),
  jsonb_build_object('key', :'K2', 'format', 'webp', 'aspect', '4:3'),
  'a highlighted dish carries its photo too');

-- The gate off: no photo anywhere, no file.
select pg_temp.as_postgres();
update public.change_gates set enabled = false where key = 'dish-photos';
set local role service_role;
select is(
  (select count(*)::int from jsonb_array_elements(public.public_menu_v2((select value from fixture where name = 'kal_slug')) -> 'sections') s,
          jsonb_array_elements(s -> 'items') item
    where item -> 'photo' <> 'null'::jsonb),
  0, 'with dish-photos off, public_menu_v2 sends no photo');
select is(public.public_menu_photo((select value from fixture where name = 'kal_slug'), :'K2'), null::jsonb,
  'and public_menu_photo names no file');
select pg_temp.as_postgres();
update public.change_gates set enabled = true where key = 'dish-photos';

-- A removed dish: its photo is no longer served, and cannot be set.
update public.menu_items set is_active = false where id = :'DISH';
set local role service_role;
select is(public.public_menu_photo((select value from fixture where name = 'kal_slug'), :'K2'), null::jsonb,
  'a removed dish''s photo is not served');
select pg_temp.impersonate(:'FA_KAL');
select throws_ok(format('select pg_temp.set_photo(%L, %L)', :'DISH', :'K1'),
  'P0002', null, 'and a removed dish''s photo cannot be set');

-- Only the service role may call the Worker's reads.
select pg_temp.as_postgres();
select ok(not has_function_privilege('anon', 'public.public_menu_v2(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.public_menu_v2(text)', 'execute')
      and not has_function_privilege('anon', 'public.public_menu_photo(text, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.public_menu_photo(text, text)', 'execute'),
  'anon and authenticated cannot call the Worker''s reads');

select * from finish();
rollback;
