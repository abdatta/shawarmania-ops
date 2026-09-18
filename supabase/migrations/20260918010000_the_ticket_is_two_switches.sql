-- #55 the-ticket-is-two-switches, part two: the five-minute clock starts when
-- the ticket is finished, not when the money was recorded.
--
-- An order answers two independent questions -- is the food made (`prepared_at`)
-- and is it paid (`status`) -- and #45 built the data that way on purpose. The
-- take-back clock treated one switch as if it ended the whole ticket: at a
-- counter where customers pay when they order, it ran while the food was still
-- being made, and a biller who noticed at minute six that they had tapped Cash
-- for a UPI payment had already lost the undo.
--
-- The ticket is finished when the SECOND of the two lands, whichever it was:
-- the upfront payer is prepared after paying, the customer who pays on handover
-- is paid after preparing. So the window ends five minutes after
-- `greatest(paid_at, prepared_at)`, and it does not start at all while
-- `prepared_at` is null. A bill carrying no order -- a direct sale rung and paid
-- without saving an order -- has no preparation to wait for and keeps the old
-- rule of five minutes from its own `paid_at`.
--
-- The three refusing functions and the end-of-day guard all read the window
-- from `billing_edit_window_end` below rather than from three copies of an
-- expression, because a rule copied three times is a rule that will disagree
-- with itself. Every authorization check stays AHEAD of the window check, in
-- that order: a widened window must never widen who may use it.

-- ---------------------------------------------------------------------------
-- The window, named once.

create or replace function public.billing_edit_window_end(
  p_paid_at timestamptz,
  p_prepared_at timestamptz,
  p_settles_an_order boolean
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  -- NULL means "no deadline yet": the food is still owed, so the ticket is not
  -- finished and its payment stays reversible however long ago it was taken.
  select case
    when not p_settles_an_order then p_paid_at + interval '5 minutes'
    when p_prepared_at is null then null
    else greatest(p_paid_at, p_prepared_at) + interval '5 minutes'
  end;
$$;

-- Reached only from inside the security-definer commands below, which run as
-- this function's owner, so no client role needs it. This app has no anonymous
-- surface at all and no client-side reader of a rule the database enforces.
revoke execute on function public.billing_edit_window_end(timestamptz, timestamptz, boolean)
  from public, anon, authenticated;

comment on function public.billing_edit_window_end(timestamptz, timestamptz, boolean) is
  'The ticket edit window: five minutes after the later of payment and preparation, '
  'unbounded while preparation is unrecorded, and five minutes after payment for a '
  'bill that settles no order. Derived, never stored.';

-- ---------------------------------------------------------------------------
-- Taking a payment back.

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
  v_deadline timestamptz;
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
  -- The ticket's edit window: five minutes past the later of payment and
  -- preparation, and no deadline at all while the food is still owed. The same
  -- expression the cancel-after-paid and tender-correction commands answer to,
  -- computed in one place. A rendered timer grants nothing.
  v_deadline:=public.billing_edit_window_end(v_bill.paid_at,v_order.prepared_at,true);
  if p_created_at<v_bill.paid_at
     or (v_deadline is not null and p_created_at>=v_deadline) then
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

-- ---------------------------------------------------------------------------
-- Cancelling after payment.

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
  v_deadline timestamptz;
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
  -- The same ticket edit window as the take-back, from the same function.
  v_deadline:=public.billing_edit_window_end(v_bill.paid_at,v_order.prepared_at,true);
  if p_created_at<v_bill.paid_at
     or (v_deadline is not null and p_created_at>=v_deadline) then
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

-- ---------------------------------------------------------------------------
-- Correcting the tender.
--
-- This command works from the bill, so it reaches preparation through
-- `bills.order_id` -- which is NULLABLE, and that null is exactly the
-- direct-sale case. A join would drop the null and hand every direct bill an
-- unbounded window, so the read is a left lookup and the null is carried into
-- the window function as `p_settles_an_order = false`.

create or replace function public.correct_bill_payment(
  p_command_id uuid default null,p_schema_version integer default null,
  p_payload_hash text default null,p_created_at timestamptz default null,
  p_shift_id uuid default null,p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_error text; v_context jsonb; v_claim jsonb; v_bill public.bills%rowtype;
  v_bill_id uuid; v_expected integer; v_current integer; v_correction uuid;
  v_result jsonb; v_same boolean; v_prepared_at timestamptz; v_deadline timestamptz;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['billId','expectedRevision','payments']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'billId')<>'string'
     or jsonb_typeof(p_payload->'expectedRevision')<>'number'
     or (p_payload->>'expectedRevision') !~ '^[0-9]+$'
     or jsonb_typeof(p_payload->'payments')<>'array' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  v_context:=public.billing_device_context(p_shift_id,p_created_at);
  if v_context->>'status'<>'ok' then return v_context; end if;
  begin
    v_bill_id:=(p_payload->>'billId')::uuid;
    v_expected:=(p_payload->>'expectedRevision')::integer;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;

  select * into v_bill from public.bills where id=v_bill_id for update;
  if not found or v_bill.outlet_id<>(v_context->>'outletId')::uuid
     or v_bill.counter_device_id<>auth.uid()
     or v_bill.counter_shift_id<>p_shift_id then
    return jsonb_build_object('status','authorization_refused');
  end if;

  v_claim:=public.billing_begin_command(p_command_id,'correct_bill_payment',p_schema_version,
    p_payload_hash,p_created_at,v_bill.outlet_id,auth.uid(),p_shift_id,
    (v_context->>'actorId')::uuid);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;

  if v_bill.status<>'settled' then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;
  -- The same ticket edit window as the two unwinds. `v_prepared_at` stays null
  -- when the bill settles no order, and the third argument is what tells the
  -- window function which of the two rules applies.
  if v_bill.order_id is not null then
    select o.prepared_at into v_prepared_at from public.orders o where o.id=v_bill.order_id;
  end if;
  v_deadline:=public.billing_edit_window_end(
    v_bill.paid_at,v_prepared_at,v_bill.order_id is not null);
  if p_created_at<v_bill.paid_at
     or (v_deadline is not null and p_created_at>=v_deadline) then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','payment_edit_expired','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;
  if not coalesce(public.billing_validate_payments(p_payload->'payments',v_bill.total_paise),false) then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','arithmetic_invalid','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;

  select coalesce(max(revision),0) into v_current
    from public.bill_payment_corrections where bill_id=v_bill.id;
  if v_expected<>v_current then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','stale_revision','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;
  select not exists (
    (select method::text,amount_paise from public.effective_bill_payments where bill_id=v_bill.id
     except select payment->>'method',(payment->>'amountPaise')::bigint
       from jsonb_array_elements(p_payload->'payments') payment)
    union all
    (select payment->>'method',(payment->>'amountPaise')::bigint
       from jsonb_array_elements(p_payload->'payments') payment
     except select method::text,amount_paise from public.effective_bill_payments where bill_id=v_bill.id)
  ) into v_same;
  if v_same then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','arithmetic_invalid','commandId',p_command_id),
      v_bill.business_date,v_bill.payment_business_date);
  end if;

  perform set_config('app.billing_command','1',true);
  insert into public.bill_payment_corrections
    (command_id,bill_id,outlet_id,device_id,shift_id,actor_id,revision,client_created_at)
  values (p_command_id,v_bill.id,v_bill.outlet_id,auth.uid(),p_shift_id,
    (v_context->>'actorId')::uuid,v_current+1,p_created_at)
  returning id into v_correction;
  insert into public.bill_payment_correction_allocations
    (correction_id,outlet_id,method,amount_paise)
  select v_correction,v_bill.outlet_id,(payment->>'method')::public.payment_method,
    (payment->>'amountPaise')::bigint from jsonb_array_elements(p_payload->'payments') payment;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,
    'billId',v_bill.id,'billNumber',v_bill.bill_number,'paymentRevision',v_current+1,
    'delayed',(v_context->>'delayed')::boolean);
  return public.billing_finish_command(p_command_id,v_result,
    v_bill.business_date,v_bill.payment_business_date);
end;
$$;

-- ---------------------------------------------------------------------------
-- Finishing the day.
--
-- Two changes, pulling in opposite directions and both the owner's decision.
--
-- It gains a blocker: the day may not close while an order at that business
-- date is **paid and not prepared**. Today's check catches `status='open'`
-- only, which a paid-but-unprepared order does not match. Closing a day while a
-- paying customer is still owed food is wrong on its own terms, and under the
-- derived window it would also leave an unbounded undo open behind a confirmed
-- day. It returns its own status so the sheet can name that work in the
-- biller's words rather than counting it among ordinary open orders.
--
-- And it loses one: `billing_end_of_day_payment_edit_guard` refused the day
-- close for five minutes after any settled payment, which the Finish Day sheet
-- two screens away has been calling "not a blocker" and offering to finish
-- through since `append_only_payment_corrections`. Nothing in the app handled
-- the refusal, so a biller who closed a day quickly met a generic failure. The
-- screen's promise is the one the owner kept: closing the day ends the window
-- early. What stops a later unwind is not a new guard but an old one --
-- `billing_device_context` requires a live shift and finishing the day ends it
-- -- and that claim is proved by hand-crafted requests in pgTAP rather than
-- asserted here.

create or replace function public.confirm_billing_end_of_day(
  p_command_id uuid default null,
  p_schema_version integer default null,
  p_payload_hash text default null,
  p_created_at timestamptz default null,
  p_shift_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_error text; v_device public.counter_devices%rowtype; v_outlet uuid; v_date date;
  v_unsent integer; v_needs_attention integer; v_shift uuid; v_claim jsonb;
  v_result jsonb; v_watermark bigint;
begin
  v_error:=public.billing_envelope_error(p_command_id,p_schema_version,p_payload_hash,p_created_at,
    p_payload,array['outletId','businessDate','unsentCount','needsAttentionCount']);
  if v_error is not null then return jsonb_build_object('status',v_error); end if;
  if jsonb_typeof(p_payload->'outletId')<>'string'
     or jsonb_typeof(p_payload->'businessDate')<>'string'
     or jsonb_typeof(p_payload->'unsentCount')<>'number'
     or jsonb_typeof(p_payload->'needsAttentionCount')<>'number' then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if p_shift_id is not null then return jsonb_build_object('status','malformed_payload'); end if;
  select * into v_device from public.counter_devices where id=auth.uid() and removed_at is null and session_proven_at is not null;
  if not found then return jsonb_build_object('status','removed_tablet'); end if;
  begin
    v_outlet:=(p_payload->>'outletId')::uuid;
    v_date:=(p_payload->>'businessDate')::date;
    v_unsent:=(p_payload->>'unsentCount')::integer;
    v_needs_attention:=(p_payload->>'needsAttentionCount')::integer;
  exception when others then return jsonb_build_object('status','malformed_payload'); end;
  if v_outlet is null or v_date is null or v_unsent is null or v_needs_attention is null
     or v_outlet<>v_device.outlet_id or v_unsent<0 or v_needs_attention<0 then
    return jsonb_build_object('status','malformed_payload');
  end if;
  if v_unsent<>0 or v_needs_attention<>0 then
    return jsonb_build_object('status','unresolved_operations');
  end if;
  v_claim:=public.billing_begin_command(p_command_id,'confirm_end_of_day',p_schema_version,
    p_payload_hash,p_created_at,v_device.outlet_id,v_device.id,null,null);
  if v_claim->>'status'<>'claimed' then return v_claim; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_device.outlet_id::text||':'||v_date::text,0));
  select id into v_shift from public.counter_shifts
    where device_id=v_device.id and business_date=v_date
    order by opened_at desc,id desc limit 1 for update;
  if not found then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','authorization_refused','commandId',p_command_id),v_date);
  end if;
  if exists (select 1 from public.orders
      where outlet_id=v_device.outlet_id and business_date=v_date and status='open') then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','unresolved_operations','commandId',p_command_id),v_date);
  end if;
  -- Food owed on a paid order. Its own status, because "1 open order" and
  -- "1 order is paid but not marked prepared" send the biller to different
  -- work, and the second one has a customer waiting at the counter.
  if exists (select 1 from public.orders
      where outlet_id=v_device.outlet_id and business_date=v_date
        and status='paid' and prepared_at is null) then
    return public.billing_finish_command(p_command_id,
      jsonb_build_object('status','unresolved_preparation','commandId',p_command_id),v_date);
  end if;

  update public.counter_shifts
     set ended_at=coalesce(ended_at,now()),
         ended_reason=case when ended_at is null then 'day_finished' else ended_reason end
   where id=v_shift;
  select watermark into v_watermark from public.billing_commands where id=p_command_id;
  v_result:=jsonb_build_object('status','accepted','commandId',p_command_id,
    'businessDate',v_date,'watermark',v_watermark);
  perform public.billing_finish_command(p_command_id,v_result,v_date);
  insert into public.billing_end_of_day_confirmations
    (outlet_id,device_id,business_date,shift_id,confirmed_at,command_watermark)
  values (v_device.outlet_id,v_device.id,v_date,v_shift,now(),v_watermark)
  on conflict (device_id,business_date) do update set confirmed_at=excluded.confirmed_at,
    shift_id=excluded.shift_id,command_watermark=excluded.command_watermark,
    invalidated_at=null,invalidated_by_command_id=null;
  return v_result;
end;
$$;

drop trigger if exists billing_end_of_day_payment_edit_guard
  on public.billing_end_of_day_confirmations;
drop function if exists public.reject_open_payment_edit_at_finish();
