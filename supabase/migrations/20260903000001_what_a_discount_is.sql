-- A discount is a line on the bill: the model half.
--
-- Two sources, two storage shapes, because they answer different questions.
--
-- A **menu discount** attaches to the line it reduces, as `discount_paise` plus
-- the percentage that produced it. That is what makes "which item was
-- discounted, and by how much" answerable off the bill itself, with the live
-- menu never consulted. Those columns landed with the arithmetic migration.
--
-- A **bill discount** belongs to no line and there may be several, so it gets a
-- child table, modelled directly on `bill_payments` — which solved the same
-- problem for split tender and is the shape this repo already trusts:
-- append-only, insertable only through a billing command, immutable afterwards,
-- and guarded by a deferred constraint trigger asserting the parts equal the
-- whole.
--
-- Neither carries a name. A discount does not need naming [owner, 2026-09-03].

-- ---------------------------------------------------------------------------
-- Bill-level discounts.
--
-- `basis` and the two value columns are paired by check, so a percentage row
-- cannot carry a rupee value or the reverse — the sort of row that reads fine
-- and reports wrong.

create type public.discount_basis as enum ('percent', 'amount');

create table public.order_discounts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  outlet_id uuid not null references public.outlets (id),
  basis public.discount_basis not null,
  value_bp integer check (value_bp > 0),
  value_paise bigint check (value_paise > 0),
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now(),
  constraint order_discounts_basis_matches_value check (
    (basis = 'percent' and value_bp is not null and value_paise is null)
    or (basis = 'amount' and value_paise is not null and value_bp is null))
);

create index order_discounts_order_idx on public.order_discounts (order_id);
create index order_discounts_outlet_idx on public.order_discounts (outlet_id, order_id);
alter table public.order_discounts enable row level security;

create table public.bill_discounts (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id),
  outlet_id uuid not null references public.outlets (id),
  basis public.discount_basis not null,
  value_bp integer check (value_bp > 0),
  value_paise bigint check (value_paise > 0),
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now(),
  constraint bill_discounts_basis_matches_value check (
    (basis = 'percent' and value_bp is not null and value_paise is null)
    or (basis = 'amount' and value_paise is not null and value_bp is null))
);

create index bill_discounts_bill_idx on public.bill_discounts (bill_id);
create index bill_discounts_outlet_idx on public.bill_discounts (outlet_id, bill_id);
alter table public.bill_discounts enable row level security;

-- ---------------------------------------------------------------------------
-- The parts equal the whole.
--
-- `orders.discount_paise` and `bills.discount_paise` are the figure every
-- reader adds up, and they must equal the sum of the line discounts and the
-- bill-level discount records. Deferred, because a discounted order is written
-- as several statements — the parent, its lines, its discount rows — and no
-- intermediate state of that write satisfies the sum.

create or replace function public.billing_discount_total_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_declared bigint;
  v_lines bigint;
  v_records bigint;
begin
  -- Each field access sits in its own branch rather than in a CASE expression.
  -- PL/pgSQL resolves every field an expression names, including ones in
  -- branches it will not take, so `new.bill_id` inside a CASE fails outright on
  -- an `orders` record. `billing_payment_total_guard` is shaped this way for the
  -- same reason.
  if tg_table_name = 'orders' then
    v_id := coalesce(new.id, old.id);
  elsif tg_table_name = 'order_items' or tg_table_name = 'order_discounts' then
    v_id := coalesce(new.order_id, old.order_id);
  elsif tg_table_name = 'bills' then
    v_id := coalesce(new.id, old.id);
  else
    v_id := coalesce(new.bill_id, old.bill_id);
  end if;

  if tg_table_name in ('orders', 'order_items', 'order_discounts') then
    select discount_paise into v_declared from public.orders where id = v_id;
    -- The parent may already be gone in a cascade; nothing left to check.
    if not found then return coalesce(new, old); end if;

    select coalesce(sum(discount_paise), 0) into v_lines
      from public.order_items where order_id = v_id;
    select coalesce(sum(amount_paise), 0) into v_records
      from public.order_discounts where order_id = v_id;
  else
    select discount_paise into v_declared from public.bills where id = v_id;
    if not found then return coalesce(new, old); end if;

    select coalesce(sum(discount_paise), 0) into v_lines
      from public.bill_items where bill_id = v_id;
    select coalesce(sum(amount_paise), 0) into v_records
      from public.bill_discounts where bill_id = v_id;
  end if;

  if v_declared <> v_lines + v_records then
    raise exception
      'discount parts do not equal the whole: declared %, lines %, records %',
      v_declared, v_lines, v_records;
  end if;

  return coalesce(new, old);
end;
$$;

create constraint trigger orders_discount_total_guard
  after insert or update on public.orders
  deferrable initially deferred for each row
  execute function public.billing_discount_total_guard();
create constraint trigger order_items_discount_total_guard
  after insert or update or delete on public.order_items
  deferrable initially deferred for each row
  execute function public.billing_discount_total_guard();
create constraint trigger order_discounts_total_guard
  after insert or update or delete on public.order_discounts
  deferrable initially deferred for each row
  execute function public.billing_discount_total_guard();

create constraint trigger bills_discount_total_guard
  after insert or update on public.bills
  deferrable initially deferred for each row
  execute function public.billing_discount_total_guard();
create constraint trigger bill_items_discount_total_guard
  after insert or update or delete on public.bill_items
  deferrable initially deferred for each row
  execute function public.billing_discount_total_guard();
create constraint trigger bill_discounts_total_guard
  after insert or update or delete on public.bill_discounts
  deferrable initially deferred for each row
  execute function public.billing_discount_total_guard();

-- ---------------------------------------------------------------------------
-- Command-only writes, mirroring bill_payments exactly.

create or replace function public.billing_discount_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and current_setting('app.billing_command', true) is distinct from '1' then
    raise exception 'discounts may be written only through billing commands'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger order_discounts_command_insert before insert on public.order_discounts
  for each row execute function public.billing_discount_insert_guard();
create trigger bill_discounts_command_insert before insert on public.bill_discounts
  for each row execute function public.billing_discount_insert_guard();

-- An order is editable, so its discounts are replaced wholesale by a revision
-- rather than being immutable. A bill is history, so its discounts are.
create trigger order_discounts_command_change before update or delete on public.order_discounts
  for each row execute function public.billing_discount_insert_guard();
create trigger bill_discounts_immutable before update or delete on public.bill_discounts
  for each row execute function public.reject_mutation();

-- Readable exactly where the parent is readable: the existing policies on
-- `orders` and `bills` already resolve outlet scope, and restating that logic
-- here would be a second place for it to be wrong.
create policy order_discounts_select on public.order_discounts
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy bill_discounts_select on public.bill_discounts
  for select to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_id));

grant select on public.order_discounts to authenticated;
grant select on public.bill_discounts to authenticated;
grant all on public.order_discounts to service_role;
grant all on public.bill_discounts to service_role;
revoke insert, update, delete on public.order_discounts from authenticated, anon;
revoke insert, update, delete on public.bill_discounts from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Menu discounts: the owner's side.
--
-- Several may be active at once, at different values over different category
-- sets, added one at a time [owner, 2026-09-03]. There is no date window: they
-- are turned on and turned off. When scheduling is wanted it must key on the
-- outlet's business date and not on now(), or a discount ending on the 31st
-- misses a bill rung at 00:30 on the 1st that belongs to the 31st.

create table public.menu_discounts (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  basis public.discount_basis not null,
  value_bp integer check (value_bp > 0 and value_bp <= 1000000),
  value_paise bigint check (value_paise > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint menu_discounts_basis_matches_value check (
    (basis = 'percent' and value_bp is not null and value_paise is null)
    or (basis = 'amount' and value_paise is not null and value_bp is null))
);

create index menu_discounts_outlet_active_idx
  on public.menu_discounts (outlet_id) where is_active;
alter table public.menu_discounts enable row level security;

create table public.menu_discount_categories (
  discount_id uuid not null references public.menu_discounts (id) on delete cascade,
  category_id uuid not null references public.menu_categories (id),
  primary key (discount_id, category_id)
);

create index menu_discount_categories_category_idx
  on public.menu_discount_categories (category_id);
alter table public.menu_discount_categories enable row level security;

-- A discount's categories must belong to the discount's own outlet. Cross-table,
-- so a trigger rather than a check, and security definer because the writer may
-- not be able to read the category row it references — the same shape and the
-- same reason as `menu_item_category_same_outlet`.
create or replace function public.menu_discount_category_same_outlet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discount_outlet uuid;
  v_category_outlet uuid;
begin
  select outlet_id into v_discount_outlet
    from public.menu_discounts where id = new.discount_id;
  select outlet_id into v_category_outlet
    from public.menu_categories where id = new.category_id;

  if v_discount_outlet is null or v_discount_outlet <> v_category_outlet then
    raise exception 'a menu discount category must belong to the discount''s own outlet';
  end if;

  return new;
end;
$$;

create trigger menu_discount_categories_same_outlet
  before insert or update on public.menu_discount_categories
  for each row execute function public.menu_discount_category_same_outlet();

-- ---------------------------------------------------------------------------
-- A rupee menu discount is bounded by the cheapest item it reaches
-- [owner, 2026-09-03], and the bound is enforced in both directions.
--
-- Not tidiness. A per-unit rupee discount above the price drives that line's
-- own discount past its `line_total_paise`, which is refused by the line's
-- check constraint — but by then the counter has already quoted a total it
-- cannot write, which is a worse failure than a refusal at configuration time.

create or replace function public.menu_discount_within_cheapest_item(
  p_discount_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value bigint;
  v_active boolean;
  v_cheapest bigint;
begin
  select value_paise, is_active into v_value, v_active
    from public.menu_discounts
   where id = p_discount_id and basis = 'amount';

  if v_value is null or not v_active then return; end if;

  select min(i.price_paise) into v_cheapest
    from public.menu_items i
    join public.menu_discount_categories dc on dc.category_id = i.category_id
   where dc.discount_id = p_discount_id and i.is_active;

  if v_cheapest is not null and v_value > v_cheapest then
    raise exception
      'a discount of % paise is more than the cheapest item it covers, at % paise',
      v_value, v_cheapest
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.menu_discount_price_floor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_discount uuid;
begin
  -- Each field access in its own branch, not a CASE expression: PL/pgSQL
  -- resolves every field an expression names, including in branches it will not
  -- take, so `new.discount_id` would fail outright on a `menu_discounts` row.
  if tg_table_name = 'menu_discounts' then
    v_discount := new.id;
  else
    v_discount := new.discount_id;
  end if;

  perform public.menu_discount_within_cheapest_item(v_discount);
  return new;
end;
$$;

create constraint trigger menu_discounts_price_floor
  after insert or update on public.menu_discounts
  deferrable initially deferred for each row
  execute function public.menu_discount_price_floor();
create constraint trigger menu_discount_categories_price_floor
  after insert or update on public.menu_discount_categories
  deferrable initially deferred for each row
  execute function public.menu_discount_price_floor();

-- The other direction: an item cannot be repriced beneath, or moved into a
-- category whose active rupee discount already exceeds, its price.
create or replace function public.menu_item_above_active_discounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worst bigint;
begin
  select max(d.value_paise) into v_worst
    from public.menu_discounts d
    join public.menu_discount_categories dc on dc.discount_id = d.id
   where dc.category_id = new.category_id
     and d.basis = 'amount'
     and d.is_active;

  if v_worst is not null and new.is_active and new.price_paise < v_worst then
    raise exception
      'this item would cost % paise, beneath the % paise discount already covering its category',
      new.price_paise, v_worst
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger menu_items_above_active_discounts
  before insert or update of price_paise, category_id, is_active on public.menu_items
  for each row execute function public.menu_item_above_active_discounts();

-- ---------------------------------------------------------------------------
-- Policies. Read where the menu is read — the counter needs these to price a
-- line — and written only by the roles that may edit the menu itself.

create policy menu_discounts_select on public.menu_discounts
  for select to authenticated
  using (
    public.app_device_ok()
    and (
      outlet_id = (select public.app_counter_shift_outlet())
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
          or outlet_id in (select public.app_outlets_for('biller'))
        )
      )
    )
  );

create policy menu_discounts_insert on public.menu_discounts
  for insert to authenticated
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

create policy menu_discounts_update on public.menu_discounts
  for update to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  )
  with check (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

create policy menu_discounts_delete on public.menu_discounts
  for delete to authenticated
  using (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
    )
  );

-- The join table inherits its parent's scope, resolved through the parent
-- rather than restated. A restatement is a second place to be wrong.
create policy menu_discount_categories_select on public.menu_discount_categories
  for select to authenticated
  using (exists (select 1 from public.menu_discounts d where d.id = discount_id));

create policy menu_discount_categories_insert on public.menu_discount_categories
  for insert to authenticated
  with check (exists (
    select 1 from public.menu_discounts d
     where d.id = discount_id
       and public.app_account_active()
       and (
         (select public.app_is_owner())
         or d.outlet_id in (select public.app_outlets_for('franchise_admin')))));

create policy menu_discount_categories_delete on public.menu_discount_categories
  for delete to authenticated
  using (exists (
    select 1 from public.menu_discounts d
     where d.id = discount_id
       and public.app_account_active()
       and (
         (select public.app_is_owner())
         or d.outlet_id in (select public.app_outlets_for('franchise_admin')))));

grant select on public.menu_discounts to authenticated;
grant insert, update, delete on public.menu_discounts to authenticated;
grant select on public.menu_discount_categories to authenticated;
grant insert, delete on public.menu_discount_categories to authenticated;
grant all on public.menu_discounts to service_role;
grant all on public.menu_discount_categories to service_role;

-- ---------------------------------------------------------------------------
-- The counter's discount presets.
--
-- Between none and four, ordered, defaulting to 10/15/20 percent. **A preset
-- carries its own unit**: the counter offers a rupee discount in one tap as
-- readily as a percentage, so a preset is a basis and a value rather than a
-- bare percentage.
--
-- One jsonb column rather than a table: these are read and written whole,
-- always with the outlet, never queried by element and never joined to. A table
-- would have cost a policy, an isolation case and an adapter for a list of at
-- most four values.
--
-- `value` is basis points when the basis is a percentage and paise when it is
-- an amount, which is the same integer convention every other discount column
-- in this migration uses.
--
-- Four is a layout fact, not an arbitrary cap: the biller's panel fits four
-- across one row.

-- A check constraint may not contain a subquery, and "every element is well
-- formed" cannot be said in scalar SQL. An immutable helper can say it, and
-- says it in one readable place.
create or replace function public.discount_presets_valid(p_presets jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_presets is not null
    and jsonb_typeof(p_presets) = 'array'
    and jsonb_array_length(p_presets) <= 4
    and not exists (
      select 1 from jsonb_array_elements(p_presets) preset
       where jsonb_typeof(preset) <> 'object'
          -- Absence first, and explicitly. `preset ->> 'basis'` on a missing key
          -- is NULL, and `NULL not in (...)` is NULL rather than true, so a
          -- preset with no basis or no value would pass every test below it
          -- without ever being looked at.
          or not (preset ? 'basis') or not (preset ? 'value')
          or preset ->> 'basis' not in ('percent', 'amount')
          or jsonb_typeof(preset -> 'value') <> 'number'
          or (preset ->> 'value') !~ '^[0-9]+$'
          or (preset ->> 'value')::bigint <= 0
          -- A percentage preset is bounded; a rupee one is bounded by the menu
          -- at the moment it is applied, which is the counter's business.
          or (preset ->> 'basis' = 'percent' and (preset ->> 'value')::bigint > 10000));
$$;

alter table public.outlets
  add column discount_presets jsonb not null default
    '[{"basis":"percent","value":1000},
      {"basis":"percent","value":1500},
      {"basis":"percent","value":2000}]'::jsonb
    constraint outlets_discount_presets_valid
      check (public.discount_presets_valid(discount_presets));
