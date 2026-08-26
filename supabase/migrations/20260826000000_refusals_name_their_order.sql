-- A refusal names the order it was about.
--
-- Every refusal edited below is raised inside a function that has already
-- selected the order into `v_order`, and the accepted path already returns its
-- number. The refusal path returned `orderStatus` and stopped, so neither the
-- tablet's attention item nor the manager's diagnostics could say *which* order
-- was refused: on 2026-08-26 the two order numbers behind three red rows at
-- Kalyani had to be recovered by correlating command timestamps against
-- `orders`, which is not available to somebody standing at a counter.
--
-- Every order-bearing refusal is covered rather than only the two seen in
-- production, because a panel that names the order for some refusals and not
-- others is harder to read than one that never does.
--
-- These are `create or replace` of the current bodies with one uniform edit:
-- `orderId` and `orderNumber` added to the refusal payload. No guard's
-- condition, ordering or verdict is touched. The result is jsonb and the client
-- parser accepts unknown members, so every existing reader keeps working.

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
     or v_order.total_paise<>v_order.subtotal_paise-v_order.discount_paise+v_order.tax_paise
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
    customer_phone,subtotal_paise,discount_paise,tax_paise,total_paise,pricing_mode,
    payment_method,status,created_at,synced_at)
  values (v_bill,v_order.outlet_id,v_order.business_date,v_payment_date,v_order.ordered_at,v_paid_at,
    v_order.id,(v_context->>'actorId')::uuid,auth.uid(),p_shift_id,null,v_order.customer_id,
    v_order.customer_name,v_order.customer_phone,v_order.subtotal_paise,v_order.discount_paise,
    v_order.tax_paise,v_order.total_paise,v_order.pricing_mode,v_summary,'settled',now(),now())
  returning bill_number into v_number;
  insert into public.bill_payments (bill_id,outlet_id,method,amount_paise)
    select v_bill,v_order.outlet_id,(payment->>'method')::public.payment_method,
      (payment->>'amountPaise')::bigint from jsonb_array_elements(p_payload->'payments') payment;
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
  -- payer's paid-but-unprepared one.
  if v_order.status='cancelled'
     or (not v_prepared and v_order.status<>'open')
     or (v_prepared and v_order.status='paid' and v_order.prepared_at is not null) then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
      'orderStatus',v_order.status,'commandId',p_command_id),v_order.business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  update public.orders set prepared_at=case when v_prepared then p_created_at end
    where id=v_order.id;
  v_new_status:=v_order.status;
  return public.billing_finish_command(p_command_id,jsonb_build_object('status','accepted',
    'commandId',p_command_id,'orderId',v_order.id,'orderNumber',v_order.order_number,
    'orderStatus',v_new_status,'prepared',v_prepared,
    'delayed',(v_context->>'delayed')::boolean),v_order.business_date);
end;
$$;

create or replace function public.unpay_billing_order(
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
  v_bill public.bills%rowtype; v_reason text; v_order_id uuid; v_bill_id uuid;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['orderId','billId','reason']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'billId')<>'string'
     or jsonb_typeof(p_payload->'reason')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  begin
    v_order_id:=(p_payload->>'orderId')::uuid;
    v_bill_id:=(p_payload->>'billId')::uuid;
    v_reason:=btrim(p_payload->>'reason');
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_order_id is null or v_bill_id is null or v_reason is null or length(v_reason)=0 then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context:=public.billing_device_context(p_shift_id,p_created_at);
  if v_context->>'status'<>'ok' then return v_context; end if;
  v_claim:=public.billing_begin_command(p_command_id,'void_order_payment',p_schema_version,
    p_payload_hash,p_created_at,(v_context->>'outletId')::uuid,auth.uid(),p_shift_id,
    (v_context->>'actorId')::uuid);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;
  select * into v_order from public.orders where id=v_order_id for update;
  if not found or v_order.outlet_id<>(v_context->>'outletId')::uuid or v_order.device_id<>auth.uid() then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'));
  end if;
  if v_order.status<>'paid' or v_order.bill_id is distinct from v_bill_id then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
      'orderStatus',v_order.status,'commandId',p_command_id),v_order.business_date);
  end if;
  select * into v_bill from public.bills where id=v_bill_id;
  if not found or v_bill.order_id<>v_order.id then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'));
  end if;
  if v_bill.status<>'settled' then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
      'commandId',p_command_id),v_bill.business_date,v_bill.payment_business_date);
  end if;
  -- The same clock, enforced from the same stored column, that tender
  -- corrections answer to. A rendered timer grants nothing.
  if p_created_at<v_bill.paid_at or p_created_at>=v_bill.paid_at+interval '5 minutes' then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','payment_edit_expired','orderId',v_order.id,'orderNumber',v_order.order_number,'commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  update public.bills set status='void',voided_by=(v_context->>'actorId')::uuid,
    voided_at=p_created_at,void_reason=v_reason,void_kind='counter_unpay'
    where id=v_bill.id and status='settled';
  if not found then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
      'commandId',p_command_id),v_bill.business_date,v_bill.payment_business_date);
  end if;
  update public.orders set status='open',paid_by=null,paid_shift_id=null,paid_at=null,bill_id=null
    where id=v_order.id;
  return public.billing_finish_command(p_command_id,jsonb_build_object('status','accepted',
    'commandId',p_command_id,'orderId',v_order.id,'orderNumber',v_order.order_number,
    'billId',v_bill.id,'billNumber',v_bill.bill_number,'kind','counter_unpay',
    'delayed',(v_context->>'delayed')::boolean),v_bill.business_date,v_bill.payment_business_date);
end;
$$;

create or replace function public.cancel_paid_billing_order(
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
  v_bill public.bills%rowtype; v_reason text; v_order_id uuid; v_bill_id uuid;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['orderId','billId','reason']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'orderId')<>'string'
     or jsonb_typeof(p_payload->'billId')<>'string'
     or jsonb_typeof(p_payload->'reason')<>'string' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  begin
    v_order_id:=(p_payload->>'orderId')::uuid;
    v_bill_id:=(p_payload->>'billId')::uuid;
    v_reason:=btrim(p_payload->>'reason');
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_order_id is null or v_bill_id is null or v_reason is null or length(v_reason)=0 then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context:=public.billing_device_context(p_shift_id,p_created_at);
  if v_context->>'status'<>'ok' then return v_context; end if;
  v_claim:=public.billing_begin_command(p_command_id,'cancel_paid_order',p_schema_version,
    p_payload_hash,p_created_at,(v_context->>'outletId')::uuid,auth.uid(),p_shift_id,
    (v_context->>'actorId')::uuid);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;
  select * into v_order from public.orders where id=v_order_id for update;
  if not found or v_order.outlet_id<>(v_context->>'outletId')::uuid or v_order.device_id<>auth.uid() then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'));
  end if;
  if v_order.status<>'paid' or v_order.bill_id is distinct from v_bill_id then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
      'orderStatus',v_order.status,'commandId',p_command_id),v_order.business_date);
  end if;
  select * into v_bill from public.bills where id=v_bill_id;
  if not found or v_bill.order_id<>v_order.id then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'));
  end if;
  if v_bill.status<>'settled' then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
      'commandId',p_command_id),v_bill.business_date,v_bill.payment_business_date);
  end if;
  if p_created_at<v_bill.paid_at or p_created_at>=v_bill.paid_at+interval '5 minutes' then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','payment_edit_expired','orderId',v_order.id,'orderNumber',v_order.order_number,'commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  update public.bills set status='void',voided_by=(v_context->>'actorId')::uuid,
    voided_at=p_created_at,void_reason=v_reason,void_kind='cancelled_after_paid'
    where id=v_bill.id and status='settled';
  if not found then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
      'commandId',p_command_id),v_bill.business_date,v_bill.payment_business_date);
  end if;
  update public.orders set status='cancelled',paid_by=null,paid_shift_id=null,paid_at=null,bill_id=null,
    cancelled_by=(v_context->>'actorId')::uuid,
    cancelled_device_id=auth.uid(),cancelled_shift_id=p_shift_id,cancelled_at=p_created_at,
    cancel_reason=v_reason where id=v_order.id;
  return public.billing_finish_command(p_command_id,jsonb_build_object('status','accepted',
    'commandId',p_command_id,'orderId',v_order.id,'orderNumber',v_order.order_number,
    'billId',v_bill.id,'billNumber',v_bill.bill_number,'kind','cancelled_after_paid',
    'delayed',(v_context->>'delayed')::boolean),v_bill.business_date,v_bill.payment_business_date);
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
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
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
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open','orderId',v_order.id,'orderNumber',v_order.order_number,
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
