-- Billing: shifts, bills, bill items, per-outlet bill numbering, and the
-- write contract — append-only bills, snapshot line items, validated business
-- dates. This is the path the whole product depends on; every rule here is a
-- database rule, not a convention.

-- ---------------------------------------------------------------------------
-- shifts — a shift never spans two business dates.

create table public.shifts (
  id uuid primary key,
  outlet_id uuid not null references public.outlets (id),
  counter_device_id uuid not null references public.counter_devices (id),
  biller_profile_id uuid not null references public.profiles (id),
  business_date date not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint shifts_close_after_open check (closed_at is null or closed_at >= opened_at)
);

create index shifts_outlet_business_date_idx on public.shifts (outlet_id, business_date);
create index shifts_counter_device_id_idx on public.shifts (counter_device_id);

alter table public.shifts enable row level security;

-- ---------------------------------------------------------------------------
-- bills — client-generated UUID primary key: the idempotency key for the
-- offline outbox. created_at is the client clock (what the biller
-- experienced); synced_at is the server clock (what the system can trust).

create table public.bills (
  id uuid primary key,
  outlet_id uuid not null references public.outlets (id),
  -- Assigned by the allocation trigger on every insert; the default exists
  -- only so generated client types treat the column as server-supplied. A
  -- client-provided value — including this default — is always overwritten.
  bill_number bigint not null default 0,
  business_date date not null,
  biller_profile_id uuid not null references public.profiles (id),
  counter_device_id uuid not null references public.counter_devices (id),
  shift_id uuid not null references public.shifts (id),
  customer_id uuid references public.customers (id),
  customer_name text,
  customer_phone text,
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  tax_paise bigint not null default 0 check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_mode public.pricing_mode not null default 'no_tax',
  payment_method public.payment_method not null,
  status public.bill_status not null default 'settled',
  voided_by uuid references public.profiles (id),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  constraint bills_number_unique_per_outlet unique (outlet_id, bill_number),
  constraint bills_total_arithmetic
    check (total_paise = subtotal_paise - discount_paise + tax_paise),
  -- v1 writes no_tax only. Dropping this constraint is the deliberate,
  -- explicit act that one day enables GST — never a silent reinterpretation.
  constraint bills_v1_no_tax check (pricing_mode = 'no_tax' and tax_paise = 0),
  constraint bills_void_fields_paired
    check ((status = 'void') = (voided_at is not null)),
  constraint bills_void_needs_attribution
    check (status = 'settled' or (voided_by is not null and void_reason is not null))
);

create index bills_outlet_business_date_idx on public.bills (outlet_id, business_date);
create index bills_shift_id_idx on public.bills (shift_id);

alter table public.bills enable row level security;

-- ---------------------------------------------------------------------------
-- bill_items — the snapshot is the point. menu_item_id is nullable and
-- advisory; a historical bill must never be valued by joining the live menu.

create table public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id),
  menu_item_id uuid references public.menu_items (id),
  item_name text not null,
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  quantity integer not null check (quantity > 0),
  line_total_paise bigint not null check (line_total_paise >= 0),
  constraint bill_items_line_arithmetic
    check (line_total_paise = unit_price_paise * quantity)
);

create index bill_items_bill_id_idx on public.bill_items (bill_id);

alter table public.bill_items enable row level security;

-- ---------------------------------------------------------------------------
-- Per-outlet bill numbers: a counter row per outlet, bumped inside the insert
-- transaction. Gapless because a failed insert rolls the bump back with it;
-- race-safe because the row lock serialises allocation per outlet for the
-- few milliseconds the statement lives. Clients cannot touch the table, and
-- a client-supplied number is overwritten, never trusted.

create table public.bill_number_counters (
  outlet_id uuid primary key references public.outlets (id),
  last_number bigint not null default 0
);

alter table public.bill_number_counters enable row level security;

revoke all on public.bill_number_counters from authenticated, anon;

create or replace function public.assign_bill_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.bill_number_counters as c (outlet_id, last_number)
  values (new.outlet_id, 1)
  on conflict (outlet_id) do update set last_number = c.last_number + 1
  returning c.last_number into new.bill_number;

  return new;
end;
$$;

create trigger bills_assign_number
  before insert on public.bills
  for each row execute function public.assign_bill_number();

-- ---------------------------------------------------------------------------
-- Append-only: the only legal update is settled → void, touching only the
-- void columns, by an admin session. Everything else — including anything a
-- privileged writer might try — is refused at the trigger.

create or replace function public.bills_void_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'settled' and new.status = 'void' then
    if (to_jsonb(new) - 'status' - 'voided_by' - 'voided_at' - 'void_reason')
       is distinct from
       (to_jsonb(old) - 'status' - 'voided_by' - 'voided_at' - 'void_reason') then
      raise exception 'voiding may not modify any bill field other than void attribution';
    end if;

    -- Role gate applies to client sessions; seeds and privileged maintenance
    -- run without a session and answer to the RLS-less trigger checks above.
    if auth.uid() is not null then
      if public.app_role() not in ('franchise_admin', 'super_admin') then
        raise exception 'only a franchise admin or super admin may void a bill';
      end if;
      if new.voided_by is distinct from auth.uid() then
        raise exception 'voided_by must be the voiding session';
      end if;
    end if;

    return new;
  end if;

  raise exception 'bills are append-only once settled; corrections are voids plus new bills';
end;
$$;

create trigger bills_append_only
  before update on public.bills
  for each row execute function public.bills_void_only();

create trigger bills_no_delete
  before delete on public.bills
  for each row execute function public.reject_mutation();

create trigger bill_items_immutable
  before update or delete on public.bill_items
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- Business-date validation. The device resolves the business date from its
-- own clock at settlement; the server refuses what cannot be true rather
-- than repairing it. Applies to bills (created_at), shifts (opened_at) and —
-- in a later migration — attendance (check_in_at).

create or replace function public.validate_business_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutover time;
  v_ts timestamptz;
  v_expected date;
begin
  select business_day_cutover into v_cutover
    from public.outlets
   where id = new.outlet_id;

  if v_cutover is null then
    raise exception 'unknown outlet %', new.outlet_id;
  end if;

  v_ts := case tg_table_name
    when 'bills' then (to_jsonb(new) ->> 'created_at')::timestamptz
    when 'shifts' then (to_jsonb(new) ->> 'opened_at')::timestamptz
    when 'attendance' then (to_jsonb(new) ->> 'check_in_at')::timestamptz
  end;

  -- An attendance row with no check-in (absent, leave) has no timestamp to
  -- validate against.
  if v_ts is null then
    return new;
  end if;

  v_expected := public.app_business_date(v_ts, v_cutover);

  if new.business_date is distinct from v_expected then
    raise exception
      'business_date % contradicts the outlet cutover: % at Asia/Kolkata under a % cutover belongs to %',
      new.business_date, v_ts, v_cutover, v_expected;
  end if;

  return new;
end;
$$;

create trigger bills_business_date_valid
  before insert on public.bills
  for each row execute function public.validate_business_date();

create trigger shifts_business_date_valid
  before insert or update on public.shifts
  for each row execute function public.validate_business_date();

-- ---------------------------------------------------------------------------
-- Policies.

-- shifts: the device opens and closes its own shifts; managers read.
create policy shifts_select on public.shifts
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
      or counter_device_id = auth.uid()
    )
  );

create policy shifts_insert on public.shifts
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and public.app_role() = 'biller'
    and outlet_id = public.app_outlet_id()
    and counter_device_id = auth.uid()
    and public.app_profile_has(biller_profile_id, 'biller', public.app_outlet_id())
  );

create policy shifts_update on public.shifts
  for update to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and counter_device_id = auth.uid()
  )
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and counter_device_id = auth.uid()
    and outlet_id = public.app_outlet_id()
  );

-- bills: the counter creates; managers read; the device sees only its own
-- open shifts' bills — a shared tablet must not expose the day's takings to
-- whoever is standing at it.
create policy bills_select on public.bills
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
      or (
        counter_device_id = auth.uid()
        and shift_id in (
          select s.id from public.shifts s
          where s.counter_device_id = auth.uid() and s.closed_at is null
        )
      )
    )
  );

create policy bills_insert on public.bills
  for insert to authenticated
  with check (
    public.app_account_active()
    and public.app_device_ok()
    and public.app_role() = 'biller'
    and outlet_id = public.app_outlet_id()
    and counter_device_id = auth.uid()
    and public.app_profile_has(biller_profile_id, 'biller', public.app_outlet_id())
    and shift_id in (
      select s.id from public.shifts s where s.counter_device_id = auth.uid()
    )
  );

-- The void transition. The trigger constrains what an update may change and
-- who may perform it; the policy constrains whose bills are reachable.
create policy bills_update on public.bills
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

-- bill_items: visibility and writability flow through the parent bill.
create policy bill_items_select on public.bill_items
  for select to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_id));

create policy bill_items_insert on public.bill_items
  for insert to authenticated
  with check (
    public.app_role() = 'biller'
    and exists (select 1 from public.bills b where b.id = bill_id)
  );
