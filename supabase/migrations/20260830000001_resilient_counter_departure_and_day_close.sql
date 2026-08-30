-- Resilient counter departure and day close.
--
-- A personal phone can end its operator's shift while the enrolled tablet is
-- offline. The tablet is still trusted hardware at exactly one outlet, but its
-- last-known human attribution is now qualified rather than invented: commands
-- durably created in the bounded gap after remote departure keep the old shift
-- and actor, carry an immutable exception, and are never moved to the next
-- shift. Deliberate Finish Day, removal, cutoff and overlap remain hard stops.

-- ---------------------------------------------------------------------------
-- 1. Stored distinctions: remote leave is not deliberate Finish Day.

alter table public.counter_shifts
  drop constraint counter_shifts_ended_reason_check;
alter table public.counter_shifts
  add constraint counter_shifts_ended_reason_check
  check (ended_reason in ('operator', 'day_finished', 'device_removed'));

alter table public.billing_commands
  add column recorded_after_shift_end boolean not null default false,
  add column attribution_shift_ended_at timestamptz,
  add constraint billing_commands_departure_pair check (
    recorded_after_shift_end = (attribution_shift_ended_at is not null));

alter table public.bills
  add column recorded_after_shift_end boolean not null default false,
  add column attribution_shift_ended_at timestamptz,
  add constraint bills_departure_pair check (
    recorded_after_shift_end = (attribution_shift_ended_at is not null));

create index bills_after_shift_end_review_idx
  on public.bills (outlet_id, paid_at desc)
  where recorded_after_shift_end;

-- ---------------------------------------------------------------------------
-- 2. The exact historical authority window.

create or replace function public.billing_device_context(
  p_shift_id uuid,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device public.counter_devices%rowtype;
  v_shift public.counter_shifts%rowtype;
  v_after_shift_end boolean := false;
begin
  if auth.uid() is null or p_shift_id is null or p_created_at is null then
    return jsonb_build_object('status', 'malformed_payload');
  end if;

  select * into v_device from public.counter_devices where id = auth.uid();
  if not found then
    return jsonb_build_object('status', 'authorization_refused');
  end if;
  if v_device.removed_at is not null and p_created_at >= v_device.removed_at then
    return jsonb_build_object('status', 'removed_tablet');
  end if;

  select * into v_shift
    from public.counter_shifts
   where id = p_shift_id
     and device_id = v_device.id
     and outlet_id = v_device.outlet_id
     and p_created_at >= opened_at
     and p_created_at < expires_at;
  if not found then
    return jsonb_build_object('status', 'authorization_refused');
  end if;

  if v_shift.ended_at is not null and p_created_at >= v_shift.ended_at then
    -- Only an ordinary operator departure leaves a bounded, qualified capture
    -- gap. Finish Day and removal are deliberate device stops.
    if v_shift.ended_reason <> 'operator' then
      return jsonb_build_object('status', 'authorization_refused');
    end if;
    -- A later shift is the unambiguous ownership boundary. An old view cannot
    -- create under Rahul once Priya's shift has opened.
    if exists (
      select 1
        from public.counter_shifts later
       where later.device_id = v_shift.device_id
         and later.id <> v_shift.id
         and later.opened_at > v_shift.opened_at
         and later.opened_at <= p_created_at
    ) then
      return jsonb_build_object('status', 'authorization_refused');
    end if;
    v_after_shift_end := true;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'deviceId', v_device.id,
    'outletId', v_shift.outlet_id,
    'actorId', v_shift.person_id,
    'shiftId', v_shift.id,
    'delayed', v_device.removed_at is not null
      or v_shift.ended_at is not null or v_shift.expires_at <= now(),
    'recordedAfterShiftEnd', v_after_shift_end,
    'shiftEndedAt', case
      when v_after_shift_end then to_jsonb(v_shift.ended_at)
      else 'null'::jsonb
    end);
end;
$$;

-- The receipt derives its exception from server shift state and the immutable
-- command time. It also exposes transaction-local values to the bill insert
-- trigger; no command implementation has to remember to copy audit fields.
create or replace function public.billing_begin_command(
  p_command_id uuid,
  p_type text,
  p_schema_version integer,
  p_payload_hash text,
  p_created_at timestamptz,
  p_outlet_id uuid,
  p_device_id uuid,
  p_shift_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.billing_commands%rowtype;
  v_inserted integer;
  v_ended_at timestamptz;
begin
  select ended_at into v_ended_at
    from public.counter_shifts
   where id = p_shift_id
     and ended_reason = 'operator'
     and p_created_at >= ended_at;

  insert into public.billing_commands (
    id, outlet_id, device_id, shift_id, actor_id, command_type,
    schema_version, payload_hash, client_created_at, result_category,
    recorded_after_shift_end, attribution_shift_ended_at)
  values (
    p_command_id, p_outlet_id, p_device_id, p_shift_id, p_actor_id, p_type,
    p_schema_version, p_payload_hash, p_created_at, 'pending',
    v_ended_at is not null, v_ended_at)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    perform set_config(
      'app.billing_recorded_after_shift_end',
      case when v_ended_at is null then '0' else '1' end,
      true);
    perform set_config(
      'app.billing_attribution_shift_ended_at',
      coalesce(v_ended_at::text, ''),
      true);
    return jsonb_build_object('status', 'claimed');
  end if;

  select * into v_existing from public.billing_commands where id = p_command_id;
  if v_existing.command_type is distinct from p_type
     or v_existing.schema_version is distinct from p_schema_version
     or v_existing.payload_hash is distinct from p_payload_hash
     or v_existing.client_created_at is distinct from p_created_at
     or v_existing.outlet_id is distinct from p_outlet_id
     or v_existing.device_id is distinct from p_device_id
     or v_existing.shift_id is distinct from p_shift_id
     or v_existing.actor_id is distinct from p_actor_id then
    return jsonb_build_object('status', 'identity_conflict', 'commandId', p_command_id);
  end if;

  if v_existing.result_category = 'accepted' then
    return jsonb_set(v_existing.result, '{status}', '"replay"'::jsonb, true);
  end if;
  return v_existing.result;
end;
$$;

create or replace function public.billing_stamp_departure_exception()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ended text := current_setting('app.billing_attribution_shift_ended_at', true);
begin
  if current_setting('app.billing_recorded_after_shift_end', true) = '1' then
    new.recorded_after_shift_end := true;
    new.attribution_shift_ended_at := v_ended::timestamptz;
  end if;
  return new;
end;
$$;

create trigger bills_stamp_departure_exception
  before insert on public.bills
  for each row execute function public.billing_stamp_departure_exception();

-- The exact-payment constraint is deferred until COMMIT. For an ordinary live
-- shift its historical invoker-security function could still see the bill and
-- allocations through tablet RLS. A remote-leave command deliberately commits
-- after that read authority ended, so the same guard would see zero allocations
-- and reject valid money. Validation is a table invariant, not a client read;
-- execute it as its owner and expose no callable function surface.
alter function public.billing_payment_total_guard() security definer;
revoke execute on function public.billing_payment_total_guard()
  from public, anon, authenticated;

-- Every accepted response carries the same qualification as its compact
-- receipt. Exact replay returns the stored result byte-for-byte apart from the
-- existing accepted -> replay status substitution.
create or replace function public.billing_finish_command(
  p_command_id uuid,
  p_result jsonb,
  p_business_date date default null,
  p_payment_business_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command public.billing_commands%rowtype;
begin
  select * into v_command from public.billing_commands where id = p_command_id;
  if v_command.recorded_after_shift_end then
    p_result := p_result || jsonb_build_object(
      'recordedAfterShiftEnd', true,
      'shiftEndedAt', v_command.attribution_shift_ended_at);
  end if;

  update public.billing_commands
     set result_category = p_result ->> 'status',
         result = p_result,
         business_date = p_business_date,
         payment_business_date = p_payment_business_date
   where id = p_command_id
   returning * into v_command;

  if p_result ->> 'status' = 'accepted' and v_command.device_id is not null
     and v_command.command_type <> 'confirm_end_of_day' then
    update public.billing_end_of_day_confirmations c
       set invalidated_at = now(), invalidated_by_command_id = p_command_id
     where c.device_id = v_command.device_id
       and c.invalidated_at is null
       and c.business_date in (p_business_date, p_payment_business_date);
  end if;
  return p_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Deliberate Finish Day closes the edit opportunity distinctly.

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
-- 4. Append-only, manager-owned attribution review.

create table public.billing_attribution_reviews (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  bill_id uuid not null unique references public.bills (id),
  original_operator_id uuid not null references public.profiles (id),
  outcome text not null check (
    outcome in ('confirmed_original', 'assigned_other', 'operator_unknown')),
  resolved_operator_id uuid references public.profiles (id),
  reason text,
  reviewed_by uuid not null references public.profiles (id),
  reviewed_at timestamptz not null default now(),
  constraint billing_attribution_review_shape check (
    (outcome = 'confirmed_original'
      and resolved_operator_id = original_operator_id and reason is null)
    or (outcome = 'assigned_other'
      and resolved_operator_id is not null
      and resolved_operator_id <> original_operator_id and reason is null)
    or (outcome = 'operator_unknown'
      and resolved_operator_id is null
      and length(btrim(reason)) > 0))
);

create index billing_attribution_reviews_outlet_time_idx
  on public.billing_attribution_reviews (outlet_id, reviewed_at desc);

alter table public.billing_attribution_reviews enable row level security;
create policy billing_attribution_reviews_select
  on public.billing_attribution_reviews for select to authenticated using (
    public.app_account_active() and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))));

create trigger billing_attribution_reviews_no_update
  before update or delete on public.billing_attribution_reviews
  for each row execute function public.reject_mutation();

create or replace function public.review_billing_attribution(
  p_bill_id uuid,
  p_outcome text,
  p_resolved_operator_id uuid default null,
  p_reason text default null
)
returns public.billing_attribution_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.bills%rowtype;
  v_review public.billing_attribution_reviews%rowtype;
begin
  if auth.uid() is null or not public.app_account_active() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select * into v_bill from public.bills where id = p_bill_id;
  if not found or not v_bill.recorded_after_shift_end then
    raise exception 'no flagged bill' using errcode = 'P0001';
  end if;
  if not ((select public.app_is_owner())
      or public.app_has_role_at('franchise_admin', v_bill.outlet_id)) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_outcome = 'confirmed_original' then
    p_resolved_operator_id := v_bill.biller_profile_id;
    p_reason := null;
  elsif p_outcome = 'assigned_other' then
    if p_resolved_operator_id is null or p_resolved_operator_id = v_bill.biller_profile_id
       or not exists (
         select 1 from public.assignments a
          where a.person_id = p_resolved_operator_id
            and a.outlet_id = v_bill.outlet_id
            and a.role = 'biller'
            and a.started_on <= v_bill.business_date
            and (a.ended_on is null or a.ended_on >= v_bill.business_date)
       ) then
      raise exception 'the selected person was not an eligible biller for this outlet and date'
        using errcode = 'P0001';
    end if;
    p_reason := null;
  elsif p_outcome = 'operator_unknown' then
    p_resolved_operator_id := null;
    p_reason := nullif(btrim(p_reason), '');
    if p_reason is null then
      raise exception 'a reason is required when the operator is unknown' using errcode = 'P0001';
    end if;
  else
    raise exception 'invalid attribution outcome' using errcode = 'P0001';
  end if;

  insert into public.billing_attribution_reviews (
    outlet_id, bill_id, original_operator_id, outcome,
    resolved_operator_id, reason, reviewed_by)
  values (
    v_bill.outlet_id, v_bill.id, v_bill.biller_profile_id, p_outcome,
    p_resolved_operator_id, p_reason, auth.uid())
  returning * into v_review;
  return v_review;
exception when unique_violation then
  raise exception 'this attribution exception has already been reviewed' using errcode = 'P0001';
end;
$$;

grant select on public.billing_attribution_reviews to authenticated;
grant all on public.billing_attribution_reviews to service_role;
revoke insert, update, delete on public.billing_attribution_reviews from authenticated, anon;
revoke execute on function public.review_billing_attribution(uuid,text,uuid,text)
  from public, anon;
grant execute on function public.review_billing_attribution(uuid,text,uuid,text)
  to authenticated;

revoke execute on function public.billing_stamp_departure_exception()
  from public, anon, authenticated;
