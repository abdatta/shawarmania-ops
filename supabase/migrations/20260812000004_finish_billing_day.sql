-- Finishing a day is one tablet action: after its local queue is empty, the
-- server refuses open preparation work, ends that tablet's latest shift and
-- records the confirmation under one outlet/date advisory lock.
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
  select * into v_device from public.counter_devices where id=auth.uid() and removed_at is null;
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
         ended_reason=coalesce(ended_reason,'operator')
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
