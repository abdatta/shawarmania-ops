-- Inventory: the movements ledger is the truth; current_quantity is a
-- trigger-maintained cache. This is what makes stock auditable — "why does
-- the system think we have 4 kg?" is always answerable by reading the ledger.

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  name text not null,
  unit public.inventory_unit not null,
  -- Quantities are numeric, not integer paise — 1.5 kg is a real quantity.
  -- Money on these rows still follows the paise rule.
  current_quantity numeric not null default 0,
  purchase_cost_paise bigint not null default 0 check (purchase_cost_paise >= 0),
  low_stock_threshold numeric not null default 0 check (low_stock_threshold >= 0),
  is_active boolean not null default true,
  last_updated_at timestamptz not null default now()
);

create index inventory_items_outlet_id_idx on public.inventory_items (outlet_id);

alter table public.inventory_items enable row level security;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  inventory_item_id uuid not null references public.inventory_items (id),
  movement_type public.movement_type not null,
  quantity_delta numeric not null check (quantity_delta <> 0),
  unit_cost_paise bigint check (unit_cost_paise >= 0),
  note text,
  recorded_by uuid not null references public.profiles (id),
  business_date date not null,
  created_at timestamptz not null default now(),
  -- The sign follows the meaning: stock arrives positive, leaves negative.
  -- A correction may go either way but must say why.
  constraint inventory_movements_sign check (
    (movement_type = 'added' and quantity_delta > 0)
    or (movement_type in ('used', 'wasted') and quantity_delta < 0)
    or (movement_type = 'correction')
  ),
  constraint inventory_movements_added_has_cost
    check (movement_type <> 'added' or unit_cost_paise is not null),
  constraint inventory_movements_correction_has_note
    check (movement_type <> 'correction' or note is not null)
);

create index inventory_movements_item_idx on public.inventory_movements (inventory_item_id);
create index inventory_movements_outlet_business_date_idx
  on public.inventory_movements (outlet_id, business_date);

alter table public.inventory_movements enable row level security;

-- ---------------------------------------------------------------------------
-- Ledger enforcement.

-- Apply each movement to the cache. security definer: clients hold no update
-- grant on current_quantity, and must not — the trigger is the only writer.
create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
begin
  select outlet_id into v_outlet
    from public.inventory_items
   where id = new.inventory_item_id;

  if v_outlet is null then
    raise exception 'unknown inventory item %', new.inventory_item_id;
  end if;

  if v_outlet <> new.outlet_id then
    raise exception 'movement outlet does not match the item''s outlet';
  end if;

  update public.inventory_items
     set current_quantity = current_quantity + new.quantity_delta,
         last_updated_at = now()
   where id = new.inventory_item_id;

  return new;
end;
$$;

create trigger inventory_movements_apply
  after insert on public.inventory_movements
  for each row execute function public.apply_inventory_movement();

create trigger inventory_movements_immutable
  before update or delete on public.inventory_movements
  for each row execute function public.reject_mutation();

-- Clients may edit an item's descriptive fields, never its cache or its
-- outlet. Column-scoped grants enforce this below RLS: even a policy mistake
-- cannot open current_quantity to a client write.
revoke update on public.inventory_items from authenticated, anon;
grant update (name, unit, purchase_cost_paise, low_stock_threshold, is_active)
  on public.inventory_items to authenticated;

-- ---------------------------------------------------------------------------
-- Policies. Inventory is a manager surface: Franchise Admin writes own
-- outlet, Super Admin reads everywhere. The counter has no inventory access.

create policy inventory_items_select on public.inventory_items
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

create policy inventory_items_insert on public.inventory_items
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_role() = 'franchise_admin'
    and outlet_id = public.app_outlet_id()
    -- Opening stock arrives as an 'added' movement, so the ledger stays the
    -- complete story from quantity zero.
    and current_quantity = 0
  );

create policy inventory_items_update on public.inventory_items
  for update to authenticated
  using (
    public.app_account_active()
    and public.app_role() = 'franchise_admin'
    and outlet_id = public.app_outlet_id()
  )
  with check (
    public.app_account_active()
    and public.app_role() = 'franchise_admin'
    and outlet_id = public.app_outlet_id()
  );

create policy inventory_movements_select on public.inventory_movements
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_role() = 'franchise_admin'
    and outlet_id = public.app_outlet_id()
    and recorded_by = auth.uid()
  );
