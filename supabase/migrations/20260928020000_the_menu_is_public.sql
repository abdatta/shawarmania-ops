-- the-menu-is-public: every trading outlet's menu, readable by a customer.
--
-- The brand site serves `shawarmania.in/menu/<slug>/` from a Cloudflare Worker
-- that calls `public_menu` below with the service role -- the same shape as the
-- public receipt, for the same reason: the anonymous role is granted nothing in
-- this schema, and a browser never holds a key (design D3).
--
-- Two things arrive:
--
--   1. `outlets.menu_slug`, the outlet's public address. Derived from the name
--      when an outlet is created, stored rather than recomputed, unique, and
--      URL-safe. Stored because a printed QR code on a table points at it: a
--      renamed outlet must not silently break every code already printed
--      (design D1). It is not `code`, which is internal shorthand an owner
--      edits freely and staff codes are derived from (design D2).
--
--   2. `public_menu(slug)`, which answers with the menu a customer may see and
--      nothing else: section names, and per item its name, description, price,
--      veg flag and whether it is available. No ids, no outlet fields beyond
--      the name, nothing a manager did not intend to publish.

-- ---------------------------------------------------------------------------
-- 1. The slug.

-- `Kalyani Cafe` -> `kalyani-cafe`. Anything that is not a lowercase letter or a
-- digit separates words; separators collapse and never lead or trail. Returns
-- '' for a name with no letters or digits at all, which the caller replaces.
create function public.menu_slug_from(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-');
$$;

comment on function public.menu_slug_from(text) is
  'The URL-safe form of an outlet name: lowercase letters and digits, words joined by single hyphens.';

-- A free slug for an outlet: its name's slug, else its code's, else "outlet";
-- `-2`, `-3` ... appended until no other outlet holds it.
create function public.free_menu_slug(p_name text, p_code text, p_outlet uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_base text := coalesce(
    nullif(public.menu_slug_from(p_name), ''),
    nullif(public.menu_slug_from(p_code), ''),
    'outlet');
  v_candidate text := left(v_base, 60);
  v_n integer := 1;
begin
  while exists (
    select 1 from public.outlets o
     where o.menu_slug = v_candidate and o.id is distinct from p_outlet
  ) loop
    v_n := v_n + 1;
    v_candidate := left(v_base, 60 - length(v_n::text) - 1) || '-' || v_n;
  end loop;
  return v_candidate;
end;
$$;

alter table public.outlets add column menu_slug text;

update public.outlets o
   set menu_slug = public.free_menu_slug(o.name, o.code, o.id)
 where o.menu_slug is null;

-- '' as the default, not null, so the generated Insert type leaves the column
-- optional and an outlet is created exactly as before; the trigger below
-- replaces the blank before the check constraint ever sees it.
alter table public.outlets
  alter column menu_slug set default '',
  alter column menu_slug set not null,
  add constraint outlets_menu_slug_key unique (menu_slug),
  add constraint outlets_menu_slug_shape
    check (menu_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(menu_slug) <= 60);

comment on column public.outlets.menu_slug is
  'The outlet''s public menu address, shawarmania.in/menu/<menu_slug>/. Derived from the name at creation and kept thereafter, because printed table QR codes point at it.';

-- A blank slug on insert is derived; a blank slug on update keeps the old one,
-- so clearing the field never un-publishes a menu by accident.
--
-- Security definer, as `menu_item_category_same_outlet` is: finding a free slug
-- has to see every outlet's slug, not only the ones the writer's policies show,
-- or two outlets could be offered the same one and the second insert would fail
-- on the unique key instead of getting `-2`.
create function public.outlets_menu_slug_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if btrim(coalesce(new.menu_slug, '')) = '' then
    if tg_op = 'UPDATE' then
      new.menu_slug := old.menu_slug;
    else
      new.menu_slug := public.free_menu_slug(new.name, new.code, new.id);
    end if;
  else
    new.menu_slug := lower(btrim(new.menu_slug));
  end if;
  return new;
end;
$$;

create trigger outlets_menu_slug_default
  before insert or update of menu_slug on public.outlets
  for each row execute function public.outlets_menu_slug_default();

-- ---------------------------------------------------------------------------
-- 2. The public reader.
--
-- Null for a slug no trading outlet holds, and for an outlet with nothing on
-- its menu yet: the Worker renders one "not found" page for all three, so a
-- caller learns nothing about which outlets exist but are closed.
create function public.public_menu(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with outlet as (
    select o.id, o.name, o.menu_slug
      from public.outlets o
     where o.menu_slug = lower(btrim(p_slug))
       and o.is_active
  ),
  sections as (
    select c.id, c.name, c.sort_order,
           jsonb_agg(
             jsonb_build_object(
               'name', i.name,
               'description', i.description,
               'price_paise', i.price_paise,
               'is_veg', i.is_veg,
               'is_available', i.is_available
             ) order by i.sort_order, i.name, i.id
           ) as items
      from outlet
      join public.menu_categories c on c.outlet_id = outlet.id and c.is_active
      join public.menu_items i on i.category_id = c.id and i.is_active
     group by c.id, c.name, c.sort_order
  )
  select jsonb_build_object(
           'outlet', jsonb_build_object('name', outlet.name, 'slug', outlet.menu_slug),
           'sections', (
             select jsonb_agg(
                      jsonb_build_object('name', s.name, 'items', s.items)
                      order by s.sort_order, s.name, s.id)
               from sections s
           )
         )
    from outlet
   where exists (select 1 from sections);
$$;

comment on function public.public_menu(text) is
  'The menu a customer may see for one trading outlet, by its menu_slug: section names and, per item, name, description, price_paise, is_veg, is_available. Null when no trading outlet with a menu holds the slug. Service role only.';

-- The service role, and nobody else -- exactly as `bill_public_receipt`. Not
-- `anon`: the public reader is a Worker holding a server-side credential, not
-- a browser holding a key. Not `authenticated`: staff read the menu through
-- their own policies, and a security definer function that ignores those has no
-- business being reachable from a session.
revoke all on function public.public_menu(text) from public, anon, authenticated;
grant execute on function public.public_menu(text) to service_role;

-- The helpers are harmless but nobody's API.
revoke all on function public.menu_slug_from(text) from public, anon, authenticated;
revoke all on function public.free_menu_slug(text, text, uuid) from public, anon, authenticated;
revoke all on function public.outlets_menu_slug_default() from public, anon, authenticated;
