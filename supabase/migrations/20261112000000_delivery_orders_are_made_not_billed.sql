-- delivery-orders-are-made-not-billed (#83): an outlet may offer Delivery,
-- whose orders the kitchen makes and the counter hands to a rider without a
-- bill; every order's label is kept after it leaves the rail; and the figure
-- pages can read delivery orders alone.
-- change-gate: delivery-orders
--
-- Everything here is new or added, except two statements the owner agreed to on
-- 2026-11-01 (design D3): `billing_order_guard` is replaced by today's body plus
-- two branches, and the closed list of billing command kinds is widened by two.
-- No published build writes `handed_over`, a delivery row or either new kind,
-- so every write it makes takes the same path it takes today.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('delivery-orders', 'DO', 'change', 'Delivery orders',
   'An outlet may offer Delivery, whose orders the kitchen makes and the counter hands to a rider without a bill, labels are kept after an order leaves the rail, and Stats, Billing History, Items and Sales can show delivery orders alone.',
   'Every order is billed or cancelled, labels go when an order leaves the rail, and no page shows delivery orders.',
   'delivery-orders-are-made-not-billed', 83);

-- ---------------------------------------------------------------------------
-- 1. Handed over, and Delivery offered (design D2, D7).

-- Not open, so the rail, the kitchen board, readiness and the commands that
-- require `open` all leave a handed-over order alone without being touched.
alter type public.order_status add value if not exists 'handed_over';

-- Off for every outlet until its owner or manager turns it on, as the other
-- service choices are. Written only through `set_outlet_service_settings_v2`.
alter table public.outlets
  add column delivery_offered boolean not null default false;

comment on column public.outlets.delivery_offered is
  'The counter offers Delivery: an order the kitchen makes and the counter hands to a rider without a bill (delivery-orders-are-made-not-billed).';

-- The two new commands record their own kinds (design D3, agreed 2026-11-01).
-- release-lint: allow drop, constraint — widened so the two delivery commands can record their own kinds; every kind a published build writes is still allowed, and no build reads the list (owner agreed 2026-11-01, design D3)
alter table public.billing_commands
  drop constraint billing_commands_command_type_check,
  add constraint billing_commands_command_type_check
    check (command_type in ('create_order','revise_order','cancel_order','pay_order','pay_now',
      'correct_bill_payment','void_bill','manager_cancel_order','confirm_end_of_day',
      'set_order_preparation','void_order_payment','cancel_paid_order','prepare_order_lines',
      'hand_over_delivery','take_back_delivery_handover'));

-- ---------------------------------------------------------------------------
-- 2. The three tables (design D1, D4, D5). Each is read as `order_labels` is —
-- a live counter shift at its own outlet, the outlet's Franchise Admins and the
-- owner — and written only inside the commands and the trigger. No kitchen:
-- the kitchen learns Delivery through `kitchen_board_v3`'s flag alone.

-- An order is a delivery order exactly while its row exists. The handover's
-- attribution lives here, not on `orders`, so the guard needs no new column.
-- `handover_prior_ticks` is what the handover changed of the counter's ticks,
-- so a take-back puts back exactly those and nothing else (design D4).
create table public.delivery_orders (
  order_id uuid primary key references public.orders (id),
  outlet_id uuid not null references public.outlets (id),
  marked_at timestamptz not null,
  handed_over_at timestamptz,
  handed_over_by uuid references public.profiles (id),
  handed_over_shift_id uuid references public.counter_shifts (id),
  handed_over_device_id uuid references public.counter_devices (id),
  handover_command_id uuid,
  handover_prior_ticks jsonb,
  constraint delivery_orders_handover_together check (
    (handed_over_at is null) = (handed_over_by is null)
    and (handed_over_at is null) = (handed_over_shift_id is null)
    and (handed_over_at is null) = (handed_over_device_id is null)
    and (handed_over_at is null) = (handover_command_id is null)
    and (handed_over_at is null) = (handover_prior_ticks is null))
);

create index delivery_orders_outlet_idx on public.delivery_orders (outlet_id);
create index delivery_orders_handover_shift_idx
  on public.delivery_orders (handed_over_shift_id) where handed_over_shift_id is not null;

-- One row per take-back: the handover it undid, who took it back, when and why.
create table public.delivery_handover_takebacks (
  id uuid primary key,
  order_id uuid not null references public.orders (id),
  outlet_id uuid not null references public.outlets (id),
  handed_over_at timestamptz not null,
  handed_over_by uuid not null references public.profiles (id),
  handover_command_id uuid not null,
  taken_back_at timestamptz not null,
  taken_back_by uuid not null references public.profiles (id),
  taken_back_shift_id uuid not null references public.counter_shifts (id),
  taken_back_device_id uuid not null references public.counter_devices (id),
  reason text not null
    constraint delivery_handover_takebacks_reason_shape check (length(btrim(reason)) > 0)
);

create index delivery_handover_takebacks_order_idx on public.delivery_handover_takebacks (order_id);
create index delivery_handover_takebacks_outlet_idx on public.delivery_handover_takebacks (outlet_id);

-- The label an order carried when it left the rail. Never written to a bill, a
-- receipt, an SMS, a public link or an export, and never a customer's name.
create table public.kept_order_labels (
  order_id uuid primary key references public.orders (id),
  outlet_id uuid not null references public.outlets (id),
  label text not null
    constraint kept_order_labels_label_shape check (label = btrim(label) and length(label) between 1 and 24),
  kept_at timestamptz not null
);

create index kept_order_labels_outlet_idx on public.kept_order_labels (outlet_id);

alter table public.delivery_orders enable row level security;
alter table public.delivery_handover_takebacks enable row level security;
alter table public.kept_order_labels enable row level security;

create policy delivery_orders_select on public.delivery_orders
  for select to authenticated using (public.app_device_ok() and (
    outlet_id = (select public.app_counter_shift_outlet())
    or (public.app_account_active() and ((select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

create policy delivery_handover_takebacks_select on public.delivery_handover_takebacks
  for select to authenticated using (public.app_device_ok() and (
    outlet_id = (select public.app_counter_shift_outlet())
    or (public.app_account_active() and ((select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

create policy kept_order_labels_select on public.kept_order_labels
  for select to authenticated using (public.app_device_ok() and (
    outlet_id = (select public.app_counter_shift_outlet())
    or (public.app_account_active() and ((select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

revoke all on public.delivery_orders, public.delivery_handover_takebacks, public.kept_order_labels
  from anon, authenticated;
grant select on public.delivery_orders, public.delivery_handover_takebacks, public.kept_order_labels
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The order guard (design D3). Today's body, from
-- 20261017000000_restore_counter_before_dish_ticks, with two branches added and
-- nothing else changed. Both branches are reached only from inside
-- `hand_over_delivery_order` and `take_back_delivery_handover`, which set
-- `app.delivery_handover`; they read no gate, so a handover or take-back queued
-- while the gate was on still lands after it is turned off (design D9).

-- release-lint: allow function-change — today's body verbatim plus a handover branch and a take-back branch that only the two new delivery commands reach; no published build writes handed_over, so every write it makes takes today's path (owner agreed 2026-11-01, design D3)
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
  -- delivery-orders: a handed-over order changes only by its take-back, which
  -- reopens it and moves nothing else.
  if old.status::text = 'handed_over' then
    if current_setting('app.delivery_handover', true) = '1'
       and new.status = 'open'
       and (to_jsonb(new) - 'status') is not distinct from (to_jsonb(old) - 'status') then
      return new;
    end if;
    raise exception 'handed-over orders are immutable';
  end if;
  if old.status = 'cancelled' then
    raise exception 'paid and cancelled orders are immutable';
  end if;
  if old.status = 'paid' then
    if new.status = 'open' then
      -- The payment unwind: status and the paid-attribution pair leave together,
      -- and a preparation the day change stamped leaves with them, because it
      -- was premised on the payment the unwind removes.
      if (to_jsonb(new) - array['status','paid_by','paid_shift_id','paid_at','bill_id',
          'prepared_at','prepared_source'])
         is distinct from
         (to_jsonb(old) - array['status','paid_by','paid_shift_id','paid_at','bill_id',
          'prepared_at','prepared_source']) then
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
    -- Remaining paid: only preparation may move -- the upfront payer's tick, or
    -- the day change finishing what nobody ticked.
    if new.status <> 'paid' then
      raise exception 'invalid order transition';
    end if;
    if (to_jsonb(new) - array['prepared_at','prepared_source'])
       is distinct from
       (to_jsonb(old) - array['prepared_at','prepared_source']) then
      raise exception 'payment changed order facts';
    end if;
    return new;
  end if;
  if new.status = 'open' then
    if (to_jsonb(new) - array['customer_id','customer_name','customer_phone',
        'subtotal_paise','discount_paise','tax_paise','rounding_paise','total_paise','pricing_mode',
        'changed_by','changed_shift_id','changed_at','prepared_at','prepared_source',
        'service_type','table_number','table_shared'])
       is distinct from
       (to_jsonb(old) - array['customer_id','customer_name','customer_phone',
        'subtotal_paise','discount_paise','tax_paise','rounding_paise','total_paise','pricing_mode',
        'changed_by','changed_shift_id','changed_at','prepared_at','prepared_source',
        'service_type','table_number','table_shared']) then
      raise exception 'revision changed immutable order facts';
    end if;
  elsif new.status = 'paid' then
    if (to_jsonb(new) - array['status','paid_by','paid_shift_id','paid_at','bill_id','prepared_at','prepared_source'])
       is distinct from
       (to_jsonb(old) - array['status','paid_by','paid_shift_id','paid_at','bill_id','prepared_at','prepared_source']) then
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
  elsif new.status::text = 'handed_over' then
    -- delivery-orders: an open delivery order is handed over, and only its
    -- status moves; the handover's attribution is on `delivery_orders`.
    if current_setting('app.delivery_handover', true) is distinct from '1'
       or not exists (select 1 from public.delivery_orders d where d.order_id = old.id)
       or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'invalid order transition';
    end if;
  else
    raise exception 'invalid order transition';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The gated triggers (design D4, D5). Both BEFORE UPDATE, both inert while
-- the gate is off.

-- A delivery order is never paid. Off, the off path may bill an open delivery
-- order, as the proposal states.
create function public.order_delivery_is_not_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.app_change_gate('delivery-orders') then return new; end if;
  if exists (select 1 from public.delivery_orders d where d.order_id = new.id) then
    raise exception 'a delivery order is handed over, not paid' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.order_delivery_is_not_paid() from public, anon, authenticated;

create trigger orders_delivery_is_not_paid
  before update on public.orders
  for each row
  when (old.status = 'open' and new.status = 'paid')
  execute function public.order_delivery_is_not_paid();

-- An order's label is copied as it leaves the rail, before
-- `orders_label_leaves_the_rail` (AFTER) deletes it. The last label wins: an
-- order taken back and handed over again keeps the one it left with.
create function public.order_label_is_kept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.app_change_gate('delivery-orders') then return new; end if;
  insert into public.kept_order_labels (order_id, outlet_id, label, kept_at)
  select l.order_id, l.outlet_id, l.label, now()
    from public.order_labels l
   where l.order_id = new.id
  on conflict (order_id) do update set label = excluded.label, kept_at = excluded.kept_at;
  return new;
end;
$$;

revoke execute on function public.order_label_is_kept() from public, anon, authenticated;

create trigger orders_label_is_kept
  before update on public.orders
  for each row
  when (new.status::text in ('cancelled', 'handed_over')
        or (new.status::text = 'paid' and new.prepared_at is not null))
  execute function public.order_label_is_kept();

-- ---------------------------------------------------------------------------
-- 5. Creating and revising a delivery order (design D4). Each `_v3` is its
-- `_v2` plus an optional `delivery` boolean. Without it, the `_v2` is called
-- with the caller's own arguments. With it, the key is checked against the
-- caller's hash and taken off, and the `_v2` runs on what is left; so every
-- refusal, the idempotency record and the replay are the `_v2`'s own.

-- What a delivery order may not carry: a service, a table, packaging, a
-- bill-level discount or a customer. A menu discount riding a line is the
-- dish's own price, which a delivery order never shows anyway.
create function public.delivery_order_content_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and coalesce(p->>'serviceType', '') = ''
     and coalesce(p->>'tableNumber', '') = ''
     and coalesce(p->>'customerId', '') = ''
     and coalesce(p->>'customerName', '') = ''
     and coalesce(p->>'customerPhone', '') = ''
     and coalesce(jsonb_array_length(case when jsonb_typeof(p->'discounts') = 'array'
                                          then p->'discounts' end), 0) = 0
     and jsonb_typeof(p->'lines') = 'array'
     and not exists (select 1 from jsonb_array_elements(p->'lines') l
                      where coalesce(l->>'kind', 'item') <> 'item')
$$;

revoke execute on function public.delivery_order_content_ok(jsonb) from public, anon, authenticated;

create function public.create_billing_order_v3(
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
  v_delivery boolean;
  v_inner jsonb;
  v_result jsonb;
  v_order uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or not (p_payload ? 'delivery') then
    return public.create_billing_order_v2(p_command_id, p_schema_version, p_payload_hash,
      p_created_at, p_shift_id, p_payload);
  end if;
  if jsonb_typeof(p_payload->'delivery') <> 'boolean'
     or p_schema_version is null or p_schema_version < 3
     or p_payload_hash is distinct from public.billing_payload_hash(p_payload) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_delivery := (p_payload->>'delivery')::boolean;
  v_inner := p_payload - 'delivery';
  if v_delivery and not public.delivery_order_content_ok(v_inner) then
    return jsonb_build_object('status','malformed_payload');
  end if;

  v_result := public.create_billing_order_v2(p_command_id, p_schema_version,
    public.billing_payload_hash(v_inner), p_created_at, p_shift_id, v_inner);
  v_order := (v_result->>'orderId')::uuid;
  if v_result->>'status' = 'accepted' and v_delivery then
    insert into public.delivery_orders (order_id, outlet_id, marked_at)
    select o.id, o.outlet_id, p_created_at from public.orders o where o.id = v_order;
  elsif v_result->>'status' = 'replay'
        and v_delivery is distinct from exists (
          select 1 from public.delivery_orders d where d.order_id = v_order) then
    -- The stored hash is over the payload without the key, so a replay that
    -- disagrees about it is caught here.
    return jsonb_build_object('status','identity_conflict','commandId',p_command_id);
  end if;
  return v_result;
end;
$$;

create function public.revise_billing_order_v3(
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
  v_delivery boolean;
  v_inner jsonb;
  v_result jsonb;
  v_order uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or not (p_payload ? 'delivery') then
    return public.revise_billing_order_v2(p_command_id, p_schema_version, p_payload_hash,
      p_created_at, p_shift_id, p_payload);
  end if;
  if jsonb_typeof(p_payload->'delivery') <> 'boolean'
     or p_schema_version is null or p_schema_version < 3
     or p_payload_hash is distinct from public.billing_payload_hash(p_payload) then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_delivery := (p_payload->>'delivery')::boolean;
  v_inner := p_payload - 'delivery';
  if v_delivery and not public.delivery_order_content_ok(v_inner) then
    return jsonb_build_object('status','malformed_payload');
  end if;

  v_result := public.revise_billing_order_v2(p_command_id, p_schema_version,
    public.billing_payload_hash(v_inner), p_created_at, p_shift_id, v_inner);
  -- Only a revision accepted now moves the row: a replay must not put back
  -- what a later revision changed.
  if v_result->>'status' = 'accepted' then
    v_order := (v_result->>'orderId')::uuid;
    if v_delivery then
      insert into public.delivery_orders (order_id, outlet_id, marked_at)
      select o.id, o.outlet_id, p_created_at from public.orders o where o.id = v_order
      on conflict (order_id) do nothing;
    else
      delete from public.delivery_orders where order_id = v_order and handed_over_at is null;
    end if;
  end if;
  return v_result;
end;
$$;

revoke execute on function
  public.create_billing_order_v3(uuid,integer,text,timestamptz,uuid,jsonb),
  public.revise_billing_order_v3(uuid,integer,text,timestamptz,uuid,jsonb)
  from public, anon;
grant execute on function
  public.create_billing_order_v3(uuid,integer,text,timestamptz,uuid,jsonb),
  public.revise_billing_order_v3(uuid,integer,text,timestamptz,uuid,jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Handing over, and taking it back (design D4). The owning tablet's live
-- shift only, as a payment is. Neither reads the gate (design D9).

create function public.hand_over_delivery_order(
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
  v_actor uuid;
  v_prior jsonb;
begin
  v_error := public.billing_envelope_error(p_command_id, p_schema_version, p_payload_hash,
    p_created_at, p_payload, array['orderId']);
  if v_error is not null then return jsonb_build_object('status', v_error); end if;
  if jsonb_typeof(p_payload->'orderId') is distinct from 'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  begin
    v_order_id := (p_payload->>'orderId')::uuid;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  v_context := public.billing_device_context(p_shift_id, p_created_at);
  if v_context->>'status' <> 'ok' then return v_context; end if;
  v_actor := (v_context->>'actorId')::uuid;
  v_claim := public.billing_begin_command(p_command_id, 'hand_over_delivery', p_schema_version,
    p_payload_hash, p_created_at, (v_context->>'outletId')::uuid, auth.uid(), p_shift_id, v_actor);
  if v_claim->>'status' <> 'claimed' then return v_claim; end if;

  select * into v_order from public.orders where id = v_order_id for update;
  if not found or v_order.outlet_id <> (v_context->>'outletId')::uuid
     or v_order.device_id <> auth.uid() then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused','commandId',p_command_id));
  end if;
  if v_order.status <> 'open' then
    return public.billing_finish_command(p_command_id, jsonb_build_object('status','order_not_open',
      'orderId',v_order.id,'orderNumber',v_order.order_number,'orderStatus',v_order.status,
      'commandId',p_command_id), v_order.business_date);
  end if;
  if not exists (select 1 from public.delivery_orders d where d.order_id = v_order.id)
     or p_created_at < v_order.ordered_at then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','malformed_payload','orderId',v_order.id,
        'orderNumber',v_order.order_number,'commandId',p_command_id), v_order.business_date);
  end if;

  perform set_config('app.billing_command','1',true);
  perform set_config('app.delivery_handover','1',true);
  -- An order prepared without line ticks reads every dish ticked; make that a
  -- fact first, so the handover ticks only what is truly owed.
  perform public.dish_ticks_from_preparation_v2(v_order, p_shift_id, v_actor);

  -- Every dish still owed, and what its tick was, so a take-back can put it back.
  select coalesce(jsonb_agg(jsonb_build_object(
           'lineId', i.id, 'quantity', p.quantity, 'preparedAt', p.prepared_at,
           'shiftId', p.shift_id, 'personId', p.person_id) order by i.id), '[]'::jsonb)
    into v_prior
    from public.order_items i
    left join public.order_line_preparations p on p.order_item_id = i.id
   where i.order_id = v_order.id and i.kind = 'item' and coalesce(p.quantity, 0) < i.quantity;

  insert into public.order_line_preparations
    (order_item_id, outlet_id, order_id, quantity, prepared_at, shift_id, person_id)
  select i.id, v_order.outlet_id, v_order.id, i.quantity, p_created_at, p_shift_id, v_actor
    from public.order_items i
    left join public.order_line_preparations p on p.order_item_id = i.id
   where i.order_id = v_order.id and i.kind = 'item' and coalesce(p.quantity, 0) < i.quantity
  on conflict (order_item_id) do update set quantity = excluded.quantity,
    prepared_at = excluded.prepared_at, shift_id = excluded.shift_id,
    person_id = excluded.person_id;
  perform public.derive_dish_preparation_v2(v_order.id, p_created_at);

  update public.delivery_orders
     set handed_over_at = p_created_at, handed_over_by = v_actor,
         handed_over_shift_id = p_shift_id, handed_over_device_id = auth.uid(),
         handover_command_id = p_command_id, handover_prior_ticks = v_prior
   where order_id = v_order.id;
  update public.orders set status = 'handed_over' where id = v_order.id;

  return public.billing_finish_command(p_command_id, jsonb_build_object('status','accepted',
    'commandId',p_command_id,'orderId',v_order.id,'orderNumber',v_order.order_number,
    'handedOverAt',p_created_at,'delayed',(v_context->>'delayed')::boolean), v_order.business_date);
end;
$$;

create function public.take_back_delivery_handover(
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
  v_delivery public.delivery_orders%rowtype;
  v_order_id uuid;
  v_reason text;
  v_actor uuid;
  v_deadline timestamptz;
  v_tick jsonb;
begin
  v_error := public.billing_envelope_error(p_command_id, p_schema_version, p_payload_hash,
    p_created_at, p_payload, array['orderId','reason']);
  if v_error is not null then return jsonb_build_object('status', v_error); end if;
  if jsonb_typeof(p_payload->'orderId') is distinct from 'string'
     or jsonb_typeof(p_payload->'reason') is distinct from 'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  begin
    v_order_id := (p_payload->>'orderId')::uuid;
    v_reason := btrim(p_payload->>'reason');
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_order_id is null or v_reason is null or length(v_reason) = 0 then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context := public.billing_device_context(p_shift_id, p_created_at);
  if v_context->>'status' <> 'ok' then return v_context; end if;
  v_actor := (v_context->>'actorId')::uuid;
  v_claim := public.billing_begin_command(p_command_id, 'take_back_delivery_handover',
    p_schema_version, p_payload_hash, p_created_at, (v_context->>'outletId')::uuid, auth.uid(),
    p_shift_id, v_actor);
  if v_claim->>'status' <> 'claimed' then return v_claim; end if;

  select * into v_order from public.orders where id = v_order_id for update;
  if not found or v_order.outlet_id <> (v_context->>'outletId')::uuid
     or v_order.device_id <> auth.uid() then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused','commandId',p_command_id));
  end if;
  select * into v_delivery from public.delivery_orders where order_id = v_order.id for update;
  if v_order.status::text <> 'handed_over' or not found or v_delivery.handed_over_at is null then
    return public.billing_finish_command(p_command_id, jsonb_build_object('status','order_not_open',
      'orderId',v_order.id,'orderNumber',v_order.order_number,'orderStatus',v_order.status,
      'commandId',p_command_id), v_order.business_date);
  end if;
  -- The window is a payment take-back's: five minutes past the later of the
  -- handover and the preparation it finished, measured from the stored
  -- handover time, which is the handover command's own (design D4).
  v_deadline := public.billing_edit_window_end(v_delivery.handed_over_at, v_order.prepared_at, true);
  if p_created_at < v_delivery.handed_over_at
     or (v_deadline is not null and p_created_at >= v_deadline) then
    return public.billing_finish_command(p_command_id, jsonb_build_object('status','payment_edit_expired',
      'orderId',v_order.id,'orderNumber',v_order.order_number,'commandId',p_command_id),
      v_order.business_date);
  end if;

  perform set_config('app.billing_command','1',true);
  perform set_config('app.delivery_handover','1',true);
  insert into public.delivery_handover_takebacks
    (id, order_id, outlet_id, handed_over_at, handed_over_by, handover_command_id,
     taken_back_at, taken_back_by, taken_back_shift_id, taken_back_device_id, reason)
  values
    (p_command_id, v_order.id, v_order.outlet_id, v_delivery.handed_over_at,
     v_delivery.handed_over_by, v_delivery.handover_command_id,
     p_created_at, v_actor, p_shift_id, auth.uid(), v_reason);
  update public.orders set status = 'open' where id = v_order.id;

  -- Only what the handover ticked goes back; earlier ticks, Readies and
  -- acknowledgements stay.
  for v_tick in select value from jsonb_array_elements(v_delivery.handover_prior_ticks) loop
    if v_tick->>'quantity' is null then
      delete from public.order_line_preparations
       where order_item_id = (v_tick->>'lineId')::uuid and order_id = v_order.id;
    else
      update public.order_line_preparations
         set quantity = (v_tick->>'quantity')::integer,
             prepared_at = (v_tick->>'preparedAt')::timestamptz,
             shift_id = (v_tick->>'shiftId')::uuid,
             person_id = (v_tick->>'personId')::uuid
       where order_item_id = (v_tick->>'lineId')::uuid and order_id = v_order.id;
    end if;
  end loop;
  perform public.derive_dish_preparation_v2(v_order.id, p_created_at);

  update public.delivery_orders
     set handed_over_at = null, handed_over_by = null, handed_over_shift_id = null,
         handed_over_device_id = null, handover_command_id = null, handover_prior_ticks = null
   where order_id = v_order.id;

  return public.billing_finish_command(p_command_id, jsonb_build_object('status','accepted',
    'commandId',p_command_id,'orderId',v_order.id,'orderNumber',v_order.order_number,
    'delayed',(v_context->>'delayed')::boolean), v_order.business_date);
end;
$$;

revoke execute on function
  public.hand_over_delivery_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.take_back_delivery_handover(uuid,integer,text,timestamptz,uuid,jsonb)
  from public, anon;
grant execute on function
  public.hand_over_delivery_order(uuid,integer,text,timestamptz,uuid,jsonb),
  public.take_back_delivery_handover(uuid,integer,text,timestamptz,uuid,jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Offering Delivery (design D7, D8): `set_outlet_service_settings` with one
-- more choice, owned by the same people. Null leaves it as it is.

create function public.set_outlet_service_settings_v2(
  p_outlet uuid,
  p_dine_in_offered boolean,
  p_takeaway_offered boolean,
  p_table_numbers boolean,
  p_packaging_mode public.packaging_mode,
  p_packaging_price_paise integer,
  p_packaging_free_for_gold boolean,
  p_collect_customer_details boolean default null,
  p_delivery_offered boolean default null
)
returns public.outlets
language plpgsql security definer
set search_path = ''
as $$
declare
  v_outlet public.outlets;
begin
  if auth.uid() is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet)) then
    raise exception 'only the owner or this outlet''s manager may change how it serves'
      using errcode = 'insufficient_privilege';
  end if;

  update public.outlets
     set dine_in_offered = p_dine_in_offered,
         takeaway_offered = p_takeaway_offered,
         table_numbers = p_table_numbers,
         packaging_mode = p_packaging_mode,
         packaging_price_paise = p_packaging_price_paise,
         packaging_free_for_gold = p_packaging_free_for_gold,
         collect_customer_details = coalesce(p_collect_customer_details, collect_customer_details),
         delivery_offered = coalesce(p_delivery_offered, delivery_offered)
   where id = p_outlet
  returning * into v_outlet;
  if not found then
    raise exception 'no such outlet' using errcode = 'no_data_found';
  end if;
  return v_outlet;
end;
$$;

revoke execute on function public.set_outlet_service_settings_v2(
  uuid, boolean, boolean, boolean, public.packaging_mode, integer, boolean, boolean, boolean
) from public, anon;
grant execute on function public.set_outlet_service_settings_v2(
  uuid, boolean, boolean, boolean, public.packaging_mode, integer, boolean, boolean, boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The reads (design D6). Each `_v2`/`_v3` leaves the read it supersedes in
-- place for published builds. **None sums a delivery order's money**: its
-- totals are the counter's prices, which are not what the platform charged.

-- The kitchen board, each card saying whether its order is a delivery order.
create function public.kitchen_board_v3()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_board jsonb;
begin
  v_board := public.kitchen_board_v2();
  return jsonb_set(v_board, '{orders}', coalesce((
    select jsonb_agg(c || jsonb_build_object('delivery', exists (
             select 1 from public.delivery_orders d
              where d.order_id = coalesce(c->>'sourceOrderId', c->>'id')::uuid))
           order by n)
      from jsonb_array_elements(v_board->'orders') with ordinality t(c, n)), '[]'::jsonb));
end;
$$;

revoke execute on function public.kitchen_board_v3() from public, anon;
grant execute on function public.kitchen_board_v3() to authenticated;

-- Overview's open total leaves out open delivery orders: their totals are not
-- money anybody owes.
create function public.overview_today_v3(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today jsonb;
begin
  v_today := public.overview_today_v2(p_outlet_id);
  return v_today || jsonb_build_object('openPaise', (
    select coalesce(sum(o.total_paise), 0)::bigint
      from public.orders o, public.outlets x
     where x.id = p_outlet_id
       and o.outlet_id = p_outlet_id
       and o.business_date = public.app_business_date(now(), x.business_day_cutover)
       and o.status = 'open'
       and not exists (select 1 from public.delivery_orders d where d.order_id = o.id)));
end $$;

revoke all on function public.overview_today_v3(uuid) from public, anon;
grant execute on function public.overview_today_v3(uuid) to authenticated;

-- A day's Stats, for counter orders or for delivery orders, never both.
-- `counter` is today's twelve figures with delivery orders left out; `delivery`
-- is placed, updated, cancelled, handed over, seen, Ready and the two average
-- times, and no money.
create function public.billing_day_stats_v2(
  p_outlet_id uuid, p_business_date date, p_scope text default 'counter'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_outlet_id is null
     or not public.app_device_ok()
     or not public.app_account_active()
     or not (public.app_is_owner()
             or p_outlet_id in (select public.app_outlets_for('franchise_admin'))) then
    raise exception 'only the owner or this outlet''s managers read its day'
      using errcode = '42501';
  end if;
  if p_business_date is null then
    raise exception 'Choose a day' using errcode = 'invalid_parameter_value';
  end if;
  if p_scope is null or p_scope not in ('counter', 'delivery') then
    raise exception 'Choose counter or delivery' using errcode = 'invalid_parameter_value';
  end if;

  with day_orders as materialized (
    select o.id, o.status, o.ordered_at, o.created_at, o.prepared_at, o.prepared_source
      from public.orders o
     where o.outlet_id = p_outlet_id and o.business_date = p_business_date
       and exists (select 1 from public.delivery_orders d where d.order_id = o.id)
           = (p_scope = 'delivery')
  ),
  revised as (
    select count(distinct c.result->>'orderId') as n
      from public.billing_commands c
     where c.outlet_id = p_outlet_id
       and c.command_type = 'revise_order'
       and c.result_category in ('accepted', 'replay')
       and c.received_at >= (select min(created_at) from day_orders)
       and c.result->>'orderId' in (select id::text from day_orders)
  ),
  seen as (
    select count(distinct a.order_id) as n
      from public.kitchen_acknowledgements a
     where a.outlet_id = p_outlet_id
       and a.order_id in (select id from day_orders)
  ),
  ready as materialized (
    select r.order_id, max(r.at) as last_at
      from public.kitchen_readies r
     where r.outlet_id = p_outlet_id
       and r.order_id in (select id from day_orders)
       and r.undoes is null
       and not exists (select 1 from public.kitchen_readies u where u.undoes = r.id)
     group by r.order_id
  ),
  timed as (
    select o.ordered_at, o.prepared_at, o.prepared_source, r.last_at
      from ready r join day_orders o on o.id = r.order_id
     where o.prepared_source is distinct from 'day_change'
  ),
  day_bills as materialized (
    select b.id, b.status, b.void_kind
      from public.bills b
     where b.outlet_id = p_outlet_id and b.business_date = p_business_date
       and p_scope = 'counter'
  )
  select jsonb_build_object(
    'placed', (select count(*) from day_orders),
    'updated', (select n from revised),
    'cancelled', (select count(*) from day_orders where status = 'cancelled'),
    'seen', (select n from seen),
    'ready', (select count(*) from ready),
    'toReadySeconds', (select round(avg(extract(epoch from last_at - ordered_at)))::bigint
                         from timed where last_at >= ordered_at),
    'handoverSeconds', (select round(avg(extract(epoch from prepared_at - last_at)))::bigint
                          from timed
                         where prepared_source = 'counter' and prepared_at >= last_at))
  || case when p_scope = 'delivery' then jsonb_build_object(
    'handedOver', (select count(*) from day_orders where status::text = 'handed_over'))
  else jsonb_build_object(
    'paid', (select count(*) from day_orders where status = 'paid'),
    'billsCancelled', (select count(*) from day_bills
                        where status = 'void' and coalesce(void_kind, 'manager_void') = 'manager_void'),
    'cancelledAfterPaid', (select count(*) from day_bills where void_kind = 'cancelled_after_paid'),
    'paymentUndone', (select count(*) from day_bills where void_kind = 'counter_unpay'),
    'paymentChanged', (select count(distinct x.bill_id)
                         from public.bill_payment_corrections x
                        where x.outlet_id = p_outlet_id
                          and x.bill_id in (select id from day_bills))) end
    into v_result;
  return v_result;
end $$;

revoke all on function public.billing_day_stats_v2(uuid, date, text) from public, anon;
grant execute on function public.billing_day_stats_v2(uuid, date, text) to authenticated;

-- Billing history's day: today's answer, with Stats for counter orders alone,
-- delivery orders' Stats beside them, and the open figures without delivery
-- orders. One request still answers the page, whichever way its switch is.
create function public.billing_day_numbers_v2(p_outlet_id uuid, p_business_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_numbers jsonb;
begin
  v_numbers := public.billing_day_numbers(p_outlet_id, p_business_date);
  return v_numbers || jsonb_build_object(
    'stats', public.billing_day_stats_v2(p_outlet_id, p_business_date, 'counter'),
    'deliveryStats', public.billing_day_stats_v2(p_outlet_id, p_business_date, 'delivery'),
    'openOrders', (
      select count(*) from public.orders o
       where o.outlet_id = p_outlet_id and o.business_date = p_business_date
         and (o.status = 'open' or (o.status = 'paid' and o.prepared_at is null))
         and not exists (select 1 from public.delivery_orders d where d.order_id = o.id)),
    'unpaidPaise', (
      select coalesce(sum(o.total_paise), 0)::bigint from public.orders o
       where o.outlet_id = p_outlet_id and o.business_date = p_business_date
         and o.status = 'open'
         and not exists (select 1 from public.delivery_orders d where d.order_id = o.id)));
end $$;

revoke all on function public.billing_day_numbers_v2(uuid, date) from public, anon;
grant execute on function public.billing_day_numbers_v2(uuid, date) to authenticated;

-- Billing history's bills, each with its order's label: the one still on the
-- rail's table, else the one kept when it left. As the caller, like the read
-- it wraps, so the policies decide what is seen.
create function public.billing_history_bills_v2(
  p_outlet_id uuid,
  p_business_date date,
  p_filter jsonb default '{}'::jsonb,
  p_limit integer default 30,
  p_after jsonb default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with page as (
    select public.billing_history_bills(p_outlet_id, p_business_date, p_filter, p_limit, p_after) as v
  )
  select jsonb_set(page.v, '{rows}', coalesce((
    select jsonb_agg(x || jsonb_build_object('order_label', (
             select coalesce(l.label, k.label)
               from public.bills b
               left join public.order_labels l on l.order_id = b.order_id
               left join public.kept_order_labels k on k.order_id = b.order_id
              where b.id = (x->>'id')::uuid))
           order by n)
      from jsonb_array_elements(page.v->'rows') with ordinality t(x, n)), '[]'::jsonb))
    from page
$$;

revoke all on function public.billing_history_bills_v2(uuid, date, jsonb, integer, jsonb)
  from public, anon;
grant execute on function public.billing_history_bills_v2(uuid, date, jsonb, integer, jsonb)
  to authenticated;

-- A day's handed-over and cancelled delivery orders, for Billing history's
-- Delivery view: dishes, label, who rang it, who handed it over or cancelled
-- it, and every take-back. No money.
create function public.billing_history_delivery_orders(p_outlet_id uuid, p_business_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_outlet_id is null
     or not public.app_device_ok()
     or not public.app_account_active()
     or not (public.app_is_owner()
             or p_outlet_id in (select public.app_outlets_for('franchise_admin'))) then
    raise exception 'only the owner or this outlet''s managers read its day'
      using errcode = '42501';
  end if;
  if p_business_date is null then
    raise exception 'Choose a day' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'orderId', o.id,
           'orderNumber', o.order_number,
           'status', o.status,
           'orderedAt', o.ordered_at,
           'label', coalesce(l.label, k.label),
           'createdByName', (select p.full_name from public.profiles p where p.id = o.created_by),
           'handedOverAt', d.handed_over_at,
           'handedOverByName', (select p.full_name from public.profiles p where p.id = d.handed_over_by),
           'cancelledAt', o.cancelled_at,
           'cancelledByName', (select p.full_name from public.profiles p where p.id = o.cancelled_by),
           'cancelReason', o.cancel_reason,
           'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                              'id', i.id, 'itemName', i.item_name, 'quantity', i.quantity,
                              'note', i.note) order by i.item_name, i.id), '[]'::jsonb)
                       from public.order_items i where i.order_id = o.id and i.kind = 'item'),
           'takeBacks', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'takenBackAt', t.taken_back_at,
                                  'takenBackByName', (select p.full_name from public.profiles p
                                                       where p.id = t.taken_back_by),
                                  'handedOverAt', t.handed_over_at,
                                  'reason', t.reason) order by t.taken_back_at), '[]'::jsonb)
                           from public.delivery_handover_takebacks t where t.order_id = o.id))
         order by coalesce(d.handed_over_at, o.cancelled_at) desc, o.order_number desc), '[]'::jsonb)
    into v_result
    from public.delivery_orders d
    join public.orders o on o.id = d.order_id
    left join public.order_labels l on l.order_id = o.id
    left join public.kept_order_labels k on k.order_id = o.id
   where d.outlet_id = p_outlet_id
     and o.business_date = p_business_date
     and o.status::text in ('handed_over', 'cancelled');
  return v_result;
end $$;

revoke all on function public.billing_history_delivery_orders(uuid, date) from public, anon;
grant execute on function public.billing_history_delivery_orders(uuid, date) to authenticated;

-- Analytics with a scope. `counter` is `sales_analytics_v2` exactly.
-- `delivery` counts handed-over delivery orders by their business day (Day,
-- Week) or Kolkata hour, and their item lines' quantities; every money figure
-- is null, so a screen can only say it is unavailable. The platforms' delivery
-- money (`delivery`) is the same as in `counter`: it is not these orders.
create function public.sales_analytics_v3(
  p_outlet_id uuid,
  p_from date,
  p_to date,
  p_view text default 'all',
  p_periods integer default 2,
  p_align text default 'equal',
  p_cut text default null,
  p_scope text default 'counter'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_counter jsonb;
  v_first date;
  v_result jsonb;
begin
  if p_scope is null or p_scope not in ('counter', 'delivery') then
    raise exception 'Choose counter or delivery' using errcode = 'invalid_parameter_value';
  end if;
  -- The counter answer carries every refusal, so both scopes refuse alike.
  v_counter := public.sales_analytics_v2(p_outlet_id, p_from, p_to, p_view, p_periods, p_align, p_cut);
  if p_scope = 'counter' then return v_counter; end if;

  select min(w.w_first) into v_first
    from public.revenue_compared_windows(p_outlet_id, p_from, p_to, p_periods, p_align, p_cut) w;

  with windows as materialized (
    select * from public.revenue_compared_windows(
      p_outlet_id, p_from, p_to, p_periods, p_align, p_cut)
  ),
  selected as materialized (
    select o.id, o.business_date, o.ordered_at, w.period,
           (w.period is not null
            and (w.cut_at is null or o.business_date < w.w_last or o.ordered_at < w.cut_at))
             as compared
      from public.orders o
      join public.delivery_orders d on d.order_id = o.id
      left join windows w on o.business_date between w.w_first and w.w_last
     where o.outlet_id = p_outlet_id
       and o.business_date between v_first and p_to
       and o.status::text = 'handed_over'
  ),
  lines as materialized (
    select s.id, s.business_date, s.period, s.compared, i.menu_item_id, i.item_name,
           i.category_name, i.quantity
      from selected s
      join public.order_items i on i.order_id = s.id
     where i.kind = 'item'
       and p_view <> 'sales'
  ),
  item_sales as (
    select coalesce(menu_item_id::text, 'snapshot:' || item_name) as key,
           menu_item_id,
           max(item_name) as name,
           case when count(distinct coalesce(category_name, 'Uncategorised')) > 1
                then 'Multiple categories'
                else coalesce(max(category_name), 'Uncategorised') end as category,
           coalesce(sum(quantity) filter (where period = 0), 0) as units,
           count(distinct id) filter (where period = 0) as orders,
           coalesce(sum(quantity) filter (where period = 1 and compared), 0) as previous_units
      from lines
     group by 1, menu_item_id
  ),
  item_periods as (
    select coalesce(menu_item_id::text, 'snapshot:' || item_name) as key, period,
           sum(quantity) as units
      from lines where compared group by 1, 2
  ),
  category_periods as (
    select coalesce(category_name, 'Uncategorised') as name, period, sum(quantity) as units
      from lines where compared group by 1, 2
  ),
  items as (
    select coalesce(s.key, m.id::text) as key,
           coalesce(m.name, s.name) as name,
           coalesce(s.category, c.name, 'Uncategorised') as category,
           coalesce(s.units, 0) as units,
           coalesce(s.orders, 0) as orders,
           coalesce(s.previous_units, 0) as previous_units,
           coalesce(m.is_active and c.is_active, false) as active,
           coalesce(m.is_available, false) as available,
           h.item_id is not null as highlighted
      from item_sales s
      full join (select * from public.menu_items where outlet_id = p_outlet_id) m
        on m.id = s.menu_item_id
      left join public.menu_categories c on c.id = m.category_id
      left join public.menu_highlight_items h
        on h.outlet_id = p_outlet_id and h.item_id = coalesce(m.id, s.menu_item_id)
     where s.key is not null or (m.is_active and c.is_active)
  ),
  line_days as (
    select business_date, sum(quantity) as units from lines group by business_date
  ),
  order_days as (
    select business_date, count(*) as orders from selected group by business_date
  ),
  daily as (
    select d::date as date, coalesce(o.orders, 0) as orders, coalesce(l.units, 0) as units
      from generate_series(v_first::timestamp, p_to::timestamp, interval '1 day') d
      left join order_days o on o.business_date = d::date
      left join line_days l on l.business_date = d::date
  ),
  days as (
    select case when p_view = 'items' then w.w_first else d.date end as date,
           sum(d.orders) as orders, sum(d.units) as units
      from daily d
      left join windows w on d.date between w.w_first and w.w_last
     where p_view <> 'items' or w.period is not null
     group by 1
  )
  select jsonb_build_object(
    'categories', case when p_view = 'sales' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'revenue', null, 'units', units,
                                          'previousRevenue', null,
                                          'previousUnits', previous_units,
                                          'periodUnits', (
                                            select jsonb_agg(coalesce(u.units, 0) order by w)
                                              from generate_series(0, p_periods - 1) w
                                              left join category_periods u
                                                on u.name = c.name and u.period = w),
                                          'periodRevenue', null)
                       order by units desc, name)
        from (select coalesce(category_name, 'Uncategorised') as name,
                     coalesce(sum(quantity) filter (where period = 0), 0) as units,
                     coalesce(sum(quantity) filter (where period = 1 and compared), 0)
                       as previous_units
                from lines
               group by 1) c), '[]'::jsonb) end,
    'delivery', v_counter->'delivery',
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', date, 'revenue', null, 'orders', orders,
                                          'units', units, 'discounts', null)
                       order by date)
        from days), '[]'::jsonb),
    'items', case when p_view = 'sales' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('key', key, 'name', name, 'category', category,
                                          'units', units, 'revenue', null,
                                          'discounts', null, 'orders', orders,
                                          'previousUnits', previous_units,
                                          'previousRevenue', null, 'active', active,
                                          'available', available, 'highlighted', highlighted,
                                          'periodUnits', (
                                            select jsonb_agg(coalesce(u.units, 0) order by w)
                                              from generate_series(0, p_periods - 1) w
                                              left join item_periods u
                                                on u.key = items.key and u.period = w),
                                          'periodRevenue', null)
                       order by units desc, key)
        from items), '[]'::jsonb) end,
    'hours', case when p_view = 'items' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('period', period, 'hour', hour,
                                          'orders', orders, 'revenue', null)
                       order by period, hour)
        from (select period,
                     extract(hour from ordered_at at time zone 'Asia/Kolkata')::int as hour,
                     count(*) as orders
                from selected
               where period is not null
               group by 1, 2) h), '[]'::jsonb) end,
    'totals', (select jsonb_agg(jsonb_build_object(
                        'period', w.period, 'counter', null, 'delivery', null,
                        'orders', (select count(*) from selected s
                                    where s.period = w.period and s.compared))
                      order by w.period)
                 from windows w),
    'cutAt', v_counter->'cutAt'
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.sales_analytics_v3(uuid, date, date, text, integer, text, text, text)
  from public, anon;
grant execute on function public.sales_analytics_v3(uuid, date, date, text, integer, text, text, text)
  to authenticated;

-- One dish's or category's series with a scope, on the same terms.
create function public.sales_analytics_series_v3(
  p_outlet_id uuid,
  p_from date,
  p_to date,
  p_periods integer default 2,
  p_item text default null,
  p_category text default null,
  p_cut text default null,
  p_scope text default 'counter'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_counter jsonb;
  v_first date;
  v_item uuid;
  v_snapshot text;
  v_result jsonb;
begin
  if p_scope is null or p_scope not in ('counter', 'delivery') then
    raise exception 'Choose counter or delivery' using errcode = 'invalid_parameter_value';
  end if;
  v_counter := public.sales_analytics_series_v2(p_outlet_id, p_from, p_to, p_periods, p_item,
    p_category, p_cut);
  if p_scope = 'counter' then return v_counter; end if;

  if p_item like 'snapshot:%' then
    v_snapshot := substr(p_item, 10);
  elsif p_item is not null then
    v_item := p_item::uuid;
  end if;
  v_first := (v_counter->>'from')::date;

  with windows as materialized (
    select * from public.revenue_compared_windows(
      p_outlet_id, p_from, p_to, p_periods, 'equal', p_cut)
  ),
  lines as materialized (
    select o.business_date,
           w.period,
           (w.cut_at is null or o.business_date < w.w_last or o.ordered_at < w.cut_at)
             as compared,
           extract(hour from o.ordered_at at time zone 'Asia/Kolkata')::int as hour,
           i.quantity
      from public.orders o
      join public.delivery_orders d on d.order_id = o.id
      join windows w on o.business_date between w.w_first and w.w_last
      join public.order_items i on i.order_id = o.id
     where o.outlet_id = p_outlet_id
       and o.business_date between v_first and p_to
       and o.status::text = 'handed_over'
       and i.kind = 'item'
       and (v_item is null or i.menu_item_id = v_item)
       and (v_snapshot is null or (i.menu_item_id is null and i.item_name = v_snapshot))
       and (p_category is null or coalesce(i.category_name, 'Uncategorised') = p_category)
  ),
  per_day as (
    select business_date, sum(quantity) as units from lines group by business_date
  ),
  per_hour as (
    select period, hour, sum(quantity) as units from lines group by period, hour
  ),
  hours as (
    select p.period, h.hour, coalesce(x.units, 0) as units
      from generate_series(0, p_periods - 1) p(period)
     cross join generate_series(0, 23) h(hour)
      left join per_hour x on x.period = p.period and x.hour = h.hour
  )
  select jsonb_build_object(
           'from', v_first,
           'units', (select jsonb_agg(coalesce(p.units, 0) order by d)
                       from generate_series(v_first::timestamp, p_to::timestamp, interval '1 day') d
                       left join per_day p on p.business_date = d::date),
           'revenue', null,
           'hourUnits', (select jsonb_agg(units order by period, hour) from hours),
           'hourRevenue', null,
           'totals', (select jsonb_agg(jsonb_build_object(
                                'units', coalesce((select sum(l.quantity) from lines l
                                                    where l.period = w.period and l.compared), 0),
                                'revenue', null)
                              order by w.period)
                        from windows w),
           'cutAt', v_counter->'cutAt')
    into v_result;

  return v_result;
end;
$$;

revoke all on function public.sales_analytics_series_v3(uuid, date, date, integer, text, text, text, text)
  from public, anon;
grant execute on function public.sales_analytics_series_v3(uuid, date, date, integer, text, text, text, text)
  to authenticated;
