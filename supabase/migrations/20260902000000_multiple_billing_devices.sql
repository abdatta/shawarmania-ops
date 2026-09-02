-- Two tablets at one outlet, and a setup that no longer spends a counter.
--
-- Both halves of this are the same invariant, which is why they are one
-- migration. An outlet was held to one active tablet by a partial unique index,
-- and a tablet counted as that active tablet from the instant its setup code was
-- redeemed, before the browser had proved it could hold a session. So a lost
-- response between those two acts spent the outlet's only counter and needed an
-- admin to clear it. Lifting the first without fixing the second would make a
-- silent failure cheaper to produce rather than impossible.
--
-- Landing them together also means there is never a moment where a second tablet
-- is permitted while an unproven row still counts as a counter. The two halves
-- are never both loose, because they are one statement.
--
-- **The canonical predicate, from here on: a row is a counter when
-- `removed_at is null and session_proven_at is not null`.** Every entry point a
-- tablet can reach with its own session is repointed at it below. Sites that
-- already require a live shift inherit it, because an unproven tablet is refused
-- by `request_counter_shift` and therefore never has one.
--
-- An unproven row expires with the code that created it [owner, 2026-09-02]:
-- `proof_expires_at` is the redeemed code's own expiry, evaluated where the row
-- is read exactly as code validity already is. No second duration to tune, and
-- no scheduled sweep to notice has stopped running. A row past its window is
-- excluded from the label index, reaches nothing, appears nowhere, and needs no
-- deletion to be harmless.
--
-- The second singleton, found while implementing and decided the same day: an
-- outlet was also held to one live setup code, enforced by issuing silently
-- superseding whatever live code was already there. That made two admins setting
-- up two tablets a race one of them always lost, and the loser was told only
-- that their code was `invalid`. An outlet may now hold several live codes, and
-- a label collision is refused at the point of asking instead.

-- ---------------------------------------------------------------------------
-- 1. Proof of session.

alter table public.counter_devices
  add column session_proven_at timestamptz,
  add column proof_expires_at timestamptz;

-- Every tablet that exists today has been trading, which is proof enough and
-- the only backfill that keeps both outlets working through this migration. Its
-- proof window is irrelevant once proven and is left null rather than invented.
update public.counter_devices
   set session_proven_at = coalesce(set_up_at, now())
 where session_proven_at is null;

-- A row is either proven, or still inside a window in which it may be. Neither
-- is a state anything below knows how to read.
alter table public.counter_devices
  add constraint counter_devices_proven_or_pending
    check (session_proven_at is not null or proof_expires_at is not null);

-- ---------------------------------------------------------------------------
-- 2. Both per-outlet singletons.
--
-- The active-tablet index goes, and the label takes over the job that index was
-- accidentally doing: telling two counters at one shop apart. The label index is
-- scoped to proven rows because an index predicate cannot call now(), so an
-- unproven row holds no label and an abandoned one blocks nothing. A collision
-- between two redeemed codes therefore surfaces at proof, and both callers below
-- translate it rather than letting it raise.

drop index public.counter_devices_one_active_per_outlet;

create unique index counter_devices_one_active_label_per_outlet
  on public.counter_devices (outlet_id, lower(btrim(label)))
  where removed_at is null and session_proven_at is not null;

-- The live-code index was unique on the outlet. What is actually wanted from it
-- is the lookup, which redemption does not even use: it finds a code by its hash.
--
-- Note what this leaves behind. `superseded_at` was written only by issuing, so
-- from here it has no writer, and its `is null` predicates are always true. The
-- column and the predicates stay: the state is still meaningful, and a reader
-- who finds one superseded should not have to ask whether the code was honoured.
-- The consequence worth knowing is that a stray code is now retired by expiry
-- alone, which is the hour ceiling and nothing longer.
drop index public.counter_device_setup_codes_one_live_per_outlet;

create index counter_device_setup_codes_live_per_outlet_idx
  on public.counter_device_setup_codes (outlet_id)
  where consumed_at is null and superseded_at is null;

-- ---------------------------------------------------------------------------
-- 3. The device helpers, repointed at the canonical predicate.

create or replace function public.app_device_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select d.removed_at is null and d.session_proven_at is not null
       from public.counter_devices d where d.id = auth.uid()),
    true
  )
$$;

create or replace function public.app_counter_device()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from public.counter_devices d
   where d.id = auth.uid() and d.removed_at is null
     and d.session_proven_at is not null
$$;

create or replace function public.app_counter_device_outlet()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.outlet_id from public.counter_devices d
   where d.id = auth.uid() and d.removed_at is null
     and d.session_proven_at is not null
$$;

create or replace function public.app_counter_shift()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
     and d.session_proven_at is not null
   where s.device_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
$$;

create or replace function public.app_counter_shift_outlet()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.outlet_id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
     and d.session_proven_at is not null
   where s.device_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
$$;

create or replace function public.app_counter_shift_operator()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.person_id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
     and d.session_proven_at is not null
   where s.device_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
$$;

-- ---------------------------------------------------------------------------
-- 4. Proving a session, and renaming a counter.
--
-- Proof is called by the tablet with its own freshly minted session, which is
-- the only evidence that matters: the browser holds a session, so the row it
-- names may become a counter. Modelled on `report_counter_device_state`, because
-- that is already the shape of a device speaking for itself: definer rights,
-- identity from auth.uid() alone, and nothing about a device crossing the wire.
--
-- Idempotent on purpose. A lost response is the failure this whole change exists
-- to survive, so proving twice is success rather than a second state.

create or replace function public.prove_counter_device_session()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if exists (
    select 1 from public.counter_devices d
     where d.id = auth.uid() and d.removed_at is null
       and d.session_proven_at is not null
  ) then
    return 'ok';
  end if;

  begin
    update public.counter_devices
       set session_proven_at = now(), last_seen_at = now()
     where id = auth.uid()
       and removed_at is null
       and session_proven_at is null
       and proof_expires_at > now();
    -- Read inside the block rather than after it, because ROW_COUNT describes
    -- the last statement executed and an exception handler is a statement.
    get diagnostics v_count = row_count;
  exception when unique_violation then
    -- Two live codes for one outlet carried one label and both were redeemed.
    -- The first to prove is the counter; this one says why, rather than failing
    -- as an unhandled write.
    return 'label_taken';
  end;

  return case when v_count = 1 then 'ok' else 'invalid' end;
end;
$$;

-- Renaming, which label uniqueness turns from an UPDATE into a path: an admin
-- who cannot rename cannot resolve a collision, and reusing a removed tablet's
-- label is legitimate, so the refusal has to be a value rather than an error.
create or replace function public.rename_counter_device(
  p_device_id uuid,
  p_renamed_by uuid,
  p_label text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
begin
  if p_label is null or length(btrim(p_label)) = 0 then
    return 'invalid';
  end if;

  select d.outlet_id into v_outlet
    from public.counter_devices d
   where d.id = p_device_id and d.removed_at is null
     and d.session_proven_at is not null;

  if v_outlet is null then
    return 'invalid';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = p_renamed_by and p.is_active
  ) or not exists (
    select 1 from public.assignments a
     where a.person_id = p_renamed_by
       and a.ended_on is null
       and (
         a.role = 'super_admin'
         or (a.role = 'franchise_admin' and a.outlet_id = v_outlet)
       )
  ) then
    return 'not_authorised';
  end if;

  begin
    update public.counter_devices
       set label = btrim(p_label)
     where id = p_device_id;
  exception when unique_violation then
    return 'label_taken';
  end;

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Issuing a code.
--
-- `tablet_exists` is gone: an outlet holding a counter is no longer a reason to
-- refuse one. So is the supersede, which used to be how one live code per outlet
-- was maintained and which silently voided a colleague's unredeemed code.
--
-- What replaces the early refusal is the label. It is checked against proven
-- tablets and against rows still inside their proof window, because both will
-- hold that label at the outlet, and it is refused here so the admin reads it on
-- their own phone rather than at the counter. `label_taken` is allowed to be
-- specific for the same reason `tablet_exists` was: it describes the outlet, to
-- somebody who is already authorised over that outlet and named it themselves.

create or replace function public.issue_counter_device_setup_code(
  p_outlet_id uuid,
  p_issued_by uuid,
  p_label text,
  p_code_hash text,
  p_valid_for interval
)
returns table (status text, code_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_valid interval := least(greatest(coalesce(p_valid_for, interval '15 minutes'),
                                     interval '1 minute'),
                            interval '1 hour');
begin
  if p_label is null or length(btrim(p_label)) = 0 then
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
    (outlet_id, label, code_hash, issued_by, expires_at)
  values
    (p_outlet_id, btrim(p_label), p_code_hash, p_issued_by, now() + v_valid)
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Redeeming a code.
--
-- The row it writes is not a counter. It carries the code's own expiry as its
-- proof window and nothing else changes about the transaction: the code is still
-- consumed before the row is written, which is what makes two simultaneous
-- redemptions of one code unable to both win.
--
-- `tablet_exists` is gone here too. The label is checked instead, and, exactly
-- as `tablet_exists` did, it leaves the code unconsumed: the code is not at
-- fault, and removing the colliding tablet should let the same code work.

create or replace function public.redeem_counter_device_setup_code(
  p_code_hash text,
  p_device_id uuid,
  p_max_attempts integer default 5
)
returns table (status text, device_id uuid, outlet_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
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
    (id, outlet_id, label, set_up_by, proof_expires_at)
  values
    (p_device_id, v_code.outlet_id, v_code.label, v_code.issued_by, v_code.expires_at);

  return query select 'ok'::text, p_device_id, v_code.outlet_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The rest of what a tablet can reach with its own session.
--
-- Each of these carries exactly one added predicate and is otherwise the
-- definition already deployed, reproduced so the change is one statement per
-- function rather than a patch nobody can read. Opening a shift is the door that
-- matters most: an unproven tablet is refused here, so every surface that
-- requires a live shift inherits the rule without being touched.

create or replace function public.request_counter_shift(
  p_device_id uuid,
  p_username text,
  p_code_hash text,
  p_valid_for interval
)
returns table (status text, request_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
  v_person uuid;
  v_username text;
  v_id uuid;
  v_expires timestamptz;
  -- Long enough to walk round a counter and read four digits aloud; short
  -- enough that a request nobody answers is gone before anybody wanders off.
  v_valid interval := least(greatest(coalesce(p_valid_for, interval '2 minutes'),
                                     interval '30 seconds'),
                            interval '5 minutes');
begin
  select d.outlet_id into v_outlet
    from public.counter_devices d
   where d.id = p_device_id and d.removed_at is null and d.session_proven_at is not null;

  if v_outlet is null then
    return query select 'device_unknown'::text, null::uuid, null::timestamptz;
    return;
  end if;

  v_username := public.app_normalize_username(p_username);

  -- Resolved through the same Auth alias the password grant uses, so the name
  -- typed on the tablet is exactly the name typed at sign-in. A miss leaves
  -- v_person null and changes nothing else about what happens next — and since
  -- this migration, nothing can read that column to tell which happened.
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
    (device_id, outlet_id, person_id, requested_username, code_hash, expires_at)
  values
    (p_device_id, v_outlet, v_person, v_username, p_code_hash, v_expires)
  returning id into v_id;

  return query select 'ok'::text, v_id, v_expires;
end;
$$;

-- The heartbeat, both signatures. An unproven row reporting its state would be
-- a row that reaches something, and it also would have appeared on the Tablets
-- surface the moment it did.

create or replace function public.report_counter_device_state(p_unsent integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.counter_devices
     set last_seen_at = now(),
         last_reported_unsent = greatest(coalesce(p_unsent, 0), 0),
         last_reported_oldest_unresolved_at = null
   where id = auth.uid() and removed_at is null and session_proven_at is not null;
  get diagnostics v_count = row_count;
  return case when v_count = 1 then 'ok' else 'invalid' end;
end;
$$;
create or replace function public.report_counter_device_state(
  p_unresolved integer,
  p_oldest_unresolved_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_unresolved is null
     or p_unresolved < 0
     or (p_unresolved > 0 and p_oldest_unresolved_at is null) then
    return 'invalid';
  end if;

  update public.counter_devices
     set last_seen_at = now(),
         last_reported_unsent = p_unresolved,
         last_reported_oldest_unresolved_at =
           case when p_unresolved = 0 then null else p_oldest_unresolved_at end
   where id = auth.uid() and removed_at is null and session_proven_at is not null;
  get diagnostics v_count = row_count;
  return case when v_count = 1 then 'ok' else 'invalid' end;
end;
$$;

-- Customer lookup already required a live shift, so this is belt and braces
-- rather than a hole: it is repointed because the predicate it duplicates has
-- moved, and a copy that disagrees with the original is how the next reader is
-- misled.

create or replace function public.app_may_look_up_customer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.counter_shifts s
      join public.counter_devices d on d.id = s.device_id and d.removed_at is null
           and d.session_proven_at is not null
     where s.ended_at is null
       and s.expires_at > now()
       and (
         -- The tablet the shift is open on.
         s.device_id = auth.uid()
         -- Or the person who opened it, on their own device. They are the one
         -- accountable for the drawer, so a lookup from their phone while they
         -- hold the counter is the same act as one from the tablet.
         or (s.person_id = auth.uid() and public.app_account_active())
       )
  )
$$;

-- End of day. The device is read directly here rather than through a helper, so
-- an unproven row could have inserted a command before the shift lookup refused
-- it. `removed_tablet` is the existing status for a device that is not a
-- counter, and it discloses nothing new.

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

-- The Tablets surface. `visible_devices` is what makes an unproven setup
-- invisible, which is the whole of the app-shell requirement: nothing appears,
-- and nothing needs removing before another code is issued.

create or replace function public.counter_operations_snapshot(
  p_outlet_ids uuid[]
)
returns table (
  read_at timestamptz,
  device_id uuid,
  outlet_id uuid,
  label text,
  set_up_at timestamptz,
  last_seen_at timestamptz,
  last_reported_unsent integer,
  shift_id uuid,
  operator_name text,
  opened_at timestamptz,
  business_date date,
  bill_count bigint,
  cash_total_paise bigint,
  upi_total_paise bigint,
  open_order_count bigint,
  drawer_cash_paise bigint
)
language plpgsql
stable
security invoker
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
           d.last_seen_at, d.last_reported_unsent
      from public.counter_devices d
     where d.removed_at is null
       and d.session_proven_at is not null
       and d.outlet_id = any(coalesce(p_outlet_ids, array[]::uuid[]))
  ),
  live_shifts as (
    select distinct on (s.device_id)
           s.id, s.device_id, s.outlet_id, s.person_id,
           s.opened_at, s.business_date
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
         case when s.id is null then null else coalesce(b.bill_count, 0) end,
         case when s.id is null then null else coalesce(b.cash_total_paise, 0) end,
         case when s.id is null then null else coalesce(b.upi_total_paise, 0) end,
         case when s.id is null then null else coalesce(o.open_order_count, 0) end,
         -- V1 has no opening-float allocation by shift. The drawer contribution
         -- from billing is therefore precisely the latest effective Cash tender.
         case when s.id is null then null else coalesce(b.cash_total_paise, 0) end
    from visible_devices d
    left join live_shifts s on s.device_id = d.id
    left join public.profiles p on p.id = s.person_id
    left join bill_rollup b on b.shift_id = s.id
    left join order_rollup o on o.shift_id = s.id
   order by d.label;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants. Proof is called by the tablet itself, so it goes to
-- `authenticated`; renaming is an admin act reached through the same service
-- boundary as removal.

revoke execute on function public.prove_counter_device_session() from public, anon;
grant execute on function public.prove_counter_device_session() to authenticated;

revoke execute on function public.rename_counter_device(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.rename_counter_device(uuid, uuid, text) to service_role;

