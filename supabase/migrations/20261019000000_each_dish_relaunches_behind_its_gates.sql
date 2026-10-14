-- change-gate: dish-ticks
--
-- #74 relaunched under #75 (each-dish-is-ticked-off, design R1–R10).
--
-- Everything here only adds. The tables and columns the first launch added on
-- 12 October (`order_items.note`, `order_line_preparations`, `kitchen_readies`)
-- stay as they are; the functions the published counter calls, restored to their
-- pre-#74 bodies by 20261017000000, are not touched. The on path calls the `_v2`
-- functions below, which only `dish-ticks` (and `kitchen-ready`, which depends on
-- it) reach, so a later fix during staging may replace them.
--
-- Labels live in `order_labels`, not `orders.label`: the restored order guard
-- refuses any change to that column, and the guard is a function every published
-- build's writes run through (design R8).

-- ---------------------------------------------------------------------------
-- 1. The gates, off. The owner turns them on the Change gates page.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('dish-ticks', 'DT', 'change', 'Dish ticks',
   'The counter is the menu and a two-column rail with Bills and Expenses below; orders take a label, dishes take notes, each dish is ticked off on its own, and the kitchen sees only the food it still owes.',
   'The counter and kitchen as they were before #74: three columns, one Prepared tick per order, no labels or notes.',
   'each-dish-is-ticked-off', 74),
  ('kitchen-ready', 'KR', 'change', 'Kitchen Ready',
   'The kitchen marks its food Done; on the counter those dishes fill orange and the order''s bell swings to two rings of the handbell.',
   'The kitchen has ACK only, as before #74.',
   'each-dish-is-ticked-off', 74);

insert into public.change_gate_dependencies (gate_key, depends_on)
values ('kitchen-ready', 'dish-ticks');

-- ---------------------------------------------------------------------------
-- 2. Labels (design R8). A word for the counter about whose order it is, kept
-- only while the order is on the rail. Never read by the kitchen, never copied
-- to a bill.

create table public.order_labels (
  order_id uuid primary key references public.orders (id),
  outlet_id uuid not null references public.outlets (id),
  label text not null
    constraint order_labels_label_shape check (label = btrim(label) and length(label) between 1 and 24)
);

create index order_labels_outlet_idx on public.order_labels (outlet_id);

alter table public.order_labels enable row level security;

-- A live counter shift at its own outlet, its Franchise Admins and the owner.
-- No kitchen: the kitchen knows an order by its number.
create policy order_labels_select on public.order_labels
  for select to authenticated using (public.app_device_ok() and (
    outlet_id = (select public.app_counter_shift_outlet())
    or (public.app_account_active() and ((select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

revoke all on public.order_labels from anon, authenticated;
grant select on public.order_labels to authenticated;

-- An order's label goes as the order leaves the rail — cancelled, or paid with
-- its preparation recorded — whichever path finishes it, the old ones and the
-- day change included. Inert while `dish-ticks` is off: nothing then writes a
-- label, and the on path's next create sweeps what the gap left (design R4).
create function public.order_label_leaves_the_rail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.app_change_gate('dish-ticks') then return new; end if;
  delete from public.order_labels where order_id = new.id;
  return new;
end;
$$;

revoke execute on function public.order_label_leaves_the_rail() from public, anon, authenticated;

create trigger orders_label_leaves_the_rail
  after update on public.orders
  for each row
  when (new.status = 'cancelled' or (new.status = 'paid' and new.prepared_at is not null))
  execute function public.order_label_leaves_the_rail();

-- ---------------------------------------------------------------------------
-- 3. What a dish line is, on the on path (design D6, D5, R4).
--
-- Every item line of an order with how much the counter has ticked and how much
-- the kitchens have marked Ready. **An order already prepared reads every item
-- line as ticked**: the old Prepared tick, a whole-order command queued while
-- the gate was off, and the day change all record the order and no line.

create function public.dish_lines_v2(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select id, prepared_at from public.orders where id = p_order_id
  ),
  readies as (
    select (l ->> 'id')::uuid as line_id, sum((l ->> 'quantity')::integer) as amount
      from public.kitchen_readies r
     cross join lateral jsonb_array_elements(r.lines) l
     where r.order_id = p_order_id
       and r.undoes is null
       and not exists (select 1 from public.kitchen_readies u where u.undoes = r.id)
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'menuItemId', i.menu_item_id,
           'itemName', i.item_name,
           'quantity', i.quantity,
           'note', i.note,
           'categoryId', m.category_id,
           'ticked', case when o.prepared_at is not null then i.quantity
                          else least(i.quantity, coalesce(p.quantity, 0)) end,
           'ready', least(i.quantity, coalesce(r.amount, 0)))
         order by i.item_name, i.id), '[]'::jsonb)
    from o
    join public.order_items i on i.order_id = o.id and i.kind = 'item'
    left join public.menu_items m on m.id = i.menu_item_id
    left join public.order_line_preparations p on p.order_item_id = i.id
    left join readies r on r.line_id = i.id
$$;

-- A line is locked once the counter has ticked it or a kitchen has marked any of
-- it Ready (design D4): it takes no more and its note is fixed.
create function public.dish_line_locked_v2(p_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.order_line_preparations where order_item_id = p_line_id)
      or exists (
           select 1
             from public.order_items i
             join public.kitchen_readies r on r.order_id = i.order_id and r.undoes is null
            cross join lateral jsonb_array_elements(r.lines) l
            where i.id = p_line_id
              and l ->> 'id' = p_line_id::text
              and not exists (select 1 from public.kitchen_readies u where u.undoes = r.id))
$$;

-- An order prepared without line ticks (R4) gets them before anything changes a
-- line's tick, at the order's own preparation time, so unticking one dish never
-- unticks the rest and a revision's new food shows as the only unticked part.
create function public.dish_ticks_from_preparation_v2(
  p_order public.orders, p_shift_id uuid, p_actor uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.order_line_preparations
    (order_item_id, outlet_id, order_id, quantity, prepared_at, shift_id, person_id)
  select i.id, p_order.outlet_id, p_order.id, i.quantity, p_order.prepared_at, p_shift_id, p_actor
    from public.order_items i
   where p_order.prepared_at is not null
     and i.order_id = p_order.id and i.kind = 'item'
     and not exists (select 1 from public.order_line_preparations p where p.order_item_id = i.id)
$$;

-- The order's Prepared follows its dishes (design D6): every item line ticked to
-- its quantity prepares it at the command's time; one not ticked unprepares an
-- open order the counter prepared. A paid order's preparation is never undone
-- here, and a tick landing on an order the day change finished replaces the
-- cutover with its own, earlier time (#69).
create function public.derive_dish_preparation_v2(p_order_id uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_all_ticked boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  select not exists (
           select 1
             from public.order_items i
             left join public.order_line_preparations p on p.order_item_id = i.id
            where i.order_id = p_order_id and i.kind = 'item'
              and coalesce(p.quantity, 0) < i.quantity)
    into v_all_ticked;
  if v_all_ticked then
    if v_order.prepared_at is null
       or (v_order.prepared_source = 'day_change' and p_at < v_order.prepared_at) then
      update public.orders set prepared_at = p_at, prepared_source = 'counter'
       where id = p_order_id;
    end if;
  elsif v_order.status = 'open' and v_order.prepared_source = 'counter' then
    update public.orders set prepared_at = null, prepared_source = null where id = p_order_id;
  end if;
end;
$$;

revoke execute on function public.dish_lines_v2(uuid), public.dish_line_locked_v2(uuid),
  public.dish_ticks_from_preparation_v2(public.orders, uuid, uuid),
  public.derive_dish_preparation_v2(uuid, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The order commands on the on path (design D2, D3, R3, R8). The bodies are
-- the restored `create_billing_order` and `revise_billing_order` with labels,
-- notes and the dishes' Prepared added. They record the same command types, so
-- idempotency and replay are unchanged.

create function public.create_billing_order_v2(
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
  v_label text;
  v_result jsonb;
begin
  v_error := public.billing_envelope_error(p_command_id, p_schema_version,
    p_payload_hash, p_created_at, p_payload, array[
      'orderId','businessDate','customerId','customerName','customerPhone',
      'subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','lines'],
    array['roundingPaise','discounts'],
    array['serviceType','tableNumber']);
  if v_error is not null then return jsonb_build_object('status', v_error); end if;
  -- A label of up to 24 characters, a note of up to 60 on an item line only.
  if not public.billing_dish_payload_ok(p_payload) then
    return jsonb_build_object('status','malformed_payload');
  end if;
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
     or not (public.billing_content_payload_well_typed(p_payload)
       and public.billing_points_shape_ok(p_payload, p_schema_version)) then
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
       discount_paise, discount_percent_bp, category_name, kind, note)
    select (line ->> 'id')::uuid, v_order, nullif(line ->> 'menuItemId','')::uuid,
      line ->> 'itemName', (line ->> 'unitPricePaise')::bigint,
      (line ->> 'quantity')::integer, (line ->> 'lineTotalPaise')::bigint,
      coalesce((line ->> 'discountPaise')::bigint, 0),
      nullif(line ->> 'discountPercentBp','')::integer,
      nullif(line ->> 'categoryName',''),
      coalesce(line ->> 'kind', 'item')::public.line_kind,
      nullif(btrim(line ->> 'note'),'')
      from jsonb_array_elements(p_payload -> 'lines') line;

    insert into public.order_discounts (order_id, outlet_id, basis, value_bp, value_paise, amount_paise, source)
    select v_order, v_outlet, (d ->> 'basis')::public.discount_basis,
      nullif(d ->> 'valueBp','')::integer, nullif(d ->> 'valuePaise','')::bigint,
      (d ->> 'amountPaise')::bigint,
      coalesce(d ->> 'source', 'biller')::public.discount_row_source
      from jsonb_array_elements(coalesce(p_payload -> 'discounts', '[]'::jsonb)) d;
  exception when unique_violation then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','identity_conflict','commandId',p_command_id), v_date);
  end;

  v_label := nullif(btrim(p_payload ->> 'label'), '');
  if v_label is not null then
    insert into public.order_labels (order_id, outlet_id, label) values (v_order, v_outlet, v_label);
  end if;
  -- Labels an order kept while the gate was off and it left the rail (R4).
  delete from public.order_labels l
   using public.orders o
   where o.id = l.order_id and l.outlet_id = v_outlet
     and (o.status = 'cancelled' or (o.status = 'paid' and o.prepared_at is not null));

  v_result := jsonb_build_object('status','accepted','commandId',p_command_id,
    'orderId',v_order,'orderNumber',v_number,'delayed',(v_context ->> 'delayed')::boolean);
  return public.billing_finish_command(p_command_id, v_result, v_date);
end;
$$;

create function public.revise_billing_order_v2(
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
  v_label text;
  v_result jsonb;
begin
  v_error := public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,
    p_created_at,p_payload,array['orderId','businessDate','customerId','customerName',
      'customerPhone','subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','lines'],
    array['roundingPaise','discounts'],
    array['serviceType','tableNumber']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if not public.billing_dish_payload_ok(p_payload) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context := public.billing_device_context(p_shift_id,p_created_at);
  if v_context ->> 'status' <> 'ok' then return v_context; end if;
  if not (public.billing_content_payload_well_typed(p_payload)
       and public.billing_points_shape_ok(p_payload, p_schema_version)) then
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
  -- An order the old path prepared reads every dish ticked; make that a fact of
  -- each line before the revision changes any (R4).
  perform public.dish_ticks_from_preparation_v2(v_order, p_shift_id,
    (v_context->>'actorId')::uuid);
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
  -- A note follows the revision, except on a locked line (D3, D4): a revision
  -- that changes one is accepted with the note as it was, so a queued edit never
  -- becomes needs-attention work.
  insert into public.order_items
    (id,order_id,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise,
     discount_paise,discount_percent_bp,category_name,kind,note)
  select (line->>'id')::uuid,v_order.id,nullif(line->>'menuItemId','')::uuid,
    line->>'itemName',(line->>'unitPricePaise')::bigint,(line->>'quantity')::integer,
    (line->>'lineTotalPaise')::bigint,
    coalesce((line->>'discountPaise')::bigint,0),
    nullif(line->>'discountPercentBp','')::integer,
    nullif(line->>'categoryName',''),
    coalesce(line->>'kind','item')::public.line_kind,
    nullif(btrim(line->>'note'),'')
    from jsonb_array_elements(p_payload->'lines') line
  on conflict (id) do update set quantity=excluded.quantity,line_total_paise=excluded.line_total_paise,
    discount_paise=excluded.discount_paise,discount_percent_bp=excluded.discount_percent_bp,
    category_name=excluded.category_name,
    note=case when public.dish_line_locked_v2(public.order_items.id)
              then public.order_items.note
              when exists (select 1 from jsonb_array_elements(p_payload->'lines') l
                            where l->>'id'=excluded.id::text and l ? 'note')
              then excluded.note
              else public.order_items.note end
    where public.order_items.order_id=excluded.order_id;
  get diagnostics v_affected = row_count;
  if v_affected <> jsonb_array_length(p_payload->'lines') then
    raise unique_violation;
  end if;

  -- An order's bill-level discounts are replaced wholesale, exactly as its
  -- lines are: a revision states the whole order, not a difference from it.
  delete from public.order_discounts where order_id = v_order.id;
  insert into public.order_discounts (order_id,outlet_id,basis,value_bp,value_paise,amount_paise,source)
  select v_order.id,v_order.outlet_id,(d->>'basis')::public.discount_basis,
    nullif(d->>'valueBp','')::integer,nullif(d->>'valuePaise','')::bigint,
    (d->>'amountPaise')::bigint,
    coalesce(d->>'source','biller')::public.discount_row_source
    from jsonb_array_elements(coalesce(p_payload->'discounts','[]'::jsonb)) d;
  exception when unique_violation then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','identity_conflict','commandId',p_command_id),v_order.business_date);
  end;

  -- A revision without the key leaves the label as it was; a blank one removes it.
  if p_payload ? 'label' then
    v_label := nullif(btrim(p_payload->>'label'),'');
    if v_label is null then
      delete from public.order_labels where order_id = v_order.id;
    else
      insert into public.order_labels (order_id, outlet_id, label)
      values (v_order.id, v_order.outlet_id, v_label)
      on conflict (order_id) do update set label = excluded.label;
    end if;
  end if;

  -- Food added that is not ticked unprepares the order; food removed that leaves
  -- only ticked dishes prepares it (D6).
  perform public.derive_dish_preparation_v2(v_order.id, p_created_at);
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'orderId',v_order.id,
    'orderNumber',v_order.order_number,'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_order.business_date);
end;
$$;

revoke execute on function
  public.create_billing_order_v2(uuid,integer,text,timestamptz,uuid,jsonb),
  public.revise_billing_order_v2(uuid,integer,text,timestamptz,uuid,jsonb)
  from public, anon;
grant execute on function
  public.create_billing_order_v2(uuid,integer,text,timestamptz,uuid,jsonb),
  public.revise_billing_order_v2(uuid,integer,text,timestamptz,uuid,jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A dish tick (design D6, R4): the owning tablet ticks or unticks dishes, and
-- the order's Prepared follows them. Recorded as `prepare_order_lines`, the type
-- the command table already allows.

create function public.prepare_order_lines_v2(
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
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_line jsonb;
  v_ids uuid[] := '{}';
  v_line_id uuid;
begin
  v_error := public.billing_envelope_error(p_command_id, p_schema_version, p_payload_hash,
    p_created_at, p_payload, array['orderId','lines']);
  if v_error is not null then return jsonb_build_object('status', v_error); end if;
  begin
    if jsonb_typeof(p_payload->'orderId') is distinct from 'string'
       or jsonb_typeof(p_payload->'lines') is distinct from 'array'
       or jsonb_array_length(p_payload->'lines') = 0 then
      raise exception 'shape';
    end if;
    v_order_id := (p_payload->>'orderId')::uuid;
    for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
      if not public.billing_payload_has_keys(v_line, array['id','prepared'])
         or jsonb_typeof(v_line->'id') is distinct from 'string'
         or jsonb_typeof(v_line->'prepared') is distinct from 'boolean' then
        raise exception 'shape';
      end if;
      v_line_id := (v_line->>'id')::uuid;
      if v_line_id = any(v_ids) then raise exception 'duplicate'; end if;
      v_ids := array_append(v_ids, v_line_id);
    end loop;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  v_context := public.billing_device_context(p_shift_id, p_created_at);
  if v_context->>'status' <> 'ok' then return v_context; end if;
  v_claim := public.billing_begin_command(p_command_id, 'prepare_order_lines', p_schema_version,
    p_payload_hash, p_created_at, (v_context->>'outletId')::uuid, auth.uid(), p_shift_id,
    (v_context->>'actorId')::uuid);
  if v_claim->>'status' <> 'claimed' then return v_claim; end if;
  select * into v_order from public.orders where id = v_order_id for update;
  if not found or v_order.outlet_id <> (v_context->>'outletId')::uuid
     or v_order.device_id <> auth.uid() then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused'));
  end if;
  if p_created_at < v_order.ordered_at then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','malformed_payload'), v_order.business_date);
  end if;
  -- A cancelled order takes no tick; a paid order no untick, and a finished one
  -- (paid and prepared, other than by the day change) no tick either.
  if v_order.status = 'cancelled'
     or (v_order.status = 'paid' and v_order.prepared_at is not null
         and v_order.prepared_source is distinct from 'day_change')
     or (v_order.status = 'paid' and exists (
           select 1 from jsonb_array_elements(p_payload->'lines') x where x->>'prepared' = 'false')) then
    return public.billing_finish_command(p_command_id, jsonb_build_object('status','order_not_open',
      'orderId',v_order.id,'orderNumber',v_order.order_number), v_order.business_date);
  end if;
  if exists (select 1 from public.order_items i where i.id = any(v_ids)
              and (i.order_id <> v_order_id or i.kind <> 'item')) then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused'), v_order.business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  perform public.dish_ticks_from_preparation_v2(v_order, p_shift_id,
    (v_context->>'actorId')::uuid);
  -- A line removed meanwhile is simply absent: its tick changes nothing.
  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    v_line_id := (v_line->>'id')::uuid;
    if (v_line->>'prepared')::boolean then
      insert into public.order_line_preparations
        (order_item_id, outlet_id, order_id, quantity, prepared_at, shift_id, person_id)
      select i.id, v_order.outlet_id, v_order.id, i.quantity, p_created_at, p_shift_id,
             (v_context->>'actorId')::uuid
        from public.order_items i
       where i.id = v_line_id and i.order_id = v_order_id and i.kind = 'item'
      on conflict (order_item_id) do update set quantity = excluded.quantity,
        prepared_at = excluded.prepared_at, shift_id = excluded.shift_id,
        person_id = excluded.person_id;
    else
      delete from public.order_line_preparations
       where order_item_id = v_line_id and order_id = v_order_id;
    end if;
  end loop;
  perform public.derive_dish_preparation_v2(v_order_id, p_created_at);
  -- A partial tick moves no order column, so it nudges the kitchens itself.
  insert into public.kitchen_pulses (outlet_id, bumped_at) values (v_order.outlet_id, clock_timestamp())
    on conflict (outlet_id) do update set bumped_at = excluded.bumped_at;
  return public.billing_finish_command(p_command_id, jsonb_build_object('status','accepted',
    'commandId',p_command_id,'orderId',v_order.id,'orderNumber',v_order.order_number,
    'delayed',(v_context->>'delayed')::boolean), v_order.business_date);
end;
$$;

revoke execute on function public.prepare_order_lines_v2(uuid,integer,text,timestamptz,uuid,jsonb)
  from public, anon;
grant execute on function public.prepare_order_lines_v2(uuid,integer,text,timestamptz,uuid,jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. What a kitchen sees (design D7, R4).

-- The lines of an order this kitchen's filter shows, notes included: what an
-- acknowledgement or a Ready snapshots.
create function public.kitchen_visible_lines_v2(p_order_id uuid, p_mode text, p_category_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'menuItemId', i.menu_item_id, 'itemName', i.item_name,
           'quantity', i.quantity, 'note', i.note)
         order by i.item_name, i.id), '[]'::jsonb)
    from public.order_items i
    left join public.menu_items m on m.id = i.menu_item_id
   where i.order_id = p_order_id and i.kind = 'item'
     and public.kitchen_line_visible(m.category_id, p_mode, p_category_ids)
$$;

-- Food still owed among a filter's lines: quantity less the larger of what the
-- counter ticked and what a kitchen marked Ready.
create function public.kitchen_owed_v2(p_dish_lines jsonb, p_mode text, p_category_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.line ->> 'id', 'menuItemId', q.line -> 'menuItemId',
           'itemName', q.line ->> 'itemName', 'quantity', q.owed, 'note', q.line -> 'note')
         order by q.position), '[]'::jsonb)
    from (select l.line, l.position,
                 (l.line ->> 'quantity')::integer
                   - greatest((l.line ->> 'ticked')::integer, (l.line ->> 'ready')::integer) as owed
            from jsonb_array_elements(coalesce(p_dish_lines, '[]'::jsonb))
                 with ordinality as l(line, position)
           where public.kitchen_line_visible(nullif(l.line ->> 'categoryId', '')::uuid,
                                             p_mode, p_category_ids)) q
   where q.owed > 0
$$;

-- An acknowledgement's snapshot, owed as of now: what it showed, less what has
-- since been handed over or marked Ready. Both sides of the comparison subtract
-- the same, so a tick after an ACK stays silent. A line gone from the order keeps
-- its snapshot quantity, so removed food reads as an edit until acknowledged.
create function public.kitchen_owed_snapshot_v2(p_snapshot jsonb, p_dish_lines jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(q.line || jsonb_build_object('quantity', q.owed) order by q.position),
                  '[]'::jsonb)
    from (select s.line, s.position,
                 (s.line ->> 'quantity')::integer
                   - greatest(coalesce((d.line ->> 'ticked')::integer, 0),
                              coalesce((d.line ->> 'ready')::integer, 0)) as owed
            from jsonb_array_elements(coalesce(p_snapshot, '[]'::jsonb))
                 with ordinality as s(line, position)
            left join lateral (
              select x as line from jsonb_array_elements(coalesce(p_dish_lines, '[]'::jsonb)) x
               where x ->> 'id' = s.line ->> 'id' limit 1) d on true) q
   where q.owed > 0
$$;

-- Two line lists hold the same food: a dish and its note are one, summed.
create function public.kitchen_same_lines_v2(p_left jsonb, p_right jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1
      from (select coalesce(l ->> 'menuItemId', 'name:' || (l ->> 'itemName')) as dish,
                   coalesce(l ->> 'note', '') as note,
                   sum((l ->> 'quantity')::integer) as quantity
              from jsonb_array_elements(coalesce(p_left, '[]'::jsonb)) l group by 1, 2) a
      full join
           (select coalesce(r ->> 'menuItemId', 'name:' || (r ->> 'itemName')) as dish,
                   coalesce(r ->> 'note', '') as note,
                   sum((r ->> 'quantity')::integer) as quantity
              from jsonb_array_elements(coalesce(p_right, '[]'::jsonb)) r group by 1, 2) b
        using (dish, note)
     where a.quantity is distinct from b.quantity)
$$;

-- One kitchen's active ticket for an order: the food it still owes, judged
-- against its latest acknowledgement made after its latest Ready not undone.
-- Null when the kitchen has nothing to show (D7).
create function public.kitchen_ticket_v2(
  p_order public.orders, p_device public.counter_devices, p_dish_lines jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_ticket integer;
  v_ack public.kitchen_acknowledgements%rowtype;
  v_owed jsonb;
  v_before jsonb;
  v_answered boolean;
  v_version timestamptz := public.kitchen_order_version(p_order);
begin
  select max(r.at), count(*) + 1 into v_since, v_ticket
    from public.kitchen_readies r
   where r.order_id = p_order.id and r.device_id = p_device.id and r.undoes is null
     and not exists (select 1 from public.kitchen_readies u where u.undoes = r.id);
  v_owed := public.kitchen_owed_v2(p_dish_lines, p_device.kitchen_filter_mode,
                                   p_device.kitchen_category_ids);
  select * into v_ack
    from public.kitchen_acknowledgements a
   where a.order_id = p_order.id and a.device_id = p_device.id
     and (v_since is null or a.acked_at > v_since)
   order by a.acked_at desc, a.id desc
   limit 1;
  v_before := case when v_ack.id is null then '[]'::jsonb
                   else public.kitchen_owed_snapshot_v2(
                          public.kitchen_filter_lines(v_ack.lines, p_device.kitchen_filter_mode,
                                                      p_device.kitchen_category_ids),
                          p_dish_lines) end;
  v_answered := exists (
    select 1 from public.kitchen_acknowledgements a
     where a.order_id = p_order.id and a.device_id = p_device.id and a.kind = 'new'
       and (v_since is null or a.acked_at > v_since));
  if jsonb_array_length(v_owed) = 0 and jsonb_array_length(v_before) = 0 then
    return null;
  end if;
  if v_ack.kind = 'cancel' and v_ack.order_version = v_version
     and (p_order.status = 'cancelled' or jsonb_array_length(v_owed) = 0) then
    return null;
  end if;
  return jsonb_build_object(
    'id', p_order.id,
    'orderNumber', p_order.order_number,
    'serviceType', p_order.service_type,
    'tableNumber', p_order.table_number,
    'orderedAt', p_order.ordered_at,
    'version', v_version,
    'status', p_order.status,
    'cancelledAt', p_order.cancelled_at,
    'lines', v_owed,
    'ticketNumber', v_ticket,
    'otherItemCount', (
      select count(*) from jsonb_array_elements(coalesce(p_dish_lines, '[]'::jsonb)) l
       where not public.kitchen_line_visible(nullif(l ->> 'categoryId', '')::uuid,
                                             p_device.kitchen_filter_mode,
                                             p_device.kitchen_category_ids)),
    'acknowledged', v_answered,
    'latestAck', case when v_ack.id is not null then jsonb_build_object(
      'kind', v_ack.kind, 'orderVersion', v_ack.order_version,
      'lines', v_before, 'ackedAt', v_ack.acked_at) end);
end;
$$;

-- One kitchen's Done receipts for an order, oldest first, each with the food it
-- captured that the counter has not yet handed over. Handover consumes older
-- receipts first; a quantity lowered since caps them (D7). Never filtered by
-- today's filter: what the kitchen made stays what it made.
create function public.kitchen_receipts_v2(
  p_order_id uuid, p_device_id uuid, p_dish_lines jsonb
)
returns table (ready_id uuid, at timestamptz, ticket integer, lines jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with readies as (
    select r.id, r.at, row_number() over (order by r.at, r.id)::integer as ticket, r.lines
      from public.kitchen_readies r
     where r.order_id = p_order_id and r.device_id = p_device_id and r.undoes is null
       and not exists (select 1 from public.kitchen_readies u where u.undoes = r.id)
  ),
  captured as (
    select r.id, r.at, r.ticket, l.line, l.position,
           (l.line ->> 'quantity')::integer as amount,
           coalesce(sum((l.line ->> 'quantity')::integer) over (
             partition by l.line ->> 'id' order by r.at, r.id
             rows between unbounded preceding and 1 preceding), 0) as prior
      from readies r
     cross join lateral jsonb_array_elements(r.lines) with ordinality as l(line, position)
  ),
  remaining as (
    select c.id, c.at, c.ticket, c.position, d.line as dish,
           greatest(0, least(c.amount, (d.line ->> 'quantity')::integer - c.prior)
                       - greatest(0, (d.line ->> 'ticked')::integer - c.prior)) as quantity
      from captured c
      join lateral (
        select x as line from jsonb_array_elements(coalesce(p_dish_lines, '[]'::jsonb)) x
         where x ->> 'id' = c.line ->> 'id' limit 1) d on true
  )
  select r.id, r.at, r.ticket,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', m.dish ->> 'id', 'menuItemId', m.dish -> 'menuItemId',
                     'itemName', m.dish ->> 'itemName', 'quantity', m.quantity,
                     'note', m.dish -> 'note') order by m.position)
                     from remaining m where m.id = r.id and m.quantity > 0), '[]'::jsonb)
    from readies r
$$;

create function public.kitchen_board_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shift public.counter_shifts%rowtype;
  v_device public.counter_devices%rowtype;
  v_cutover time;
  v_orders jsonb;
begin
  select s.* into v_shift from public.counter_shifts s where s.id = public.app_kitchen_shift();
  if not found then
    raise exception 'the kitchen board needs a live kitchen shift' using errcode = '42501';
  end if;
  select * into v_device from public.counter_devices where id = v_shift.device_id;
  select o.business_day_cutover into v_cutover from public.outlets o where o.id = v_shift.outlet_id;

  with candidates as (
    -- On the rail and not yet prepared, as on the old board: a prepared order is
    -- done in the kitchen, paid or not, and its Done receipts are all handed
    -- over. The rail's own predicate, so the read rides `orders_pipeline_idx`.
    select o
      from public.orders o
     where o.outlet_id = v_shift.outlet_id
       and (o.status = 'open' or (o.status = 'paid' and o.prepared_at is null))
       and o.prepared_at is null
    union all
    select o
      from public.orders o
     where o.outlet_id = v_shift.outlet_id
       and o.status = 'cancelled'
       and o.business_date in (v_shift.business_date, v_shift.business_date - 1)
       and public.app_business_date(o.cancelled_at, v_cutover) = v_shift.business_date
  ),
  dished as materialized (
    select c.o as ord, public.dish_lines_v2((c.o).id) as dish_lines from candidates c
  ),
  active as materialized (
    -- A cancelled order the counter had handed over owes nothing, and shows
    -- nothing: the kitchen made that food already.
    select (d.ord).ordered_at, (d.ord).id as order_id, 0 as ticket_order,
           public.kitchen_ticket_v2(d.ord, v_device, d.dish_lines) as card
      from dished d
     -- A ticket needs food this kitchen shows or an acknowledgement to compare
     -- with; without either there is none to work out.
     where exists (select 1 from jsonb_array_elements(d.dish_lines) l
                    where public.kitchen_line_visible(nullif(l ->> 'categoryId', '')::uuid,
                                                      v_device.kitchen_filter_mode,
                                                      v_device.kitchen_category_ids))
        or exists (select 1 from public.kitchen_acknowledgements a
                    where a.device_id = v_device.id and a.order_id = (d.ord).id)
  ),
  receipts as materialized (
    select (d.ord).ordered_at, (d.ord).id as order_id, x.ticket as ticket_order,
           jsonb_build_object(
             'id', x.ready_id, 'sourceOrderId', (d.ord).id, 'readyId', x.ready_id,
             'orderNumber', (d.ord).order_number, 'serviceType', (d.ord).service_type,
             'tableNumber', (d.ord).table_number, 'orderedAt', (d.ord).ordered_at,
             'version', public.kitchen_order_version(d.ord), 'status', (d.ord).status,
             'cancelledAt', null, 'lines', x.lines, 'otherItemCount', 0,
             'ticketNumber', x.ticket, 'acknowledged', true,
             'latestAck', jsonb_build_object(
               'kind', 'new', 'orderVersion', public.kitchen_order_version(d.ord),
               'lines', x.lines, 'ackedAt', x.at)) as card
      from dished d
     cross join lateral public.kitchen_receipts_v2((d.ord).id, v_device.id, d.dish_lines) x
     where (d.ord).status <> 'cancelled' and jsonb_array_length(x.lines) > 0
       -- Receipts only where this kitchen has marked the order Ready at all.
       and exists (select 1 from public.kitchen_readies r
                    where r.order_id = (d.ord).id and r.device_id = v_device.id
                      and r.undoes is null)
  )
  select coalesce(jsonb_agg(q.card order by q.ordered_at, q.order_id, q.ticket_order), '[]'::jsonb)
    into v_orders
    from (select * from active where card is not null
          union all
          select * from receipts) q;

  return jsonb_build_object(
    'readAt', now(),
    'outletId', v_shift.outlet_id,
    'businessDate', v_shift.business_date,
    'shiftId', v_shift.id,
    'operatorName', (select p.full_name from public.profiles p where p.id = v_shift.person_id),
    'filterChangedAt', v_device.kitchen_filter_changed_at,
    'filterMode', v_device.kitchen_filter_mode,
    'categoryIds', to_jsonb(v_device.kitchen_category_ids),
    'sort', v_device.kitchen_sort,
    'orders', v_orders);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. What the counter learns of its kitchens (design D8): per open order, each
-- carrying kitchen's slot — sent, acknowledged, ready or handed over — the old
-- bell's waiting or seen beside it, and each item line's ready quantity. No dish
-- is mapped to a kitchen, and no time or person leaves.

create function public.counter_kitchen_marks_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_outlet uuid := public.app_counter_shift_outlet();
  v_kitchens jsonb;
  v_orders jsonb;
  v_tablets integer;
begin
  if v_outlet is null then
    raise exception 'the kitchen marks need a live counter shift' using errcode = '42501';
  end if;

  with kitchens as (
    select d as dev, row_number() over (order by lower(d.label), d.id) as place
      from public.counter_shifts s
      join public.counter_devices d on d.id = s.device_id
       and d.removed_at is null and d.session_proven_at is not null and d.kind = 'kitchen'
     where s.outlet_id = v_outlet
       and s.kind = 'kitchen'
       and s.ended_at is null
       and s.expires_at > now()
  ),
  rail as materialized (
    -- The rail's own predicate, so the read rides `orders_pipeline_idx`.
    select o as ord, o.id, public.dish_lines_v2(o.id) as dish_lines
      from public.orders o
     where o.outlet_id = v_outlet
       and (o.status = 'open' or (o.status = 'paid' and o.prepared_at is null))
  ),
  cells as materialized (
    select r.id as order_id, k.place,
           public.kitchen_owed_v2(
             (select coalesce(jsonb_agg(l || jsonb_build_object('ready', 0)), '[]'::jsonb)
                from jsonb_array_elements(r.dish_lines) l),
             (k.dev).kitchen_filter_mode, (k.dev).kitchen_category_ids) as untouched,
           exists (select 1 from jsonb_array_elements(r.dish_lines) l
                    where public.kitchen_line_visible(nullif(l ->> 'categoryId', '')::uuid,
                                                      (k.dev).kitchen_filter_mode,
                                                      (k.dev).kitchen_category_ids)) as carries,
           -- A ticket needs food this kitchen shows or an acknowledgement to
           -- compare with; without either there is none to work out.
           case when (r.ord).prepared_at is null
                 and (exists (select 1 from jsonb_array_elements(r.dish_lines) l
                               where public.kitchen_line_visible(nullif(l ->> 'categoryId', '')::uuid,
                                                                 (k.dev).kitchen_filter_mode,
                                                                 (k.dev).kitchen_category_ids))
                      or exists (select 1 from public.kitchen_acknowledgements a
                                  where a.device_id = (k.dev).id and a.order_id = r.id))
                then public.kitchen_ticket_v2(r.ord, k.dev, r.dish_lines) end as ticket,
           -- Receipts only where this kitchen has marked the order Ready at all.
           case when exists (select 1 from public.kitchen_readies x
                              where x.order_id = r.id and x.device_id = (k.dev).id
                                and x.undoes is null)
                then exists (select 1 from public.kitchen_receipts_v2(r.id, (k.dev).id, r.dish_lines) x
                              where jsonb_array_length(x.lines) > 0)
                else false end as has_ready
      from rail r
     cross join kitchens k
  ),
  states as (
    select c.order_id, c.place,
           case
             when not c.carries and c.ticket is null and not c.has_ready then null
             when c.has_ready then 'ready'
             when c.carries and jsonb_array_length(c.untouched) = 0 then 'handed_over'
             when c.ticket is null then 'handed_over'
             when (c.ticket ->> 'acknowledged')::boolean
                  and public.kitchen_same_lines_v2(c.ticket -> 'lines',
                                                   c.ticket -> 'latestAck' -> 'lines')
               then 'acknowledged'
             else 'sent'
           end as state
      from cells c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'orderId', g.order_id, 'marks', g.marks, 'dishStates', g.states,
           'readyQuantities', (
             select coalesce(jsonb_object_agg(l ->> 'id', (l ->> 'ready')::integer), '{}'::jsonb)
               from rail r cross join jsonb_array_elements(r.dish_lines) l
              where r.id = g.order_id))
         order by g.order_id), '[]'::jsonb)
    into v_orders
    from (select s.order_id,
                 jsonb_agg(s.state order by s.place) as states,
                 jsonb_agg(case when s.state is null then null
                                when s.state = 'sent' then 'waiting'
                                else 'seen' end order by s.place) as marks
            from states s
           group by s.order_id
          having count(s.state) > 0) g;

  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'label', k.label) order by k.place),
                  '[]'::jsonb)
    into v_kitchens
    from (select d.id, d.label, row_number() over (order by lower(d.label), d.id) as place
            from public.counter_shifts s
            join public.counter_devices d on d.id = s.device_id
             and d.removed_at is null and d.session_proven_at is not null and d.kind = 'kitchen'
           where s.outlet_id = v_outlet
             and s.kind = 'kitchen'
             and s.ended_at is null
             and s.expires_at > now()) k;

  select count(*) into v_tablets
    from public.counter_devices d
   where d.outlet_id = v_outlet and d.kind = 'kitchen'
     and d.removed_at is null and d.session_proven_at is not null;

  return jsonb_build_object('kitchens', v_kitchens, 'orders', v_orders,
                            'kitchenTablets', v_tablets);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The kitchen's writes (design D5, R4). Online only, like ACK; each bumps the
-- outlet's pulse so the counter hears at once.

-- ACK records the kitchen's full visible lines, notes included, as the old ACK
-- records them without: both boards compare their own way (R4).
create function public.kitchen_acknowledge_v2(
  p_id uuid, p_order_id uuid, p_kind text, p_order_version timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.kitchen_acknowledgements%rowtype;
  v_shift public.counter_shifts%rowtype;
  v_device public.counter_devices%rowtype;
  v_order public.orders%rowtype;
begin
  if p_id is null or p_order_id is null or p_order_version is null
     or p_kind is null or p_kind not in ('new', 'edit', 'cancel') then
    return jsonb_build_object('status', 'invalid');
  end if;
  select s.* into v_shift from public.counter_shifts s where s.id = public.app_kitchen_shift();
  if not found then
    return jsonb_build_object('status', 'not_authorised');
  end if;
  select * into v_existing from public.kitchen_acknowledgements where id = p_id;
  if found then
    if v_existing.device_id = v_shift.device_id and v_existing.order_id = p_order_id
       and v_existing.kind = p_kind and v_existing.order_version = p_order_version then
      return jsonb_build_object('status', 'accepted', 'replay', true);
    end if;
    return jsonb_build_object('status', 'identity_conflict');
  end if;
  select * into v_order from public.orders where id = p_order_id and outlet_id = v_shift.outlet_id;
  if not found then
    return jsonb_build_object('status', 'not_authorised');
  end if;
  if public.kitchen_order_version(v_order) <> p_order_version then
    return jsonb_build_object('status', 'stale');
  end if;
  select * into v_device from public.counter_devices where id = v_shift.device_id;
  insert into public.kitchen_acknowledgements
    (id, outlet_id, device_id, shift_id, person_id, order_id, kind, order_version, lines)
  values
    (p_id, v_shift.outlet_id, v_shift.device_id, v_shift.id, v_shift.person_id, p_order_id,
     p_kind, p_order_version,
     public.kitchen_visible_lines_v2(p_order_id, v_device.kitchen_filter_mode,
                                     v_device.kitchen_category_ids));
  return jsonb_build_object('status', 'accepted');
end;
$$;

-- Ready records the lines and quantities the cook was shown; a stale quantity is
-- what was made (D5). It answers for ACK in the data: with no acknowledgement of
-- the order's current version from this kitchen, one is recorded first, so the
-- old board and the old bell read the order as seen if the gates turn off (R4).
create function public.kitchen_ready_v2(p_id uuid, p_order_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.counter_shifts%rowtype;
  v_device public.counter_devices%rowtype;
  v_order public.orders%rowtype;
  v_held public.kitchen_readies%rowtype;
  v_line jsonb;
  v_ids uuid[] := '{}';
  v_line_id uuid;
  v_version timestamptz;
begin
  select * into v_shift from public.counter_shifts where id = public.app_kitchen_shift();
  if not found then return jsonb_build_object('status', 'not_authorised'); end if;
  begin
    if p_id is null or p_order_id is null or jsonb_typeof(p_lines) is distinct from 'array'
       or jsonb_array_length(p_lines) = 0 then
      raise exception 'shape';
    end if;
    for v_line in select value from jsonb_array_elements(p_lines) loop
      if not public.billing_payload_has_keys(v_line, array['id','quantity'])
         or jsonb_typeof(v_line->'id') is distinct from 'string'
         or jsonb_typeof(v_line->'quantity') is distinct from 'number'
         or (v_line->>'quantity') !~ '^[0-9]+$'
         or (v_line->>'quantity')::integer <= 0 then
        raise exception 'shape';
      end if;
      v_line_id := (v_line->>'id')::uuid;
      if v_line_id = any(v_ids) then raise exception 'duplicate'; end if;
      v_ids := array_append(v_ids, v_line_id);
    end loop;
  exception when others then return jsonb_build_object('status', 'invalid'); end;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 74));
  select * into v_held from public.kitchen_readies where id = p_id;
  if found then
    if v_held.device_id = v_shift.device_id and v_held.order_id = p_order_id
       and v_held.lines = p_lines and v_held.undoes is null then
      return jsonb_build_object('status', 'accepted', 'replay', true);
    end if;
    return jsonb_build_object('status', 'identity_conflict');
  end if;
  select * into v_order from public.orders
   where id = p_order_id and outlet_id = v_shift.outlet_id for update;
  if not found then return jsonb_build_object('status', 'not_authorised'); end if;
  if v_order.status = 'cancelled' or (v_order.status = 'paid' and v_order.prepared_at is not null) then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_device from public.counter_devices where id = v_shift.device_id;
  -- Every captured line must still belong to this order and this kitchen's filter.
  if exists (
       select 1
         from unnest(v_ids) as requested(id)
         left join public.order_items i on i.id = requested.id
         left join public.menu_items m on m.id = i.menu_item_id
        where i.id is null or i.order_id <> v_order.id or i.kind <> 'item'
           or not public.kitchen_line_visible(m.category_id, v_device.kitchen_filter_mode,
                                              v_device.kitchen_category_ids)) then
    return jsonb_build_object('status', 'not_authorised');
  end if;
  v_version := public.kitchen_order_version(v_order);
  if not exists (select 1 from public.kitchen_acknowledgements a
                  where a.order_id = v_order.id and a.device_id = v_device.id
                    and a.order_version = v_version) then
    insert into public.kitchen_acknowledgements
      (id, outlet_id, device_id, shift_id, person_id, order_id, kind, order_version, lines)
    values
      (gen_random_uuid(), v_shift.outlet_id, v_device.id, v_shift.id, v_shift.person_id,
       v_order.id,
       case when exists (select 1 from public.kitchen_acknowledgements a
                          where a.order_id = v_order.id and a.device_id = v_device.id
                            and a.kind = 'new')
            then 'edit' else 'new' end,
       v_version,
       public.kitchen_visible_lines_v2(v_order.id, v_device.kitchen_filter_mode,
                                       v_device.kitchen_category_ids));
  end if;
  insert into public.kitchen_readies (id, outlet_id, device_id, shift_id, person_id, order_id, lines)
  values (p_id, v_shift.outlet_id, v_shift.device_id, v_shift.id, v_shift.person_id, v_order.id, p_lines);
  insert into public.kitchen_pulses (outlet_id, bumped_at) values (v_shift.outlet_id, clock_timestamp())
    on conflict (outlet_id) do update set bumped_at = excluded.bumped_at;
  return jsonb_build_object('status', 'accepted');
end;
$$;

-- Undo appends a row pointing at the Ready it reverses. No time window; it never
-- touches the counter's handover (D5).
create function public.kitchen_ready_undo_v2(p_id uuid, p_ready_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.counter_shifts%rowtype;
  v_ready public.kitchen_readies%rowtype;
  v_held public.kitchen_readies%rowtype;
begin
  select * into v_shift from public.counter_shifts where id = public.app_kitchen_shift();
  if not found then return jsonb_build_object('status', 'not_authorised'); end if;
  if p_id is null or p_ready_id is null then return jsonb_build_object('status', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 74));
  select * into v_held from public.kitchen_readies where id = p_id;
  if found then
    if v_held.device_id = v_shift.device_id and v_held.undoes = p_ready_id then
      return jsonb_build_object('status', 'accepted', 'replay', true);
    end if;
    return jsonb_build_object('status', 'identity_conflict');
  end if;
  select * into v_ready from public.kitchen_readies where id = p_ready_id for update;
  if not found or v_ready.device_id <> v_shift.device_id or v_ready.outlet_id <> v_shift.outlet_id
     or v_ready.undoes is not null then
    return jsonb_build_object('status', 'not_authorised');
  end if;
  -- One Undo is enough, even when another tap raced it.
  if exists (select 1 from public.kitchen_readies where undoes = v_ready.id) then
    return jsonb_build_object('status', 'accepted');
  end if;
  insert into public.kitchen_readies (id, outlet_id, device_id, shift_id, person_id, order_id, lines, undoes)
  values (p_id, v_shift.outlet_id, v_shift.device_id, v_shift.id, v_shift.person_id,
          v_ready.order_id, '[]', v_ready.id);
  insert into public.kitchen_pulses (outlet_id, bumped_at) values (v_shift.outlet_id, clock_timestamp())
    on conflict (outlet_id) do update set bumped_at = excluded.bumped_at;
  return jsonb_build_object('status', 'accepted');
end;
$$;

revoke execute on function
  public.kitchen_visible_lines_v2(uuid, text, uuid[]),
  public.kitchen_owed_v2(jsonb, text, uuid[]),
  public.kitchen_owed_snapshot_v2(jsonb, jsonb),
  public.kitchen_same_lines_v2(jsonb, jsonb),
  public.kitchen_ticket_v2(public.orders, public.counter_devices, jsonb),
  public.kitchen_receipts_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;

revoke execute on function
  public.kitchen_board_v2(),
  public.counter_kitchen_marks_v2(),
  public.kitchen_acknowledge_v2(uuid, uuid, text, timestamptz),
  public.kitchen_ready_v2(uuid, uuid, jsonb),
  public.kitchen_ready_undo_v2(uuid, uuid)
  from public, anon;
grant execute on function
  public.kitchen_board_v2(),
  public.counter_kitchen_marks_v2(),
  public.kitchen_acknowledge_v2(uuid, uuid, text, timestamptz),
  public.kitchen_ready_v2(uuid, uuid, jsonb),
  public.kitchen_ready_undo_v2(uuid, uuid)
  to authenticated;
