-- #70 the-kitchen-sees-its-orders.
--
-- A set-up tablet is a counter or a kitchen. A kitchen tablet opens a kitchen
-- shift through the counter's own handshake, held by the same people, and that
-- shift reaches exactly one thing: a narrow board of its outlet's unfinished
-- orders, carrying no customer, price or payment fact, filtered by the
-- categories the tablet chose, with the tablet's own acknowledgements.
--
-- The dangerous half of this migration is section 2. Every device-authorised
-- policy and billing command reaches the tablet's data through a handful of
-- shared helpers that accepted ANY live shift. They now accept counter shifts
-- only, which is what refuses a kitchen shift bills, customers, expenses, the
-- drawer and every billing command without an edit to each caller. The
-- hand-crafted refusals proving it live in
-- supabase/tests/81_the_kitchen_sees_its_orders.sql and the REST probes.

-- ---------------------------------------------------------------------------
-- 1. Kinds, and the kitchen's filter on the tablet's own record.

alter table public.counter_devices
  add column kind text not null default 'counter'
    constraint counter_devices_kind_known check (kind in ('counter', 'kitchen')),
  add column kitchen_filter_mode text not null default 'exclude'
    constraint counter_devices_kitchen_filter_mode_known
      check (kitchen_filter_mode in ('include', 'exclude')),
  add column kitchen_category_ids uuid[] not null default '{}',
  add column kitchen_sort text not null default 'oldest_first'
    constraint counter_devices_kitchen_sort_known
      check (kitchen_sort in ('oldest_first', 'newest_first')),
  add column kitchen_filter_changed_by uuid references public.profiles (id),
  add column kitchen_filter_changed_at timestamptz;

comment on column public.counter_devices.kind is
  'counter takes money; kitchen shows the outlet''s unfinished orders. Chosen when the '
  'setup code is issued, changed from the Tablets list.';
comment on column public.counter_devices.kitchen_category_ids is
  'The kitchen filter''s categories: shown alone (include) or hidden (exclude). '
  'Exclude with an empty list shows everything, which is the default.';
comment on column public.counter_devices.kitchen_sort is
  'The kitchen board''s order: oldest_first, the order cooks work in, by default, or '
  'newest_first. Chosen on the tablet beside its filter, so a kitchen that prefers the '
  'other way needs no release.';

alter table public.counter_device_setup_codes
  add column kind text not null default 'counter'
    constraint counter_device_setup_codes_kind_known check (kind in ('counter', 'kitchen'));

alter table public.counter_shift_requests
  add column kind text not null default 'counter'
    constraint counter_shift_requests_kind_known check (kind in ('counter', 'kitchen'));

-- Requests are granted column by column, which is what keeps `code_hash` from
-- every client; the new column joins the readable ones explicitly. The phone's
-- card reads it to say whether it is asking for a counter or a kitchen.
grant select (kind) on public.counter_shift_requests to authenticated;

alter table public.counter_shifts
  add column kind text not null default 'counter'
    constraint counter_shifts_kind_known check (kind in ('counter', 'kitchen'));

alter table public.counter_shifts
  drop constraint counter_shifts_ended_reason_check,
  add constraint counter_shifts_ended_reason_check
    check (ended_reason in ('operator', 'day_finished', 'device_removed', 'device_kind_changed'));

-- ---------------------------------------------------------------------------
-- 2. The authority split. Every device-authorised read and billing command
-- resolves the tablet's reach through these helpers, so narrowing them to
-- COUNTER shifts refuses a kitchen shift everything billing, customers, bills,
-- expenses and the drawer can reach, with no per-caller edit. The two
-- person-side helpers narrow too: holding a kitchen shift must not lend a
-- Biller customer lookup or billing reach on their own phone.

CREATE OR REPLACE FUNCTION public.app_counter_shift()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
     and d.session_proven_at is not null
   where s.device_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
     and s.kind = 'counter'
$function$;

CREATE OR REPLACE FUNCTION public.app_counter_shift_outlet()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.outlet_id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
     and d.session_proven_at is not null
   where s.device_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
     and s.kind = 'counter'
$function$;

CREATE OR REPLACE FUNCTION public.app_counter_shift_operator()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.person_id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
     and d.session_proven_at is not null
   where s.device_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
     and s.kind = 'counter'
$function$;

CREATE OR REPLACE FUNCTION public.app_billing_outlet()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select d.outlet_id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
         and d.session_proven_at is not null
   where s.ended_at is null
     and s.expires_at > now()
       and s.kind = 'counter'
     and (
       s.device_id = auth.uid()
       or (s.person_id = auth.uid() and public.app_account_active())
     )
   limit 1
$function$;

CREATE OR REPLACE FUNCTION public.app_may_look_up_customer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
      from public.counter_shifts s
      join public.counter_devices d on d.id = s.device_id and d.removed_at is null
           and d.session_proven_at is not null
     where s.ended_at is null
       and s.expires_at > now()
       and s.kind = 'counter'
       and (
         -- The tablet the shift is open on.
         s.device_id = auth.uid()
         -- Or the person who opened it, on their own device. They are the one
         -- accountable for the drawer, so a lookup from their phone while they
         -- hold the counter is the same act as one from the tablet.
         or (s.person_id = auth.uid() and public.app_account_active())
       )
  )
$function$;

CREATE OR REPLACE FUNCTION public.billing_device_context(p_shift_id uuid, p_created_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     and p_created_at < expires_at
     and kind = 'counter';
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
$function$;

-- The kitchen's own two helpers: the live kitchen shift on the calling tablet,
-- and its outlet. Null for anything else, a counter shift included.
create or replace function public.app_kitchen_shift()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
     and d.session_proven_at is not null and d.kind = 'kitchen'
   where s.device_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
     and s.kind = 'kitchen'
$$;

create or replace function public.app_kitchen_shift_outlet()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.outlet_id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
     and d.session_proven_at is not null and d.kind = 'kitchen'
   where s.device_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
     and s.kind = 'kitchen'
$$;

revoke execute on function public.app_kitchen_shift() from public, anon;
revoke execute on function public.app_kitchen_shift_outlet() from public, anon;
grant execute on function public.app_kitchen_shift() to authenticated;
grant execute on function public.app_kitchen_shift_outlet() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Finish Day neither waits for a kitchen nor counts one as participating:
-- a kitchen shift issues no billing command. And a kitchen tablet cannot run
-- the day close at all.

CREATE OR REPLACE FUNCTION public.billing_day_readiness(p_outlet_id uuid, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_open integer; v_live integer; v_missing integer; v_stale integer;
begin
  if auth.uid() is null or not coalesce((
    (public.app_device_ok() and public.app_counter_device_outlet()=p_outlet_id)
    or (public.app_account_active() and (
      (select public.app_is_owner())
      or public.app_has_role_at('franchise_admin',p_outlet_id)))),false) then
    return jsonb_build_object('status','authorization_refused');
  end if;
  select count(*) into v_open from public.orders
    where outlet_id=p_outlet_id and business_date=p_business_date and status='open';
  select count(*) into v_live from public.counter_shifts
    where outlet_id=p_outlet_id and business_date=p_business_date
      and ended_at is null and expires_at>now() and kind='counter';
  with participating as (
    select distinct device_id from public.counter_shifts
      where outlet_id=p_outlet_id and business_date=p_business_date and kind='counter'
  )
  select count(*) into v_missing from participating p
    where not exists (select 1 from public.billing_end_of_day_confirmations c
      where c.device_id=p.device_id and c.business_date=p_business_date);
  with participating as (
    select distinct device_id from public.counter_shifts
      where outlet_id=p_outlet_id and business_date=p_business_date and kind='counter'
  )
  select count(*) into v_stale from participating p
    join public.billing_end_of_day_confirmations c
      on c.device_id=p.device_id and c.business_date=p_business_date
    where c.invalidated_at is not null
      or c.shift_id is distinct from (select s.id from public.counter_shifts s
        where s.device_id=p.device_id and s.business_date=p_business_date
        order by s.opened_at desc,s.id desc limit 1)
      or c.command_watermark < coalesce((
      select max(b.watermark) from public.billing_commands b
       where b.device_id=p.device_id and b.result_category='accepted'
         and b.command_type<>'confirm_end_of_day'
         and p_business_date in (b.business_date,b.payment_business_date)),0);
  return jsonb_build_object('status','ok','ready',v_open=0 and v_live=0 and v_missing=0 and v_stale=0,
    'openOrders',v_open,'liveShifts',v_live,'missingConfirmations',v_missing,
    'staleConfirmations',v_stale);
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_billing_end_of_day(p_command_id uuid DEFAULT NULL::uuid, p_schema_version integer DEFAULT NULL::integer, p_payload_hash text DEFAULT NULL::text, p_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_shift_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select * into v_device from public.counter_devices where id=auth.uid() and removed_at is null and session_proven_at is not null and kind='counter';
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
$function$;

-- ---------------------------------------------------------------------------
-- 4. The kind travels with the setup code, the shift request and the shift.

drop function public.issue_counter_device_setup_code(uuid, uuid, text, text, interval);

CREATE OR REPLACE FUNCTION public.issue_counter_device_setup_code(p_outlet_id uuid, p_issued_by uuid, p_label text, p_code_hash text, p_valid_for interval, p_kind text DEFAULT 'counter'::text)
 RETURNS TABLE(status text, code_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_valid interval := least(greatest(coalesce(p_valid_for, interval '15 minutes'),
                                     interval '1 minute'),
                            interval '1 hour');
begin
  if p_label is null or length(btrim(p_label)) = 0
     or p_kind is null or p_kind not in ('counter', 'kitchen') then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if not exists (select 1 from public.outlets o where o.id = p_outlet_id and o.is_active) then
    return query select 'not_authorised'::text, null::uuid;
    return;
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = p_issued_by and p.is_active
  ) or not exists (
    select 1 from public.assignments a
     where a.person_id = p_issued_by
       and a.ended_on is null
       and (
         a.role = 'super_admin'
         or (a.role = 'franchise_admin' and a.outlet_id = p_outlet_id)
       )
  ) then
    return query select 'not_authorised'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.counter_devices d
     where d.outlet_id = p_outlet_id
       and d.removed_at is null
       and (d.session_proven_at is not null or d.proof_expires_at > now())
       and lower(btrim(d.label)) = lower(btrim(p_label))
  ) then
    return query select 'label_taken'::text, null::uuid;
    return;
  end if;

  insert into public.counter_device_setup_codes
    (outlet_id, label, code_hash, issued_by, expires_at, kind)
  values
    (p_outlet_id, btrim(p_label), p_code_hash, p_issued_by, now() + v_valid, p_kind)
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$function$;
revoke all on function public.issue_counter_device_setup_code(uuid, uuid, text, text, interval, text)
  from public, anon, authenticated;
grant execute on function public.issue_counter_device_setup_code(uuid, uuid, text, text, interval, text)
  to service_role;

CREATE OR REPLACE FUNCTION public.redeem_counter_device_setup_code(p_code_hash text, p_device_id uuid, p_max_attempts integer DEFAULT 5)
 RETURNS TABLE(status text, device_id uuid, outlet_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_code record;
  v_consumed integer;
begin
  select * into v_code
    from public.counter_device_setup_codes c
   where c.code_hash = p_code_hash
     and c.consumed_at is null
     and c.superseded_at is null;

  if not found or v_code.expires_at <= now() or v_code.attempts >= p_max_attempts then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.counter_devices d
     where d.outlet_id = v_code.outlet_id
       and d.removed_at is null
       and (d.session_proven_at is not null or d.proof_expires_at > now())
       and lower(btrim(d.label)) = lower(btrim(v_code.label))
  ) then
    return query select 'label_taken'::text, null::uuid, null::uuid;
    return;
  end if;

  if not exists (select 1 from auth.users u where u.id = p_device_id) then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  update public.counter_device_setup_codes
     set consumed_at = now(), consumed_device_id = p_device_id
   where id = v_code.id and consumed_at is null;
  get diagnostics v_consumed = row_count;

  if v_consumed <> 1 then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  insert into public.counter_devices
    (id, outlet_id, label, set_up_by, proof_expires_at, kind)
  values
    (p_device_id, v_code.outlet_id, v_code.label, v_code.issued_by, v_code.expires_at,
     v_code.kind);

  return query select 'ok'::text, p_device_id, v_code.outlet_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_counter_shift(p_device_id uuid, p_username text, p_code_hash text, p_valid_for interval)
 RETURNS TABLE(status text, request_id uuid, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_outlet uuid;
  v_kind text;
  v_person uuid;
  v_username text;
  v_id uuid;
  v_expires timestamptz;
  v_valid interval := least(greatest(coalesce(p_valid_for, interval '2 minutes'),
                                     interval '30 seconds'),
                            interval '5 minutes');
begin
  select d.outlet_id, d.kind into v_outlet, v_kind
    from public.counter_devices d
   where d.id = p_device_id and d.removed_at is null
     and d.session_proven_at is not null
   for update;

  if v_outlet is null then
    return query select 'device_unknown'::text, null::uuid, null::timestamptz;
    return;
  end if;

  v_username := public.app_normalize_username(p_username);
  if public.app_username_valid(v_username) then
    select u.id into v_person
      from auth.users u
     where lower(u.email) = v_username || '@login.shawarmania.invalid'
     limit 1;
  end if;

  update public.counter_shift_requests
     set resolution = 'superseded', resolved_at = now(), code_hash = null
   where device_id = p_device_id and resolution is null;

  v_expires := now() + v_valid;
  insert into public.counter_shift_requests
    (device_id, outlet_id, person_id, requested_username, code_hash, expires_at, kind)
  values
    (p_device_id, v_outlet, v_person, v_username, p_code_hash, v_expires, v_kind)
  returning id into v_id;

  return query select 'ok'::text, v_id, v_expires;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_counter_shift(p_person_id uuid, p_request_id uuid, p_code_hash text, p_max_attempts integer DEFAULT 3)
 RETURNS TABLE(status text, shift_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_req record;
  v_cutover time;
  v_shift uuid;
  -- Three, and never more, whatever the caller asks for. A typo loop has to end
  -- in a fresh code rather than in an indefinite retry against four digits.
  v_max integer := least(greatest(coalesce(p_max_attempts, 3), 1), 3);
begin
  select * into v_req
    from public.counter_shift_requests r
   where r.id = p_request_id
     and r.person_id = p_person_id
     and r.resolution is null
     and r.expires_at > now()
   for update;

  if not found then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if v_req.code_hash <> p_code_hash then
    update public.counter_shift_requests
       set attempts = attempts + 1
     where id = v_req.id
    returning attempts into v_req.attempts;

    if v_req.attempts >= v_max then
      update public.counter_shift_requests
         set resolution = 'exhausted', resolved_at = now(), code_hash = null
       where id = v_req.id;
      return query select 'exhausted'::text, null::uuid;
      return;
    end if;

    return query select 'wrong_code'::text, null::uuid;
    return;
  end if;

  if not public.app_may_hold_counter_shift(p_person_id, v_req.outlet_id) then
    update public.counter_shift_requests
       set resolution = 'not_eligible', resolved_at = now(), code_hash = null
     where id = v_req.id;
    return query select 'not_eligible'::text, null::uuid;
    return;
  end if;

  -- A request carries the kind its tablet had when it was made. A tablet whose
  -- kind changed since cannot be opened under the old one; the change itself
  -- cancels pending requests, so this is a backstop against a race.
  if not exists (
    select 1 from public.counter_devices d
     where d.id = v_req.device_id and d.kind = v_req.kind
  ) then
    update public.counter_shift_requests
       set resolution = 'cancelled', resolved_at = now(), code_hash = null
     where id = v_req.id;
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  -- A tablet holds one shift at a time. Whatever was open is closed by the
  -- handover, and old work keeps its own shift reference and its attribution.
  update public.counter_shifts
     set ended_at = now(), ended_reason = 'operator'
   where device_id = v_req.device_id and ended_at is null;

  select o.business_day_cutover into v_cutover
    from public.outlets o where o.id = v_req.outlet_id;

  insert into public.counter_shifts
    (device_id, outlet_id, person_id, business_date, expires_at, kind)
  values
    (v_req.device_id, v_req.outlet_id, p_person_id,
     public.app_business_date(now(), v_cutover),
     public.app_next_cutover(now(), v_cutover), v_req.kind)
  returning id into v_shift;

  update public.counter_shift_requests
     set resolution = 'confirmed', resolved_at = now(), shift_id = v_shift,
         code_hash = null
   where id = v_req.id;

  return query select 'ok'::text, v_shift;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Changing a tablet's kind, through the Tablets list's Edit like a rename.
-- Either direction cancels a pending request and ends a live shift; becoming a
-- kitchen is refused while the counter still owes anything -- unsent work, or
-- an order it took that is still on the rail, which only it may ever finish.

drop function public.edit_counter_device(uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.edit_counter_device(p_device_id uuid, p_edited_by uuid, p_label text, p_outlet_id uuid, p_kind text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_device public.counter_devices%rowtype;
  v_label text := btrim(p_label);
  v_is_owner boolean;
  v_is_manager boolean;
  v_is_transfer boolean;
  v_kind text;
  v_kind_change boolean;
begin
  if v_label is null or length(v_label) = 0 or length(v_label) > 120
     or p_outlet_id is null then
    return 'invalid';
  end if;

  select d.* into v_device
    from public.counter_devices d
   where d.id = p_device_id
   for update;

  if not found or v_device.removed_at is not null
     or v_device.session_proven_at is null then
    return 'device_invalid';
  end if;

  if not exists (
    select 1 from public.profiles p
     where p.id = p_edited_by and p.is_active
  ) then
    return 'not_authorised';
  end if;

  select exists (
           select 1 from public.assignments a
            where a.person_id = p_edited_by
              and a.role = 'super_admin'
              and a.ended_on is null
         ),
         exists (
           select 1 from public.assignments a
            where a.person_id = p_edited_by
              and a.role = 'franchise_admin'
              and a.outlet_id = v_device.outlet_id
              and a.ended_on is null
         )
    into v_is_owner, v_is_manager;

  if not v_is_owner and not v_is_manager then
    return 'not_authorised';
  end if;

  v_is_transfer := p_outlet_id <> v_device.outlet_id;
  v_kind := coalesce(p_kind, v_device.kind);
  if v_kind not in ('counter', 'kitchen') then
    return 'invalid';
  end if;
  v_kind_change := v_kind <> v_device.kind;
  if v_is_transfer and not v_is_owner then
    return 'not_authorised';
  end if;

  if not exists (
    select 1 from public.outlets o
     where o.id = p_outlet_id and o.is_active
  ) or not exists (
    select 1 from public.outlets o
     where o.id = v_device.outlet_id and o.is_active
  ) then
    return 'inactive_outlet';
  end if;

  if not v_is_transfer and not v_kind_change
     and v_label = v_device.label then
    return 'no_change';
  end if;

  if v_is_transfer then
    -- Lock relevant request/shift rows before checking them, preventing a
    -- concurrent handshake from crossing the move.
    perform 1
     from public.counter_shift_requests r
     where r.device_id = p_device_id
       and r.resolution is null
     for update;
    if found then
      return 'pending_request';
    end if;

    perform 1
      from public.counter_shifts s
     where s.device_id = p_device_id
       and s.ended_at is null
       and s.expires_at > now()
     for update;
    if found then
      return 'live_shift';
    end if;

  end if;

  if v_is_transfer or (v_kind_change and v_kind = 'kitchen') then
    if v_device.last_seen_at is null
       or v_device.last_seen_at < now() - interval '30 minutes' then
      return 'stale_telemetry';
    end if;

    if v_device.last_reported_unsent <> 0
       or v_device.last_reported_oldest_unresolved_at is not null then
      return 'unresolved_work';
    end if;

    -- A zero predating server-accepted work is not evidence about that work.
    -- Require the latest report to follow both command acceptance and bill sync.
    if exists (
      select 1 from public.billing_commands c
       where c.device_id = p_device_id
         and c.result_category = 'accepted'
         and c.received_at > v_device.last_seen_at
    ) or exists (
      select 1 from public.bills b
       where b.counter_device_id = p_device_id
         and b.synced_at > v_device.last_seen_at
    ) then
      return 'stale_telemetry';
    end if;
  end if;

  -- Only the tablet that took an order may finish it, so a counter that still
  -- holds one on the rail would strand it as a kitchen.
  if v_kind_change and v_kind = 'kitchen' and exists (
    select 1 from public.orders o
     where o.device_id = p_device_id
       and (o.status = 'open' or (o.status = 'paid' and o.prepared_at is null))
  ) then
    return 'rail_orders';
  end if;

  if v_kind_change then
    update public.counter_shift_requests
       set resolution = 'cancelled', resolved_at = now(), code_hash = null
     where device_id = p_device_id and resolution is null;
    update public.counter_shifts
       set ended_at = now(), ended_reason = 'device_kind_changed'
     where device_id = p_device_id and ended_at is null;
  end if;

  begin
    update public.counter_devices
       set label = v_label,
           outlet_id = p_outlet_id,
           kind = v_kind,
           -- Category ids belong to an outlet; a moved tablet starts showing all.
           kitchen_category_ids = case when v_is_transfer then '{}'::uuid[]
                                       else kitchen_category_ids end,
           kitchen_filter_mode = case when v_is_transfer then 'exclude'
                                      else kitchen_filter_mode end
     where id = p_device_id;
  exception when unique_violation then
    return 'label_taken';
  end;

  return 'ok';
end;
$function$;
revoke all on function public.edit_counter_device(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.edit_counter_device(uuid, uuid, text, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. The Tablets list reports a kitchen as a kitchen: its kind, its filter in
-- words, and who holds its shift -- and none of the counter's money figures,
-- because a kitchen shift has none.

drop function public.counter_operations_snapshot(uuid[]);

create function public.counter_operations_snapshot(p_outlet_ids uuid[])
returns table (
  read_at timestamptz, device_id uuid, outlet_id uuid, label text,
  set_up_at timestamptz, last_seen_at timestamptz, last_reported_unsent integer,
  shift_id uuid, operator_name text, opened_at timestamptz, business_date date,
  bill_count bigint, cash_total_paise bigint, upi_total_paise bigint,
  open_order_count bigint, drawer_cash_paise bigint,
  kind text, kitchen_filter_mode text, kitchen_category_names text[]
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.app_account_active()
     or not (
       (select public.app_is_owner())
       or (
         exists (select 1 from public.app_outlets_for('franchise_admin'))
         and not exists (
           select requested
             from unnest(coalesce(p_outlet_ids, array[]::uuid[])) requested
            where requested not in (select public.app_outlets_for('franchise_admin'))
         )
       )
     ) then
    raise exception 'counter operations are limited to authorised managers'
      using errcode = '42501';
  end if;

  return query
  with visible_devices as (
    select d.id, d.outlet_id, d.label, d.set_up_at,
           d.last_seen_at, d.last_reported_unsent, d.kind,
           d.kitchen_filter_mode, d.kitchen_category_ids
      from public.counter_devices d
     where d.removed_at is null
       and d.session_proven_at is not null
       and d.outlet_id = any(coalesce(p_outlet_ids, array[]::uuid[]))
  ),
  live_shifts as (
    select distinct on (s.device_id)
           s.id, s.device_id, s.outlet_id, s.person_id,
           s.opened_at, s.business_date, s.kind
      from public.counter_shifts s
      join visible_devices d on d.id = s.device_id and d.outlet_id = s.outlet_id
     where s.ended_at is null and s.expires_at > statement_timestamp()
     order by s.device_id, s.opened_at desc
  ),
  bill_rollup as (
    select s.id as shift_id,
           count(distinct b.id)::bigint as bill_count,
           coalesce(sum(ep.amount_paise) filter (
             where b.status = 'settled' and ep.method = 'cash'
           ), 0)::bigint as cash_total_paise,
           coalesce(sum(ep.amount_paise) filter (
             where b.status = 'settled' and ep.method = 'upi'
           ), 0)::bigint as upi_total_paise
      from live_shifts s
      left join public.bills b on b.counter_shift_id = s.id
      left join public.effective_bill_payments ep
        on ep.bill_id = b.id and ep.outlet_id = b.outlet_id
     where s.kind = 'counter'
     group by s.id
  ),
  order_rollup as (
    select s.id as shift_id, count(o.id)::bigint as open_order_count
      from live_shifts s
      left join public.orders o
        on o.device_id = s.device_id
       and o.outlet_id = s.outlet_id
       and o.business_date = s.business_date
       and o.status = 'open'
     where s.kind = 'counter'
     group by s.id
  )
  select statement_timestamp() as read_at,
         d.id as device_id,
         d.outlet_id,
         d.label,
         d.set_up_at,
         d.last_seen_at,
         d.last_reported_unsent,
         s.id as shift_id,
         p.full_name as operator_name,
         s.opened_at,
         s.business_date,
         case when s.id is null or s.kind <> 'counter' then null else coalesce(b.bill_count, 0) end,
         case when s.id is null or s.kind <> 'counter' then null else coalesce(b.cash_total_paise, 0) end,
         case when s.id is null or s.kind <> 'counter' then null else coalesce(b.upi_total_paise, 0) end,
         case when s.id is null or s.kind <> 'counter' then null else coalesce(o.open_order_count, 0) end,
         -- V1 has no opening-float allocation by shift. The drawer contribution
         -- from billing is therefore precisely the latest effective Cash tender.
         case when s.id is null or s.kind <> 'counter' then null else coalesce(b.cash_total_paise, 0) end,
         d.kind,
         d.kitchen_filter_mode,
         array(
           select c.name from public.menu_categories c
            where c.id = any(d.kitchen_category_ids)
              and c.outlet_id = d.outlet_id
              and c.is_active
            order by c.sort_order, c.name
         )
    from visible_devices d
    left join live_shifts s on s.device_id = d.id
    left join public.profiles p on p.id = s.person_id
    left join bill_rollup b on b.shift_id = s.id
    left join order_rollup o on o.shift_id = s.id
   order by d.label;
end;
$$;

revoke execute on function public.counter_operations_snapshot(uuid[]) from public, anon;
grant execute on function public.counter_operations_snapshot(uuid[]) to authenticated;

-- The app reads the wrapper, which adds the heartbeat's oldest-unresolved
-- instant; it passes the kitchen's three columns through.
drop function public.counter_operations_snapshot_v2(uuid[]);

create function public.counter_operations_snapshot_v2(p_outlet_ids uuid[])
returns table (
  read_at timestamptz, device_id uuid, outlet_id uuid, label text,
  set_up_at timestamptz, last_seen_at timestamptz, last_reported_unsent integer,
  last_reported_oldest_unresolved_at timestamptz,
  shift_id uuid, operator_name text, opened_at timestamptz, business_date date,
  bill_count bigint, cash_total_paise bigint, upi_total_paise bigint,
  open_order_count bigint, drawer_cash_paise bigint,
  kind text, kitchen_filter_mode text, kitchen_category_names text[]
)
language sql
stable
set search_path = ''
as $$
  select snapshot.read_at,
         snapshot.device_id,
         snapshot.outlet_id,
         snapshot.label,
         snapshot.set_up_at,
         snapshot.last_seen_at,
         snapshot.last_reported_unsent,
         device.last_reported_oldest_unresolved_at,
         snapshot.shift_id,
         snapshot.operator_name,
         snapshot.opened_at,
         snapshot.business_date,
         snapshot.bill_count,
         snapshot.cash_total_paise,
         snapshot.upi_total_paise,
         snapshot.open_order_count,
         snapshot.drawer_cash_paise,
         snapshot.kind,
         snapshot.kitchen_filter_mode,
         snapshot.kitchen_category_names
    from public.counter_operations_snapshot(p_outlet_ids) snapshot
    join public.counter_devices device on device.id = snapshot.device_id;
$$;

revoke execute on function public.counter_operations_snapshot_v2(uuid[]) from public, anon;
grant execute on function public.counter_operations_snapshot_v2(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The kitchen's filter: read the outlet's categories, write its own row.

drop policy menu_categories_select on public.menu_categories;
create policy menu_categories_select on public.menu_categories
  for select to authenticated using (
    public.app_device_ok() and (
      outlet_id = (select public.app_counter_shift_outlet())
      or outlet_id = (select public.app_kitchen_shift_outlet())
      or (public.app_account_active() and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
        or outlet_id in (select public.app_outlets_for('biller'))))));

/** Is a line in this category shown under this filter? The one definition. */
create or replace function public.kitchen_line_visible(
  p_category uuid, p_mode text, p_category_ids uuid[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_mode
           when 'include' then coalesce(p_category = any(p_category_ids), false)
           else not coalesce(p_category = any(p_category_ids), false)
         end
$$;

-- The sort travels with the filter: one sheet on the tablet saves both. Omitted,
-- it is left as it was.
create or replace function public.set_kitchen_filter(
  p_mode text, p_category_ids uuid[], p_sort text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.counter_shifts%rowtype;
  v_ids uuid[] := coalesce(p_category_ids, array[]::uuid[]);
begin
  if p_mode is null or p_mode not in ('include', 'exclude') then
    return 'invalid';
  end if;
  if p_sort is not null and p_sort not in ('oldest_first', 'newest_first') then
    return 'invalid';
  end if;
  select s.* into v_shift from public.counter_shifts s
   where s.id = public.app_kitchen_shift();
  if not found then
    return 'not_authorised';
  end if;
  if exists (
    select 1 from unnest(v_ids) requested
     where not exists (
       select 1 from public.menu_categories c
        where c.id = requested and c.outlet_id = v_shift.outlet_id
     )
  ) then
    return 'invalid';
  end if;
  update public.counter_devices
     set kitchen_filter_mode = p_mode,
         kitchen_category_ids = array(select distinct unnest(v_ids)),
         kitchen_sort = coalesce(p_sort, kitchen_sort),
         kitchen_filter_changed_by = v_shift.person_id,
         kitchen_filter_changed_at = now()
   where id = v_shift.device_id;
  return 'ok';
end;
$$;

revoke execute on function public.set_kitchen_filter(text, uuid[], text) from public, anon;
grant execute on function public.set_kitchen_filter(text, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The kitchen's nudge. A kitchen shift holds no select on orders (they
-- carry the customer's name and phone), so Realtime's postgres_changes could
-- not reach it there. Every order write instead bumps one row per outlet,
-- carrying no order data; the kitchen re-reads its board on the event, exactly
-- the counter's "a nudge, never the data" contract. Order writes at an outlet
-- already serialise on its order- and bill-number counters, so the row lock
-- adds no new contention.

create table public.kitchen_pulses (
  outlet_id uuid primary key references public.outlets (id),
  bumped_at timestamptz not null default now()
);

alter table public.kitchen_pulses enable row level security;

create policy kitchen_pulses_select on public.kitchen_pulses
  for select to authenticated using (
    public.app_device_ok() and (
      outlet_id = (select public.app_kitchen_shift_outlet())
      or (public.app_account_active() and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

revoke all on public.kitchen_pulses from anon, authenticated;
grant select on public.kitchen_pulses to authenticated;

create or replace function public.kitchen_pulse_bump()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.kitchen_pulses (outlet_id, bumped_at)
  values (new.outlet_id, now())
  on conflict (outlet_id) do update set bumped_at = excluded.bumped_at;
  return null;
end;
$$;

revoke execute on function public.kitchen_pulse_bump() from public, anon, authenticated;

create trigger orders_bump_kitchen_pulse
  after insert or update on public.orders
  for each row execute function public.kitchen_pulse_bump();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.kitchen_pulses;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Acknowledgements. Append-only, one row per ACK, per kitchen tablet. The
-- server takes the snapshot of what was acknowledged itself -- the order's
-- visible lines under the tablet's filter at the version the cook saw -- so the
-- next edit can be diffed against it after a reload.

create table public.kitchen_acknowledgements (
  id uuid primary key,
  outlet_id uuid not null references public.outlets (id),
  device_id uuid not null references public.counter_devices (id),
  shift_id uuid not null references public.counter_shifts (id),
  person_id uuid not null references public.profiles (id),
  order_id uuid not null references public.orders (id),
  kind text not null constraint kitchen_acknowledgements_kind_known
    check (kind in ('new', 'edit', 'cancel')),
  order_version timestamptz not null,
  lines jsonb not null,
  -- The real instant, not the transaction's: two acknowledgements of one order
  -- must order exactly, or the board would read the older as the latest.
  acked_at timestamptz not null default clock_timestamp()
);

create index kitchen_acknowledgements_device_order_idx
  on public.kitchen_acknowledgements (device_id, order_id, acked_at desc);

alter table public.kitchen_acknowledgements enable row level security;

create policy kitchen_acknowledgements_select on public.kitchen_acknowledgements
  for select to authenticated using (
    public.app_device_ok() and (
      (device_id = auth.uid() and outlet_id = (select public.app_kitchen_shift_outlet()))
      or (public.app_account_active() and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

revoke all on public.kitchen_acknowledgements from anon, authenticated;
grant select on public.kitchen_acknowledgements to authenticated;

create or replace function public.kitchen_acknowledgements_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'kitchen acknowledgements are append-only' using errcode = '42501';
end;
$$;

create trigger kitchen_acknowledgements_append_only
  before update or delete on public.kitchen_acknowledgements
  for each row execute function public.kitchen_acknowledgements_append_only();

/** An order's version, as the kitchen sees it: its last revision or creation. */
create or replace function public.kitchen_order_version(p_order public.orders)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_order.changed_at, p_order.created_at)
$$;

/** The lines of one order this tablet's filter shows, as the kitchen snapshots them. */
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

revoke execute on function public.kitchen_visible_lines(uuid, text, uuid[]) from public, anon, authenticated;

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

revoke execute on function public.kitchen_acknowledge(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.kitchen_acknowledge(uuid, uuid, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. The board. Everything a kitchen reads, in one call, and nothing else:
-- order number, service, table, times, status, its visible lines, how many
-- lines another kitchen holds, and this tablet's own latest acknowledgement.
-- No customer column and no amount leaves this function.
--
-- An order is on the board when it is on the counter's rail and not yet
-- prepared -- open or paid, with no Prepared tick -- or was cancelled during
-- this shift's business day, and
-- either it has a line this tablet shows or this tablet acknowledged it with
-- one (so an edit that removes every line here reads as a cancellation until
-- acknowledged). An order whose latest acknowledgement here is a cancellation
-- at its current version is off the board.

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
                                      'lines', a.lines, 'ackedAt', a.acked_at)
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
              and (s.latest_ack ->> 'orderVersion')::timestamptz = s.version);

  return jsonb_build_object(
    'readAt', now(),
    'outletId', v_shift.outlet_id,
    'businessDate', v_shift.business_date,
    'shiftId', v_shift.id,
    -- Who opened this kitchen, as the counter's header names its operator.
    'operatorName', (select p.full_name from public.profiles p where p.id = v_shift.person_id),
    'filterMode', v_device.kitchen_filter_mode,
    'categoryIds', to_jsonb(v_device.kitchen_category_ids),
    'sort', v_device.kitchen_sort,
    'orders', v_orders);
end;
$$;

revoke execute on function public.kitchen_board() from public, anon;
grant execute on function public.kitchen_board() to authenticated;
