-- the-menu-asks-for-a-review
--
-- The public table menu opens with a popup asking for a Google review, with a
-- review discount for sharing one. Each outlet decides whether it asks, where
-- its own Google listing takes a review, and how large the review discount is; the
-- owner for any outlet, a Franchise Admin for the outlets they manage — the same
-- reach as Orders and Loyalty on the outlet page.
--
--   1. three columns on the outlet, off by default;
--   2. one narrow write, as set_outlet_loyalty_settings is;
--   3. public_menu answers the ask beside the sections, or null while it is off.

-- ---------------------------------------------------------------------------
-- 1. The outlet's ask.
alter table public.outlets
  add column review_ask_enabled boolean not null default false,
  add column review_ask_url text,
  add column review_ask_percent integer not null default 5;

alter table public.outlets
  -- An https address and nothing a page could be tricked by: the Worker puts it
  -- in an href on a public page.
  add constraint outlets_review_ask_url_shape
    check (review_ask_url is null
           or (char_length(review_ask_url) <= 500 and review_ask_url ~ '^https://[^[:space:]"<>]+$')),
  add constraint outlets_review_ask_percent_range
    check (review_ask_percent between 1 and 50),
  -- Asking with nowhere to send the customer would be a button that goes nowhere.
  add constraint outlets_review_ask_needs_url
    check (not review_ask_enabled or review_ask_url is not null);

comment on column public.outlets.review_ask_enabled is
  'Whether the public table menu opens by asking for a Google review.';
comment on column public.outlets.review_ask_url is
  'Where this outlet''s Google listing takes a review, e.g. https://g.page/r/<id>/review.';
comment on column public.outlets.review_ask_percent is
  'The review discount the menu''s review popup names, in whole percent. Copy only: no bill applies it by itself.';

-- ---------------------------------------------------------------------------
-- 2. One narrow write: the owner, or a Franchise Admin of this outlet, on a live
-- account. These three columns and no others, so it is no way round
-- `outlets_update`.
create or replace function public.set_outlet_review_ask(
  p_outlet uuid,
  p_enabled boolean,
  p_url text,
  p_percent integer
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
         review_ask_percent = p_percent
   where id = p_outlet
  returning * into v_outlet;

  if not found then
    raise exception 'no such outlet' using errcode = 'no_data_found';
  end if;
  return v_outlet;
end;
$$;

revoke all on function public.set_outlet_review_ask(uuid, boolean, text, integer) from public, anon;
grant execute on function public.set_outlet_review_ask(uuid, boolean, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The public reader carries the ask: `review` is {url, percent} while the
-- outlet asks, and null while it does not. The sections are #68's, unchanged.
-- The brand site's Worker accepts `review`, `url` and `percent` and nothing
-- else new; it must be deployed before this migration reaches production.
create or replace function public.public_menu(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with outlet as (
    select o.id,o.name,o.menu_slug,o.review_ask_enabled,o.review_ask_url,o.review_ask_percent
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
      then jsonb_build_object('url',outlet.review_ask_url,'percent',outlet.review_ask_percent) end)
  from outlet where exists(select 1 from sections);
$$;
revoke all on function public.public_menu(text) from public,anon,authenticated;
grant execute on function public.public_menu(text) to service_role;

-- ---------------------------------------------------------------------------
-- Kalyani Cafe asks from day one [owner, 2026-10-07]: its listing is the 4.4★
-- "Shawarmania" cafe in Block B, Kalyani. No other outlet is touched, and an
-- environment without that address (local, CI) changes nothing.
update public.outlets
   set review_ask_enabled = true,
       review_ask_url = 'https://g.page/r/Cef3CrZy-ZyuEBE/review',
       review_ask_percent = 5
 where menu_slug = 'kalyani-cafe';
