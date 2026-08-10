-- A bill may be settled across several real tender methods. The allocation rows
-- are canonical; bills.payment_method remains only as a nullable single-tender
-- summary for compatibility with the pre-live schema.

alter table public.bills alter column payment_method drop not null;
alter table public.bills add constraint bills_id_outlet_unique unique (id, outlet_id);

create table public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null,
  outlet_id uuid not null references public.outlets(id),
  method public.payment_method not null,
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now(),
  constraint bill_payments_bill_outlet_fk
    foreign key (bill_id, outlet_id) references public.bills(id, outlet_id),
  constraint bill_payments_one_method_per_bill unique (bill_id, method)
);

create index bill_payments_outlet_bill_idx on public.bill_payments (outlet_id, bill_id);
alter table public.bill_payments enable row level security;

insert into public.bill_payments (bill_id, outlet_id, method, amount_paise, created_at)
select id, outlet_id, payment_method, total_paise, paid_at
from public.bills
where payment_method is not null;

create or replace function public.billing_payment_total_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_bill uuid;
  v_total bigint; v_summary public.payment_method; v_count integer;
  v_allocated bigint; v_only public.payment_method;
begin
  if tg_table_name='bills' then
    v_bill:=coalesce(new.id,old.id);
  else
    v_bill:=coalesce(new.bill_id,old.bill_id);
  end if;
  select total_paise, payment_method into v_total, v_summary
  from public.bills where id=v_bill;
  select count(*), coalesce(sum(amount_paise),0), min(method)
    into v_count, v_allocated, v_only
  from public.bill_payments where bill_id=v_bill;
  if v_count=0 or v_allocated<>v_total then
    raise exception 'bill payments must exactly equal the bill total';
  end if;
  if (v_count=1 and v_summary is distinct from v_only)
     or (v_count>1 and v_summary is not null) then
    raise exception 'bill payment summary does not match its allocations';
  end if;
  return coalesce(new,old);
end;
$$;

create constraint trigger bill_payments_total_guard
  after insert or update or delete on public.bill_payments
  deferrable initially deferred for each row
  execute function public.billing_payment_total_guard();
create constraint trigger bills_payment_total_guard
  after insert or update on public.bills
  deferrable initially deferred for each row
  execute function public.billing_payment_total_guard();

create or replace function public.billing_bill_payment_insert_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null
     and current_setting('app.billing_command',true) is distinct from '1' then
    raise exception 'bill payments may be inserted only through billing commands' using errcode='42501';
  end if;
  return new;
end;
$$;

create trigger bill_payments_command_insert before insert on public.bill_payments
  for each row execute function public.billing_bill_payment_insert_guard();
create trigger bill_payments_immutable before update or delete on public.bill_payments
  for each row execute function public.reject_mutation();

create policy bill_payments_select on public.bill_payments for select to authenticated using (
  exists (select 1 from public.bills b where b.id=bill_id));

grant select on public.bill_payments to authenticated;
grant all on public.bill_payments to service_role;
revoke insert,update,delete on public.bill_payments from authenticated,anon;

create or replace function public.billing_validate_payments(p_payments jsonb,p_total bigint)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_count integer; v_distinct integer; v_sum bigint;
begin
  if jsonb_typeof(p_payments)<>'array'
     or jsonb_array_length(p_payments)<1 or jsonb_array_length(p_payments)>5 then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payments) payment
    where not public.billing_payload_has_keys(payment,array['method','amountPaise'])
       or jsonb_typeof(payment->'method')<>'string'
       or jsonb_typeof(payment->'amountPaise')<>'number'
       or (payment->>'amountPaise') !~ '^[0-9]+$'
       or (payment->>'amountPaise')::bigint<=0
  ) then return false; end if;
  select count(*),count(distinct (payment->>'method')::public.payment_method),
         sum((payment->>'amountPaise')::bigint)
    into v_count,v_distinct,v_sum from jsonb_array_elements(p_payments) payment;
  return v_count=v_distinct and v_sum=p_total;
exception when others then return false;
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
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
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
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','arithmetic_invalid'),
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
      'payments','lines']);
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
      customer_phone,subtotal_paise,discount_paise,tax_paise,total_paise,pricing_mode,
      payment_method,status,created_at,synced_at)
    values (v_bill,v_outlet,v_date,v_payment_date,p_created_at,p_created_at,null,
      (v_context->>'actorId')::uuid,auth.uid(),p_shift_id,null,v_customer,
      nullif(p_payload->>'customerName',''),nullif(p_payload->>'customerPhone',''),
      (p_payload->>'subtotalPaise')::bigint,(p_payload->>'discountPaise')::bigint,
      (p_payload->>'taxPaise')::bigint,(p_payload->>'totalPaise')::bigint,
      (p_payload->>'pricingMode')::public.pricing_mode,v_summary,'settled',now(),now())
    returning bill_number into v_number;
    insert into public.bill_payments (bill_id,outlet_id,method,amount_paise)
      select v_bill,v_outlet,(payment->>'method')::public.payment_method,
        (payment->>'amountPaise')::bigint from jsonb_array_elements(p_payload->'payments') payment;
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

create or replace function public.close_business_day(
  p_outlet_id uuid,p_business_date date,p_opening_cash_paise bigint,
  p_actual_closing_paise bigint,p_notes text default null
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
  select coalesce(sum(bp.amount_paise),0) into v_sales
    from public.bill_payments bp join public.bills b on b.id=bp.bill_id
    where bp.outlet_id=p_outlet_id and b.payment_business_date=p_business_date
      and bp.method='cash' and b.status='settled';
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

revoke execute on function public.billing_validate_payments(jsonb,bigint) from public,anon,authenticated;
