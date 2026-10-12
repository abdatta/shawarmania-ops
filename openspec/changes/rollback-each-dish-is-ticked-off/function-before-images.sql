-- Schema-only before-images captured from production; contains no row data.
CREATE OR REPLACE FUNCTION public.billing_order_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.counter_kitchen_marks()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare outlet uuid:=public.app_counter_shift_outlet(); kitchens jsonb; orders jsonb; tablets integer;
begin
  if outlet is null then raise exception 'the kitchen marks need a live counter shift' using errcode='42501'; end if;
  with ks as (
    select d.*,row_number() over(order by lower(d.label),d.id) place
    from public.counter_devices d join public.counter_shifts s on s.device_id=d.id
    where s.outlet_id=outlet and s.kind='kitchen' and s.ended_at is null and s.expires_at>now()
      and d.removed_at is null and d.session_proven_at is not null and d.kind='kitchen'
  ), rail as (
    select o.id,o.prepared_at from public.orders o where o.outlet_id=outlet
      and (o.status='open' or (o.status='paid' and o.prepared_at is null))
  ), cells as (
    select r.id order_id,k.place,public.kitchen_visible_lines(r.id,k.kitchen_filter_mode,k.kitchen_category_ids) visible,
      public.kitchen_ticket(r.id,k.id) ticket,
      exists(select 1 from public.kitchen_readies rd where rd.order_id=r.id and rd.device_id=k.id and rd.undoes is null
        and not exists(select 1 from public.kitchen_readies u where u.undoes=rd.id)
        and jsonb_array_length(public.kitchen_done_lines(rd.id))>0) has_ready
    from rail r cross join ks k
  ), states as (
    select *,case
      when jsonb_array_length(visible)=0 and ticket is null and not has_ready then null
      when has_ready then 'ready'
      when jsonb_array_length(visible)>0 and jsonb_array_length(public.kitchen_owed_lines(visible,false))=0 then 'handed_over'
      when ticket->>'acknowledged'='true' and public.kitchen_same_lines(ticket->'lines',ticket->'latestAck'->'lines') then 'acknowledged'
      else 'sent' end state from cells
  ) select coalesce(jsonb_agg(jsonb_build_object('orderId',order_id,'marks',marks,'dishStates',states,
      'readyQuantities',(select coalesce(jsonb_object_agg(i.id,public.dish_ready_quantity(i.id)),'{}'::jsonb)
        from public.order_items i where i.order_id=order_id and i.kind='item'))),'[]'::jsonb)
    into orders from (select order_id,jsonb_agg(state order by place) states,
      jsonb_agg(case when state is null then null when state in ('acknowledged','ready','handed_over') then 'seen' else 'waiting' end order by place) marks
      from states group by order_id having count(state)>0) g;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'label',d.label) order by lower(d.label),d.id),'[]'::jsonb)
    into kitchens from public.counter_devices d join public.counter_shifts s on s.device_id=d.id
    where s.outlet_id=outlet and s.kind='kitchen' and s.ended_at is null and s.expires_at>now()
      and d.removed_at is null and d.session_proven_at is not null and d.kind='kitchen';
  select count(*) into tablets from public.counter_devices where outlet_id=outlet and kind='kitchen' and removed_at is null and session_proven_at is not null;
  return jsonb_build_object('kitchens',kitchens,'orders',orders,'kitchenTablets',tablets);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_billing_order(p_command_id uuid DEFAULT NULL::uuid, p_schema_version integer DEFAULT NULL::integer, p_payload_hash text DEFAULT NULL::text, p_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_shift_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.kitchen_acknowledge(p_id uuid, p_order_id uuid, p_kind text, p_order_version timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     public.kitchen_owed_lines(public.kitchen_visible_lines(p_order_id, v_device.kitchen_filter_mode,
                                  v_device.kitchen_category_ids)));
  return jsonb_build_object('status', 'accepted');
end;
$function$;

CREATE OR REPLACE FUNCTION public.kitchen_board()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.counter_shifts%rowtype; d public.counter_devices%rowtype; cutover time; cards jsonb;
begin
  select * into s from public.counter_shifts where id=public.app_kitchen_shift();
  if not found then raise exception 'the kitchen board needs a live kitchen shift' using errcode='42501'; end if;
  select * into d from public.counter_devices where id=s.device_id;
  select business_day_cutover into cutover from public.outlets where id=s.outlet_id;
  with candidates as (
    select o.* from public.orders o where o.outlet_id=s.outlet_id
      and (o.status='open' or (o.status='paid' and o.prepared_at is null)) and o.prepared_at is null
    union all select o.* from public.orders o where o.outlet_id=s.outlet_id and o.status='cancelled'
      and o.business_date in (s.business_date,s.business_date-1)
      and public.app_business_date(o.cancelled_at,cutover)=s.business_date
  ), active as (
    select o.ordered_at,public.kitchen_ticket(o.id,d.id) card from candidates o
  ), receipts as (
    select o.ordered_at,jsonb_build_object('id',r.id,'sourceOrderId',o.id,'readyId',r.id,
      'orderNumber',o.order_number,'serviceType',o.service_type,'tableNumber',o.table_number,
      'orderedAt',o.ordered_at,'version',public.kitchen_order_version(o),'status',o.status,
      'cancelledAt',null,'lines',x.lines,'otherItemCount',0,'ticketNumber',
      row_number() over(partition by r.order_id order by r.at,r.id),'acknowledged',true,
      'latestAck',jsonb_build_object('kind','new','orderVersion',public.kitchen_order_version(o),
        'lines',x.lines,'ackedAt',r.at)) card
    from public.kitchen_readies r join public.orders o on o.id=r.order_id
    cross join lateral (select public.kitchen_done_lines(r.id) lines) x
    where r.device_id=d.id and r.outlet_id=s.outlet_id and r.undoes is null
      and not exists(select 1 from public.kitchen_readies u where u.undoes=r.id)
      and (o.status='open' or (o.status='paid' and o.prepared_at is null))
  ) select coalesce(jsonb_agg(card order by ordered_at,card->>'id'),'[]'::jsonb) into cards
    from (select * from active where card is not null
      union all select * from receipts where jsonb_array_length(card->'lines')>0) q;
  return jsonb_build_object('readAt',now(),'outletId',s.outlet_id,'businessDate',s.business_date,
    'shiftId',s.id,'operatorName',(select full_name from public.profiles where id=s.person_id),
    'filterChangedAt',d.kitchen_filter_changed_at,'filterMode',d.kitchen_filter_mode,
    'categoryIds',to_jsonb(d.kitchen_category_ids),'sort',d.kitchen_sort,'orders',cards);
end;
$function$;

CREATE OR REPLACE FUNCTION public.kitchen_same_lines(p_left jsonb, p_right jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select not exists(select 1 from
    (select coalesce(l->>'menuItemId','name:'||(l->>'itemName')) dish,
      coalesce(l->>'note','') note,sum((l->>'quantity')::integer) quantity
      from jsonb_array_elements(coalesce(p_left,'[]'::jsonb)) l group by 1,2) a
    full join (select coalesce(l->>'menuItemId','name:'||(l->>'itemName')) dish,
      coalesce(l->>'note','') note,sum((l->>'quantity')::integer) quantity
      from jsonb_array_elements(coalesce(p_right,'[]'::jsonb)) l group by 1,2) b using(dish,note)
    where a.quantity is distinct from b.quantity)
$function$;

CREATE OR REPLACE FUNCTION public.kitchen_visible_lines(p_order_id uuid, p_mode text, p_category_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'menuItemId',i.menu_item_id,
    'itemName',i.item_name,'quantity',i.quantity,'note',i.note) order by i.item_name,i.id),'[]'::jsonb)
  from public.order_items i left join public.menu_items m on m.id=i.menu_item_id
  where i.order_id=p_order_id and i.kind='item'
    and public.kitchen_line_visible(m.category_id,p_mode,p_category_ids)
$function$;

CREATE OR REPLACE FUNCTION public.pay_billing_now(p_command_id uuid DEFAULT NULL::uuid, p_schema_version integer DEFAULT NULL::integer, p_payload_hash text DEFAULT NULL::text, p_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_shift_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.prepare_billing_order(p_command_id uuid DEFAULT NULL::uuid, p_schema_version integer DEFAULT NULL::integer, p_payload_hash text DEFAULT NULL::text, p_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_shift_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.revise_billing_order(p_command_id uuid DEFAULT NULL::uuid, p_schema_version integer DEFAULT NULL::integer, p_payload_hash text DEFAULT NULL::text, p_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_shift_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
