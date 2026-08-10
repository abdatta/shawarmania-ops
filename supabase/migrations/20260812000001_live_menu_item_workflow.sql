-- Billing V1 starts with a menu a manager can build from an empty database.
-- The unit of work is an item: a new category and its first item commit in the
-- same transaction, so a failed item can never leave an empty heading behind.

alter table public.menu_items
  add column is_active boolean not null default true;

create unique index menu_categories_active_name_key
  on public.menu_categories (outlet_id, lower(btrim(name)))
  where is_active;

create or replace function public.create_menu_item_with_category(
  p_outlet_id uuid,
  p_category_name text,
  p_item_name text,
  p_price_paise bigint,
  p_is_veg boolean default false,
  p_description text default null,
  p_sort_order integer default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_category public.menu_categories%rowtype;
  v_item public.menu_items%rowtype;
  v_category_name text := btrim(p_category_name);
  v_item_name text := btrim(p_item_name);
begin
  if length(v_category_name) = 0 or length(v_item_name) = 0 then
    raise exception 'menu category and item names cannot be blank'
      using errcode = 'check_violation';
  end if;
  if p_price_paise is null or p_price_paise < 0 then
    raise exception 'menu price must be non-negative integer paise'
      using errcode = 'check_violation';
  end if;

  select * into v_category
    from public.menu_categories c
   where c.outlet_id = p_outlet_id
     and c.is_active
     and lower(btrim(c.name)) = lower(v_category_name)
   for update;

  if not found then
    insert into public.menu_categories (outlet_id, name, sort_order)
    select p_outlet_id, v_category_name,
           coalesce(max(c.sort_order), 0) + 1
      from public.menu_categories c
     where c.outlet_id = p_outlet_id
    returning * into v_category;
  end if;

  insert into public.menu_items (
    outlet_id, category_id, name, description, price_paise, is_veg, sort_order
  )
  select p_outlet_id, v_category.id, v_item_name,
         nullif(btrim(p_description), ''), p_price_paise, coalesce(p_is_veg, false),
         coalesce(p_sort_order, coalesce(max(i.sort_order), 0) + 1)
    from public.menu_items i
   where i.category_id = v_category.id
  returning * into v_item;

  return jsonb_build_object('category', to_jsonb(v_category), 'item', to_jsonb(v_item));
exception
  when unique_violation then
    -- A concurrent first item may have created the category after our lookup.
    -- Retry through the same function; RLS still evaluates both writes.
    return public.create_menu_item_with_category(
      p_outlet_id, v_category_name, v_item_name, p_price_paise,
      p_is_veg, p_description, p_sort_order
    );
end;
$$;

create or replace function public.update_menu_item_with_category(
  p_item_id uuid,
  p_category_name text,
  p_item_name text,
  p_price_paise bigint,
  p_is_veg boolean,
  p_description text default null
)
returns public.menu_items
language plpgsql
set search_path = ''
as $$
declare
  v_item public.menu_items%rowtype;
  v_category public.menu_categories%rowtype;
  v_old_category uuid;
  v_category_name text := btrim(p_category_name);
begin
  select category_id into v_old_category
    from public.menu_items where id = p_item_id and is_active for update;
  if not found then
    raise exception 'menu item does not exist or is retired' using errcode = 'no_data_found';
  end if;

  select * into v_category from public.menu_categories c
   where c.outlet_id = (select outlet_id from public.menu_items where id = p_item_id)
     and c.is_active and lower(btrim(c.name)) = lower(v_category_name)
   for update;
  if not found then
    insert into public.menu_categories (outlet_id, name, sort_order)
    select i.outlet_id, v_category_name,
           coalesce((select max(c.sort_order) from public.menu_categories c
                     where c.outlet_id = i.outlet_id), 0) + 1
      from public.menu_items i where i.id = p_item_id
    returning * into v_category;
  end if;

  update public.menu_items
     set category_id = v_category.id,
         name = btrim(p_item_name),
         price_paise = p_price_paise,
         is_veg = p_is_veg,
         description = nullif(btrim(p_description), '')
   where id = p_item_id
  returning * into v_item;

  if v_old_category <> v_category.id and not exists (
    select 1 from public.menu_items where category_id = v_old_category and is_active
  ) then
    update public.menu_categories set is_active = false where id = v_old_category;
  end if;
  return v_item;
end;
$$;

create or replace function public.retire_menu_item(p_item_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_category_id uuid;
begin
  update public.menu_items
     set is_active = false, is_available = false
   where id = p_item_id
     and is_active
  returning category_id into v_category_id;

  if v_category_id is null then
    raise exception 'menu item does not exist or is already retired'
      using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.menu_items
     where category_id = v_category_id and is_active
  ) then
    update public.menu_categories set is_active = false where id = v_category_id;
  end if;
end;
$$;

revoke execute on function public.create_menu_item_with_category(
  uuid,text,text,bigint,boolean,text,integer
) from public, anon;
revoke execute on function public.retire_menu_item(uuid) from public, anon;
revoke execute on function public.update_menu_item_with_category(
  uuid,text,text,bigint,boolean,text
) from public, anon;
grant execute on function public.create_menu_item_with_category(
  uuid,text,text,bigint,boolean,text,integer
) to authenticated;
grant execute on function public.retire_menu_item(uuid) to authenticated;
grant execute on function public.update_menu_item_with_category(
  uuid,text,text,bigint,boolean,text
) to authenticated;

comment on function public.create_menu_item_with_category(
  uuid,text,text,bigint,boolean,text,integer
) is 'Creates one active menu item and resolves or atomically creates its active category under caller RLS.';
