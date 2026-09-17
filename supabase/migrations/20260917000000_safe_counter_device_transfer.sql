-- A counter tablet may be renamed in place, and a Super Admin may transfer it
-- to another active outlet without replacing its Auth identity or session.
--
-- Transfer is deliberately stricter than rename. The tablet must be idle and
-- must have reported a fresh, empty durable queue before the move. These are
-- database preconditions, not promises made by the UI: the Edge Function uses
-- the service role, so this function re-derives the human caller's authority
-- and locks every mutable fact it relies on in the same transaction.

create or replace function public.edit_counter_device(
  p_device_id uuid,
  p_edited_by uuid,
  p_label text,
  p_outlet_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.counter_devices%rowtype;
  v_label text := btrim(p_label);
  v_is_owner boolean;
  v_is_manager boolean;
  v_is_transfer boolean;
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

  if not v_is_transfer
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

  begin
    update public.counter_devices
       set label = v_label,
           outlet_id = p_outlet_id
     where id = p_device_id;
  exception when unique_violation then
    return 'label_taken';
  end;

  return 'ok';
end;
$$;

revoke execute on function public.edit_counter_device(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.edit_counter_device(uuid, uuid, text, uuid)
  to service_role;

-- Request creation takes the same device-row lock as transfer. Without this,
-- a request could read outlet A, pause, then insert its A row after the device
-- had committed at B. Confirmation would subsequently open a shift at A with a
-- device currently assigned to B.
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
  v_valid interval := least(greatest(coalesce(p_valid_for, interval '2 minutes'),
                                     interval '30 seconds'),
                            interval '5 minutes');
begin
  select d.outlet_id into v_outlet
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
    (device_id, outlet_id, person_id, requested_username, code_hash, expires_at)
  values
    (p_device_id, v_outlet, v_person, v_username, p_code_hash, v_expires)
  returning id into v_id;

  return query select 'ok'::text, v_id, v_expires;
end;
$$;

-- Keep the established service RPC as a compatibility wrapper. It has no
-- independent write logic: current outlet is read once and the atomic editor
-- re-locks/re-authorises the complete operation.
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
  v_result text;
begin
  select d.outlet_id into v_outlet
    from public.counter_devices d
   where d.id = p_device_id;
  if not found then
    return 'invalid';
  end if;

  v_result := public.edit_counter_device(
    p_device_id,
    p_renamed_by,
    p_label,
    v_outlet
  );
  return case when v_result = 'device_invalid' then 'invalid' else v_result end;
end;
$$;

revoke execute on function public.rename_counter_device(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.rename_counter_device(uuid, uuid, text)
  to service_role;

-- A transferred tablet must not retain the old outlet through its stable Auth
-- UUID. Device-owned reads are intersected with its CURRENT live shift/outlet;
-- personal-account owner/manager authority is unchanged.

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated using (
  public.app_device_ok() and (
    outlet_id = (select public.app_counter_shift_outlet())
    or (public.app_account_active() and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

drop policy if exists billing_commands_select on public.billing_commands;
create policy billing_commands_select on public.billing_commands
  for select to authenticated using (
    public.app_device_ok() and (
      (device_id = auth.uid()
       and outlet_id = (select public.app_counter_shift_outlet()))
      or (public.app_account_active() and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

drop policy if exists billing_end_of_day_confirmations_select
  on public.billing_end_of_day_confirmations;
create policy billing_end_of_day_confirmations_select
  on public.billing_end_of_day_confirmations for select to authenticated using (
    public.app_device_ok() and (
      (device_id = auth.uid()
       and outlet_id = (select public.app_counter_shift_outlet()))
      or (public.app_account_active() and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

drop policy if exists counter_shift_requests_select on public.counter_shift_requests;
create policy counter_shift_requests_select on public.counter_shift_requests
  for select to authenticated using (
    (device_id = auth.uid()
     and public.app_device_ok()
     and outlet_id = (select public.app_counter_device_outlet()))
    or (person_id = auth.uid() and public.app_account_active()));

drop policy if exists counter_shifts_select on public.counter_shifts;
create policy counter_shifts_select on public.counter_shifts
  for select to authenticated using (
    (
      device_id = auth.uid()
      and public.app_device_ok()
      and outlet_id = (select public.app_counter_device_outlet())
      and ended_at is null
      and expires_at > now()
    )
    or (
      public.app_account_active()
      and (
        person_id = auth.uid()
        or (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  );

drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated using (
    public.app_device_ok()
    and (
      (
        counter_device_id = auth.uid()
        and outlet_id = (select public.app_counter_shift_outlet())
      )
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
        )
      )
    )
  );

drop policy if exists shifts_update on public.shifts;
create policy shifts_update on public.shifts
  for update to authenticated
  using (
    public.app_device_ok()
    and counter_device_id = auth.uid()
    and outlet_id = (select public.app_counter_shift_outlet())
  )
  with check (
    public.app_device_ok()
    and counter_device_id = auth.uid()
    and outlet_id = (select public.app_counter_shift_outlet())
  );
