-- a-dish-can-show-its-photo (#84): a dish's photo, kept apart from the menu the
-- counter reads (design D1, D2, D3, D6, D7).
-- change-gate: dish-photos
--
-- Everything here is new: a private bucket and its four policies on
-- storage.objects (for that bucket only, so the statements bucket is untouched),
-- a table no published build selects, two write functions that refuse while
-- `dish-photos` is off, and two service-only reads for the brand-site Worker.
-- `public_menu` is not touched; `public_menu_v2` is its body plus `photo`.

-- ---------------------------------------------------------------------------
-- 1. The bucket (D1): private, 4 MB, WebP and JPEG only.

-- release-lint: allow data — a new bucket's own row; no published build reads storage.buckets or names this bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-photos', 'menu-photos', false, 4194304, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

-- The outlet a photo file belongs to: its first path segment as a uuid, or null
-- when the name is not shaped like `<outlet_id>/<file>`, which nobody may reach.
create function public.menu_photo_outlet(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when (storage.foldername(object_name))[1] ~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and array_length(storage.foldername(object_name), 1) = 1
    then ((storage.foldername(object_name))[1])::uuid
    else null
  end;
$$;

-- May the caller read, write or delete this photo file? The owner anywhere, a
-- manager at an outlet they manage: the same people who may edit that menu.
create function public.may_reach_menu_photo(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when public.menu_photo_outlet(object_name) is null then false
    when not public.app_account_active() or not public.app_device_ok() then false
    when public.app_is_owner() then true
    else public.app_has_role_at('franchise_admin', public.menu_photo_outlet(object_name))
  end;
$$;

revoke execute on function public.may_reach_menu_photo(text) from public, anon;
grant execute on function public.may_reach_menu_photo(text) to authenticated;

-- Each policy names this bucket only, and holds only while dish-photos is on:
-- with the gate off no client reaches the bucket at all, and the files wait
-- untouched for it to return. The Worker reads with the service role, which
-- policies do not bind, behind public_menu_photo's own gate check.
create policy menu_photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'menu-photos' and public.app_change_gate('dish-photos')
         and public.may_reach_menu_photo(name));

create policy menu_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-photos' and public.app_change_gate('dish-photos')
              and public.may_reach_menu_photo(name));

-- An upsert of a file already there is an update.
create policy menu_photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-photos' and public.app_change_gate('dish-photos')
         and public.may_reach_menu_photo(name))
  with check (bucket_id = 'menu-photos' and public.app_change_gate('dish-photos')
              and public.may_reach_menu_photo(name));

create policy menu_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-photos' and public.app_change_gate('dish-photos')
         and public.may_reach_menu_photo(name));

-- ---------------------------------------------------------------------------
-- 2. The photo row (D2).

-- A framing: four fractions of the kept original, inside it.
create function public.menu_photo_crop_ok(crop jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(crop) = 'object'
     and (select count(*) from jsonb_object_keys(crop)) = 4
     and jsonb_typeof(crop -> 'x') = 'number' and jsonb_typeof(crop -> 'y') = 'number'
     and jsonb_typeof(crop -> 'w') = 'number' and jsonb_typeof(crop -> 'h') = 'number'
     and (crop ->> 'x')::numeric >= 0 and (crop ->> 'y')::numeric >= 0
     and (crop ->> 'w')::numeric > 0 and (crop ->> 'h')::numeric > 0
     and (crop ->> 'x')::numeric + (crop ->> 'w')::numeric <= 1.000001
     and (crop ->> 'y')::numeric + (crop ->> 'h')::numeric <= 1.000001;
$$;

create table public.menu_item_photos (
  item_id uuid primary key,
  outlet_id uuid not null references public.outlets(id),
  photo_key text not null check (photo_key ~ '^[0-9a-f]{64}$'),
  photo_format text not null check (photo_format in ('webp', 'jpeg')),
  aspect text not null check (aspect in ('4:3', '1:1', '4:5')),
  source_key text not null check (source_key ~ '^[0-9a-f]{64}$'),
  source_format text not null check (source_format in ('webp', 'jpeg')),
  large_crop jsonb not null check (public.menu_photo_crop_ok(large_crop)),
  thumb_crop jsonb not null check (public.menu_photo_crop_ok(thumb_crop)),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  -- The dish's own outlet and no other: the same composite key the highlights
  -- use (menu_items_outlet_identity), so even a privileged write cannot name
  -- another outlet. Stronger than the trigger design D2 sketched.
  foreign key (outlet_id, item_id) references public.menu_items(outlet_id, id)
);

alter table public.menu_item_photos enable row level security;

-- Read by whoever may read the dish: the subquery runs under menu_items' own
-- policy, so the two can never disagree.
create policy menu_item_photos_select on public.menu_item_photos
  for select to authenticated
  using (exists (select 1 from public.menu_items i where i.id = menu_item_photos.item_id));

-- Written only through the two functions below.
revoke all on public.menu_item_photos from public, anon, authenticated;
grant select on public.menu_item_photos to authenticated;
grant all on public.menu_item_photos to service_role;

comment on table public.menu_item_photos is
  'A dish''s photo (a-dish-can-show-its-photo, #84): the large photo and thumbnail key, the kept original''s key, and the framings for Adjust. Apart from menu_items so a photo never changes the counter''s menu. Written only by set_menu_item_photo and clear_menu_item_photo, which refuse while dish-photos is off.';

-- ---------------------------------------------------------------------------
-- 3. Setting and clearing a photo (D6).

-- The dish, locked, if the caller may change its menu photo; refuses otherwise.
create function public.menu_photo_item_for_change(p_item_id uuid)
returns public.menu_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.menu_items;
begin
  if not public.app_change_gate('dish-photos') then
    raise exception 'dish-photos is off' using errcode = 'P0001';
  end if;
  if auth.uid() is null or not public.app_account_active() or not public.app_device_ok() then
    raise exception 'only the owner or this outlet''s manager may change a dish''s photo'
      using errcode = '42501';
  end if;
  select * into v_item from public.menu_items i where i.id = p_item_id for update;
  if not found
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', v_item.outlet_id)) then
    raise exception 'only the owner or this outlet''s manager may change a dish''s photo'
      using errcode = '42501';
  end if;
  if not v_item.is_active then
    raise exception 'that dish has been removed' using errcode = 'P0002';
  end if;
  return v_item;
end;
$$;

revoke execute on function public.menu_photo_item_for_change(uuid) from public, anon, authenticated;

-- What a photo row was, for the client to delete the files it no longer needs.
create function public.menu_photo_previous(p_row public.menu_item_photos)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_row.item_id is null then null else jsonb_build_object(
    'key', p_row.photo_key, 'format', p_row.photo_format,
    'sourceKey', p_row.source_key, 'sourceFormat', p_row.source_format) end;
$$;

revoke execute on function public.menu_photo_previous(public.menu_item_photos) from public, anon, authenticated;

create function public.set_menu_item_photo(
  p_item_id uuid,
  p_key text,
  p_format text,
  p_aspect text,
  p_source_key text,
  p_source_format text,
  p_large_crop jsonb,
  p_thumb_crop jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.menu_items := public.menu_photo_item_for_change(p_item_id);
  v_previous public.menu_item_photos;
  v_folder text := v_item.outlet_id::text || '/';
begin
  if p_format not in ('webp', 'jpeg') or p_source_format not in ('webp', 'jpeg') then
    raise exception 'a photo is WebP or JPEG' using errcode = '22023';
  end if;
  -- All three files must already be under this dish's outlet (D6): a key with
  -- nothing behind it, or with files under another outlet, is refused. A file's
  -- extension is its format word: `.webp` or `.jpeg`.
  if (select count(*) from storage.objects o
       where o.bucket_id = 'menu-photos'
         and o.name in (v_folder || p_key || '.' || p_format,
                        v_folder || p_key || '-sm.' || p_format,
                        v_folder || p_source_key || '-src.' || p_source_format)) <> 3 then
    raise exception 'the photo''s files are not all uploaded' using errcode = '22023';
  end if;

  select * into v_previous from public.menu_item_photos p where p.item_id = p_item_id for update;

  insert into public.menu_item_photos
    (item_id, outlet_id, photo_key, photo_format, aspect, source_key, source_format,
     large_crop, thumb_crop, updated_at, updated_by)
  values
    (p_item_id, v_item.outlet_id, p_key, p_format, p_aspect, p_source_key, p_source_format,
     p_large_crop, p_thumb_crop, now(), auth.uid())
  on conflict (item_id) do update set
    photo_key = excluded.photo_key, photo_format = excluded.photo_format,
    aspect = excluded.aspect, source_key = excluded.source_key,
    source_format = excluded.source_format, large_crop = excluded.large_crop,
    thumb_crop = excluded.thumb_crop, updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  return public.menu_photo_previous(v_previous);
end;
$$;

create function public.clear_menu_item_photo(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.menu_items := public.menu_photo_item_for_change(p_item_id);
  v_previous public.menu_item_photos;
begin
  delete from public.menu_item_photos p where p.item_id = v_item.id returning * into v_previous;
  return public.menu_photo_previous(v_previous);
end;
$$;

revoke execute on function
  public.set_menu_item_photo(uuid, text, text, text, text, text, jsonb, jsonb),
  public.clear_menu_item_photo(uuid)
  from public, anon;
grant execute on function
  public.set_menu_item_photo(uuid, text, text, text, text, text, jsonb, jsonb),
  public.clear_menu_item_photo(uuid)
  to authenticated;

comment on function public.set_menu_item_photo(uuid, text, text, text, text, text, jsonb, jsonb) is
  'Sets a dish''s photo once its three files are uploaded under its outlet (a-dish-can-show-its-photo, D6). Owner or that outlet''s manager; refuses while dish-photos is off and for a removed dish. Returns the previous keys, or null, so the client deletes the files it replaced.';
comment on function public.clear_menu_item_photo(uuid) is
  'Takes a dish''s photo off (a-dish-can-show-its-photo, D6). Same refusals as set_menu_item_photo. Returns the previous keys, or null.';

-- ---------------------------------------------------------------------------
-- 4. The public reads for the brand-site Worker (D7), service role only.

-- public_menu's body as of the-review-popup-can-be-switched-off, unchanged but
-- for one item field: `photo`, {key, format, aspect} while dish-photos is on and
-- the dish has one, null otherwise. The original's key and the framings are
-- never sent.
create function public.public_menu_v2(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with outlet as (
    select o.id,o.name,o.menu_slug,o.review_ask_enabled,o.review_ask_url,o.review_ask_percent,o.review_ask_popup
    from public.outlets o
    where o.menu_slug=lower(btrim(p_slug)) and o.is_active
  ), photos_on as (
    select public.app_change_gate('dish-photos') as gate_on
  ), sections as (
    select c.id,c.name,c.sort_order,1 as section_kind,
      jsonb_agg(jsonb_build_object('name',i.name,'description',i.description,'price_paise',i.price_paise,
        'is_veg',i.is_veg,'is_available',i.is_available,
        'photo',case when (select gate_on from photos_on) and p.item_id is not null
          then jsonb_build_object('key',p.photo_key,'format',p.photo_format,'aspect',p.aspect) end)
        order by i.sort_order,i.name,i.id) as items
    from outlet join public.menu_categories c on c.outlet_id=outlet.id and c.is_active
    join public.menu_items i on i.category_id=c.id and i.is_active
    left join public.menu_item_photos p on p.item_id=i.id
    group by c.id,c.name,c.sort_order
    union all
    select h.outlet_id,h.title,0,0,
      jsonb_agg(jsonb_build_object('name',i.name,'description',i.description,'price_paise',i.price_paise,
        'is_veg',i.is_veg,'is_available',i.is_available,
        'photo',case when (select gate_on from photos_on) and p.item_id is not null
          then jsonb_build_object('key',p.photo_key,'format',p.photo_format,'aspect',p.aspect) end)
        order by chosen.sort_order)
    from outlet join public.menu_highlight_sections h on h.outlet_id=outlet.id
    join public.menu_highlight_items chosen on chosen.outlet_id=h.outlet_id
    join public.menu_items i on (i.outlet_id,i.id)=(chosen.outlet_id,chosen.item_id) and i.is_active
    join public.menu_categories c on c.id=i.category_id and c.is_active
    left join public.menu_item_photos p on p.item_id=i.id
    group by h.outlet_id,h.title
  )
  select jsonb_build_object('outlet',jsonb_build_object('name',outlet.name,'slug',outlet.menu_slug),
    'sections',(select jsonb_agg(jsonb_build_object('name',s.name,'items',s.items)
      order by s.section_kind,s.sort_order,s.name,s.id) from sections s),
    'review',case when outlet.review_ask_enabled and outlet.review_ask_url is not null
      then jsonb_build_object('url',outlet.review_ask_url,'percent',outlet.review_ask_percent,
        'popup',outlet.review_ask_popup) end)
  from outlet where exists(select 1 from sections);
$$;
revoke all on function public.public_menu_v2(text) from public, anon, authenticated;
grant execute on function public.public_menu_v2(text) to service_role;

-- The file a photo address names, only while it is that outlet's current photo
-- of an active dish in an active category, and dish-photos is on. A replaced
-- key, another outlet's key and a kept original's key are all null, so the
-- Worker answers 404 without reaching storage.
create function public.public_menu_photo(p_slug text, p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('object', o.id::text || '/' || p.photo_key, 'format', p.photo_format)
    from public.outlets o
    join public.menu_item_photos p on p.outlet_id = o.id
    join public.menu_items i on i.id = p.item_id and i.is_active
    join public.menu_categories c on c.id = i.category_id and c.is_active
   where o.menu_slug = lower(btrim(p_slug)) and o.is_active
     and p.photo_key = p_key
     and public.app_change_gate('dish-photos')
   limit 1;
$$;
revoke all on function public.public_menu_photo(text, text) from public, anon, authenticated;
grant execute on function public.public_menu_photo(text, text) to service_role;

comment on function public.public_menu_v2(text) is
  'public_menu plus each dish''s photo {key, format, aspect} while dish-photos is on, null otherwise (a-dish-can-show-its-photo, D7). Service role only, for the brand-site Worker.';
comment on function public.public_menu_photo(text, text) is
  'The stored file behind a public photo address, only for the outlet''s current photo of an active dish while dish-photos is on; null otherwise (a-dish-can-show-its-photo, D7). Service role only.';
