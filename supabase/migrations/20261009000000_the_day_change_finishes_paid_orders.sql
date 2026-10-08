-- #69 the-day-change-finishes-paid-orders.
--
-- A paid order is eventually served. Not necessarily when somebody presses
-- Finish Day -- the food may still be on the grill -- but by the time the shop
-- has shut, and the outlet's business-day cutover is chosen to sit after the
-- latest close and before the earliest open. So that is the instant this
-- migration acts on, and no earlier:
--
--   * a paid order still unprepared when its payment's business day ends is
--     marked prepared AT THAT CUTOVER, recorded as the day change's rather than
--     a person's (`orders.prepared_source`), so the cases can be counted;
--   * Finish Day stops refusing over such an order, and does not mark it: it
--     stays on every rail, and on any kitchen screen, until a tick or the
--     cutover, whichever is first;
--   * a Prepared tick queued offline before the cutover and delivered after it
--     is accepted and replaces the stamp with the counter's own time; a payment
--     take-back delivered after it clears the stamp;
--   * `backfill_prepared_history()`, the laptop repair that did this job by
--     hand with a worse timestamp, is dropped.
--
-- The stamp is a function of stored facts only -- the bill's
-- `payment_business_date` and the outlet's cutover -- so a sweep that runs late,
-- or misses a night, writes byte-identical rows when it does run. Nothing about
-- correctness depends on the job's punctuality; lateness only means an order
-- lingers on the rail, which is what happens today.

-- ---------------------------------------------------------------------------
-- When a business day ends. The single definition: a shift's expiry and the
-- day change's stamp cannot disagree about it.

create or replace function public.app_business_day_end(d date, cutover time)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((d + 1)::timestamp + cutover) at time zone 'Asia/Kolkata'
$$;

revoke execute on function public.app_business_day_end(date, time) from public, anon;
grant execute on function public.app_business_day_end(date, time) to authenticated;

create or replace function public.app_next_cutover(ts timestamptz, cutover time)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select public.app_business_day_end(public.app_business_date(ts, cutover), cutover)
$$;

-- ---------------------------------------------------------------------------
-- Who finished it. Every preparation already recorded was a counter's tick,
-- including the rows the laptop repair stamped at `paid_at`: nothing tells
-- those apart, and counting starts from here.

alter table public.orders add column prepared_source text;

alter table public.orders disable trigger orders_guard;
update public.orders set prepared_source = 'counter' where prepared_at is not null;
-- Deferred checks queued by the update must run before the trigger can be
-- re-enabled; ALTER TABLE refuses a table with pending trigger events.
set constraints all immediate;
alter table public.orders enable trigger orders_guard;

alter table public.orders
  add constraint orders_prepared_source_known
    check (prepared_source in ('counter', 'day_change')),
  add constraint orders_prepared_source_paired
    check ((prepared_at is null) = (prepared_source is null));

comment on column public.orders.prepared_source is
  'Who finished preparation: counter (a Prepared tick) or day_change (the cutover '
  'ending the payment''s business day, for a paid order nobody ticked). Null exactly '
  'when prepared_at is null.';

-- ---------------------------------------------------------------------------
-- The order guard: `prepared_source` moves wherever `prepared_at` may.

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

-- ---------------------------------------------------------------------------
-- A late tick supersedes the day change's stamp.

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

-- ---------------------------------------------------------------------------
-- A take-back clears the day change's stamp.

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
  -- A preparation the day change stamped was premised on this payment; with
  -- the payment gone the order is food nobody prepared. The counter's own tick
  -- survives an unwind, as it always has.
  update public.orders set status='open',paid_by=null,paid_shift_id=null,paid_at=null,bill_id=null,
    prepared_at=case when v_order.prepared_source='day_change' then null else prepared_at end,
    prepared_source=case when v_order.prepared_source='day_change' then null else prepared_source end
    where id=v_order.id;
  return public.billing_finish_command(p_command_id,jsonb_build_object('status','accepted',
    'commandId',p_command_id,'orderId',v_order.id,'orderNumber',v_order.order_number,
    'billId',v_bill.id,'billNumber',v_bill.bill_number,'kind','counter_unpay',
    'delayed',(v_context->>'delayed')::boolean),v_bill.business_date,v_bill.payment_business_date);
end;
$$;

-- ---------------------------------------------------------------------------
-- Finish Day no longer refuses over a paid-but-unprepared order. It was added
-- in #55 so a day was not declared final while a paying customer was owed food.
-- Re-examined with the owner: the money half holds already -- a closed day's
-- shift is ended, and `billing_device_context` refuses every take-back,
-- cancel-after-paid and correction issued under it; a later shift on the same
-- tablet that moves money makes that day's confirmation stale, as any command
-- after a close always has -- and the other half argues for keeping the order
-- visible, not for blocking. Marking it prepared here would clear food still
-- cooking from the kitchen. The sheet names it as an advisory; the cutover
-- finishes it. An unpaid open order still refuses.

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


-- ---------------------------------------------------------------------------
-- The day change. Every minute, for every outlet: a paid order whose payment
-- business day has ended and whose preparation was never recorded is finished
-- at that day's cutover. The payment's day, not the order's: an order taken at
-- 03:55 and paid at 04:05 would otherwise read prepared before it was paid.
-- `p_now` exists so the suite can drive it across a cutover.

create or replace function public.finish_paid_orders_at_day_change(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer; v_flag text;
begin
  v_flag := current_setting('app.billing_command', true);
  perform set_config('app.billing_command', '1', true);
  update public.orders o
     set prepared_at = public.app_business_day_end(b.payment_business_date, ot.business_day_cutover),
         prepared_source = 'day_change'
    from public.bills b, public.outlets ot
   where b.id = o.bill_id
     and ot.id = o.outlet_id
     and o.status = 'paid'
     and o.prepared_at is null
     and public.app_business_day_end(b.payment_business_date, ot.business_day_cutover) <= p_now;
  get diagnostics v_count = row_count;
  perform set_config('app.billing_command', coalesce(v_flag, ''), true);
  return v_count;
end;
$$;

comment on function public.finish_paid_orders_at_day_change(timestamptz) is
  'The day change: marks every paid, unprepared order prepared at the cutover ending '
  'its payment''s business day, as prepared_source = day_change. Scheduled by pg_cron; '
  'executable by no client role. Writes no billing command receipt.';

revoke all on function public.finish_paid_orders_at_day_change(timestamptz)
  from public, anon, authenticated, service_role;

select cron.schedule(
  'day-change-finishes-paid-orders',
  '* * * * *',
  'select public.finish_paid_orders_at_day_change()');

-- ---------------------------------------------------------------------------
-- The laptop repair this replaces.

drop function if exists public.backfill_prepared_history();
