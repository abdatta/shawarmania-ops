-- A self check-in is an online receipt, so the database is its clock. The
-- deployed RPC signature remains intact while existing clients drain.

create or replace function public.attendance_submit_attempt(
  p_attempt_id uuid,
  p_outlet_id uuid,
  p_business_date date,
  p_attempted_at timestamptz,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric,
  p_expected_version integer default null
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := auth.uid();
  v_fingerprint text;
  v_existing public.attendance_attempts;
  v_day public.attendance;
  v_attempt public.attendance_attempts;
  v_outlet public.outlets;
  v_current public.attendance_attempts;
  v_current_radius integer;
  v_decision public.attendance_decisions;
  v_day_found boolean := false;
  -- One statement instant is the event time, canonical check-in time and any
  -- supersession time written by this command. Device time is only a legacy
  -- payload fact while old PWAs still send it.
  v_now timestamptz := statement_timestamp();
  v_business_date date;
begin
  if v_person is null or not public.app_account_active() or not public.app_device_ok() then
    raise exception 'attendance attempt is not permitted' using errcode = 'insufficient_privilege';
  end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'attempt coordinates must be paired';
  end if;
  if p_accuracy_m is not null and p_accuracy_m < 0 then
    raise exception 'attempt accuracy cannot be negative';
  end if;

  -- Preserve the deployed client payload as the command identity, but never
  -- allow its clock-derived facts to decide a new attempt's time or date.
  v_fingerprint := public.attendance_request_fingerprint(jsonb_build_object(
    'outlet', p_outlet_id, 'date', p_business_date, 'at', p_attempted_at,
    'lat', p_lat, 'lng', p_lng, 'accuracy', p_accuracy_m,
    'expected', p_expected_version
  ));
  select * into v_existing from public.attendance_attempts where id = p_attempt_id;
  if found then
    if v_existing.person_id is distinct from v_person
       or v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'attempt id was reused with a changed payload';
    end if;
    select * into v_day from public.attendance where id = v_existing.attendance_id;
    return v_day;
  end if;

  select * into v_outlet from public.outlets where id = p_outlet_id;
  if not found or not v_outlet.is_active then
    raise exception 'outlet is not trading';
  end if;
  if not public.app_person_assigned_at(v_person, p_outlet_id)
     or not (public.app_has_role_at('employee', p_outlet_id)
             or public.app_has_role_at('biller', p_outlet_id)) then
    raise exception 'employee is not assigned to this outlet' using errcode = 'insufficient_privilege';
  end if;

  v_business_date := public.app_business_date(v_now, v_outlet.business_day_cutover);

  -- A retry may name its canonical date so the command can reject that exact
  -- row after rollover. If an old skewed client names no row, fall back to the
  -- server's current row rather than resurrecting device-clock authority.
  if p_expected_version is not null then
    select * into v_day
      from public.attendance
     where person_id = v_person and business_date = p_business_date
     for update;

    v_day_found := found;

    if v_day_found and v_day.business_date is distinct from v_business_date then
      raise exception 'retry target no longer regards this as its current business date';
    end if;
  end if;

  if not v_day_found then
    select * into v_day
      from public.attendance
     where person_id = v_person and business_date = v_business_date
     for update;
    v_day_found := found;
  end if;

  if v_day_found then
    if p_expected_version is not null and v_day.state_version <> p_expected_version then
      raise exception 'attendance state is stale';
    end if;
    if v_day.current_attempt_id is not null then
      select * into v_current
        from public.attendance_attempts
       where id = v_day.current_attempt_id;
      select o.geofence_radius_m into v_current_radius
        from public.outlets o
       where o.id = v_current.outlet_id;
      if v_current.distance_m is not null and v_current.distance_m <= v_current_radius then
        raise exception 'the current in-fence attempt must be decided before another check-in';
      end if;
    elsif v_day.latest_decision_id is not null then
      select * into v_decision
        from public.attendance_decisions where id = v_day.latest_decision_id;
      if v_day.retry_blocked
         or v_decision.kind not in ('deny', 'correct_absent', 'allow_retry', 'absent_allow_retry')
         or v_day.status <> 'absent' then
        raise exception 'another check-in is not allowed for this business date';
      end if;
    elsif v_day.check_in_at is not null then
      raise exception 'another check-in is not allowed for this business date';
    end if;
  else
    perform set_config('app.attendance_command', 'on', true);
    insert into public.attendance (
      outlet_id, person_id, business_date, status, state_version, retry_blocked
    ) values (p_outlet_id, v_person, v_business_date, 'absent', 0, false)
    returning * into v_day;
  end if;

  perform set_config('app.attendance_command', 'on', true);
  if v_day.current_attempt_id is not null then
    update public.attendance_attempts
       set superseded_at = v_now
     where id = v_day.current_attempt_id;
  end if;

  insert into public.attendance_attempts (
    id, attendance_id, outlet_id, person_id, business_date, attempted_at,
    latitude, longitude, accuracy_m, distance_m, source,
    arrival_deadline, request_fingerprint
  ) values (
    p_attempt_id, v_day.id, p_outlet_id, v_person, v_business_date, v_now,
    p_lat, p_lng, p_accuracy_m, null, 'phone',
    v_outlet.arrival_deadline, v_fingerprint
  ) returning * into v_attempt;

  update public.attendance
     set outlet_id = p_outlet_id,
         current_attempt_id = p_attempt_id,
         check_in_at = v_attempt.attempted_at,
         check_in_lat = v_attempt.latitude,
         check_in_lng = v_attempt.longitude,
         check_in_accuracy_m = v_attempt.accuracy_m,
         check_in_distance_m = v_attempt.distance_m,
         check_in_source = v_attempt.source,
         check_in_entered_by = null,
         check_in_entered_by_name = null,
         arrival_deadline = v_attempt.arrival_deadline,
         approved_by = null,
         approved_by_name = null,
         approval_reason = null,
         approved_at = null,
         approver_lat = null,
         approver_lng = null,
         approver_accuracy_m = null,
         approver_distance_m = null,
         state_version = state_version + 1
   where id = v_day.id
   returning * into v_day;
  perform set_config('app.attendance_command', 'off', true);
  return v_day;
end;
$$;

revoke execute on function public.attendance_submit_attempt(uuid, uuid, date, timestamptz, double precision, double precision, numeric, integer) from public, anon;
grant execute on function public.attendance_submit_attempt(uuid, uuid, date, timestamptz, double precision, double precision, numeric, integer) to authenticated;

-- The employee UI asks for a small, server-authored clock context rather than
-- calculating 'today' from its device. SECURITY INVOKER deliberately leaves
-- outlet RLS as the scope authority.
create or replace function public.attendance_current_context(p_outlet_ids uuid[])
returns table (
  outlet_id uuid,
  server_at timestamptz,
  business_date date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with current_context as (
    select statement_timestamp() as server_at
  ), requested as (
    select distinct pg_catalog.unnest(p_outlet_ids) as outlet_id
  )
  select
    o.id,
    current_context.server_at,
    public.app_business_date(current_context.server_at, o.business_day_cutover)
  from requested
  join public.outlets o on o.id = requested.outlet_id
  cross join current_context
  order by o.id;
$$;

revoke all on function public.attendance_current_context(uuid[]) from public, anon;
grant execute on function public.attendance_current_context(uuid[]) to authenticated;
