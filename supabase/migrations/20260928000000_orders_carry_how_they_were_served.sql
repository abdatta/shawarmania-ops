-- each-outlet-chooses-how-it-serves (#60), section 4: orders and bills carry
-- how they were served.
--
-- An order records whether it was dine-in, takeaway or neither, and a dine-in
-- order may record a table (design D2). A line records whether it is an item or
-- the packaging (D3), and a gold member's waived packaging is that line's whole
-- discount (D4). Two open orders on one table are recorded, never refused (D5,
-- D11). The command boundary accepts a third payload shape carrying all of it,
-- and still the two before it (D7), and checks the new facts for shape only,
-- never against what the outlet currently offers (D8).
--
-- Every one of these is a snapshot, like the lines and the tier: no later
-- settings change rewrites an order, and payment fixes them with everything
-- else on it.

-- ---------------------------------------------------------------------------
-- 1. Where the facts live.

create type public.service_type as enum ('dine_in', 'takeaway');
create type public.line_kind as enum ('item', 'packaging');

alter table public.orders
  -- Null is neither: an outlet that chose nothing, and every order before #60.
  add column service_type public.service_type,
  add column table_number smallint,
  -- Telemetry about the order, never a refusal of it (D11). Set by
  -- `orders_mark_shared_table` below and never unset.
  add column table_shared boolean not null default false,
  add constraint orders_table_number_range check (table_number between 1 and 999),
  add constraint orders_table_needs_dine_in
    check (table_number is null or service_type = 'dine_in');

alter table public.bills
  add column service_type public.service_type,
  add column table_number smallint,
  add constraint bills_table_number_range check (table_number between 1 and 999),
  add constraint bills_table_needs_dine_in
    check (table_number is null or service_type = 'dine_in');

-- A packaging line has no menu item and no category, so no menu discount can
-- reach it, and its discount is nothing or the whole line at 100%: on a
-- packaging line a discount *is* the gold waiver, and nothing else can put one
-- there (D4).
alter table public.order_items
  add column kind public.line_kind not null default 'item',
  add constraint order_items_packaging_shape check (
    kind <> 'packaging'
    or (menu_item_id is null and category_name is null
        and ((discount_paise = 0 and discount_percent_bp is null)
             or (discount_paise = line_total_paise and discount_percent_bp = 10000))));

alter table public.bill_items
  add column kind public.line_kind not null default 'item',
  add constraint bill_items_packaging_shape check (
    kind <> 'packaging'
    or (menu_item_id is null and category_name is null
        and ((discount_paise = 0 and discount_percent_bp is null)
             or (discount_paise = line_total_paise and discount_percent_bp = 10000))));

create unique index order_items_one_packaging_line
  on public.order_items (order_id) where kind = 'packaging';
create unique index bill_items_one_packaging_line
  on public.bill_items (bill_id) where kind = 'packaging';

comment on column public.orders.service_type is
  'How the order was served (#60): dine-in, takeaway, or null for neither. A snapshot; fixed at payment.';
comment on column public.orders.table_number is
  'The table a dine-in order was keyed to, 1 to 999 (#60). What the counter calls the order; the order number is still its identity.';
comment on column public.orders.table_shared is
  'Set when a write left two or more open orders at this outlet on this table (#60, D11). Never unset.';
comment on column public.bills.service_type is
  'Copied from the order, or from a direct sale''s own payload (#60).';
comment on column public.bills.table_number is
  'Copied from the order, or from a direct sale''s own payload (#60).';
comment on column public.order_items.kind is
  'An item from the menu, or the packaging (#60). A packaging line''s discount is the gold waiver.';
comment on column public.bill_items.kind is
  'An item from the menu, or the packaging (#60). A packaging line''s discount is the gold waiver.';

-- ---------------------------------------------------------------------------
-- 2. What a revision may change.
--
-- Reproduced from `20260822000000_preparing_order_pipeline.sql` with four
-- columns added to the open order's list: the type and the table, which move
-- while the order is open (D2); the shared mark, which the trigger below sets
-- on an open order; and **`rounding_paise`, which was never on it**. The list
-- predates the rounding line (#53), so since then any revision that moved an
-- order's rounding — an item added to an order with a percentage off the bill —
-- raised here, and the till read the refusal as a malformed edit. Nothing about
-- a paid or cancelled order moves.

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
  if old.status = 'cancelled' then
    raise exception 'paid and cancelled orders are immutable';
  end if;
  if old.status = 'paid' then
    if new.status = 'open' then
      -- The payment unwind: status and the paid-attribution pair leave together.
      if (to_jsonb(new) - array['status','paid_by','paid_shift_id','paid_at','bill_id'])
         is distinct from
         (to_jsonb(old) - array['status','paid_by','paid_shift_id','paid_at','bill_id']) then
        raise exception 'payment unwind changed order facts';
      end if;
      return new;
    end if;
    if new.status = 'cancelled' then
      -- Cancel-after-paid: the paid attribution clears (the pairing
      -- constraints require it) and the cancellation attribution arrives, in
      -- the same transaction as its bill's void.
      if (to_jsonb(new) - array['status','paid_by','paid_shift_id','paid_at','bill_id',
          'cancelled_by','cancelled_device_id','cancelled_shift_id','cancelled_at','cancel_reason'])
         is distinct from
         (to_jsonb(old) - array['status','paid_by','paid_shift_id','paid_at','bill_id',
          'cancelled_by','cancelled_device_id','cancelled_shift_id','cancelled_at','cancel_reason']) then
        raise exception 'cancellation changed order facts';
      end if;
      return new;
    end if;
    -- Remaining paid: only preparation may move, for the upfront payer.
    if new.status <> 'paid' then
      raise exception 'invalid order transition';
    end if;
    if (to_jsonb(new) - array['prepared_at'])
       is distinct from
       (to_jsonb(old) - array['prepared_at']) then
      raise exception 'payment changed order facts';
    end if;
    return new;
  end if;
  if new.status = 'open' then
    if (to_jsonb(new) - array['customer_id','customer_name','customer_phone',
        'subtotal_paise','discount_paise','tax_paise','rounding_paise','total_paise','pricing_mode',
        'changed_by','changed_shift_id','changed_at','prepared_at',
        'service_type','table_number','table_shared'])
       is distinct from
       (to_jsonb(old) - array['customer_id','customer_name','customer_phone',
        'subtotal_paise','discount_paise','tax_paise','rounding_paise','total_paise','pricing_mode',
        'changed_by','changed_shift_id','changed_at','prepared_at',
        'service_type','table_number','table_shared']) then
      raise exception 'revision changed immutable order facts';
    end if;
  elsif new.status = 'paid' then
    if (to_jsonb(new) - array['status','paid_by','paid_shift_id','paid_at','bill_id','prepared_at'])
       is distinct from
       (to_jsonb(old) - array['status','paid_by','paid_shift_id','paid_at','bill_id','prepared_at']) then
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

-- ---------------------------------------------------------------------------
-- 2b. A revision's discount records are actually replaced.
--
-- `billing_discount_insert_guard` also guards DELETE and UPDATE on the
-- discount tables, and it ended in `return new`. On a DELETE `new` is null, and
-- a BEFORE trigger that returns null silently cancels the delete. So since #53
-- a revision's "replaced wholesale" left the old records beside the new ones,
-- and the deferred parts-equal-the-whole guard refused the revision at commit:
-- **an order saved with a bill discount could not be edited**, not even to
-- remove it. Found by this change's own tests, which revise such an order.
-- Nothing is lost by it — the refused revision never committed — and the fix is
-- the return the other guards already make.

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
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Two open orders on one table are recorded (D11).
--
-- A trigger, as #57's tier snapshot is, so the rule lives in one place and the
-- functions that carry the money are not reproduced to add it: a create, a
-- revision, and a payment taken back (the case the owner found) all reach it by
-- writing an open order that has a table. It runs inside that write's
-- transaction, and it never refuses anything.
--
-- **Serialised per table, and it never waits on another order's row.** The
-- advisory lock is taken before counting, so two tablets seating one table at
-- once are counted one after the other and the second always sees the first.
-- The other orders are marked with SKIP LOCKED: waiting for a row another
-- write holds, while that write waits for this lock, would deadlock two sales
-- over a label. A row skipped here is mid-write in its own transaction, and
-- that write, if it leaves the order open at this table, runs this trigger
-- itself once this one commits, sees this order, and marks itself. The one
-- case left unmarked is an order paid or cancelled in the same instant, which
-- had left the table by the time either write finished.
--
-- Two triggers because an insert has no OLD. The update one skips its own
-- marking, so marking another order cannot recurse.

create or replace function public.orders_mark_shared_table()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.outlet_id::text || ':table:' || new.table_number::text, 0));

  if (select count(*) from public.orders o
       where o.outlet_id = new.outlet_id
         and o.table_number = new.table_number
         and o.status = 'open') >= 2 then
    update public.orders o
       set table_shared = true
     where o.id in (
       select candidate.id from public.orders candidate
        where candidate.outlet_id = new.outlet_id
          and candidate.table_number = new.table_number
          and candidate.status = 'open'
          and not candidate.table_shared
          for update skip locked);
  end if;
  return null;
end;
$$;

create trigger orders_mark_shared_table_on_insert
  after insert on public.orders
  for each row
  when (new.status = 'open' and new.table_number is not null)
  execute function public.orders_mark_shared_table();

create trigger orders_mark_shared_table_on_update
  after update on public.orders
  for each row
  when (new.status = 'open' and new.table_number is not null
        and old.table_shared is not distinct from new.table_shared)
  execute function public.orders_mark_shared_table();

-- ---------------------------------------------------------------------------
-- 4. The envelope learns the third shape.
--
-- Dropped and recreated, as `20260903000002` did, because another parameter
-- would otherwise be an overload and every existing call ambiguous. The
-- default on `p_v3_keys` keeps every command whose payload did not change
-- accepting the identical shape under all three versions.

drop function if exists public.billing_envelope_error(
  uuid, integer, text, timestamptz, jsonb, text[], text[]);

create or replace function public.billing_envelope_error(
  p_command_id uuid,
  p_schema_version integer,
  p_payload_hash text,
  p_created_at timestamptz,
  p_payload jsonb,
  p_keys text[],
  p_extra_keys text[] default '{}'::text[],
  p_v3_keys text[] default '{}'::text[]
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_shape_ok boolean;
begin
  if p_schema_version is null or p_schema_version not in (1, 2, 3) then
    return case when p_schema_version is null then 'malformed_payload'
                else 'unsupported_schema' end;
  end if;
  if p_command_id is null or p_payload_hash is null
     or p_created_at is null or p_payload is null then
    return 'malformed_payload';
  end if;

  -- The version names the shape, so an envelope carrying another version's keys
  -- is malformed rather than quietly accepted: the hash was computed over one of
  -- them and only one can be right.
  v_shape_ok := case p_schema_version
    when 1 then public.billing_payload_has_keys(p_payload, p_keys)
    when 2 then public.billing_payload_has_keys(p_payload, p_keys || p_extra_keys)
    else public.billing_payload_has_keys(p_payload, p_keys || p_extra_keys || p_v3_keys)
  end;

  if not v_shape_ok then
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

-- ---------------------------------------------------------------------------
-- 5. The new facts' shape (D8).
--
-- Checked for shape and never against the outlet's current choices: an offline
-- tablet may have rung a dine-in order before the owner stopped offering it,
-- and a setting is how the counter behaves, not a rule about money.
--
-- Each cast is behind a CASE, which Postgres evaluates in order, so a value of
-- the wrong type is refused here rather than raising.

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
    -- Absent on a version-1 payload, and a number wherever it is present.
    and (p_payload -> 'roundingPaise' is null
         or (jsonb_typeof(p_payload -> 'roundingPaise') = 'number'
             and (p_payload ->> 'roundingPaise') ~ '^-?[0-9]+$'))
    and (p_payload -> 'discounts' is null
         or (jsonb_typeof(p_payload -> 'discounts') = 'array'
             and not exists (
               select 1 from jsonb_array_elements(p_payload -> 'discounts') d
                where jsonb_typeof(d) <> 'object'
                   or d ->> 'basis' not in ('percent','amount')
                   or jsonb_typeof(d -> 'valueBp') not in ('null','number')
                   or jsonb_typeof(d -> 'valuePaise') not in ('null','number')
                   or jsonb_typeof(d -> 'amountPaise') <> 'number'
                   or (d ->> 'amountPaise') !~ '^[0-9]+$'
                   or (d ->> 'amountPaise')::bigint <= 0
                   -- The basis names which value is present, and only one is.
                   or (d ->> 'basis' = 'percent'
                       and (jsonb_typeof(d -> 'valueBp') <> 'number'
                            or jsonb_typeof(d -> 'valuePaise') <> 'null'))
                   or (d ->> 'basis' = 'amount'
                       and (jsonb_typeof(d -> 'valuePaise') <> 'number'
                            or jsonb_typeof(d -> 'valueBp') <> 'null')))))
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
          or (line -> 'discountPaise' is not null
              and (jsonb_typeof(line -> 'discountPaise') <> 'number'
                   or (line ->> 'discountPaise') !~ '^[0-9]+$'))
          or (line -> 'discountPercentBp' is not null
              and jsonb_typeof(line -> 'discountPercentBp') not in ('null','number'))
          or (line -> 'categoryName' is not null
              and jsonb_typeof(line -> 'categoryName') not in ('null','string')))

    -- #60: absent on versions 1 and 2, which read as neither and no table.
    and (p_payload -> 'serviceType' is null
         or jsonb_typeof(p_payload -> 'serviceType') = 'null'
         or (jsonb_typeof(p_payload -> 'serviceType') = 'string'
             and p_payload ->> 'serviceType' in ('dine_in','takeaway')))
    and (p_payload -> 'tableNumber' is null
         or jsonb_typeof(p_payload -> 'tableNumber') = 'null'
         or (jsonb_typeof(p_payload -> 'tableNumber') = 'number'
             and case when (p_payload ->> 'tableNumber') ~ '^[0-9]{1,3}$'
                      then (p_payload ->> 'tableNumber')::integer between 1 and 999
                      else false end
             -- A table only on a dine-in order.
             and p_payload ->> 'serviceType' is not distinct from 'dine_in'))
    and not exists (
      select 1 from jsonb_array_elements(p_payload -> 'lines') line
       where line -> 'kind' is not null
         and (jsonb_typeof(line -> 'kind') <> 'string'
              or line ->> 'kind' not in ('item','packaging')))
    -- At most one packaging line.
    and (select count(*) from jsonb_array_elements(p_payload -> 'lines') line
          where line ->> 'kind' = 'packaging') <= 1
    and not exists (
      select 1 from jsonb_array_elements(p_payload -> 'lines') line
       where line ->> 'kind' = 'packaging'
         and (coalesce(line ->> 'menuItemId', '') <> ''
              or coalesce(line ->> 'categoryName', '') <> ''
              or line ->> 'itemName' is distinct from 'Packaging'
              -- Nothing, or the whole line at 100%: the waiver and only it.
              or not case
                   when coalesce((line ->> 'discountPaise')::numeric, 0) = 0
                     then jsonb_typeof(line -> 'discountPercentBp') is not distinct from 'null'
                          or line -> 'discountPercentBp' is null
                   when jsonb_typeof(line -> 'discountPercentBp') = 'number'
                     then (line ->> 'discountPaise')::numeric = (line ->> 'lineTotalPaise')::numeric
                          and (line ->> 'discountPercentBp')::numeric = 10000
                   else false
                 end))
    -- An item line cannot pass itself off as a waiver: menu discounts reach a
    -- line through its category, so a 100% discount with none is not one.
    and not exists (
      select 1 from jsonb_array_elements(p_payload -> 'lines') line
       where line ->> 'kind' = 'item'
         and coalesce(line ->> 'categoryName', '') = ''
         and case when jsonb_typeof(line -> 'discountPercentBp') = 'number'
                  then (line ->> 'discountPercentBp')::numeric = 10000
                  else false end),
    false);
$$;

-- ---------------------------------------------------------------------------
-- 6. A packaging line is checked the way a menu line is (D8).
--
-- The menu path, read: a **new** line must match the menu as it stands when
-- the command arrives — its name and its current price — and is refused as
-- `arithmetic_invalid` otherwise, while a line already on the order is
-- compared by identity and keeps the price it was captured at. So a menu price
-- change already races an offline tablet: a queued order that adds a line at
-- the old price is refused and waits for the biller (docs/LIMITATIONS.md). A
-- new packaging line meets exactly that rule against the outlet's charge, and a
-- packaging price change races an offline tablet exactly as a menu price does.
--
-- The line's own key set gains the third shape, and an existing line's kind is
-- part of its identity.

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
  v_discount bigint;
  v_kind text;
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
    if not (
      public.billing_payload_has_keys(v_line, array[
        'id', 'menuItemId', 'itemName', 'unitPricePaise', 'quantity', 'lineTotalPaise'])
      or public.billing_payload_has_keys(v_line, array[
        'id', 'menuItemId', 'itemName', 'unitPricePaise', 'quantity', 'lineTotalPaise',
        'discountPaise', 'discountPercentBp', 'categoryName'])
      or public.billing_payload_has_keys(v_line, array[
        'id', 'menuItemId', 'itemName', 'unitPricePaise', 'quantity', 'lineTotalPaise',
        'discountPaise', 'discountPercentBp', 'categoryName', 'kind'])
    ) then
      return false;
    end if;
    v_id := (v_line ->> 'id')::uuid;
    v_menu_id := nullif(v_line ->> 'menuItemId', '')::uuid;
    v_name := v_line ->> 'itemName';
    v_price := (v_line ->> 'unitPricePaise')::bigint;
    v_quantity := (v_line ->> 'quantity')::integer;
    v_total := (v_line ->> 'lineTotalPaise')::bigint;
    v_discount := coalesce((v_line ->> 'discountPaise')::bigint, 0);
    v_kind := coalesce(v_line ->> 'kind', 'item');
    if v_id is null or length(btrim(v_name)) = 0 or v_price < 0
       or v_quantity <= 0 or v_total <> v_price * v_quantity
       or v_discount < 0 or v_discount > v_total then
      return false;
    end if;

    select * into v_existing from public.order_items where id = v_id;
    if found then
      if p_order_id is null or v_existing.order_id is distinct from p_order_id
         or v_existing.menu_item_id is distinct from v_menu_id
         or v_existing.item_name is distinct from v_name
         or v_existing.unit_price_paise is distinct from v_price
         or v_existing.kind::text is distinct from v_kind then
        return false;
      end if;
    elsif v_kind = 'packaging' then
      -- The outlet's charge as it stands: on, at this price, and once per order
      -- where it is flat.
      if not exists (
        select 1 from public.outlets o
         where o.id = p_outlet_id
           and o.packaging_mode <> 'off'
           and o.packaging_price_paise = v_price
           and (o.packaging_mode = 'per_bag' or v_quantity = 1)
      ) then
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

-- ---------------------------------------------------------------------------
-- 7. The content commands.
--
-- Reproduced from `20260920000000_the_server_links_the_sale_to_the_customer.sql`
-- (create, revise, pay now) and `20260903000002_the_boundary_accepts_both_shapes.sql`
-- (pay an order), each changed in the same few places: the version-3 keys at
-- the envelope, the type and table on the row it writes, and each line's kind.
-- Absent keys read as null and `item`, so versions 1 and 2 write exactly what
-- they used to.

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
  v_existing public.billing_commands%rowtype;
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
      'subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','lines'],
    array['roundingPaise','discounts'],
    array['serviceType','tableNumber']);
  if v_error is not null then return jsonb_build_object('status', v_error); end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;

  v_context := public.billing_device_context(p_shift_id, p_created_at);
  if v_context ->> 'status' <> 'ok' then return v_context; end if;
  v_outlet := (v_context ->> 'outletId')::uuid;
  v_actor := (v_context ->> 'actorId')::uuid;

  select * into v_existing
    from public.billing_commands
   where id = p_command_id;
  if found then
    if v_existing.command_type is distinct from 'create_order'
       or v_existing.schema_version is distinct from p_schema_version
       or v_existing.payload_hash is distinct from p_payload_hash
       or v_existing.client_created_at is distinct from p_created_at
       or v_existing.outlet_id is distinct from v_outlet
       or v_existing.device_id is distinct from auth.uid()
       or v_existing.shift_id is distinct from p_shift_id
       or v_existing.actor_id is distinct from v_actor then
      return jsonb_build_object('status','identity_conflict','commandId',p_command_id);
    end if;
    if v_existing.result_category = 'accepted' then
      return jsonb_set(v_existing.result, '{status}', '"replay"'::jsonb, true);
    end if;
    return v_existing.result;
  end if;

  begin
    v_order := (p_payload ->> 'orderId')::uuid;
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
     or not coalesce(public.billing_validate_discounts(p_payload),false)
     or not coalesce(public.billing_validate_lines(p_payload -> 'lines', v_outlet),false) then
    return jsonb_build_object('status','arithmetic_invalid');
  end if;

  v_claim := public.billing_begin_command(p_command_id, 'create_order', p_schema_version,
    p_payload_hash, p_created_at, v_outlet, auth.uid(), p_shift_id, v_actor);
  if v_claim ->> 'status' <> 'claimed' then return v_claim; end if;

  -- **The server resolves the customer, from the phone this command carried.**
  -- After the claim and before any write: a failure here returns null and the
  -- sale proceeds without a link, because nothing about identifying somebody
  -- may refuse money. Deliberately NOT in the payload-parsing block above,
  -- where a raise becomes `malformed_payload` and the sale is lost.
  v_customer := public.customer_resolve_for_sale(
    p_payload ->> 'customerPhone', p_payload ->> 'customerName');
  perform pg_advisory_xact_lock(hashtextextended(v_outlet::text||':'||v_date::text,0));
  perform set_config('app.billing_command','1',true);
  begin
    v_number := public.billing_next_order_number(v_outlet, v_date);
    insert into public.orders (
      id, outlet_id, order_number, device_id, created_by, created_shift_id,
      ordered_at, business_date, customer_id, customer_name, customer_phone,
      subtotal_paise, discount_paise, tax_paise, rounding_paise, total_paise, pricing_mode,
      service_type, table_number)
    values (
      v_order, v_outlet, v_number, auth.uid(), v_actor, p_shift_id,
      p_created_at, v_date, v_customer,
      nullif(p_payload ->> 'customerName',''), nullif(p_payload ->> 'customerPhone',''),
      (p_payload ->> 'subtotalPaise')::bigint,
      (p_payload ->> 'discountPaise')::bigint,
      (p_payload ->> 'taxPaise')::bigint,
      coalesce((p_payload ->> 'roundingPaise')::bigint, 0),
      (p_payload ->> 'totalPaise')::bigint,
      (p_payload ->> 'pricingMode')::public.pricing_mode,
      (p_payload ->> 'serviceType')::public.service_type,
      (p_payload ->> 'tableNumber')::smallint);

    insert into public.order_items
      (id, order_id, menu_item_id, item_name, unit_price_paise, quantity, line_total_paise,
       discount_paise, discount_percent_bp, category_name, kind)
    select (line ->> 'id')::uuid, v_order, nullif(line ->> 'menuItemId','')::uuid,
      line ->> 'itemName', (line ->> 'unitPricePaise')::bigint,
      (line ->> 'quantity')::integer, (line ->> 'lineTotalPaise')::bigint,
      coalesce((line ->> 'discountPaise')::bigint, 0),
      nullif(line ->> 'discountPercentBp','')::integer,
      nullif(line ->> 'categoryName',''),
      coalesce(line ->> 'kind', 'item')::public.line_kind
      from jsonb_array_elements(p_payload -> 'lines') line;

    insert into public.order_discounts (order_id, outlet_id, basis, value_bp, value_paise, amount_paise)
    select v_order, v_outlet, (d ->> 'basis')::public.discount_basis,
      nullif(d ->> 'valueBp','')::integer, nullif(d ->> 'valuePaise','')::bigint,
      (d ->> 'amountPaise')::bigint
      from jsonb_array_elements(coalesce(p_payload -> 'discounts', '[]'::jsonb)) d;
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
      'customerPhone','subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','lines'],
    array['roundingPaise','discounts'],
    array['serviceType','tableNumber']);
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
  if not coalesce(public.billing_validate_totals(p_payload),false)
     or not coalesce(public.billing_validate_discounts(p_payload),false) then
    return jsonb_build_object('status','arithmetic_invalid','orderId',v_order.id,'orderNumber',v_order.order_number);
  end if;
  begin
    v_order_id:=(p_payload->>'orderId')::uuid;
    v_payload_date:=(p_payload->>'businessDate')::date;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_order_id is null or v_payload_date is null then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_claim := public.billing_begin_command(p_command_id,'revise_order',p_schema_version,
    p_payload_hash,p_created_at,(v_context->>'outletId')::uuid,auth.uid(),p_shift_id,
    (v_context->>'actorId')::uuid);
  if v_claim ->> 'status' <> 'claimed' then return v_claim; end if;

  -- **The server resolves the customer, from the phone this command carried.**
  -- After the claim and before any write: a failure here returns null and the
  -- sale proceeds without a link, because nothing about identifying somebody
  -- may refuse money. Deliberately NOT in the payload-parsing block above,
  -- where a raise becomes `malformed_payload` and the sale is lost.
  v_customer := public.customer_resolve_for_sale(
    p_payload ->> 'customerPhone', p_payload ->> 'customerName');
  select * into v_order from public.orders where id=v_order_id for update;
  if not found or v_order.outlet_id <> (v_context->>'outletId')::uuid
     or v_order.device_id <> auth.uid() then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused','commandId',p_command_id));
  end if;
  if v_order.status <> 'open' then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,'orderStatus',v_order.status,'commandId',p_command_id),
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
  -- A version-1 or version-2 revision carries no type or table, and so leaves
  -- the order's as they are rather than clearing them: it was written by a
  -- till that could not have meant to change what it did not know about.
  update public.orders set
    customer_id=v_customer,
    customer_name=nullif(p_payload->>'customerName',''),
    customer_phone=nullif(p_payload->>'customerPhone',''),
    subtotal_paise=(p_payload->>'subtotalPaise')::bigint,
    discount_paise=(p_payload->>'discountPaise')::bigint,
    tax_paise=(p_payload->>'taxPaise')::bigint,
    rounding_paise=coalesce((p_payload->>'roundingPaise')::bigint,0),
    total_paise=(p_payload->>'totalPaise')::bigint,
    pricing_mode=(p_payload->>'pricingMode')::public.pricing_mode,
    service_type=case when p_schema_version >= 3
                      then (p_payload->>'serviceType')::public.service_type
                      else service_type end,
    table_number=case when p_schema_version >= 3
                      then (p_payload->>'tableNumber')::smallint
                      else table_number end,
    changed_by=(v_context->>'actorId')::uuid,changed_shift_id=p_shift_id,changed_at=p_created_at
    where id=v_order.id;
  delete from public.order_items i where i.order_id=v_order.id
    and not exists (select 1 from jsonb_array_elements(p_payload->'lines') line
      where (line->>'id')::uuid=i.id);
  insert into public.order_items
    (id,order_id,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise,
     discount_paise,discount_percent_bp,category_name,kind)
  select (line->>'id')::uuid,v_order.id,nullif(line->>'menuItemId','')::uuid,
    line->>'itemName',(line->>'unitPricePaise')::bigint,(line->>'quantity')::integer,
    (line->>'lineTotalPaise')::bigint,
    coalesce((line->>'discountPaise')::bigint,0),
    nullif(line->>'discountPercentBp','')::integer,
    nullif(line->>'categoryName',''),
    coalesce(line->>'kind','item')::public.line_kind
    from jsonb_array_elements(p_payload->'lines') line
  on conflict (id) do update set quantity=excluded.quantity,line_total_paise=excluded.line_total_paise,
    discount_paise=excluded.discount_paise,discount_percent_bp=excluded.discount_percent_bp,
    category_name=excluded.category_name
    where public.order_items.order_id=excluded.order_id;
  get diagnostics v_affected = row_count;
  if v_affected <> jsonb_array_length(p_payload->'lines') then
    raise unique_violation;
  end if;

  -- An order's bill-level discounts are replaced wholesale, exactly as its
  -- lines are: a revision states the whole order, not a difference from it.
  delete from public.order_discounts where order_id = v_order.id;
  insert into public.order_discounts (order_id,outlet_id,basis,value_bp,value_paise,amount_paise)
  select v_order.id,v_order.outlet_id,(d->>'basis')::public.discount_basis,
    nullif(d->>'valueBp','')::integer,nullif(d->>'valuePaise','')::bigint,
    (d->>'amountPaise')::bigint
    from jsonb_array_elements(coalesce(p_payload->'discounts','[]'::jsonb)) d;
  exception when unique_violation then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','identity_conflict','commandId',p_command_id),v_order.business_date);
  end;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'orderId',v_order.id,
    'orderNumber',v_order.order_number,'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_order.business_date);
end;
$$;

create or replace function public.pay_billing_order(
  p_command_id uuid default null,p_schema_version integer default null,
  p_payload_hash text default null,p_created_at timestamptz default null,
  p_shift_id uuid default null,p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_error text; v_context jsonb; v_claim jsonb; v_order public.orders%rowtype;
  v_paid_at timestamptz; v_payment_date date; v_bill uuid; v_order_id uuid;
  v_number bigint; v_result jsonb; v_line_sum bigint; v_summary public.payment_method;
begin
  -- This payload carries no totals and no service facts: paying an order
  -- settles it at what it was saved with. So its shape is unchanged, and all
  -- three schema versions describe the same keys.
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['billId','orderId','payments','paidAt','paymentBusinessDate']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'billId')<>'string'
     or jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'payments')<>'array'
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
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_bill is null or v_order_id is null or v_paid_at is null or v_payment_date is null then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if abs(extract(epoch from (v_paid_at-p_created_at)))>300
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
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
      'orderStatus',v_order.status,'commandId',p_command_id),v_order.business_date,v_payment_date);
  end if;
  if v_paid_at<v_order.ordered_at or p_created_at<v_order.ordered_at then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','malformed_payload','commandId',p_command_id),
      v_order.business_date,v_payment_date);
  end if;
  select coalesce(sum(line_total_paise),0) into v_line_sum from public.order_items where order_id=v_order.id;
  if v_line_sum<>v_order.subtotal_paise or v_order.total_paise<0
     or v_order.total_paise<>v_order.subtotal_paise-v_order.discount_paise+v_order.tax_paise+v_order.rounding_paise
     or not coalesce(public.billing_validate_payments(p_payload->'payments',v_order.total_paise),false) then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','arithmetic_invalid','orderId',v_order.id,'orderNumber',v_order.order_number),
      v_order.business_date,v_payment_date);
  end if;
  if jsonb_array_length(p_payload->'payments')=1 then
    v_summary:=((p_payload->'payments'->0)->>'method')::public.payment_method;
  end if;
  perform set_config('app.billing_command','1',true);
  insert into public.bills (
    id,outlet_id,business_date,payment_business_date,ordered_at,paid_at,order_id,
    biller_profile_id,counter_device_id,counter_shift_id,shift_id,customer_id,customer_name,
    customer_phone,subtotal_paise,discount_paise,tax_paise,rounding_paise,total_paise,pricing_mode,
    payment_method,status,created_at,synced_at,service_type,table_number)
  values (v_bill,v_order.outlet_id,v_order.business_date,v_payment_date,v_order.ordered_at,v_paid_at,
    v_order.id,(v_context->>'actorId')::uuid,auth.uid(),p_shift_id,null,v_order.customer_id,
    v_order.customer_name,v_order.customer_phone,v_order.subtotal_paise,v_order.discount_paise,
    v_order.tax_paise,v_order.rounding_paise,v_order.total_paise,v_order.pricing_mode,v_summary,'settled',now(),now(),
    v_order.service_type,v_order.table_number)
  returning bill_number into v_number;
  insert into public.bill_payments (bill_id,outlet_id,method,amount_paise)
    select v_bill,v_order.outlet_id,(payment->>'method')::public.payment_method,
      (payment->>'amountPaise')::bigint from jsonb_array_elements(p_payload->'payments') payment;
  insert into public.bill_items (id,bill_id,menu_item_id,item_name,unit_price_paise,quantity,
    line_total_paise,discount_paise,discount_percent_bp,category_name,kind)
    select gen_random_uuid(),v_bill,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise,
      discount_paise,discount_percent_bp,category_name,kind
      from public.order_items where order_id=v_order.id order by id;
  -- Carried across with the lines, so the bill explains its own discount without
  -- reaching back to an order that is now history.
  insert into public.bill_discounts (bill_id,outlet_id,basis,value_bp,value_paise,amount_paise)
    select v_bill,v_order.outlet_id,basis,value_bp,value_paise,amount_paise
      from public.order_discounts where order_id=v_order.id order by id;
  update public.orders set status='paid',paid_by=(v_context->>'actorId')::uuid,
    paid_shift_id=p_shift_id,paid_at=v_paid_at,bill_id=v_bill where id=v_order.id;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'orderId',v_order.id,
    'orderNumber',v_order.order_number,'billId',v_bill,'billNumber',v_number,
    'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_order.business_date,v_payment_date);
end;
$$;

create or replace function public.pay_billing_now(
  p_command_id uuid default null,p_schema_version integer default null,
  p_payload_hash text default null,p_created_at timestamptz default null,
  p_shift_id uuid default null,p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_error text; v_context jsonb; v_claim jsonb; v_outlet uuid; v_bill uuid; v_customer uuid;
  v_summary public.payment_method; v_date date; v_payment_date date; v_number bigint; v_result jsonb;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['billId','businessDate','paymentBusinessDate','customerId','customerName',
      'customerPhone','subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode',
      'payments','lines'],
    array['roundingPaise','discounts'],
    array['serviceType','tableNumber']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'billId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string'
     or jsonb_typeof(p_payload->'paymentBusinessDate')<>'string'
     or jsonb_typeof(p_payload->'payments')<>'array' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context:=public.billing_device_context(p_shift_id,p_created_at);
  if v_context->>'status'<>'ok' then return v_context; end if;
  begin
    v_outlet:=(v_context->>'outletId')::uuid; v_bill:=(p_payload->>'billId')::uuid;
    v_date:=(p_payload->>'businessDate')::date;
    v_payment_date:=(p_payload->>'paymentBusinessDate')::date;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_outlet is null or v_bill is null or v_date is null or v_payment_date is null
     or not public.billing_content_payload_well_typed(p_payload) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if v_date is distinct from (select public.app_business_date(p_created_at,business_day_cutover)
      from public.outlets where id=v_outlet) or v_payment_date is distinct from v_date then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if not coalesce(public.billing_validate_totals(p_payload),false)
     or not coalesce(public.billing_validate_discounts(p_payload),false)
     or not coalesce(public.billing_validate_lines(p_payload->'lines',v_outlet),false)
     or not coalesce(public.billing_validate_payments(
       p_payload->'payments',(p_payload->>'totalPaise')::bigint),false) then
    return jsonb_build_object('status','arithmetic_invalid');
  end if;
  if jsonb_array_length(p_payload->'payments')=1 then
    v_summary:=((p_payload->'payments'->0)->>'method')::public.payment_method;
  end if;
  v_claim:=public.billing_begin_command(p_command_id,'pay_now',p_schema_version,p_payload_hash,
    p_created_at,v_outlet,auth.uid(),p_shift_id,(v_context->>'actorId')::uuid);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;

  -- **The server resolves the customer, from the phone this command carried.**
  -- After the claim and before any write: a failure here returns null and the
  -- sale proceeds without a link, because nothing about identifying somebody
  -- may refuse money. Deliberately NOT in the payload-parsing block above,
  -- where a raise becomes `malformed_payload` and the sale is lost.
  v_customer := public.customer_resolve_for_sale(
    p_payload ->> 'customerPhone', p_payload ->> 'customerName');
  perform set_config('app.billing_command','1',true);
  begin
    insert into public.bills (
      id,outlet_id,business_date,payment_business_date,ordered_at,paid_at,order_id,
      biller_profile_id,counter_device_id,counter_shift_id,shift_id,customer_id,customer_name,
      customer_phone,subtotal_paise,discount_paise,tax_paise,rounding_paise,total_paise,pricing_mode,
      payment_method,status,created_at,synced_at,service_type,table_number)
    values (v_bill,v_outlet,v_date,v_payment_date,p_created_at,p_created_at,null,
      (v_context->>'actorId')::uuid,auth.uid(),p_shift_id,null,v_customer,
      nullif(p_payload->>'customerName',''),nullif(p_payload->>'customerPhone',''),
      (p_payload->>'subtotalPaise')::bigint,(p_payload->>'discountPaise')::bigint,
      (p_payload->>'taxPaise')::bigint,coalesce((p_payload->>'roundingPaise')::bigint,0),
      (p_payload->>'totalPaise')::bigint,
      (p_payload->>'pricingMode')::public.pricing_mode,v_summary,'settled',now(),now(),
      (p_payload->>'serviceType')::public.service_type,
      (p_payload->>'tableNumber')::smallint)
    returning bill_number into v_number;
    insert into public.bill_payments (bill_id,outlet_id,method,amount_paise)
      select v_bill,v_outlet,(payment->>'method')::public.payment_method,
        (payment->>'amountPaise')::bigint from jsonb_array_elements(p_payload->'payments') payment;
    insert into public.bill_items
      (id,bill_id,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise,
       discount_paise,discount_percent_bp,category_name,kind)
    select (line->>'id')::uuid,v_bill,nullif(line->>'menuItemId','')::uuid,line->>'itemName',
      (line->>'unitPricePaise')::bigint,(line->>'quantity')::integer,
      (line->>'lineTotalPaise')::bigint,
      coalesce((line->>'discountPaise')::bigint,0),
      nullif(line->>'discountPercentBp','')::integer,
      nullif(line->>'categoryName',''),
      coalesce(line->>'kind','item')::public.line_kind
      from jsonb_array_elements(p_payload->'lines') line;
    insert into public.bill_discounts (bill_id,outlet_id,basis,value_bp,value_paise,amount_paise)
    select v_bill,v_outlet,(d->>'basis')::public.discount_basis,
      nullif(d->>'valueBp','')::integer,nullif(d->>'valuePaise','')::bigint,
      (d->>'amountPaise')::bigint
      from jsonb_array_elements(coalesce(p_payload->'discounts','[]'::jsonb)) d;
  exception when unique_violation then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','identity_conflict','commandId',p_command_id),v_date,v_payment_date);
  end;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'billId',v_bill,
    'billNumber',v_number,'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_date,v_payment_date);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The receipt's discount rows.
--
-- Reproduced from `20260903010001_the_public_receipt_reader.sql`. A packaging
-- line's discount is not a menu discount, so it leaves the menu rows and
-- becomes a row of its own, `source = 'packaging'`, between the menu rows and
-- the bill's own. The printed rows still add up to the discount the bill
-- stored, which the receipt test holds them to; #58 words the new row.

create or replace function public.bill_public_discount_rows(p_bill_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with menu as (
    select
      case when i.discount_percent_bp is not null
           then 'p' || i.discount_percent_bp::text
           else 'a' || round(i.discount_paise::numeric / greatest(1, i.quantity))::text
      end as grouping_key,
      min(i.discount_percent_bp) as value_bp,
      case when min(i.discount_percent_bp) is not null then null
           else round(min(i.discount_paise)::numeric
                      / greatest(1, min(i.quantity)))::bigint
      end as value_paise,
      array_remove(array_agg(distinct i.category_name), null) as categories,
      sum(i.discount_paise)::bigint as amount_paise
    from public.bill_items i
   where i.bill_id = p_bill_id
     and i.discount_paise > 0
     and i.kind = 'item'
   group by 1, i.discount_percent_bp
  ),
  menu_rows as (
    select jsonb_build_object(
      'source', 'menu',
      'basis', case when value_bp is not null then 'percent' else 'amount' end,
      'value_bp', value_bp,
      'value_paise', value_paise,
      'categories', to_jsonb(categories),
      'amount_paise', amount_paise) as row,
      grouping_key as sort_key
    from menu
  ),
  packaging_rows as (
    select jsonb_build_object(
      'source', 'packaging',
      'basis', 'percent',
      'value_bp', i.discount_percent_bp,
      'value_paise', null,
      'categories', '[]'::jsonb,
      'amount_paise', i.discount_paise) as row,
      '' as sort_key
    from public.bill_items i
   where i.bill_id = p_bill_id
     and i.kind = 'packaging'
     and i.discount_paise > 0
  ),
  bill_rows as (
    select jsonb_build_object(
      'source', 'bill',
      'basis', d.basis,
      'value_bp', d.value_bp,
      'value_paise', d.value_paise,
      'categories', '[]'::jsonb,
      'amount_paise', d.amount_paise) as row,
      d.created_at::text as sort_key
    from public.bill_discounts d
   where d.bill_id = p_bill_id
  )
  select coalesce(jsonb_agg(row order by source_rank, sort_key), '[]'::jsonb)
    from (
      select row, sort_key, 0 as source_rank from menu_rows
      union all
      select row, sort_key, 1 as source_rank from packaging_rows
      union all
      select row, sort_key, 2 as source_rank from bill_rows
    ) ordered;
$$;
