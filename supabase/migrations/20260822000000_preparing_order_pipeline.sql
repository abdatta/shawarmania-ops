-- #45 preparing-order-pipeline
--
-- An order gains a preparation axis independent of payment: `prepared_at`
-- null means still preparing, a timestamp means prepared, clearing it is
-- reprepare. The status enum stays the money lifecycle, so a paid-but-still-
-- cooking order is representable without combinatorial enum values.
--
-- Three commands join the vocabulary. `set_order_preparation` marks and
-- reprepares. `void_order_payment` and `cancel_paid_order` are the counter's
-- payment unwinds: within five minutes of the bill's stored `paid_at`, and
-- only from the tablet and shift that took the payment, the originating
-- tablet may void its own bill, reopening the order or cancelling it, as one
-- atomic transaction stamped with a structured void kind. Outside the
-- window, and for every direct write by any role, nothing changes: voiding
-- remains the manager's reasoned act.

alter table public.orders add column prepared_at timestamptz;

alter table public.bills add column void_kind text
  constraint bills_void_kind_check
  check (void_kind in ('manager_void', 'counter_unpay', 'cancelled_after_paid'));

-- One bill per order becomes one LIVE bill per order: taking a payment back
-- and paying again correctly must be possible, so uniqueness moves from "one
-- bill row ever" to "one settled bill row", and history keeps every bill.
alter table public.bills drop constraint bills_order_id_key;
create unique index bills_one_live_bill_per_order
  on public.bills (order_id) where status = 'settled';

-- The command_type check list is closed; every addition is deliberate.
alter table public.billing_commands drop constraint billing_commands_command_type_check;
alter table public.billing_commands add constraint billing_commands_command_type_check
  check (command_type in (
    'create_order', 'revise_order', 'cancel_order', 'pay_order', 'pay_now',
    'correct_bill_payment', 'void_bill', 'manager_cancel_order',
    'confirm_end_of_day', 'set_order_preparation', 'void_order_payment',
    'cancel_paid_order'));

-- The order guard's column allow-lists are what make an order immutable in
-- exactly the ways the contract names. Preparation joins the open-order
-- transitions; and the paid-to-open reverse transition exists solely so the
-- payment unwind can reopen an order. No other change to a paid row passes,
-- and cancelled stays terminal in every direction.
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
        'subtotal_paise','discount_paise','tax_paise','total_paise','pricing_mode',
        'changed_by','changed_shift_id','changed_at','prepared_at'])
       is distinct from
       (to_jsonb(old) - array['customer_id','customer_name','customer_phone',
        'subtotal_paise','discount_paise','tax_paise','total_paise','pricing_mode',
        'changed_by','changed_shift_id','changed_at','prepared_at']) then
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

-- Append-only keeps its spine: settled to void touching only the void
-- columns, by an admin session. Two things are learned here. The kind is part
-- of the void attribution. And the bill's own tablet may perform the
-- transition while a billing command it authorised is executing -- its device
-- must match the bill's counter_device_id, so a foreign tablet gains nothing.
-- A direct client write has neither the role nor the command context, and is
-- refused exactly as before.
create or replace function public.bills_void_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'settled' and new.status = 'void' then
    if (to_jsonb(new) - 'status' - 'voided_by' - 'voided_at' - 'void_reason' - 'void_kind')
       is distinct from
       (to_jsonb(old) - 'status' - 'voided_by' - 'voided_at' - 'void_reason' - 'void_kind') then
      raise exception 'voiding may not modify any bill field other than void attribution';
    end if;

    -- Role gate applies to client sessions; seeds and privileged maintenance
    -- run without a session and answer to the RLS-less trigger checks above.
    if auth.uid() is not null then
      if not (public.app_is_owner()
              or public.app_has_role_at('franchise_admin', new.outlet_id))
         and not (current_setting('app.billing_command', true) = '1'
                  and new.counter_device_id = auth.uid()) then
        raise exception 'only a franchise admin of this outlet, the owner, or the bill''s own tablet under its command may void a bill';
      end if;
      -- Within an authorised tablet command the session is the device, so the
      -- human attribution comes from the command's actor rather than
      -- auth.uid(); outside one, the voiding session is who it says it is.
      if new.voided_by is distinct from auth.uid()
         and not (current_setting('app.billing_command', true) = '1'
                  and new.counter_device_id = auth.uid()) then
        raise exception 'voided_by must be the voiding session';
      end if;
    end if;

    return new;
  end if;

  raise exception 'bills are append-only once settled; corrections are voids plus new bills';
end;
$$;

-- Commands ------------------------------------------------------------------

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
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
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

-- The two unwinds share their guards and differ only in the order row's
-- destination, but each function stands alone: receipts stay per business
-- action, and nothing about the RPC surface is clever.

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
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
      'orderStatus',v_order.status,'commandId',p_command_id),v_order.business_date);
  end if;
  select * into v_bill from public.bills where id=v_bill_id;
  if not found or v_bill.order_id<>v_order.id then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'));
  end if;
  if v_bill.status<>'settled' then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
      'commandId',p_command_id),v_bill.business_date,v_bill.payment_business_date);
  end if;
  -- The same clock, enforced from the same stored column, that tender
  -- corrections answer to. A rendered timer grants nothing.
  if p_created_at<v_bill.paid_at or p_created_at>=v_bill.paid_at+interval '5 minutes' then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','payment_edit_expired','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  update public.bills set status='void',voided_by=(v_context->>'actorId')::uuid,
    voided_at=p_created_at,void_reason=v_reason,void_kind='counter_unpay'
    where id=v_bill.id and status='settled';
  if not found then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
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
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
      'orderStatus',v_order.status,'commandId',p_command_id),v_order.business_date);
  end if;
  select * into v_bill from public.bills where id=v_bill_id;
  if not found or v_bill.order_id<>v_order.id then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','authorization_refused'));
  end if;
  if v_bill.status<>'settled' then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
      'commandId',p_command_id),v_bill.business_date,v_bill.payment_business_date);
  end if;
  if p_created_at<v_bill.paid_at or p_created_at>=v_bill.paid_at+interval '5 minutes' then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','payment_edit_expired','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;
  perform set_config('app.billing_command','1',true);
  update public.bills set status='void',voided_by=(v_context->>'actorId')::uuid,
    voided_at=p_created_at,void_reason=v_reason,void_kind='cancelled_after_paid'
    where id=v_bill.id and status='settled';
  if not found then
    return public.billing_finish_command(p_command_id,jsonb_build_object('status','order_not_open',
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
