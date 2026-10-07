-- Highlights reference existing dishes; they never become a counter category.
create table public.menu_highlight_sections (
  outlet_id uuid primary key references public.outlets(id) on delete cascade,
  title text not null default 'Highlights',
  constraint menu_highlight_title check (char_length(title) between 1 and 60 and title = btrim(title) and title !~ '^\s*$')
);

-- The composite FK enforces outlet identity even for privileged direct writes,
-- and prevents moving a referenced dish to another outlet after selection.
alter table public.menu_items add constraint menu_items_outlet_identity unique (outlet_id, id);
create table public.menu_highlight_items (
  outlet_id uuid not null references public.menu_highlight_sections(outlet_id) on delete cascade,
  item_id uuid not null,
  sort_order integer not null check (sort_order >= 1),
  primary key (outlet_id, item_id),
  unique (outlet_id, sort_order),
  foreign key (outlet_id, item_id) references public.menu_items(outlet_id, id)
);

alter table public.menu_highlight_sections enable row level security;
alter table public.menu_highlight_items enable row level security;
create policy menu_highlight_sections_select on public.menu_highlight_sections
  for select to authenticated using (
    public.app_account_active() and public.app_device_ok()
    and ((select public.app_is_owner()) or outlet_id in (select public.app_outlets_for('franchise_admin')))
  );
create policy menu_highlight_items_select on public.menu_highlight_items
  for select to authenticated using (
    public.app_account_active() and public.app_device_ok()
    and ((select public.app_is_owner()) or outlet_id in (select public.app_outlets_for('franchise_admin')))
  );
-- All configuration writes go through the atomic, authority-checking command.
revoke all on public.menu_highlight_sections, public.menu_highlight_items from public, anon, authenticated;
grant select on public.menu_highlight_sections, public.menu_highlight_items to authenticated;
grant all on public.menu_highlight_sections, public.menu_highlight_items to service_role;

create function public.read_menu_highlights(p_outlet_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null or not public.app_account_active() or not public.app_device_ok()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet_id)) then
    raise exception 'only the owner or this outlet''s manager may read highlights' using errcode='42501';
  end if;
  -- One statement/read snapshot keeps the title and selection consistent.
  return (
    select jsonb_build_object(
      'title', coalesce((select s.title from public.menu_highlight_sections s where s.outlet_id=p_outlet_id), 'Highlights'),
      'itemIds', coalesce((
        select jsonb_agg(h.item_id order by h.sort_order)
        from public.menu_highlight_items h
        join public.menu_items i on (i.outlet_id,i.id)=(h.outlet_id,h.item_id) and i.is_active
        join public.menu_categories c on c.id=i.category_id and c.is_active
        where h.outlet_id=p_outlet_id
      ), '[]'::jsonb)
    )
  );
end;
$$;

create function public.set_menu_highlights(p_outlet_id uuid, p_title text, p_item_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_title text := regexp_replace(p_title, '^\s+|\s+$', '', 'g');
begin
  if auth.uid() is null or not public.app_account_active() or not public.app_device_ok()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet_id)) then
    raise exception 'only the owner or this outlet''s manager may change highlights' using errcode='42501';
  end if;
  -- Serialize replacements even when no configuration row exists yet.
  perform 1 from public.outlets where id=p_outlet_id and is_active for update;
  if not found then raise exception 'no active outlet' using errcode='P0002'; end if;
  if v_title is null or char_length(v_title) not between 1 and 60 or p_item_ids is null
     or coalesce(array_ndims(p_item_ids),1) > 1
     or cardinality(p_item_ids) <> (select count(distinct id) from unnest(p_item_ids) as t(id)) then
    raise exception 'use a name up to sixty characters and choose each item once' using errcode='22023';
  end if;
  -- Lock selected dishes while validating; removal cannot slip between the
  -- eligibility read and write. Same-outlet FK holds throughout their lifetime.
  perform i.id from public.menu_items i
    where i.outlet_id=p_outlet_id and i.id=any(p_item_ids) order by i.id for update;
  if cardinality(p_item_ids) <> (
    select count(*) from public.menu_items i
    join public.menu_categories c on c.id=i.category_id and c.is_active
    where i.outlet_id=p_outlet_id and i.is_active and i.id=any(p_item_ids)
  ) then
    raise exception 'choose dishes from this outlet''s active menu' using errcode='22023';
  end if;
  insert into public.menu_highlight_sections(outlet_id,title) values(p_outlet_id,v_title)
    on conflict(outlet_id) do update set title=excluded.title;
  delete from public.menu_highlight_items where outlet_id=p_outlet_id;
  insert into public.menu_highlight_items(outlet_id,item_id,sort_order)
    select p_outlet_id,t.id,t.position::integer from unnest(p_item_ids) with ordinality as t(id,position);
  return jsonb_build_object('title',v_title,'itemIds',to_jsonb(p_item_ids));
end;
$$;

create function public.reorder_menu_items(p_category_id uuid, p_item_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_category public.menu_categories;
begin
  if auth.uid() is null or not public.app_account_active() or not public.app_device_ok() then
    raise exception 'only an authorised manager may reorder dishes' using errcode='42501';
  end if;
  select * into v_category from public.menu_categories c
    where c.id=p_category_id and c.is_active
      and (public.app_is_owner() or public.app_has_role_at('franchise_admin',c.outlet_id)) for update;
  if not found then raise exception 'only this outlet''s manager may reorder dishes' using errcode='42501'; end if;
  -- The parent lock serializes reorders and blocks FK checks for new/moved-in
  -- dishes. Item locks serialize removals and moves out before membership check.
  perform i.id from public.menu_items i where i.category_id=p_category_id order by i.id for update;
  if p_item_ids is null or coalesce(array_ndims(p_item_ids),1) > 1
     or cardinality(p_item_ids) <> (select count(distinct id) from unnest(p_item_ids) as t(id))
     or cardinality(p_item_ids) <> (select count(*) from public.menu_items where category_id=p_category_id and is_active)
     or exists (select 1 from unnest(p_item_ids) as t(id) where not exists (
       select 1 from public.menu_items i where i.id=t.id and i.category_id=p_category_id and i.is_active
     )) then
    raise exception 'the category changed; refresh the menu and try again' using errcode='22023';
  end if;
  update public.menu_items i set sort_order=t.position::integer
    from unnest(p_item_ids) with ordinality as t(id,position) where i.id=t.id;
end;
$$;

revoke all on function public.read_menu_highlights(uuid), public.set_menu_highlights(uuid,text,uuid[]), public.reorder_menu_items(uuid,uuid[]) from public, anon;
grant execute on function public.read_menu_highlights(uuid), public.set_menu_highlights(uuid,text,uuid[]), public.reorder_menu_items(uuid,uuid[]) to authenticated;

-- Generic sections preserve the Worker contract and exact item allowlist.
create or replace function public.public_menu(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with outlet as (
    select o.id,o.name,o.menu_slug from public.outlets o
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
      order by s.section_kind,s.sort_order,s.name,s.id) from sections s))
  from outlet where exists(select 1 from sections);
$$;
revoke all on function public.public_menu(text) from public,anon,authenticated;
grant execute on function public.public_menu(text) to service_role;

comment on table public.menu_highlight_sections is 'Outlet-local, editable public highlights heading (#68). Writes only through set_menu_highlights.';
comment on table public.menu_highlight_items is 'Ordered same-outlet references to dishes, retained across temporary unavailability and filtered on removal (#68).';
