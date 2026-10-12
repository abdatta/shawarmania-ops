-- #74: dish handover belongs to the counter; Ready belongs to the kitchen.
-- Labels and notes never enter bills. Old offline envelopes remain accepted.

alter table public.orders add column label text
  constraint orders_label_shape check (label is null or
    (label = btrim(label) and length(label) between 1 and 24));
alter table public.order_items add column note text
  constraint order_items_note_shape check (note is null or
    (kind = 'item' and note = btrim(note) and length(note) between 1 and 60));

create table public.order_line_preparations (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id),
  order_id uuid not null references public.orders(id),
  quantity integer not null check (quantity > 0),
  prepared_at timestamptz not null,
  shift_id uuid not null references public.counter_shifts(id),
  person_id uuid not null references public.profiles(id)
);
create index order_line_preparations_order_idx on public.order_line_preparations(order_id);
alter table public.order_line_preparations enable row level security;
create policy order_line_preparations_select on public.order_line_preparations
  for select to authenticated using (public.app_device_ok() and (
    outlet_id = (select public.app_counter_shift_outlet())
    or (public.app_account_active() and ((select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));
revoke all on public.order_line_preparations from anon, authenticated;
grant select on public.order_line_preparations to authenticated;

create table public.kitchen_readies (
  id uuid primary key,
  outlet_id uuid not null references public.outlets(id),
  device_id uuid not null references public.counter_devices(id),
  shift_id uuid not null references public.counter_shifts(id),
  person_id uuid not null references public.profiles(id),
  order_id uuid not null references public.orders(id),
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  undoes uuid references public.kitchen_readies(id),
  at timestamptz not null default clock_timestamp()
);
create index kitchen_readies_order_idx on public.kitchen_readies(order_id,device_id,at,id);
create unique index kitchen_readies_one_undo on public.kitchen_readies(undoes) where undoes is not null;
alter table public.kitchen_readies enable row level security;
create policy kitchen_readies_select on public.kitchen_readies for select to authenticated
  using (public.app_device_ok() and (
    (device_id = auth.uid() and outlet_id = (select public.app_kitchen_shift_outlet()))
    or (public.app_account_active() and ((select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));
revoke all on public.kitchen_readies from anon, authenticated;
grant select on public.kitchen_readies to authenticated;
create trigger kitchen_readies_append_only before update or delete on public.kitchen_readies
  for each row execute function public.kitchen_acknowledgements_append_only();

-- Preserve the counter's already-recorded handovers. Day-change stamps remain
-- order facts only, and do not manufacture dish handovers.
insert into public.order_line_preparations
  (order_item_id,outlet_id,order_id,quantity,prepared_at,shift_id,person_id)
select i.id,o.outlet_id,o.id,i.quantity,o.prepared_at,o.created_shift_id,o.created_by
from public.orders o join public.order_items i on i.order_id=o.id and i.kind='item'
where o.prepared_source='counter' and o.created_shift_id is not null;

alter table public.billing_commands drop constraint billing_commands_command_type_check;
alter table public.billing_commands add constraint billing_commands_command_type_check
  check (command_type in ('create_order','revise_order','cancel_order','pay_order','pay_now',
    'correct_bill_payment','void_bill','manager_cancel_order','confirm_end_of_day',
    'set_order_preparation','void_order_payment','cancel_paid_order','prepare_order_lines'));

create function public.billing_dish_payload_ok(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if p ? 'label' and (jsonb_typeof(p->'label') not in ('string','null')
    or length(btrim(p->>'label')) > 24) then return false; end if;
  if jsonb_typeof(p->'lines') is distinct from 'array' then return false; end if;
  return not exists (select 1 from jsonb_array_elements(p->'lines') l
    where l ? 'note' and (jsonb_typeof(l->'note') not in ('string','null')
      or length(btrim(l->>'note')) > 60
      or (coalesce(l->>'kind','item') <> 'item' and nullif(btrim(l->>'note'),'') is not null)));
end;
$$;

create function public.dish_ready_quantity(p_line uuid) returns integer
language sql stable security definer set search_path='' as $$
  select least(i.quantity,coalesce((select sum((l->>'quantity')::integer)
    from public.kitchen_readies r cross join lateral jsonb_array_elements(r.lines) l
    where r.order_id=i.order_id and r.undoes is null and l->>'id'=i.id::text
      and not exists(select 1 from public.kitchen_readies u where u.undoes=r.id)),0))::integer
  from public.order_items i where i.id=p_line
$$;
create function public.dish_line_locked(p_line uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.order_line_preparations where order_item_id=p_line)
    or coalesce(public.dish_ready_quantity(p_line),0)>0
$$;

create function public.derive_dish_preparation(p_order uuid,p_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; all_ticked boolean;
begin
  select * into o from public.orders where id=p_order for update;
  select not exists(select 1 from public.order_items i
    left join public.order_line_preparations p on p.order_item_id=i.id
    where i.order_id=p_order and i.kind='item' and coalesce(p.quantity,0)<i.quantity)
    into all_ticked;
  if all_ticked then
    if o.prepared_at is null or (o.prepared_source='day_change' and p_at<o.prepared_at) then
      update public.orders set prepared_at=p_at,prepared_source='counter' where id=p_order;
    end if;
  elsif o.status='open' and o.prepared_source='counter' then
    update public.orders set prepared_at=null,prepared_source=null where id=p_order;
  end if;
end;
$$;

create function public.prepare_order_lines(
  p_command_id uuid default null,p_schema_version integer default null,
  p_payload_hash text default null,p_created_at timestamptz default null,
  p_shift_id uuid default null,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare err text; ctx jsonb; claim jsonb; o public.orders%rowtype; oid uuid;
  l jsonb; ids uuid[]:='{}'; lid uuid;
begin
  err:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['orderId','lines']);
  if err is not null then return jsonb_build_object('status',err); end if;
  begin
    if jsonb_typeof(p_payload->'orderId') is distinct from 'string'
      or jsonb_typeof(p_payload->'lines') is distinct from 'array'
      or jsonb_array_length(p_payload->'lines')=0 then raise exception 'shape'; end if;
    oid:=(p_payload->>'orderId')::uuid;
    for l in select value from jsonb_array_elements(p_payload->'lines') loop
      if not public.billing_payload_has_keys(l,array['id','prepared'])
        or jsonb_typeof(l->'id') is distinct from 'string'
        or jsonb_typeof(l->'prepared') is distinct from 'boolean' then raise exception 'shape'; end if;
      lid:=(l->>'id')::uuid;
      if lid=any(ids) then raise exception 'duplicate'; end if;
      ids:=array_append(ids,lid);
    end loop;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  ctx:=public.billing_device_context(p_shift_id,p_created_at);
  if ctx->>'status'<>'ok' then return ctx; end if;
  claim:=public.billing_begin_command(p_command_id,'prepare_order_lines',p_schema_version,
    p_payload_hash,p_created_at,(ctx->>'outletId')::uuid,auth.uid(),p_shift_id,(ctx->>'actorId')::uuid);
  if claim->>'status'<>'claimed' then return claim; end if;
  select * into o from public.orders where id=oid for update;
  if not found or o.outlet_id<>(ctx->>'outletId')::uuid or o.device_id<>auth.uid() then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'));
  end if;
  if p_created_at<o.ordered_at then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','malformed_payload'),o.business_date);
  end if;
  if o.status='cancelled' or (o.status='paid' and o.prepared_at is not null
    and o.prepared_source is distinct from 'day_change')
    or (o.status='paid' and exists(select 1 from jsonb_array_elements(p_payload->'lines') x
      where x->>'prepared'='false')) then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
      'orderId',o.id,'orderNumber',o.order_number),o.business_date);
  end if;
  if exists(select 1 from public.order_items i where i.id=any(ids)
      and (i.order_id<>oid or i.kind<>'item')) then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'),o.business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  for l in select value from jsonb_array_elements(p_payload->'lines') loop
    lid:=(l->>'id')::uuid;
    if (l->>'prepared')::boolean then
      insert into public.order_line_preparations
        (order_item_id,outlet_id,order_id,quantity,prepared_at,shift_id,person_id)
      select i.id,o.outlet_id,o.id,i.quantity,p_created_at,p_shift_id,(ctx->>'actorId')::uuid
        from public.order_items i where i.id=lid and i.order_id=oid and i.kind='item'
      on conflict(order_item_id) do update set quantity=excluded.quantity,
        prepared_at=excluded.prepared_at,shift_id=excluded.shift_id,person_id=excluded.person_id;
    else
      delete from public.order_line_preparations where order_item_id=lid and order_id=oid;
    end if;
  end loop;
  perform public.derive_dish_preparation(oid,p_created_at);
  -- Partial ticks must nudge the board too, even if Prepared did not move.
  insert into public.kitchen_pulses(outlet_id,bumped_at) values(o.outlet_id,clock_timestamp())
    on conflict(outlet_id) do update set bumped_at=excluded.bumped_at;
  return public.billing_finish_command(p_command_id,jsonb_build_object('status','accepted',
    'commandId',p_command_id,'orderId',o.id,'orderNumber',o.order_number,
    'delayed',(ctx->>'delayed')::boolean),o.business_date);
end;
$$;

revoke execute on function public.prepare_order_lines(uuid,integer,text,timestamptz,uuid,jsonb) from public,anon;
grant execute on function public.prepare_order_lines(uuid,integer,text,timestamptz,uuid,jsonb) to authenticated;
revoke execute on function public.billing_dish_payload_ok(jsonb),public.dish_ready_quantity(uuid),
  public.dish_line_locked(uuid),public.derive_dish_preparation(uuid,timestamptz) from public,anon,authenticated;


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
  if p_schema_version is null or p_schema_version not in (1, 2, 3, 4) then
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
    when 1 then public.billing_payload_has_keys(case when p_keys @> array['lines','pricingMode'] then p_payload - 'label' else p_payload end, p_keys)
    when 2 then public.billing_payload_has_keys(case when p_keys @> array['lines','pricingMode'] then p_payload - 'label' else p_payload end, p_keys || p_extra_keys)
    -- Version 4 adds a field inside a discount entry, and no top-level key.
    else public.billing_payload_has_keys(case when p_keys @> array['lines','pricingMode'] then p_payload - 'label' else p_payload end, p_keys || p_extra_keys || p_v3_keys)
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
      public.billing_payload_has_keys(v_line - 'note', array[
        'id', 'menuItemId', 'itemName', 'unitPricePaise', 'quantity', 'lineTotalPaise'])
      or public.billing_payload_has_keys(v_line - 'note', array[
        'id', 'menuItemId', 'itemName', 'unitPricePaise', 'quantity', 'lineTotalPaise',
        'discountPaise', 'discountPercentBp', 'categoryName'])
      or public.billing_payload_has_keys(v_line - 'note', array[
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

create or replace function public.billing_order_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.billing_command', true) is distinct from '1' then
    raise exception 'orders may change only through billing commands' using errcode = '42501';
  end if;
  if new.status = 'cancelled' or (new.status = 'paid' and new.prepared_at is not null) then
    new.label := null;
  end if;
  if old.status = 'paid' and new.label is distinct from old.label
     and not (new.label is null and (new.status='cancelled'
       or (new.status='paid' and new.prepared_at is not null))) then
    raise exception 'a paid label may only be cleared';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'orders cannot be deleted';
  end if;
  if old.status = 'cancelled' then
    raise exception 'paid and cancelled orders are immutable';
  end if;
  if old.status = 'paid' then
    if new.status = 'open' then
      -- The payment unwind: status and the paid-attribution pair leave together,
      -- and a preparation the day change stamped leaves with them, because it
      -- was premised on the payment the unwind removes.
      if (to_jsonb(new) - 'label' - array['status','paid_by','paid_shift_id','paid_at','bill_id',
          'prepared_at','prepared_source'])
         is distinct from
         (to_jsonb(old) - 'label' - array['status','paid_by','paid_shift_id','paid_at','bill_id',
          'prepared_at','prepared_source']) then
        raise exception 'payment unwind changed order facts';
      end if;
      return new;
    end if;
    if new.status = 'cancelled' then
      -- Cancel-after-paid: the paid attribution clears (the pairing
      -- constraints require it) and the cancellation attribution arrives, in
      -- the same transaction as its bill's void.
      if (to_jsonb(new) - 'label' - array['status','paid_by','paid_shift_id','paid_at','bill_id',
          'cancelled_by','cancelled_device_id','cancelled_shift_id','cancelled_at','cancel_reason'])
         is distinct from
         (to_jsonb(old) - 'label' - array['status','paid_by','paid_shift_id','paid_at','bill_id',
          'cancelled_by','cancelled_device_id','cancelled_shift_id','cancelled_at','cancel_reason']) then
        raise exception 'cancellation changed order facts';
      end if;
      return new;
    end if;
    -- Remaining paid: only preparation may move -- the upfront payer's tick, or
    -- the day change finishing what nobody ticked.
    if new.status <> 'paid' then
      raise exception 'invalid order transition';
    end if;
    if (to_jsonb(new) - 'label' - array['prepared_at','prepared_source'])
       is distinct from
       (to_jsonb(old) - 'label' - array['prepared_at','prepared_source']) then
      raise exception 'payment changed order facts';
    end if;
    return new;
  end if;
  if new.status = 'open' then
    if (to_jsonb(new) - 'label' - array['customer_id','customer_name','customer_phone',
        'subtotal_paise','discount_paise','tax_paise','rounding_paise','total_paise','pricing_mode',
        'changed_by','changed_shift_id','changed_at','prepared_at','prepared_source',
        'service_type','table_number','table_shared'])
       is distinct from
       (to_jsonb(old) - 'label' - array['customer_id','customer_name','customer_phone',
        'subtotal_paise','discount_paise','tax_paise','rounding_paise','total_paise','pricing_mode',
        'changed_by','changed_shift_id','changed_at','prepared_at','prepared_source',
        'service_type','table_number','table_shared']) then
      raise exception 'revision changed immutable order facts';
    end if;
  elsif new.status = 'paid' then
    if (to_jsonb(new) - 'label' - array['status','paid_by','paid_shift_id','paid_at','bill_id','prepared_at','prepared_source'])
       is distinct from
       (to_jsonb(old) - 'label' - array['status','paid_by','paid_shift_id','paid_at','bill_id','prepared_at','prepared_source']) then
      raise exception 'payment changed order facts';
    end if;
  elsif new.status = 'cancelled' then
    if (to_jsonb(new) - 'label' - array['status','cancelled_by','cancelled_device_id',
        'cancelled_shift_id','cancelled_at','cancel_reason'])
       is distinct from
       (to_jsonb(old) - 'label' - array['status','cancelled_by','cancelled_device_id',
        'cancelled_shift_id','cancelled_at','cancel_reason']) then
      raise exception 'cancellation changed order facts';
    end if;
  else
    raise exception 'invalid order transition';
  end if;
  return new;
end;
$$;

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
      service_type, table_number, label)
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
      (p_payload ->> 'tableNumber')::smallint, nullif(btrim(p_payload ->> 'label'),''));

    insert into public.order_items
      (id, order_id, menu_item_id, item_name, unit_price_paise, quantity, line_total_paise,
       discount_paise, discount_percent_bp, category_name, kind, note)
    select (line ->> 'id')::uuid, v_order, nullif(line ->> 'menuItemId','')::uuid,
      line ->> 'itemName', (line ->> 'unitPricePaise')::bigint,
      (line ->> 'quantity')::integer, (line ->> 'lineTotalPaise')::bigint,
      coalesce((line ->> 'discountPaise')::bigint, 0),
      nullif(line ->> 'discountPercentBp','')::integer,
      nullif(line ->> 'categoryName',''),
      coalesce(line ->> 'kind', 'item')::public.line_kind, nullif(btrim(line ->> 'note'),'')
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
  begin
  -- A version-1 or version-2 revision carries no type or table, and so leaves
  -- the order's as they are rather than clearing them: it was written by a
  -- till that could not have meant to change what it did not know about.
  update public.orders set
    label=case when p_payload ? 'label' then nullif(btrim(p_payload->>'label'),'') else label end,
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
     discount_paise,discount_percent_bp,category_name,kind,note)
  select (line->>'id')::uuid,v_order.id,nullif(line->>'menuItemId','')::uuid,
    line->>'itemName',(line->>'unitPricePaise')::bigint,(line->>'quantity')::integer,
    (line->>'lineTotalPaise')::bigint,
    coalesce((line->>'discountPaise')::bigint,0),
    nullif(line->>'discountPercentBp','')::integer,
    nullif(line->>'categoryName',''),
    coalesce(line->>'kind','item')::public.line_kind, nullif(btrim(line->>'note'),'')
    from jsonb_array_elements(p_payload->'lines') line
  on conflict (id) do update set quantity=excluded.quantity,line_total_paise=excluded.line_total_paise,
    discount_paise=excluded.discount_paise,discount_percent_bp=excluded.discount_percent_bp,
    category_name=excluded.category_name,
    note=case when public.dish_line_locked(public.order_items.id)
         then public.order_items.note
         when exists (select 1 from jsonb_array_elements(p_payload->'lines') l
           where l->>'id'=excluded.id::text and l ? 'note') then excluded.note
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
  perform public.derive_dish_preparation(v_order.id,p_created_at);
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'orderId',v_order.id,
    'orderNumber',v_order.order_number,'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_order.business_date);
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
  if not public.billing_dish_payload_ok(p_payload) then
    return jsonb_build_object('status','malformed_payload');
  end if;
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
     or not (public.billing_content_payload_well_typed(p_payload)
       and public.billing_points_shape_ok(p_payload, p_schema_version)) then
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
    insert into public.bill_discounts (bill_id,outlet_id,basis,value_bp,value_paise,amount_paise,source)
    select v_bill,v_outlet,(d->>'basis')::public.discount_basis,
      nullif(d->>'valueBp','')::integer,nullif(d->>'valuePaise','')::bigint,
      (d->>'amountPaise')::bigint,
      coalesce(d->>'source','biller')::public.discount_row_source
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


create or replace function public.prepare_billing_order(
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
  v_prepared boolean; v_order_id uuid; v_new_status text;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['orderId','prepared']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'prepared')<>'boolean' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  begin
    v_order_id:=(p_payload->>'orderId')::uuid;
    v_prepared:=(p_payload->>'prepared')::boolean;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_order_id is null or v_prepared is null then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context:=public.billing_device_context(p_shift_id,p_created_at);
  if v_context->>'status'<>'ok' then return v_context; end if;
  v_claim:=public.billing_begin_command(p_command_id,'set_order_preparation',p_schema_version,
    p_payload_hash,p_created_at,(v_context->>'outletId')::uuid,auth.uid(),p_shift_id,
    (v_context->>'actorId')::uuid);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;
  select * into v_order from public.orders where id=v_order_id for update;
  if not found or v_order.outlet_id<>(v_context->>'outletId')::uuid or v_order.device_id<>auth.uid() then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'));
  end if;
  if p_created_at < v_order.ordered_at then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','malformed_payload','commandId',p_command_id),v_order.business_date);
  end if;
  -- Reprepare is an unpaid-order action: the bills border is terminal in that
  -- direction. Marking prepared completes either an open order or the upfront
  -- payer's paid-but-unprepared one -- or one the day change finished while
  -- this tick sat in an offline tablet's queue, which is accepted below rather
  -- than handed back to the biller as needs-attention work.
  if v_order.status='cancelled'
     or (not v_prepared and v_order.status<>'open')
     or (v_prepared and v_order.status='paid' and v_order.prepared_at is not null
         and v_order.prepared_source is distinct from 'day_change') then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
      'orderStatus',v_order.status,'commandId',p_command_id),v_order.business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  if v_prepared then
    insert into public.order_line_preparations
      (order_item_id,outlet_id,order_id,quantity,prepared_at,shift_id,person_id)
    select i.id,v_order.outlet_id,v_order.id,i.quantity,p_created_at,p_shift_id,(v_context->>'actorId')::uuid
      from public.order_items i where i.order_id=v_order.id and i.kind='item'
    on conflict(order_item_id) do update set quantity=excluded.quantity,
      prepared_at=excluded.prepared_at,shift_id=excluded.shift_id,person_id=excluded.person_id;
  else
    delete from public.order_line_preparations where order_id=v_order.id;
  end if;
  if v_prepared and v_order.prepared_source='day_change' then
    -- The counter's record is the truer one: the tick was made, only late. An
    -- earlier tick replaces the cutover with its own time and attribution; a
    -- later one (which no live shift could have issued) changes nothing.
    if p_created_at<v_order.prepared_at then
      update public.orders set prepared_at=p_created_at,prepared_source='counter'
        where id=v_order.id;
    end if;
  else
    update public.orders set prepared_at=case when v_prepared then p_created_at end,
      prepared_source=case when v_prepared then 'counter' end
      where id=v_order.id;
  end if;
  v_new_status:=v_order.status;
  return public.billing_finish_command(p_command_id,jsonb_build_object('status','accepted',
    'commandId',p_command_id,'orderId',v_order.id,'orderNumber',v_order.order_number,
    'orderStatus',v_new_status,'prepared',v_prepared,
    'delayed',(v_context->>'delayed')::boolean),v_order.business_date);
end;
$$;
