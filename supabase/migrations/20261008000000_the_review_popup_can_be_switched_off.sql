-- the-review-popup-can-be-switched-off
--
-- The menu's review ask has two parts: a popup when the menu opens, which docks
-- into a banner at the bottom, and that banner. An outlet may now keep the
-- banner and drop the popup — the quieter version [owner, 2026-10-07].
--
--   1. one more column, on by default, so every outlet keeps what it has;
--   2. the narrow write takes it, in place of the four-argument one;
--   3. public_menu's `review` says whether to open with the popup.

-- ---------------------------------------------------------------------------
-- 1. Whether the menu opens with the popup, or shows only the banner.
alter table public.outlets
  add column review_ask_popup boolean not null default true;

comment on column public.outlets.review_ask_popup is
  'While the review ask is on: open the public menu with the popup (true) or show only the bottom banner (false).';

-- ---------------------------------------------------------------------------
-- 2. The same write, with the popup switch. The old signature is dropped so no
-- caller can leave the switch behind by accident.
drop function public.set_outlet_review_ask(uuid, boolean, text, integer);

create function public.set_outlet_review_ask(
  p_outlet uuid,
  p_enabled boolean,
  p_url text,
  p_percent integer,
  p_popup boolean
)
returns public.outlets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet public.outlets;
  v_url text := nullif(btrim(p_url), '');
begin
  if auth.uid() is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet)) then
    raise exception 'only the owner or this outlet''s manager may change its review ask'
      using errcode = 'insufficient_privilege';
  end if;

  update public.outlets
     set review_ask_enabled = p_enabled,
         review_ask_url = v_url,
         review_ask_percent = p_percent,
         review_ask_popup = coalesce(p_popup, true)
   where id = p_outlet
  returning * into v_outlet;

  if not found then
    raise exception 'no such outlet' using errcode = 'no_data_found';
  end if;
  return v_outlet;
end;
$$;

revoke all on function public.set_outlet_review_ask(uuid, boolean, text, integer, boolean) from public, anon;
grant execute on function public.set_outlet_review_ask(uuid, boolean, text, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. `review` carries `popup`. The brand site's Worker must accept it before
-- this reaches production: it refuses any field it does not know.
create or replace function public.public_menu(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with outlet as (
    select o.id,o.name,o.menu_slug,o.review_ask_enabled,o.review_ask_url,o.review_ask_percent,o.review_ask_popup
    from public.outlets o
    where o.menu_slug=lower(btrim(p_slug)) and o.is_active
  ), sections as (
    select c.id,c.name,c.sort_order,1 as section_kind,
      jsonb_agg(jsonb_build_object('name',i.name,'description',i.description,'price_paise',i.price_paise,
        'is_veg',i.is_veg,'is_available',i.is_available) order by i.sort_order,i.name,i.id) as items
    from outlet join public.menu_categories c on c.outlet_id=outlet.id and c.is_active
    join public.menu_items i on i.category_id=c.id and i.is_active group by c.id,c.name,c.sort_order
    union all
    select h.outlet_id,h.title,0,0,
      jsonb_agg(jsonb_build_object('name',i.name,'description',i.description,'price_paise',i.price_paise,
        'is_veg',i.is_veg,'is_available',i.is_available) order by chosen.sort_order)
    from outlet join public.menu_highlight_sections h on h.outlet_id=outlet.id
    join public.menu_highlight_items chosen on chosen.outlet_id=h.outlet_id
    join public.menu_items i on (i.outlet_id,i.id)=(chosen.outlet_id,chosen.item_id) and i.is_active
    join public.menu_categories c on c.id=i.category_id and c.is_active
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
revoke all on function public.public_menu(text) from public,anon,authenticated;
grant execute on function public.public_menu(text) to service_role;
