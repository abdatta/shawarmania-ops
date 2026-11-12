-- retire-auto-approve-at-the-shop, 3.1: the contract half of
-- `auto-approve-at-the-shop`, last of the three, after both gates that depended
-- on it. Every build since `106dd273` (first live in Deploy 0fe6beed, 3
-- November) checks in through `attendance_submit_attempt_v3` and offers the
-- outlet's Attendance rules without asking the gate. Every registered device
-- runs a build that contains it: on 12 November, Cafe Laptop, Conti Kitchen and
-- Shawarma Kitchen on `8b6a567f`, after eight services on it (4 to 11
-- November).
-- release: contract auto-approve-at-the-shop
--
-- What reads the key, in production and in the migrations on 12 November:
-- `attendance_submit_attempt_v3(…)`, and nothing else. It keeps its on branch,
-- the block before any write and the settle after the arrival, with its
-- signature, grants and every other line as they were (production's body was
-- read and matched the migration's before this was written). Before the row is
-- retired, so no check-in meets a v3 that answers off.
--
-- `attendance_submit_attempt` and `_v2` stay: no build since the retirement
-- calls them, but a Republish to an older one would, and neither read the gate.
-- The row is retired.

create or replace function public.attendance_submit_attempt_v3(
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
  v_distance double precision;
  v_auto public.attendance_decisions;
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
     or not public.app_acts_as('employee', p_outlet_id) then
    raise exception 'employee is not assigned to this outlet' using errcode = 'insufficient_privilege';
  end if;

  -- Block, before anything is written (design D3.1). The same distance the
  -- attempt trigger stamps, so the two can never disagree. No position, or an
  -- outlet with none, is refused too: otherwise location off is the way round.
  if v_outlet.attendance_blocks_away then
    v_distance := public.app_distance_m(v_outlet.latitude, v_outlet.longitude, p_lat, p_lng);
    if v_distance is null or v_distance > v_outlet.geofence_radius_m then
      raise exception 'check-in away from the shop is blocked here' using errcode = 'check_violation';
    end if;
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

  -- Settle, in a second statement (design D3.3): on a first-of-day check-in
  -- the update above is the arrival, and `attendance_evaluate_geofence` resets
  -- an unapproved arrival's `present` to `absent`. Here `check_in_at` is
  -- already set, so it leaves the status alone. A reading also inside another
  -- outlet the person works at is ambiguous and waits (D1).
  if not v_outlet.attendance_needs_manager
     and v_attempt.distance_m is not null
     and v_attempt.distance_m <= v_outlet.geofence_radius_m
     and not exists (
       select 1
         from public.outlets o
        where o.id <> p_outlet_id
          and o.is_active
          and public.app_person_assigned_at(v_person, o.id)
          and public.app_distance_m(o.latitude, o.longitude, p_lat, p_lng) <= o.geofence_radius_m
     ) then
    insert into public.attendance_decisions (
      id, attendance_id, attempt_id, outlet_id, person_id, business_date, kind,
      actor_id, actor_name, decided_at, reason, prevents_retry,
      previous_status, new_status, fence_radius_m, request_fingerprint
    ) values (
      gen_random_uuid(), v_day.id, v_attempt.id, p_outlet_id, v_person,
      v_business_date, 'auto_approved', null, null, v_now, null, true,
      v_day.status, 'present', v_outlet.geofence_radius_m,
      'auto-approved:' || v_attempt.id::text
    ) returning * into v_auto;
    update public.attendance_attempts set settled_at = v_now where id = v_attempt.id;
    update public.attendance
       set status = 'present',
           current_attempt_id = null,
           outcome_attempt_id = v_attempt.id,
           latest_decision_id = v_auto.id,
           retry_blocked = true,
           state_version = state_version + 1
     where id = v_day.id
     returning * into v_day;
  end if;
  perform set_config('app.attendance_command', 'off', true);
  return v_day;
end;
$$;

update public.change_gates
   set retired_at = now(), enabled = false
 where key = 'auto-approve-at-the-shop';
