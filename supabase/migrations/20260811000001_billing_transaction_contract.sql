-- Billing transaction contract.
--
-- The existing billing UI remains demo-gated. This migration settles the live
-- database boundary it will eventually call: editable orders, immutable bills,
-- two independent clocks, exact command replay and server-verifiable end of day.

-- Production was inspected before this migration was written. Refuse to reshape
-- unexpected money or customer history and report counts only: no identifiers,
-- names or phone numbers may appear in migration diagnostics.
do $$
declare
  v_bills bigint;
  v_items bigint;
  v_customers bigint;
begin
  select count(*) into v_bills from public.bills;
  select count(*) into v_items from public.bill_items;
  select count(*) into v_customers from public.customers;

  if v_bills <> 0 or v_items <> 0 or v_customers <> 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'billing transaction migration refused: bills=%s bill_items=%s customers=%s',
        v_bills, v_items, v_customers);
  end if;
end;
$$;

create type public.order_status as enum ('open', 'paid', 'cancelled');

create table public.order_number_counters (
  outlet_id uuid not null references public.outlets (id),
  business_date date not null,
  last_number bigint not null default 0 check (last_number >= 0),
  primary key (outlet_id, business_date)
);

create table public.orders (
  id uuid primary key,
  outlet_id uuid not null references public.outlets (id),
  order_number bigint not null check (order_number > 0),
  device_id uuid not null references public.counter_devices (id),
  created_by uuid not null references public.profiles (id),
  created_shift_id uuid not null references public.counter_shifts (id),
  ordered_at timestamptz not null,
  business_date date not null,
  status public.order_status not null default 'open',
  customer_id uuid references public.customers (id),
  customer_name text,
  customer_phone text,
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  tax_paise bigint not null default 0 check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_mode public.pricing_mode not null default 'no_tax',
  changed_by uuid references public.profiles (id),
  changed_shift_id uuid references public.counter_shifts (id),
  changed_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancelled_device_id uuid references public.counter_devices (id),
  cancelled_shift_id uuid references public.counter_shifts (id),
  cancelled_at timestamptz,
  cancel_reason text,
  paid_by uuid references public.profiles (id),
  paid_shift_id uuid references public.counter_shifts (id),
  paid_at timestamptz,
  bill_id uuid,
  created_at timestamptz not null default now(),
  constraint orders_number_unique_per_outlet_day
    unique (outlet_id, business_date, order_number),
  constraint orders_total_arithmetic
    check (total_paise = subtotal_paise - discount_paise + tax_paise),
  constraint orders_v1_no_tax
    check (pricing_mode = 'no_tax' and tax_paise = 0),
  constraint orders_customer_name_not_blank
    check (customer_name is null or length(btrim(customer_name)) > 0),
  constraint orders_change_fields_paired check (
    (changed_at is null) = (changed_by is null)
    and (changed_at is null) = (changed_shift_id is null)),
  constraint orders_cancel_fields_match_status check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (status = 'cancelled') = (cancelled_by is not null)
    and (status = 'cancelled') = (cancel_reason is not null)
    and (cancel_reason is null or length(btrim(cancel_reason)) > 0)),
  constraint orders_paid_fields_match_status check (
    (status = 'paid') = (paid_at is not null)
    and (status = 'paid') = (paid_by is not null)
    and (status = 'paid') = (paid_shift_id is not null)
    and (status = 'paid') = (bill_id is not null))
);

create index orders_outlet_business_date_idx
  on public.orders (outlet_id, business_date);
create index orders_device_status_idx on public.orders (device_id, status);

create table public.order_items (
  id uuid primary key,
  order_id uuid not null references public.orders (id),
  menu_item_id uuid references public.menu_items (id),
  item_name text not null check (length(btrim(item_name)) > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  quantity integer not null check (quantity > 0),
  line_total_paise bigint not null check (line_total_paise >= 0),
  constraint order_items_line_arithmetic
    check (line_total_paise = unit_price_paise * quantity)
);

create index order_items_order_id_idx on public.order_items (order_id);

-- A compact receipt contains only envelope identity, attribution, dates and the
-- result needed for replay. Customer and line payloads deliberately never land.
create table public.billing_commands (
  id uuid primary key,
  outlet_id uuid not null references public.outlets (id),
  device_id uuid references public.counter_devices (id),
  shift_id uuid references public.counter_shifts (id),
  actor_id uuid references public.profiles (id),
  command_type text not null check (command_type in (
    'create_order', 'revise_order', 'cancel_order', 'pay_order', 'pay_now',
    'void_bill', 'manager_cancel_order', 'confirm_end_of_day')),
  schema_version integer not null check (schema_version > 0),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  client_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  business_date date,
  payment_business_date date,
  result_category text not null,
  result jsonb not null default '{}'::jsonb,
  watermark bigint generated always as identity unique,
  constraint billing_commands_result_is_object
    check (jsonb_typeof(result) = 'object')
);

create index billing_commands_outlet_date_idx
  on public.billing_commands (outlet_id, business_date, watermark);
create index billing_commands_device_date_idx
  on public.billing_commands (device_id, business_date, watermark);

create table public.billing_end_of_day_confirmations (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  device_id uuid not null references public.counter_devices (id),
  business_date date not null,
  shift_id uuid not null references public.counter_shifts (id),
  confirmed_at timestamptz not null default now(),
  command_watermark bigint not null check (command_watermark >= 0),
  invalidated_at timestamptz,
  invalidated_by_command_id uuid references public.billing_commands (id),
  constraint billing_end_of_day_one_per_tablet_day
    unique (device_id, business_date),
  constraint billing_end_of_day_invalidation_paired check (
    (invalidated_at is null) = (invalidated_by_command_id is null))
);

create index billing_end_of_day_outlet_date_idx
  on public.billing_end_of_day_confirmations (outlet_id, business_date);

alter table public.order_number_counters enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.billing_commands enable row level security;
alter table public.billing_end_of_day_confirmations enable row level security;

-- Bills gain a source order, live counter-shift attribution, and two explicit
-- clocks. Defaults keep synthetic seed inserts compatible; the preparation
-- trigger replaces them from the legacy created_at/business_date pair unless a
-- command has explicitly supplied both clocks.
alter table public.bills
  add column order_id uuid unique references public.orders (id),
  add column counter_shift_id uuid references public.counter_shifts (id),
  add column ordered_at timestamptz not null default now(),
  add column paid_at timestamptz not null default now(),
  add column payment_business_date date not null default current_date;

-- `shift_id` points at the retired pre-tablet shift model and remains only for
-- synthetic demo history. New command bills use counter_shift_id exclusively.
alter table public.bills alter column shift_id drop not null;

alter table public.orders
  add constraint orders_bill_id_fkey foreign key (bill_id)
    references public.bills (id) deferrable initially deferred;

create index bills_outlet_payment_business_date_idx
  on public.bills (outlet_id, payment_business_date);
create index bills_order_id_idx on public.bills (order_id);

create or replace function public.prepare_bill_clocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.billing_command', true) is distinct from '1' then
    new.ordered_at := new.created_at;
    new.paid_at := new.created_at;
    new.payment_business_date := new.business_date;
    select s.id into new.counter_shift_id
      from public.counter_shifts s
     where s.device_id = new.counter_device_id
       and s.outlet_id = new.outlet_id
       and s.business_date = new.business_date
       and new.created_at >= s.opened_at
       and new.created_at < s.expires_at
     order by s.opened_at desc
     limit 1;
  end if;
  return new;
end;
$$;

create trigger bills_prepare_clocks
  before insert on public.bills
  for each row execute function public.prepare_bill_clocks();

-- Bill revenue now follows ordered_at. Synthetic seed inserts still carry the
-- legacy created_at field, and prepare_bill_clocks copies that value first.
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
  select business_day_cutover into v_cutover from public.outlets where id=new.outlet_id;
  if v_cutover is null then raise exception 'unknown outlet %',new.outlet_id; end if;
  if tg_table_name='bills' then
    v_ts:=case when current_setting('app.billing_command',true)='1'
      then (to_jsonb(new)->>'ordered_at')::timestamptz
      else (to_jsonb(new)->>'created_at')::timestamptz end;
  elsif tg_table_name='shifts' then
    v_ts:=(to_jsonb(new)->>'opened_at')::timestamptz;
  elsif tg_table_name='attendance' then
    v_ts:=(to_jsonb(new)->>'check_in_at')::timestamptz;
  end if;
  if v_ts is null then return new; end if;
  v_expected:=public.app_business_date(v_ts,v_cutover);
  if new.business_date is distinct from v_expected then
    raise exception
      'business_date % contradicts the outlet cutover: % at Asia/Kolkata under a % cutover belongs to %',
      new.business_date,v_ts,v_cutover,v_expected;
  end if;
  return new;
end;
$$;

-- Canonical JSON is deliberately specified rather than delegated to a runtime's
-- object formatting. Object keys sort by code point, arrays retain order, and
-- insignificant whitespace disappears. shared/billing-command.ts mirrors this.
create or replace function public.billing_canonical_json(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_type text := jsonb_typeof(p_value);
  v_result text;
begin
  if v_type = 'object' then
    select '{' || coalesce(string_agg(
      to_json(k)::text || ':' || public.billing_canonical_json(v),
      ',' order by k), '') || '}'
      into v_result
      from jsonb_each(p_value) as e(k, v);
    return v_result;
  elsif v_type = 'array' then
    select '[' || coalesce(string_agg(
      public.billing_canonical_json(v), ',' order by ord), '') || ']'
      into v_result
      from jsonb_array_elements(p_value) with ordinality as e(v, ord);
    return v_result;
  end if;
  return p_value::text;
end;
$$;

create or replace function public.billing_payload_hash(p_payload jsonb)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(public.billing_canonical_json(p_payload), 'UTF8'),
      'sha256'),
    'hex')
$$;

create or replace function public.billing_payload_has_keys(
  p_payload jsonb,
  p_keys text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_payload) = 'object'
    and (select array_agg(k order by k) from jsonb_object_keys(p_payload) k)
        = (select array_agg(k order by k) from unnest(p_keys) k)
$$;

create or replace function public.billing_envelope_error(
  p_command_id uuid,
  p_schema_version integer,
  p_payload_hash text,
  p_created_at timestamptz,
  p_payload jsonb,
  p_keys text[]
)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_schema_version is not null and p_schema_version <> 1 then
    return 'unsupported_schema';
  end if;
  if p_command_id is null or p_schema_version is null or p_payload_hash is null
     or p_created_at is null or p_payload is null
     or not public.billing_payload_has_keys(p_payload, p_keys) then
    return 'malformed_payload';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$'
     or p_payload_hash <> public.billing_payload_hash(p_payload) then
    return 'malformed_payload';
  end if;
  if p_created_at > now() + interval '5 minutes' then
    return 'malformed_payload';
  end if;
  return null;
end;
$$;

create or replace function public.billing_device_context(
  p_shift_id uuid,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device public.counter_devices%rowtype;
  v_shift public.counter_shifts%rowtype;
begin
  if auth.uid() is null or p_shift_id is null or p_created_at is null then
    return jsonb_build_object('status', 'malformed_payload');
  end if;

  select * into v_device from public.counter_devices where id = auth.uid();
  if not found then
    return jsonb_build_object('status', 'authorization_refused');
  end if;
  if v_device.removed_at is not null and p_created_at >= v_device.removed_at then
    return jsonb_build_object('status', 'removed_tablet');
  end if;

  select * into v_shift
    from public.counter_shifts
   where id = p_shift_id
     and device_id = v_device.id
     and outlet_id = v_device.outlet_id
     and p_created_at >= opened_at
     and p_created_at < least(expires_at, coalesce(ended_at, expires_at));
  if not found then
    return jsonb_build_object('status', 'authorization_refused');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'deviceId', v_device.id,
    'outletId', v_shift.outlet_id,
    'actorId', v_shift.person_id,
    'shiftId', v_shift.id,
    'delayed', v_device.removed_at is not null
      or v_shift.ended_at is not null or v_shift.expires_at <= now());
end;
$$;

create or replace function public.billing_validate_totals(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_subtotal bigint;
  v_discount bigint;
  v_tax bigint;
  v_total bigint;
  v_line_sum bigint;
begin
  v_subtotal := (p_payload ->> 'subtotalPaise')::bigint;
  v_discount := (p_payload ->> 'discountPaise')::bigint;
  v_tax := (p_payload ->> 'taxPaise')::bigint;
  v_total := (p_payload ->> 'totalPaise')::bigint;
  select coalesce(sum((line ->> 'lineTotalPaise')::bigint), 0)
    into v_line_sum
    from jsonb_array_elements(p_payload -> 'lines') line;
  return v_subtotal >= 0 and v_discount >= 0 and v_tax = 0
    and v_total >= 0 and p_payload ->> 'pricingMode' = 'no_tax'
    and v_subtotal = v_line_sum
    and v_total = v_subtotal - v_discount + v_tax;
exception when others then
  return false;
end;
$$;

create or replace function public.billing_content_payload_well_typed(p_payload jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_payload -> 'customerId') in ('null','string')
    and jsonb_typeof(p_payload -> 'customerName') in ('null','string')
    and jsonb_typeof(p_payload -> 'customerPhone') in ('null','string')
    and jsonb_typeof(p_payload -> 'subtotalPaise') = 'number'
    and jsonb_typeof(p_payload -> 'discountPaise') = 'number'
    and jsonb_typeof(p_payload -> 'taxPaise') = 'number'
    and jsonb_typeof(p_payload -> 'totalPaise') = 'number'
    and (p_payload ->> 'subtotalPaise') ~ '^-?[0-9]+$'
    and (p_payload ->> 'discountPaise') ~ '^-?[0-9]+$'
    and (p_payload ->> 'taxPaise') ~ '^-?[0-9]+$'
    and (p_payload ->> 'totalPaise') ~ '^-?[0-9]+$'
    and jsonb_typeof(p_payload -> 'pricingMode') = 'string'
    and jsonb_typeof(p_payload -> 'lines') = 'array'
    and not exists (
      select 1 from jsonb_array_elements(p_payload -> 'lines') line
       where jsonb_typeof(line) <> 'object'
          or jsonb_typeof(line -> 'id') <> 'string'
          or jsonb_typeof(line -> 'menuItemId') not in ('null','string')
          or jsonb_typeof(line -> 'itemName') <> 'string'
          or jsonb_typeof(line -> 'unitPricePaise') <> 'number'
          or jsonb_typeof(line -> 'quantity') <> 'number'
          or jsonb_typeof(line -> 'lineTotalPaise') <> 'number'
          or (line ->> 'unitPricePaise') !~ '^-?[0-9]+$'
          or (line ->> 'quantity') !~ '^-?[0-9]+$'
          or (line ->> 'lineTotalPaise') !~ '^-?[0-9]+$'),
    false)
$$;

create or replace function public.billing_validate_lines(
  p_lines jsonb,
  p_outlet_id uuid,
  p_order_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_id uuid;
  v_menu_id uuid;
  v_name text;
  v_price bigint;
  v_quantity integer;
  v_total bigint;
  v_existing public.order_items%rowtype;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return false;
  end if;
  if (select count(*) <> count(distinct value ->> 'id')
        from jsonb_array_elements(p_lines)) then
    return false;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if not public.billing_payload_has_keys(v_line, array[
      'id', 'menuItemId', 'itemName', 'unitPricePaise', 'quantity', 'lineTotalPaise']) then
      return false;
    end if;
    v_id := (v_line ->> 'id')::uuid;
    v_menu_id := nullif(v_line ->> 'menuItemId', '')::uuid;
    v_name := v_line ->> 'itemName';
    v_price := (v_line ->> 'unitPricePaise')::bigint;
    v_quantity := (v_line ->> 'quantity')::integer;
    v_total := (v_line ->> 'lineTotalPaise')::bigint;
    if v_id is null or length(btrim(v_name)) = 0 or v_price < 0
       or v_quantity <= 0 or v_total <> v_price * v_quantity then
      return false;
    end if;

    select * into v_existing from public.order_items where id = v_id;
    if found then
      if p_order_id is null or v_existing.order_id is distinct from p_order_id
         or v_existing.menu_item_id is distinct from v_menu_id
         or v_existing.item_name is distinct from v_name
         or v_existing.unit_price_paise is distinct from v_price then
        return false;
      end if;
    elsif v_menu_id is not null and not exists (
      select 1 from public.menu_items m
       where m.id = v_menu_id and m.outlet_id = p_outlet_id
         and m.name = v_name and m.price_paise = v_price
    ) then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.billing_next_order_number(
  p_outlet_id uuid,
  p_business_date date
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_number bigint;
begin
  insert into public.order_number_counters as c
    (outlet_id, business_date, last_number)
  values (p_outlet_id, p_business_date, 1)
  on conflict (outlet_id, business_date)
  do update set last_number = c.last_number + 1
  returning last_number into v_number;
  return v_number;
end;
$$;

create or replace function public.billing_begin_command(
  p_command_id uuid,
  p_type text,
  p_schema_version integer,
  p_payload_hash text,
  p_created_at timestamptz,
  p_outlet_id uuid,
  p_device_id uuid,
  p_shift_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.billing_commands%rowtype;
  v_inserted integer;
begin
  insert into public.billing_commands (
    id, outlet_id, device_id, shift_id, actor_id, command_type,
    schema_version, payload_hash, client_created_at, result_category)
  values (
    p_command_id, p_outlet_id, p_device_id, p_shift_id, p_actor_id, p_type,
    p_schema_version, p_payload_hash, p_created_at, 'pending')
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return jsonb_build_object('status', 'claimed');
  end if;

  select * into v_existing from public.billing_commands where id = p_command_id;
  if v_existing.command_type is distinct from p_type
     or v_existing.schema_version is distinct from p_schema_version
     or v_existing.payload_hash is distinct from p_payload_hash
     or v_existing.client_created_at is distinct from p_created_at
     or v_existing.outlet_id is distinct from p_outlet_id
     or v_existing.device_id is distinct from p_device_id
     or v_existing.shift_id is distinct from p_shift_id
     or v_existing.actor_id is distinct from p_actor_id then
    return jsonb_build_object('status', 'identity_conflict', 'commandId', p_command_id);
  end if;

  if v_existing.result_category = 'accepted' then
    return jsonb_set(v_existing.result, '{status}', '"replay"'::jsonb, true);
  end if;
  return v_existing.result;
end;
$$;

create or replace function public.billing_finish_command(
  p_command_id uuid,
  p_result jsonb,
  p_business_date date default null,
  p_payment_business_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command public.billing_commands%rowtype;
begin
  update public.billing_commands
     set result_category = p_result ->> 'status',
         result = p_result,
         business_date = p_business_date,
         payment_business_date = p_payment_business_date
   where id = p_command_id
   returning * into v_command;

  if p_result ->> 'status' = 'accepted' and v_command.device_id is not null
     and v_command.command_type <> 'confirm_end_of_day' then
    update public.billing_end_of_day_confirmations c
       set invalidated_at = now(), invalidated_by_command_id = p_command_id
     where c.device_id = v_command.device_id
       and c.invalidated_at is null
       and c.business_date in (p_business_date, p_payment_business_date);
  end if;
  return p_result;
end;
$$;

create or replace function public.billing_order_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.billing_command', true) is distinct from '1' then
    raise exception 'orders may change only through billing commands' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'orders cannot be deleted';
  end if;
  if old.status <> 'open' then
    raise exception 'paid and cancelled orders are immutable';
  end if;
  if new.status = 'open' then
    if (to_jsonb(new) - array['customer_id','customer_name','customer_phone',
        'subtotal_paise','discount_paise','tax_paise','total_paise','pricing_mode',
        'changed_by','changed_shift_id','changed_at'])
       is distinct from
       (to_jsonb(old) - array['customer_id','customer_name','customer_phone',
        'subtotal_paise','discount_paise','tax_paise','total_paise','pricing_mode',
        'changed_by','changed_shift_id','changed_at']) then
      raise exception 'revision changed immutable order facts';
    end if;
  elsif new.status = 'paid' then
    if (to_jsonb(new) - array['status','paid_by','paid_shift_id','paid_at','bill_id'])
       is distinct from
       (to_jsonb(old) - array['status','paid_by','paid_shift_id','paid_at','bill_id']) then
      raise exception 'payment changed order facts';
    end if;
  elsif new.status = 'cancelled' then
    if (to_jsonb(new) - array['status','cancelled_by','cancelled_device_id',
        'cancelled_shift_id','cancelled_at','cancel_reason'])
       is distinct from
       (to_jsonb(old) - array['status','cancelled_by','cancelled_device_id',
        'cancelled_shift_id','cancelled_at','cancel_reason']) then
      raise exception 'cancellation changed order facts';
    end if;
  else
    raise exception 'invalid order transition';
  end if;
  return new;
end;
$$;

create trigger orders_guard
  before update or delete on public.orders
  for each row execute function public.billing_order_guard();

create or replace function public.billing_order_item_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  if current_setting('app.billing_command', true) is distinct from '1' then
    raise exception 'order items may change only through billing commands' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orders o where o.id = v_order_id and o.status = 'open') then
    raise exception 'order is not open';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger order_items_guard
  before insert or update or delete on public.order_items
  for each row execute function public.billing_order_item_guard();

-- Existing immutable-bill triggers remain the last line of defence. The insert
-- and item guards additionally make the command surface mandatory for clients.
create or replace function public.billing_bill_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and current_setting('app.billing_command', true) is distinct from '1' then
    raise exception 'bills may be inserted only through billing commands' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger bills_command_insert
  before insert on public.bills
  for each row execute function public.billing_bill_insert_guard();

create or replace function public.billing_bill_item_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and current_setting('app.billing_command', true) is distinct from '1' then
    raise exception 'bill items may be inserted only through billing commands' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger bill_items_command_insert
  before insert on public.bill_items
  for each row execute function public.billing_bill_item_insert_guard();

-- Command implementations ---------------------------------------------------

create or replace function public.create_billing_order(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_error text;
  v_context jsonb;
  v_claim jsonb;
  v_outlet uuid;
  v_actor uuid;
  v_order uuid;
  v_customer uuid;
  v_date date;
  v_number bigint;
  v_result jsonb;
begin
  v_error := public.billing_envelope_error(p_command_id, p_schema_version,
    p_payload_hash, p_created_at, p_payload, array[
      'orderId','businessDate','customerId','customerName','customerPhone',
      'subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','lines']);
  if v_error is not null then return jsonb_build_object('status', v_error); end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context := public.billing_device_context(p_shift_id, p_created_at);
  if v_context ->> 'status' <> 'ok' then return v_context; end if;
  begin
    v_outlet := (v_context ->> 'outletId')::uuid;
    v_actor := (v_context ->> 'actorId')::uuid;
    v_order := (p_payload ->> 'orderId')::uuid;
    v_customer := nullif(p_payload ->> 'customerId', '')::uuid;
    v_date := (p_payload ->> 'businessDate')::date;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;

  if v_order is null or v_date is null
     or not public.billing_content_payload_well_typed(p_payload) then
    return jsonb_build_object('status','malformed_payload');
  end if;

  if v_date is distinct from (select public.app_business_date(
      p_created_at, business_day_cutover) from public.outlets where id = v_outlet) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if not coalesce(public.billing_validate_totals(p_payload),false)
     or not coalesce(public.billing_validate_lines(p_payload -> 'lines', v_outlet),false) then
    return jsonb_build_object('status','arithmetic_invalid');
  end if;

  v_claim := public.billing_begin_command(p_command_id, 'create_order', p_schema_version,
    p_payload_hash, p_created_at, v_outlet, auth.uid(), p_shift_id, v_actor);
  if v_claim ->> 'status' <> 'claimed' then return v_claim; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_outlet::text||':'||v_date::text,0));
  if exists (select 1 from public.daily_cash_records
      where outlet_id=v_outlet and business_date=v_date) then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused','commandId',p_command_id),v_date);
  end if;
  perform set_config('app.billing_command','1',true);
  begin
    v_number := public.billing_next_order_number(v_outlet, v_date);
    insert into public.orders (
      id, outlet_id, order_number, device_id, created_by, created_shift_id,
      ordered_at, business_date, customer_id, customer_name, customer_phone,
      subtotal_paise, discount_paise, tax_paise, total_paise, pricing_mode)
    values (
      v_order, v_outlet, v_number, auth.uid(), v_actor, p_shift_id,
      p_created_at, v_date, v_customer,
      nullif(p_payload ->> 'customerName',''), nullif(p_payload ->> 'customerPhone',''),
      (p_payload ->> 'subtotalPaise')::bigint,
      (p_payload ->> 'discountPaise')::bigint,
      (p_payload ->> 'taxPaise')::bigint,
      (p_payload ->> 'totalPaise')::bigint,
      (p_payload ->> 'pricingMode')::public.pricing_mode);

    insert into public.order_items
      (id, order_id, menu_item_id, item_name, unit_price_paise, quantity, line_total_paise)
    select (line ->> 'id')::uuid, v_order, nullif(line ->> 'menuItemId','')::uuid,
      line ->> 'itemName', (line ->> 'unitPricePaise')::bigint,
      (line ->> 'quantity')::integer, (line ->> 'lineTotalPaise')::bigint
      from jsonb_array_elements(p_payload -> 'lines') line;
  exception when unique_violation then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','identity_conflict','commandId',p_command_id), v_date);
  end;
  v_result := jsonb_build_object('status','accepted','commandId',p_command_id,
    'orderId',v_order,'orderNumber',v_number,'delayed',(v_context ->> 'delayed')::boolean);
  return public.billing_finish_command(p_command_id, v_result, v_date);
end;
$$;

create or replace function public.revise_billing_order(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_error text;
  v_context jsonb;
  v_claim jsonb;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_payload_date date;
  v_customer uuid;
  v_affected integer;
  v_result jsonb;
begin
  v_error := public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,
    p_created_at,p_payload,array['orderId','businessDate','customerId','customerName',
      'customerPhone','subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','lines']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context := public.billing_device_context(p_shift_id,p_created_at);
  if v_context ->> 'status' <> 'ok' then return v_context; end if;
  if not public.billing_content_payload_well_typed(p_payload) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if not coalesce(public.billing_validate_totals(p_payload),false) then
    return jsonb_build_object('status','arithmetic_invalid');
  end if;
  begin
    v_order_id:=(p_payload->>'orderId')::uuid;
    v_payload_date:=(p_payload->>'businessDate')::date;
    v_customer:=nullif(p_payload->>'customerId','')::uuid;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_order_id is null or v_payload_date is null then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_claim := public.billing_begin_command(p_command_id,'revise_order',p_schema_version,
    p_payload_hash,p_created_at,(v_context->>'outletId')::uuid,auth.uid(),p_shift_id,
    (v_context->>'actorId')::uuid);
  if v_claim ->> 'status' <> 'claimed' then return v_claim; end if;
  select * into v_order from public.orders where id=v_order_id for update;
  if not found or v_order.outlet_id <> (v_context->>'outletId')::uuid
     or v_order.device_id <> auth.uid() then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused','commandId',p_command_id));
  end if;
  if v_order.status <> 'open' then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','order_not_open','orderStatus',v_order.status,'commandId',p_command_id),
      v_order.business_date);
  end if;
  if p_created_at < v_order.ordered_at then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','malformed_payload','commandId',p_command_id),v_order.business_date);
  end if;
  if v_payload_date <> v_order.business_date
     or not coalesce(public.billing_validate_lines(
       p_payload->'lines',v_order.outlet_id,v_order.id),false) then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','arithmetic_invalid','commandId',p_command_id),v_order.business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  begin
  update public.orders set
    customer_id=v_customer,
    customer_name=nullif(p_payload->>'customerName',''),
    customer_phone=nullif(p_payload->>'customerPhone',''),
    subtotal_paise=(p_payload->>'subtotalPaise')::bigint,
    discount_paise=(p_payload->>'discountPaise')::bigint,
    tax_paise=(p_payload->>'taxPaise')::bigint,
    total_paise=(p_payload->>'totalPaise')::bigint,
    pricing_mode=(p_payload->>'pricingMode')::public.pricing_mode,
    changed_by=(v_context->>'actorId')::uuid,changed_shift_id=p_shift_id,changed_at=p_created_at
    where id=v_order.id;
  delete from public.order_items i where i.order_id=v_order.id
    and not exists (select 1 from jsonb_array_elements(p_payload->'lines') line
      where (line->>'id')::uuid=i.id);
  insert into public.order_items
    (id,order_id,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise)
  select (line->>'id')::uuid,v_order.id,nullif(line->>'menuItemId','')::uuid,
    line->>'itemName',(line->>'unitPricePaise')::bigint,(line->>'quantity')::integer,
    (line->>'lineTotalPaise')::bigint from jsonb_array_elements(p_payload->'lines') line
  on conflict (id) do update set quantity=excluded.quantity,line_total_paise=excluded.line_total_paise
    where public.order_items.order_id=excluded.order_id;
  get diagnostics v_affected = row_count;
  if v_affected <> jsonb_array_length(p_payload->'lines') then
    raise unique_violation;
  end if;
  exception when unique_violation then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','identity_conflict','commandId',p_command_id),v_order.business_date);
  end;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'orderId',v_order.id,
    'orderNumber',v_order.order_number,'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_order.business_date);
end;
$$;

create or replace function public.cancel_billing_order(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_error text; v_context jsonb; v_claim jsonb; v_order public.orders%rowtype;
  v_order_id uuid; v_reason text;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['orderId','reason']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'reason')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  begin
    v_order_id:=(p_payload->>'orderId')::uuid;
    v_reason:=btrim(p_payload->>'reason');
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_order_id is null or v_reason is null or length(v_reason)=0 then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context:=public.billing_device_context(p_shift_id,p_created_at);
  if v_context->>'status'<>'ok' then return v_context; end if;
  v_claim:=public.billing_begin_command(p_command_id,'cancel_order',p_schema_version,p_payload_hash,
    p_created_at,(v_context->>'outletId')::uuid,auth.uid(),p_shift_id,(v_context->>'actorId')::uuid);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;
  select * into v_order from public.orders where id=v_order_id for update;
  if not found or v_order.outlet_id<>(v_context->>'outletId')::uuid or v_order.device_id<>auth.uid() then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'));
  end if;
  if v_order.status<>'open' then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
      'orderStatus',v_order.status,'commandId',p_command_id),v_order.business_date);
  end if;
  if p_created_at < v_order.ordered_at then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','malformed_payload','commandId',p_command_id),v_order.business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  update public.orders set status='cancelled',cancelled_by=(v_context->>'actorId')::uuid,
    cancelled_device_id=auth.uid(),cancelled_shift_id=p_shift_id,cancelled_at=p_created_at,
    cancel_reason=v_reason where id=v_order.id;
  return public.billing_finish_command(p_command_id,jsonb_build_object('status','accepted',
    'commandId',p_command_id,'orderId',v_order.id,'orderNumber',v_order.order_number,
    'delayed',(v_context->>'delayed')::boolean),v_order.business_date);
end;
$$;

create or replace function public.pay_billing_order(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_error text; v_context jsonb; v_claim jsonb; v_order public.orders%rowtype;
  v_paid_at timestamptz; v_payment_date date; v_method public.payment_method;
  v_bill uuid; v_order_id uuid;
  v_number bigint; v_result jsonb;
  v_line_sum bigint;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['billId','orderId','paymentMethod','paidAt','paymentBusinessDate']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'billId')<>'string'
     or jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'paymentMethod')<>'string'
     or jsonb_typeof(p_payload->'paidAt')<>'string'
     or jsonb_typeof(p_payload->'paymentBusinessDate')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context:=public.billing_device_context(p_shift_id,p_created_at);
  if v_context->>'status'<>'ok' then return v_context; end if;
  begin
    v_bill:=(p_payload->>'billId')::uuid; v_order_id:=(p_payload->>'orderId')::uuid;
    v_paid_at:=(p_payload->>'paidAt')::timestamptz;
    v_payment_date:=(p_payload->>'paymentBusinessDate')::date;
    v_method:=(p_payload->>'paymentMethod')::public.payment_method;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_bill is null or v_order_id is null or v_paid_at is null
     or v_payment_date is null or v_method is null then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if abs(extract(epoch from (v_paid_at-p_created_at))) > 300
     or v_payment_date is distinct from (select public.app_business_date(v_paid_at,business_day_cutover)
       from public.outlets where id=(v_context->>'outletId')::uuid) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_claim:=public.billing_begin_command(p_command_id,'pay_order',p_schema_version,p_payload_hash,
    p_created_at,(v_context->>'outletId')::uuid,auth.uid(),p_shift_id,(v_context->>'actorId')::uuid);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;
  select * into v_order from public.orders where id=v_order_id for update;
  if not found or v_order.outlet_id<>(v_context->>'outletId')::uuid or v_order.device_id<>auth.uid() then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'));
  end if;
  if v_order.status<>'open' then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
      'orderStatus',v_order.status,'commandId',p_command_id),v_order.business_date,v_payment_date);
  end if;
  if v_paid_at < v_order.ordered_at or p_created_at < v_order.ordered_at then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','malformed_payload','commandId',p_command_id),
      v_order.business_date,v_payment_date);
  end if;
  select coalesce(sum(line_total_paise),0) into v_line_sum from public.order_items where order_id=v_order.id;
  if v_line_sum<>v_order.subtotal_paise or v_order.total_paise<0
     or v_order.total_paise<>v_order.subtotal_paise-v_order.discount_paise+v_order.tax_paise then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','arithmetic_invalid'),
      v_order.business_date,v_payment_date);
  end if;
  perform set_config('app.billing_command','1',true);
  insert into public.bills (
    id,outlet_id,business_date,payment_business_date,ordered_at,paid_at,order_id,
    biller_profile_id,counter_device_id,counter_shift_id,shift_id,customer_id,customer_name,
    customer_phone,subtotal_paise,discount_paise,tax_paise,total_paise,pricing_mode,
    payment_method,status,created_at,synced_at)
  values (v_bill,v_order.outlet_id,v_order.business_date,v_payment_date,v_order.ordered_at,v_paid_at,
    v_order.id,(v_context->>'actorId')::uuid,auth.uid(),p_shift_id,null,v_order.customer_id,
    v_order.customer_name,v_order.customer_phone,v_order.subtotal_paise,v_order.discount_paise,
    v_order.tax_paise,v_order.total_paise,v_order.pricing_mode,
    v_method,'settled',now(),now())
  returning bill_number into v_number;
  insert into public.bill_items (id,bill_id,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise)
    select gen_random_uuid(),v_bill,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise
      from public.order_items where order_id=v_order.id order by id;
  update public.orders set status='paid',paid_by=(v_context->>'actorId')::uuid,
    paid_shift_id=p_shift_id,paid_at=v_paid_at,bill_id=v_bill where id=v_order.id;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'orderId',v_order.id,
    'orderNumber',v_order.order_number,'billId',v_bill,'billNumber',v_number,
    'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_order.business_date,v_payment_date);
end;
$$;

create or replace function public.pay_billing_now(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_error text; v_context jsonb; v_claim jsonb; v_outlet uuid; v_bill uuid; v_customer uuid;
  v_method public.payment_method;
  v_date date; v_payment_date date; v_number bigint; v_result jsonb;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['billId','businessDate','paymentBusinessDate','customerId','customerName',
      'customerPhone','subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode',
      'paymentMethod','lines']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'billId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string'
     or jsonb_typeof(p_payload->'paymentBusinessDate')<>'string'
     or jsonb_typeof(p_payload->'paymentMethod')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context:=public.billing_device_context(p_shift_id,p_created_at);
  if v_context->>'status'<>'ok' then return v_context; end if;
  begin
    v_outlet:=(v_context->>'outletId')::uuid; v_bill:=(p_payload->>'billId')::uuid;
    v_customer:=nullif(p_payload->>'customerId','')::uuid;
    v_date:=(p_payload->>'businessDate')::date;
    v_payment_date:=(p_payload->>'paymentBusinessDate')::date;
    v_method:=(p_payload->>'paymentMethod')::public.payment_method;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_outlet is null or v_bill is null or v_date is null or v_payment_date is null
     or v_method is null or not public.billing_content_payload_well_typed(p_payload) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if v_date is distinct from (select public.app_business_date(p_created_at,business_day_cutover)
      from public.outlets where id=v_outlet)
     or v_payment_date is distinct from v_date then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if not coalesce(public.billing_validate_totals(p_payload),false)
     or not coalesce(public.billing_validate_lines(p_payload->'lines',v_outlet),false) then
    return jsonb_build_object('status','arithmetic_invalid');
  end if;
  v_claim:=public.billing_begin_command(p_command_id,'pay_now',p_schema_version,p_payload_hash,
    p_created_at,v_outlet,auth.uid(),p_shift_id,(v_context->>'actorId')::uuid);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;
  perform set_config('app.billing_command','1',true);
  begin
    insert into public.bills (
      id,outlet_id,business_date,payment_business_date,ordered_at,paid_at,order_id,
      biller_profile_id,counter_device_id,counter_shift_id,shift_id,customer_id,customer_name,
      customer_phone,subtotal_paise,discount_paise,tax_paise,total_paise,pricing_mode,
      payment_method,status,created_at,synced_at)
    values (v_bill,v_outlet,v_date,v_payment_date,p_created_at,p_created_at,null,
      (v_context->>'actorId')::uuid,auth.uid(),p_shift_id,null,
      v_customer,nullif(p_payload->>'customerName',''),
      nullif(p_payload->>'customerPhone',''),(p_payload->>'subtotalPaise')::bigint,
      (p_payload->>'discountPaise')::bigint,(p_payload->>'taxPaise')::bigint,
      (p_payload->>'totalPaise')::bigint,(p_payload->>'pricingMode')::public.pricing_mode,
      v_method,'settled',now(),now())
    returning bill_number into v_number;
    insert into public.bill_items
      (id,bill_id,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise)
    select (line->>'id')::uuid,v_bill,nullif(line->>'menuItemId','')::uuid,line->>'itemName',
      (line->>'unitPricePaise')::bigint,(line->>'quantity')::integer,
      (line->>'lineTotalPaise')::bigint from jsonb_array_elements(p_payload->'lines') line;
  exception when unique_violation then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','identity_conflict','commandId',p_command_id),v_date,v_payment_date);
  end;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'billId',v_bill,
    'billNumber',v_number,'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_date,v_payment_date);
end;
$$;

create or replace function public.manager_cancel_billing_order(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_error text; v_order public.orders%rowtype; v_claim jsonb; v_order_id uuid; v_reason text;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['orderId','reason']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'reason')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if p_shift_id is not null then return jsonb_build_object('status','malformed_payload'); end if;
  begin
    v_order_id:=(p_payload->>'orderId')::uuid;
    v_reason:=btrim(p_payload->>'reason');
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_order_id is null or v_reason is null or length(v_reason)=0 then
    return jsonb_build_object('status','malformed_payload');
  end if;
  select * into v_order from public.orders where id=v_order_id;
  if not found or not public.app_account_active()
     or not ((select public.app_is_owner())
       or public.app_has_role_at('franchise_admin',v_order.outlet_id)) then
    return jsonb_build_object('status','authorization_refused');
  end if;
  v_claim:=public.billing_begin_command(p_command_id,'manager_cancel_order',p_schema_version,
    p_payload_hash,p_created_at,v_order.outlet_id,null,null,auth.uid());
  if v_claim->>'status'<>'claimed' then return v_claim; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_order.outlet_id::text||':'||v_order.business_date::text,0));
  select * into v_order from public.orders where id=v_order.id for update;
  if v_order.status<>'open' then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
      'orderStatus',v_order.status,'commandId',p_command_id),v_order.business_date);
  end if;
  if p_created_at < v_order.ordered_at then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','malformed_payload','commandId',p_command_id),v_order.business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  update public.orders set status='cancelled',cancelled_by=auth.uid(),cancelled_at=p_created_at,
    cancel_reason=v_reason where id=v_order.id;
  return public.billing_finish_command(p_command_id,jsonb_build_object('status','accepted',
    'commandId',p_command_id,'orderId',v_order.id,'orderNumber',v_order.order_number),v_order.business_date);
end;
$$;

create or replace function public.void_billing_bill(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_error text; v_bill public.bills%rowtype; v_claim jsonb; v_bill_id uuid; v_reason text;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['billId','reason']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'billId')<>'string'
     or jsonb_typeof(p_payload->'reason')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if p_shift_id is not null then return jsonb_build_object('status','malformed_payload'); end if;
  begin
    v_bill_id:=(p_payload->>'billId')::uuid;
    v_reason:=btrim(p_payload->>'reason');
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_bill_id is null or v_reason is null or length(v_reason)=0 then
    return jsonb_build_object('status','malformed_payload');
  end if;
  select * into v_bill from public.bills where id=v_bill_id;
  if not found or not public.app_account_active()
     or not ((select public.app_is_owner())
       or public.app_has_role_at('franchise_admin',v_bill.outlet_id)) then
    return jsonb_build_object('status','authorization_refused');
  end if;
  v_claim:=public.billing_begin_command(p_command_id,'void_bill',p_schema_version,p_payload_hash,
    p_created_at,v_bill.outlet_id,null,null,auth.uid());
  if v_claim->>'status'<>'claimed' then return v_claim; end if;
  if p_created_at < v_bill.paid_at then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','malformed_payload','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  update public.bills set status='void',voided_by=auth.uid(),voided_at=p_created_at,
    void_reason=v_reason where id=v_bill.id and status='settled';
  if not found then return public.billing_finish_command(p_command_id,
    jsonb_build_object('status','order_not_open','commandId',p_command_id),v_bill.business_date,
    v_bill.payment_business_date); end if;
  return public.billing_finish_command(p_command_id,jsonb_build_object('status','accepted',
    'commandId',p_command_id,'billId',v_bill.id,'billNumber',v_bill.bill_number),
    v_bill.business_date,v_bill.payment_business_date);
end;
$$;

-- End of day ---------------------------------------------------------------

create or replace function public.billing_day_readiness(
  p_outlet_id uuid,
  p_business_date date
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_open integer; v_live integer; v_missing integer; v_stale integer;
begin
  if auth.uid() is null or not coalesce((
    (public.app_device_ok() and public.app_counter_device_outlet()=p_outlet_id)
    or (public.app_account_active() and (
      (select public.app_is_owner())
      or public.app_has_role_at('franchise_admin',p_outlet_id)))),false) then
    return jsonb_build_object('status','authorization_refused');
  end if;
  select count(*) into v_open from public.orders
    where outlet_id=p_outlet_id and business_date=p_business_date and status='open';
  select count(*) into v_live from public.counter_shifts
    where outlet_id=p_outlet_id and business_date=p_business_date
      and ended_at is null and expires_at>now();
  with participating as (
    select distinct device_id from public.counter_shifts
      where outlet_id=p_outlet_id and business_date=p_business_date
  )
  select count(*) into v_missing from participating p
    where not exists (select 1 from public.billing_end_of_day_confirmations c
      where c.device_id=p.device_id and c.business_date=p_business_date);
  with participating as (
    select distinct device_id from public.counter_shifts
      where outlet_id=p_outlet_id and business_date=p_business_date
  )
  select count(*) into v_stale from participating p
    join public.billing_end_of_day_confirmations c
      on c.device_id=p.device_id and c.business_date=p_business_date
    where c.invalidated_at is not null
      or c.shift_id is distinct from (select s.id from public.counter_shifts s
        where s.device_id=p.device_id and s.business_date=p_business_date
        order by s.opened_at desc,s.id desc limit 1)
      or c.command_watermark < coalesce((
      select max(b.watermark) from public.billing_commands b
       where b.device_id=p.device_id and b.result_category='accepted'
         and b.command_type<>'confirm_end_of_day'
         and p_business_date in (b.business_date,b.payment_business_date)),0);
  return jsonb_build_object('status','ok','ready',v_open=0 and v_live=0 and v_missing=0 and v_stale=0,
    'openOrders',v_open,'liveShifts',v_live,'missingConfirmations',v_missing,
    'staleConfirmations',v_stale);
end;
$$;

create or replace function public.confirm_billing_end_of_day(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_error text; v_device public.counter_devices%rowtype; v_outlet uuid; v_date date;
  v_unsent integer; v_needs_attention integer; v_shift uuid; v_claim jsonb;
  v_result jsonb; v_watermark bigint;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['outletId','businessDate','unsentCount','needsAttentionCount']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'outletId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string'
     or jsonb_typeof(p_payload->'unsentCount')<>'number'
     or jsonb_typeof(p_payload->'needsAttentionCount')<>'number' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if p_shift_id is not null then return jsonb_build_object('status','malformed_payload'); end if;
  select * into v_device from public.counter_devices where id=auth.uid() and removed_at is null;
  if not found then return jsonb_build_object('status','removed_tablet'); end if;
  begin
    v_outlet:=(p_payload->>'outletId')::uuid;
    v_date:=(p_payload->>'businessDate')::date;
    v_unsent:=(p_payload->>'unsentCount')::integer;
    v_needs_attention:=(p_payload->>'needsAttentionCount')::integer;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_outlet is null or v_date is null or v_unsent is null or v_needs_attention is null
     or v_outlet<>v_device.outlet_id or v_unsent<0 or v_needs_attention<0 then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if v_unsent<>0 or v_needs_attention<>0 then
    return jsonb_build_object('status','unresolved_operations');
  end if;
  v_claim:=public.billing_begin_command(p_command_id,'confirm_end_of_day',p_schema_version,
    p_payload_hash,p_created_at,v_device.outlet_id,v_device.id,null,null);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_device.outlet_id::text||':'||v_date::text,0));
  select id into v_shift from public.counter_shifts
    where device_id=v_device.id and business_date=v_date
    order by opened_at desc,id desc limit 1;
  if not found then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused','commandId',p_command_id),v_date);
  end if;
  if exists (select 1 from public.counter_shifts where device_id=v_device.id
      and business_date=v_date and ended_at is null and expires_at>now()) then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused','commandId',p_command_id),v_date);
  end if;
  select watermark into v_watermark from public.billing_commands where id=p_command_id;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,
    'businessDate',v_date,'watermark',v_watermark);
  perform public.billing_finish_command(p_command_id,v_result,v_date);
  insert into public.billing_end_of_day_confirmations
    (outlet_id,device_id,business_date,shift_id,confirmed_at,command_watermark)
  values (v_device.outlet_id,v_device.id,v_date,v_shift,now(),v_watermark)
  on conflict (device_id,business_date) do update set confirmed_at=excluded.confirmed_at,
    shift_id=excluded.shift_id,command_watermark=excluded.command_watermark,
    invalidated_at=null,invalidated_by_command_id=null;
  return v_result;
end;
$$;

create or replace function public.billing_assert_day_ready(p_outlet_id uuid,p_business_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_state jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text||':'||p_business_date::text,0));
  v_state:=public.billing_day_readiness(p_outlet_id,p_business_date);
  if coalesce((v_state->>'ready')::boolean,false) is not true then
    raise exception 'business day is not billing-ready: %',v_state using errcode='P0001';
  end if;
end;
$$;

-- A closed day cannot be reopened by racing a new shift against the close.
create or replace function public.counter_shift_closed_day_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    new.outlet_id::text||':'||new.business_date::text,0));
  if exists (select 1 from public.daily_cash_records r
    where r.outlet_id=new.outlet_id and r.business_date=new.business_date) then
    raise exception 'business day is already closed';
  end if;
  return new;
end;
$$;
create trigger counter_shifts_closed_day_guard
  before insert on public.counter_shifts
  for each row execute function public.counter_shift_closed_day_guard();

-- Rebuild day close on the two-date contract and lock/recheck billing readiness
-- in the same transaction as the immutable drawer snapshot.
create or replace function public.close_business_day(
  p_outlet_id uuid,
  p_business_date date,
  p_opening_cash_paise bigint,
  p_actual_closing_paise bigint,
  p_notes text default null
)
returns public.daily_cash_records
language plpgsql security definer set search_path = '' as $$
declare v_sales bigint; v_expenses bigint; v_withdrawn bigint; v_expected bigint;
  v_record public.daily_cash_records%rowtype;
begin
  if auth.uid() is null or not public.app_account_active()
     or not public.app_has_role_at('franchise_admin',p_outlet_id) then
    raise exception 'only an active franchise admin of this outlet may close its business day';
  end if;
  if p_opening_cash_paise is null or p_opening_cash_paise<0
     or p_actual_closing_paise is null or p_actual_closing_paise<0 then
    raise exception 'opening and counted closing cash must be non-negative paise amounts';
  end if;
  perform public.billing_assert_day_ready(p_outlet_id,p_business_date);
  select coalesce(sum(total_paise),0) into v_sales from public.bills
    where outlet_id=p_outlet_id and payment_business_date=p_business_date
      and payment_method='cash' and status='settled';
  select coalesce(sum(amount_paise),0) into v_expenses from public.expenses
    where outlet_id=p_outlet_id and business_date=p_business_date and payment_method='cash';
  select coalesce(sum(amount_paise),0) into v_withdrawn from public.cash_withdrawals
    where outlet_id=p_outlet_id and business_date=p_business_date;
  v_expected:=p_opening_cash_paise+v_sales-v_expenses-v_withdrawn;
  insert into public.daily_cash_records(outlet_id,business_date,opening_cash_paise,
    cash_sales_paise,cash_expenses_paise,cash_withdrawn_paise,expected_closing_paise,
    actual_closing_paise,difference_paise,closed_by,notes)
  values(p_outlet_id,p_business_date,p_opening_cash_paise,v_sales,v_expenses,v_withdrawn,
    v_expected,p_actual_closing_paise,p_actual_closing_paise-v_expected,auth.uid(),p_notes)
  returning * into v_record;
  return v_record;
exception when unique_violation then
  raise exception 'business day % is already closed for this outlet',p_business_date;
end;
$$;

-- Policies and privileges ---------------------------------------------------

create policy orders_select on public.orders for select to authenticated using (
  public.app_device_ok() and (
    device_id=auth.uid()
    or (public.app_account_active() and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));
create policy order_items_select on public.order_items for select to authenticated using (
  exists (select 1 from public.orders o where o.id=order_id));
create policy billing_commands_select on public.billing_commands for select to authenticated using (
  public.app_device_ok() and (
    device_id=auth.uid()
    or (public.app_account_active() and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));
create policy billing_end_of_day_confirmations_select
  on public.billing_end_of_day_confirmations for select to authenticated using (
    public.app_device_ok() and (
      device_id=auth.uid()
      or (public.app_account_active() and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

drop policy if exists bills_insert on public.bills;
drop policy if exists bills_update on public.bills;
drop policy if exists bill_items_insert on public.bill_items;
drop policy if exists bills_select on public.bills;
create policy bills_select on public.bills for select to authenticated using (
  public.app_device_ok() and (
    (counter_device_id=auth.uid()
      and counter_shift_id=(select public.app_counter_shift()))
    or (public.app_account_active() and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

grant select on public.orders,public.order_items,public.billing_commands,
  public.billing_end_of_day_confirmations to authenticated;
grant all on public.order_number_counters,public.orders,public.order_items,
  public.billing_commands,public.billing_end_of_day_confirmations to service_role;
revoke all on public.order_number_counters from authenticated,anon;
revoke insert,update,delete on public.orders,public.order_items,public.billing_commands,
  public.billing_end_of_day_confirmations,public.bills,public.bill_items from authenticated,anon;

-- Public helpers are callable only where the contract requires them. Internal
-- validators retain no client execute grant; command functions and readiness do.
revoke execute on function public.billing_canonical_json(jsonb),public.billing_payload_hash(jsonb),
  public.billing_payload_has_keys(jsonb,text[]),
  public.billing_envelope_error(uuid,integer,text,timestamptz,jsonb,text[]),
  public.billing_device_context(uuid,timestamptz),public.billing_validate_totals(jsonb),
  public.billing_content_payload_well_typed(jsonb),
  public.billing_validate_lines(jsonb,uuid,uuid),public.billing_next_order_number(uuid,date),
  public.billing_begin_command(uuid,text,integer,text,timestamptz,uuid,uuid,uuid,uuid),
  public.billing_finish_command(uuid,jsonb,date,date),public.billing_assert_day_ready(uuid,date)
  from public,anon,authenticated;
grant execute on function public.billing_payload_hash(jsonb) to authenticated;
grant execute on function public.create_billing_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.revise_billing_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.cancel_billing_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.pay_billing_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.pay_billing_now(uuid,integer,text,timestamptz,uuid,jsonb),
  public.manager_cancel_billing_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.void_billing_bill(uuid,integer,text,timestamptz,uuid,jsonb),
  public.confirm_billing_end_of_day(uuid,integer,text,timestamptz,uuid,jsonb),
  public.billing_day_readiness(uuid,date) to authenticated;

revoke execute on function public.create_billing_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.revise_billing_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.cancel_billing_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.pay_billing_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.pay_billing_now(uuid,integer,text,timestamptz,uuid,jsonb),
  public.manager_cancel_billing_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.void_billing_bill(uuid,integer,text,timestamptz,uuid,jsonb),
  public.confirm_billing_end_of_day(uuid,integer,text,timestamptz,uuid,jsonb),
  public.billing_day_readiness(uuid,date) from public,anon;
