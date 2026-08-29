-- A counter heartbeat is evidence with an age, not a permanent verdict.
-- Keep the deployed integer column for compatibility and add only the missing
-- fact: when the oldest locally unresolved command was created.

alter table public.counter_devices
  add column last_reported_oldest_unresolved_at timestamptz;

-- Compatibility signature for already-deployed tablets. A positive legacy
-- report cannot truthfully name the oldest command, so it clears that fact to
-- unknown. Zero still repairs both fields.
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
   where id = auth.uid() and removed_at is null;
  get diagnostics v_count = row_count;
  return case when v_count = 1 then 'ok' else 'invalid' end;
end;
$$;

-- Rich heartbeat used by current tablets. It still derives the device solely
-- from auth.uid(); neither an outlet nor a device identity crosses the wire.
create function public.report_counter_device_state(
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
   where id = auth.uid() and removed_at is null;
  get diagnostics v_count = row_count;
  return case when v_count = 1 then 'ok' else 'invalid' end;
end;
$$;

revoke execute on function public.report_counter_device_state(integer, timestamptz)
  from public, anon;
grant execute on function public.report_counter_device_state(integer, timestamptz)
  to authenticated;

-- Postgres cannot replace a function while changing its table return type.
-- Preserve the deployed snapshot and add a versioned reader carrying the new
-- fact. The old function remains callable by older builds.
create function public.counter_operations_snapshot_v2(
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
  last_reported_oldest_unresolved_at timestamptz,
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
language sql
stable
security invoker
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
         snapshot.drawer_cash_paise
    from public.counter_operations_snapshot(p_outlet_ids) snapshot
    join public.counter_devices device on device.id = snapshot.device_id;
$$;

revoke execute on function public.counter_operations_snapshot_v2(uuid[]) from public, anon;
grant execute on function public.counter_operations_snapshot_v2(uuid[]) to authenticated;
