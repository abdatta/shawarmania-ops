-- A discount is a line on the bill: the command boundary.
--
-- Content payloads now carry their discount records and their rounding, which
-- changes their canonical JSON and therefore their SHA-256 identity. The key
-- check is an exact set match, so the new shape would be refused as malformed
-- without this — and, far worse, so would the old one.
--
-- **The boundary accepts both, and must.** Since #34 a till may hold days of
-- captured commands, and it updates itself whenever the PWA does. A till that
-- went offline before this release and reconnects after it is holding envelopes
-- written under the old shape, with hashes already computed over it. Refusing
-- those would lose a trading day to a deployment, which is the exact failure the
-- offline contract exists to prevent.
--
-- So schema version 1 means the payload without discounts or rounding — which is
-- what it meant when it was written — and version 2 means the payload with them.

-- ---------------------------------------------------------------------------
-- The envelope check learns the second shape.
--
-- `p_extra_keys` is empty for every command whose payload did not change, so
-- both versions accept the identical shape there and nothing about cancelling,
-- voiding or confirming a day moves.

-- Dropped rather than replaced, because adding a parameter creates an
-- **overload**: `create or replace` matches on the argument list, so the
-- six-argument original would survive alongside the seven-argument version and
-- every existing six-argument call would become ambiguous (42725) rather than
-- resolving to either. The default on `p_extra_keys` is what keeps those calls
-- working once there is only one function to resolve to.
drop function if exists public.billing_envelope_error(
  uuid, integer, text, timestamptz, jsonb, text[]);

create or replace function public.billing_envelope_error(
  p_command_id uuid,
  p_schema_version integer,
  p_payload_hash text,
  p_created_at timestamptz,
  p_payload jsonb,
  p_keys text[],
  p_extra_keys text[] default '{}'::text[]
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_shape_ok boolean;
begin
  if p_schema_version is null or p_schema_version not in (1, 2) then
    return case when p_schema_version is null then 'malformed_payload'
                else 'unsupported_schema' end;
  end if;
  if p_command_id is null or p_payload_hash is null
     or p_created_at is null or p_payload is null then
    return 'malformed_payload';
  end if;

  -- The version names the shape, so a version-1 envelope carrying version-2
  -- keys is malformed rather than quietly accepted: the hash was computed over
  -- one of them and only one can be right.
  if p_schema_version = 1 then
    v_shape_ok := public.billing_payload_has_keys(p_payload, p_keys);
  else
    v_shape_ok := public.billing_payload_has_keys(p_payload, p_keys || p_extra_keys);
  end if;

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
-- Typing the new keys, when they are there.

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
              and jsonb_typeof(line -> 'categoryName') not in ('null','string'))),
    false);
$$;

-- ---------------------------------------------------------------------------
-- Lines have their own exact key check, and it needs the second shape too.
--
-- This is the one that would have been missed. The payload's key set is checked
-- once at the envelope, and then **each line's key set is checked again here** —
-- so accepting the new payload shape without this accepts an envelope whose
-- lines are then refused as `arithmetic_invalid`, which reads like a totals bug
-- and is not one. Everything else about the function is unchanged: the same
-- per-line arithmetic, the same menu agreement, the same refusal to let a
-- revision restate an existing line's identity.

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
    if v_id is null or length(btrim(v_name)) = 0 or v_price < 0
       or v_quantity <= 0 or v_total <> v_price * v_quantity
       or v_discount < 0 or v_discount > v_total then
      return false;
    end if;

    -- `unit_price_paise` is still the list price, so a line whose discount
    -- changed on a revision is the same line at the same price. Only the four
    -- identity facts are compared, exactly as before.
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

-- ---------------------------------------------------------------------------
-- The parts of a payload's discount must equal its declared discount, for the
-- same reason the stored ones must: a figure every reader adds up has to be the
-- sum of what it is made of.

create or replace function public.billing_validate_discounts(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_declared bigint;
  v_lines bigint;
  v_records bigint;
begin
  v_declared := (p_payload ->> 'discountPaise')::bigint;

  select coalesce(sum(coalesce((line ->> 'discountPaise')::bigint, 0)), 0)
    into v_lines
    from jsonb_array_elements(p_payload -> 'lines') line;

  select coalesce(sum((d ->> 'amountPaise')::bigint), 0)
    into v_records
    from jsonb_array_elements(coalesce(p_payload -> 'discounts', '[]'::jsonb)) d;

  -- A line may never give away more than it is worth, whatever the parts sum to.
  if exists (
    select 1 from jsonb_array_elements(p_payload -> 'lines') line
     where coalesce((line ->> 'discountPaise')::bigint, 0)
           > (line ->> 'lineTotalPaise')::bigint) then
    return false;
  end if;

  return v_declared = v_lines + v_records;
exception when others then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- The four content commands.
--
-- Each gains the same three things: the extra key set for version 2, the
-- rounding and discount columns on the row it writes, and the discount records
-- beside it. `coalesce(... , 0)` and `'[]'` throughout, so a version-1 payload
-- writes exactly what it used to.

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
    array['roundingPaise','discounts']);
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
     or not coalesce(public.billing_validate_discounts(p_payload),false)
     or not coalesce(public.billing_validate_lines(p_payload -> 'lines', v_outlet),false) then
    return jsonb_build_object('status','arithmetic_invalid');
  end if;

  v_claim := public.billing_begin_command(p_command_id, 'create_order', p_schema_version,
    p_payload_hash, p_created_at, v_outlet, auth.uid(), p_shift_id, v_actor);
  if v_claim ->> 'status' <> 'claimed' then return v_claim; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_outlet::text||':'||v_date::text,0));
  perform set_config('app.billing_command','1',true);
  begin
    v_number := public.billing_next_order_number(v_outlet, v_date);
    insert into public.orders (
      id, outlet_id, order_number, device_id, created_by, created_shift_id,
      ordered_at, business_date, customer_id, customer_name, customer_phone,
      subtotal_paise, discount_paise, tax_paise, rounding_paise, total_paise, pricing_mode)
    values (
      v_order, v_outlet, v_number, auth.uid(), v_actor, p_shift_id,
      p_created_at, v_date, v_customer,
      nullif(p_payload ->> 'customerName',''), nullif(p_payload ->> 'customerPhone',''),
      (p_payload ->> 'subtotalPaise')::bigint,
      (p_payload ->> 'discountPaise')::bigint,
      (p_payload ->> 'taxPaise')::bigint,
      coalesce((p_payload ->> 'roundingPaise')::bigint, 0),
      (p_payload ->> 'totalPaise')::bigint,
      (p_payload ->> 'pricingMode')::public.pricing_mode);

    insert into public.order_items
      (id, order_id, menu_item_id, item_name, unit_price_paise, quantity, line_total_paise,
       discount_paise, discount_percent_bp, category_name)
    select (line ->> 'id')::uuid, v_order, nullif(line ->> 'menuItemId','')::uuid,
      line ->> 'itemName', (line ->> 'unitPricePaise')::bigint,
      (line ->> 'quantity')::integer, (line ->> 'lineTotalPaise')::bigint,
      coalesce((line ->> 'discountPaise')::bigint, 0),
      nullif(line ->> 'discountPercentBp','')::integer,
      nullif(line ->> 'categoryName','')
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
    array['roundingPaise','discounts']);
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
    changed_by=(v_context->>'actorId')::uuid,changed_shift_id=p_shift_id,changed_at=p_created_at
    where id=v_order.id;
  delete from public.order_items i where i.order_id=v_order.id
    and not exists (select 1 from jsonb_array_elements(p_payload->'lines') line
      where (line->>'id')::uuid=i.id);
  insert into public.order_items
    (id,order_id,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise,
     discount_paise,discount_percent_bp,category_name)
  select (line->>'id')::uuid,v_order.id,nullif(line->>'menuItemId','')::uuid,
    line->>'itemName',(line->>'unitPricePaise')::bigint,(line->>'quantity')::integer,
    (line->>'lineTotalPaise')::bigint,
    coalesce((line->>'discountPaise')::bigint,0),
    nullif(line->>'discountPercentBp','')::integer,
    nullif(line->>'categoryName','')
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
  -- This payload carries no totals: paying an order settles it at the figures it
  -- was saved with, discount and rounding included. So its shape is unchanged,
  -- and both schema versions describe the same keys.
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
    payment_method,status,created_at,synced_at)
  values (v_bill,v_order.outlet_id,v_order.business_date,v_payment_date,v_order.ordered_at,v_paid_at,
    v_order.id,(v_context->>'actorId')::uuid,auth.uid(),p_shift_id,null,v_order.customer_id,
    v_order.customer_name,v_order.customer_phone,v_order.subtotal_paise,v_order.discount_paise,
    v_order.tax_paise,v_order.rounding_paise,v_order.total_paise,v_order.pricing_mode,v_summary,'settled',now(),now())
  returning bill_number into v_number;
  insert into public.bill_payments (bill_id,outlet_id,method,amount_paise)
    select v_bill,v_order.outlet_id,(payment->>'method')::public.payment_method,
      (payment->>'amountPaise')::bigint from jsonb_array_elements(p_payload->'payments') payment;
  insert into public.bill_items (id,bill_id,menu_item_id,item_name,unit_price_paise,quantity,
    line_total_paise,discount_paise,discount_percent_bp,category_name)
    select gen_random_uuid(),v_bill,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise,
      discount_paise,discount_percent_bp,category_name
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
    array['roundingPaise','discounts']);
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
    v_customer:=nullif(p_payload->>'customerId','')::uuid;
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
  perform set_config('app.billing_command','1',true);
  begin
    insert into public.bills (
      id,outlet_id,business_date,payment_business_date,ordered_at,paid_at,order_id,
      biller_profile_id,counter_device_id,counter_shift_id,shift_id,customer_id,customer_name,
      customer_phone,subtotal_paise,discount_paise,tax_paise,rounding_paise,total_paise,pricing_mode,
      payment_method,status,created_at,synced_at)
    values (v_bill,v_outlet,v_date,v_payment_date,p_created_at,p_created_at,null,
      (v_context->>'actorId')::uuid,auth.uid(),p_shift_id,null,v_customer,
      nullif(p_payload->>'customerName',''),nullif(p_payload->>'customerPhone',''),
      (p_payload->>'subtotalPaise')::bigint,(p_payload->>'discountPaise')::bigint,
      (p_payload->>'taxPaise')::bigint,coalesce((p_payload->>'roundingPaise')::bigint,0),
      (p_payload->>'totalPaise')::bigint,
      (p_payload->>'pricingMode')::public.pricing_mode,v_summary,'settled',now(),now())
    returning bill_number into v_number;
    insert into public.bill_payments (bill_id,outlet_id,method,amount_paise)
      select v_bill,v_outlet,(payment->>'method')::public.payment_method,
        (payment->>'amountPaise')::bigint from jsonb_array_elements(p_payload->'payments') payment;
    insert into public.bill_items
      (id,bill_id,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise,
       discount_paise,discount_percent_bp,category_name)
    select (line->>'id')::uuid,v_bill,nullif(line->>'menuItemId','')::uuid,line->>'itemName',
      (line->>'unitPricePaise')::bigint,(line->>'quantity')::integer,
      (line->>'lineTotalPaise')::bigint,
      coalesce((line->>'discountPaise')::bigint,0),
      nullif(line->>'discountPercentBp','')::integer,
      nullif(line->>'categoryName','')
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
