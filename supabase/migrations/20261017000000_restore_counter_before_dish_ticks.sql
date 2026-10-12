-- Emergency rollback of #74. Restore the pre-#74 counter/kitchen behavior.
-- Existing sales, append-only receipts and released migration history survive.
-- Keep optional label/note envelope acceptance and prepare_order_lines delivery
-- solely for queued commands and cached #74 pages during the transition.
-- Those fields are ignored by the restored content RPCs; no new UI emits them.
-- Never infer whole-order preparation from partial ticks or kitchen Ready.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Restored verbatim from supabase/migrations/20261009000000_the_day_change_finishes_paid_orders.sql at 014f5693.
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
  else
    raise exception 'invalid order transition';
  end if;
  return new;
end;
$$;

-- Restored verbatim from supabase/migrations/20260929000000_a_regular_earns_points_and_gold.sql at 014f5693.
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
       discount_paise, discount_percent_bp, category_name, kind)
    select (line ->> 'id')::uuid, v_order, nullif(line ->> 'menuItemId','')::uuid,
      line ->> 'itemName', (line ->> 'unitPricePaise')::bigint,
      (line ->> 'quantity')::integer, (line ->> 'lineTotalPaise')::bigint,
      coalesce((line ->> 'discountPaise')::bigint, 0),
      nullif(line ->> 'discountPercentBp','')::integer,
      nullif(line ->> 'categoryName',''),
      coalesce(line ->> 'kind', 'item')::public.line_kind
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

-- Restored verbatim from supabase/migrations/20260929000000_a_regular_earns_points_and_gold.sql at 014f5693.
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
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,'orderId',v_order.id,
    'orderNumber',v_order.order_number,'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,v_order.business_date);
end;
$$;

-- Restored verbatim from supabase/migrations/20260929000000_a_regular_earns_points_and_gold.sql at 014f5693.
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

-- Restored verbatim from supabase/migrations/20261009000000_the_day_change_finishes_paid_orders.sql at 014f5693.
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

-- Restored verbatim from supabase/migrations/20261010000000_the_kitchen_sees_its_orders.sql at 014f5693.
create or replace function public.kitchen_visible_lines(
  p_order_id uuid, p_mode text, p_category_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', oi.id,
           'menuItemId', oi.menu_item_id,
           'itemName', oi.item_name,
           'quantity', oi.quantity)
         order by oi.item_name, oi.id), '[]'::jsonb)
    from public.order_items oi
    left join public.menu_items mi on mi.id = oi.menu_item_id
   where oi.order_id = p_order_id
     and oi.kind = 'item'
     and public.kitchen_line_visible(mi.category_id, p_mode, p_category_ids)
$$;

-- Restored verbatim from supabase/migrations/20261014000000_the_counter_sees_the_kitchen.sql at 014f5693.
create or replace function public.kitchen_same_lines(p_left jsonb, p_right jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1
      from (select coalesce(l ->> 'menuItemId', 'name:' || (l ->> 'itemName')) as dish,
                   sum((l ->> 'quantity')::integer) as quantity
              from jsonb_array_elements(coalesce(p_left, '[]'::jsonb)) l
             group by 1) a
      full join
           (select coalesce(r ->> 'menuItemId', 'name:' || (r ->> 'itemName')) as dish,
                   sum((r ->> 'quantity')::integer) as quantity
              from jsonb_array_elements(coalesce(p_right, '[]'::jsonb)) r
             group by 1) b
        using (dish)
     where a.quantity is distinct from b.quantity)
$$;

-- Restored verbatim from supabase/migrations/20261014010000_a_kitchen_filter_is_a_view.sql at 014f5693.
create or replace function public.kitchen_board()
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
  select s.* into v_shift from public.counter_shifts s
   where s.id = public.app_kitchen_shift();
  if not found then
    raise exception 'the kitchen board needs a live kitchen shift' using errcode = '42501';
  end if;
  select * into v_device from public.counter_devices where id = v_shift.device_id;
  select o.business_day_cutover into v_cutover from public.outlets o where o.id = v_shift.outlet_id;

  with candidates as (
    select o.*
      from public.orders o
     where o.outlet_id = v_shift.outlet_id
       -- On the rail and not yet prepared: an order the counter has ticked
       -- Prepared is done in the kitchen, paid or not. Written as the rail's own
       -- predicate plus the preparation, so the planner can prove it against
       -- `orders_pipeline_idx` and never walks an outlet's whole history.
       and (o.status = 'open' or (o.status = 'paid' and o.prepared_at is null))
       and o.prepared_at is null
    union all
    select o.*
      from public.orders o
     where o.outlet_id = v_shift.outlet_id
       and o.status = 'cancelled'
       and o.business_date in (v_shift.business_date, v_shift.business_date - 1)
       and public.app_business_date(o.cancelled_at, v_cutover) = v_shift.business_date
  ),
  shaped as (
    select c.*,
           public.kitchen_order_version(c::public.orders) as version,
           public.kitchen_visible_lines(c.id, v_device.kitchen_filter_mode,
                                        v_device.kitchen_category_ids) as visible,
           (select count(*) from public.order_items oi
              left join public.menu_items mi on mi.id = oi.menu_item_id
             where oi.order_id = c.id and oi.kind = 'item'
               and not public.kitchen_line_visible(mi.category_id,
                     v_device.kitchen_filter_mode, v_device.kitchen_category_ids)
           ) as other_count,
           (select jsonb_build_object('kind', a.kind, 'orderVersion', a.order_version,
                                      'lines', public.kitchen_filter_lines(a.lines, v_device.kitchen_filter_mode,
                                        v_device.kitchen_category_ids), 'ackedAt', a.acked_at)
              from public.kitchen_acknowledgements a
             where a.device_id = v_device.id and a.order_id = c.id
             order by a.acked_at desc, a.id desc limit 1) as latest_ack,
           exists (select 1 from public.kitchen_acknowledgements a
                    where a.device_id = v_device.id and a.order_id = c.id
                      and a.kind = 'new') as acknowledged
      from candidates c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'orderNumber', s.order_number,
           'serviceType', s.service_type,
           'tableNumber', s.table_number,
           'orderedAt', s.ordered_at,
           'version', s.version,
           'status', s.status,
           'cancelledAt', s.cancelled_at,
           'lines', s.visible,
           'otherItemCount', s.other_count,
           'acknowledged', s.acknowledged,
           'latestAck', s.latest_ack)
         order by s.ordered_at, s.id), '[]'::jsonb)
    into v_orders
    from shaped s
   where (jsonb_array_length(s.visible) > 0
          or jsonb_array_length(coalesce(s.latest_ack -> 'lines', '[]'::jsonb)) > 0)
     and not (coalesce(s.latest_ack ->> 'kind', '') = 'cancel'
              and (s.latest_ack ->> 'orderVersion')::timestamptz = s.version
              and (s.status = 'cancelled' or jsonb_array_length(s.visible) = 0));

  return jsonb_build_object(
    'readAt', now(),
    'outletId', v_shift.outlet_id,
    'businessDate', v_shift.business_date,
    'shiftId', v_shift.id,
    -- Who opened this kitchen, as the counter's header names its operator.
    'operatorName', (select p.full_name from public.profiles p where p.id = v_shift.person_id),
    'filterChangedAt', v_device.kitchen_filter_changed_at,
    'filterMode', v_device.kitchen_filter_mode,
    'categoryIds', to_jsonb(v_device.kitchen_category_ids),
    'sort', v_device.kitchen_sort,
    'orders', v_orders);
end;
$$;

-- Restored verbatim from supabase/migrations/20261014010000_a_kitchen_filter_is_a_view.sql at 014f5693.
create or replace function public.counter_kitchen_marks()
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
    select d.id, d.label, d.kitchen_filter_mode, d.kitchen_category_ids,
           row_number() over (order by lower(d.label), d.id) as place
      from public.counter_shifts s
      join public.counter_devices d on d.id = s.device_id
       and d.removed_at is null and d.session_proven_at is not null and d.kind = 'kitchen'
     where s.outlet_id = v_outlet
       and s.kind = 'kitchen'
       and s.ended_at is null
       and s.expires_at > now()
  ),
  rail as (
    -- The rail's own predicate, so the read rides `orders_pipeline_idx`.
    select o.id, o.prepared_at, public.kitchen_order_version(o) as version
      from public.orders o
     where o.outlet_id = v_outlet
       and (o.status = 'open' or (o.status = 'paid' and o.prepared_at is null))
  ),
  cells as (
    select r.id as order_id, r.prepared_at, r.version, k.place,
           public.kitchen_visible_lines(r.id, k.kitchen_filter_mode, k.kitchen_category_ids)
             as visible,
           latest.kind as latest_kind, latest.order_version as latest_version,
           public.kitchen_filter_lines(latest.lines, k.kitchen_filter_mode,
                                       k.kitchen_category_ids) as latest_lines,
           exists (select 1 from public.kitchen_acknowledgements a
                    where a.device_id = k.id and a.order_id = r.id and a.kind = 'new')
             as acknowledged
      from rail r
     cross join kitchens k
      left join lateral (
        select a.kind, a.order_version, a.lines
          from public.kitchen_acknowledgements a
         where a.device_id = k.id and a.order_id = r.id
         order by a.acked_at desc, a.id desc
         limit 1) latest on true
  ),
  answers as (
    select c.order_id, c.place,
           case
             when not (jsonb_array_length(c.visible) > 0
                       or (jsonb_array_length(coalesce(c.latest_lines, '[]'::jsonb)) > 0
                           and not (c.latest_kind = 'cancel' and c.latest_version = c.version)))
               then null
             when c.prepared_at is not null then 'seen'
             when jsonb_array_length(c.visible) > 0 and c.acknowledged
                  and c.latest_lines is not null
                  and public.kitchen_same_lines(c.visible, c.latest_lines) then 'seen'
             else 'waiting'
           end as answer
      from cells c
  )
  select coalesce(jsonb_agg(jsonb_build_object('orderId', g.order_id, 'marks', g.marks)
                            order by g.order_id), '[]'::jsonb)
    into v_orders
    from (select a.order_id, jsonb_agg(a.answer order by a.place) as marks
            from answers a
           group by a.order_id
          having count(a.answer) > 0) g;

  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'label', k.label) order by k.place),
                  '[]'::jsonb)
    into v_kitchens
    from (select d.id, d.label,
                 row_number() over (order by lower(d.label), d.id) as place
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

-- Restored verbatim from supabase/migrations/20261010000000_the_kitchen_sees_its_orders.sql at 014f5693.
create or replace function public.kitchen_acknowledge(
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

  select s.* into v_shift from public.counter_shifts s
   where s.id = public.app_kitchen_shift();
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

  select * into v_order from public.orders
   where id = p_order_id and outlet_id = v_shift.outlet_id;
  if not found then
    return jsonb_build_object('status', 'not_authorised');
  end if;
  if public.kitchen_order_version(v_order) <> p_order_version then
    -- The cook acknowledged a version that is no longer current; the card is
    -- already alerting for the newer one.
    return jsonb_build_object('status', 'stale');
  end if;

  select * into v_device from public.counter_devices where id = v_shift.device_id;

  insert into public.kitchen_acknowledgements
    (id, outlet_id, device_id, shift_id, person_id, order_id, kind, order_version, lines)
  values
    (p_id, v_shift.outlet_id, v_shift.device_id, v_shift.id, v_shift.person_id, p_order_id,
     p_kind, p_order_version,
     public.kitchen_visible_lines(p_order_id, v_device.kitchen_filter_mode,
                                  v_device.kitchen_category_ids));
  return jsonb_build_object('status', 'accepted');
end;
$$;
