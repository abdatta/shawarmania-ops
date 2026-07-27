-- Menu and customers. Menu is per-outlet from day one: two outlets may share
-- item names and differ on price, and a franchise wants its own availability.

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create index menu_categories_outlet_id_idx on public.menu_categories (outlet_id);

alter table public.menu_categories enable row level security;

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  category_id uuid not null references public.menu_categories (id),
  name text not null,
  description text,
  price_paise bigint not null check (price_paise >= 0),
  is_veg boolean not null default false,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index menu_items_outlet_id_idx on public.menu_items (outlet_id);
create index menu_items_category_id_idx on public.menu_items (category_id);

alter table public.menu_items enable row level security;

create trigger menu_items_set_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

-- An item's category must belong to the item's own outlet. Cross-table, so a
-- trigger rather than a check constraint; security definer because the writer
-- may not be able to read the category row it references.
create or replace function public.menu_item_category_same_outlet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
begin
  select outlet_id into v_outlet
    from public.menu_categories
   where id = new.category_id;

  if v_outlet is null or v_outlet <> new.outlet_id then
    raise exception 'menu item category must belong to the same outlet';
  end if;

  return new;
end;
$$;

create trigger menu_items_category_same_outlet
  before insert or update on public.menu_items
  for each row execute function public.menu_item_category_same_outlet();

-- ---------------------------------------------------------------------------
-- customers — scoped per outlet by design; the same person at both outlets is
-- two records (see docs/LIMITATIONS.md). The aggregate columns are maintained
-- by the billing-live change; until then there is no client write path.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  name text,
  phone text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  bill_count integer not null default 0 check (bill_count >= 0),
  total_spend_paise bigint not null default 0 check (total_spend_paise >= 0)
);

create index customers_outlet_id_idx on public.customers (outlet_id);
create unique index customers_outlet_phone_key
  on public.customers (outlet_id, phone) where phone is not null;

alter table public.customers enable row level security;

-- ---------------------------------------------------------------------------
-- Policies.

-- Menu reads: Super Admin everywhere; Franchise Admin and the counter device
-- read their own outlet. Employees have no menu surface.
create policy menu_categories_select on public.menu_categories
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (
        public.app_role() in ('franchise_admin', 'biller')
        and outlet_id = public.app_outlet_id()
      )
    )
  );

create policy menu_items_select on public.menu_items
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (
        public.app_role() in ('franchise_admin', 'biller')
        and outlet_id = public.app_outlet_id()
      )
    )
  );

-- Menu writes: Super Admin anywhere, Franchise Admin own outlet. The biller's
-- sold-out toggle is a later change's concern; v1 keeps the tablet read-only.
create policy menu_categories_insert on public.menu_categories
  for insert to authenticated
  with check (
    public.app_account_active()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

create policy menu_categories_update on public.menu_categories
  for update to authenticated
  using (
    public.app_account_active()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  )
  with check (
    public.app_account_active()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

create policy menu_items_insert on public.menu_items
  for insert to authenticated
  with check (
    public.app_account_active()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

create policy menu_items_update on public.menu_items
  for update to authenticated
  using (
    public.app_account_active()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  )
  with check (
    public.app_account_active()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

-- Customers: reads for the roles that serve them; no writes until the
-- maintenance path lands with billing-live.
create policy customers_select on public.customers
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (
        public.app_role() in ('franchise_admin', 'biller')
        and outlet_id = public.app_outlet_id()
      )
    )
  );

revoke insert, update, delete on public.customers from authenticated, anon;
