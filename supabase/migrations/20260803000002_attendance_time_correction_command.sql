-- A time correction keeps immutable arrival evidence intact and changes only
-- the canonical effective time used by reads and derived lateness.
alter table public.attendance_decisions
  drop constraint attendance_decision_reason_required,
  add constraint attendance_decision_reason_required
    check (
      kind not in (
        'deny', 'correct_present', 'correct_absent', 'allow_retry',
        'absent_allow_retry', 'correct_time'
      ) or reason is not null
    ),
  drop constraint attendance_decision_retry_semantics,
  add constraint attendance_decision_retry_semantics
    check (
      kind = 'correct_time'
      or (kind in ('allow_retry', 'absent_allow_retry') and not prevents_retry)
      or kind = 'deny'
      or (kind not in ('allow_retry', 'absent_allow_retry', 'deny') and prevents_retry)
    ),
  add constraint attendance_decision_time_correction_shape
    check (
      (kind = 'correct_time'
        and previous_check_in_at is not null
        and new_check_in_at is not null)
      or (kind <> 'correct_time'
        and previous_check_in_at is null
        and new_check_in_at is null)
    );

drop function public.attendance_correct(
  uuid, uuid, integer, text, text, double precision, double precision, numeric
);

create function public.attendance_correct(
  p_decision_id uuid,
  p_attendance_id uuid,
  p_expected_version integer,
  p_action text,
  p_reason text,
  p_manager_lat double precision default null,
  p_manager_lng double precision default null,
  p_manager_accuracy_m numeric default null,
  p_corrected_at timestamptz default null
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_reason text := nullif(btrim(p_reason), '');
  v_fingerprint text;
  v_existing public.attendance_decisions;
  v_day public.attendance;
  v_attempt public.attendance_attempts;
  v_outlet public.outlets;
  v_kind public.attendance_decision_kind;
  v_new_status public.attendance_status;
  v_prevents boolean;
  v_distance numeric;
  v_now timestamptz := now();
begin
  if v_reason is null then
    raise exception 'an attendance correction requires a reason';
  end if;
  if p_action not in ('present', 'absent', 'allow_retry', 'absent_allow_retry', 'time') then
    raise exception 'unknown attendance correction';
  end if;
  if p_action = 'time' and p_corrected_at is null then
    raise exception 'a check-in time correction requires a time';
  end if;
  if p_action <> 'time' and p_corrected_at is not null then
    raise exception 'only a check-in time correction accepts a time';
  end if;

  v_fingerprint := public.attendance_request_fingerprint(jsonb_build_object(
    'attendance', p_attendance_id, 'version', p_expected_version,
    'action', p_action, 'reason', v_reason,
    'lat', p_manager_lat, 'lng', p_manager_lng, 'accuracy', p_manager_accuracy_m,
    'corrected_at', p_corrected_at
  ));
  select * into v_existing
    from public.attendance_decisions
   where id = p_decision_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
       or v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'decision id was reused with a changed payload';
    end if;
    select * into v_day
      from public.attendance
     where id = v_existing.attendance_id;
    return v_day;
  end if;

  select * into v_day
    from public.attendance
   where id = p_attendance_id
   for update;
  if not found
     or v_day.state_version <> p_expected_version
     or v_day.current_attempt_id is not null then
    raise exception 'attendance state is stale';
  end if;
  select * into v_attempt
    from public.attendance_attempts
   where id = coalesce(
     v_day.outcome_attempt_id,
     (select at.id
        from public.attendance_attempts at
       where at.attendance_id = v_day.id
       order by at.attempted_at desc
       limit 1)
   );
  if not found then
    raise exception 'a correction requires a recorded attempt';
  end if;
  select * into v_outlet
    from public.outlets
   where id = v_attempt.outlet_id;
  if v_actor is null
     or not public.app_account_active()
     or not (
       public.app_is_owner()
       or public.app_has_role_at('franchise_admin', v_attempt.outlet_id)
     ) then
    raise exception 'only a manager for this outlet may correct attendance'
      using errcode = 'insufficient_privilege';
  end if;
  select p.full_name into v_actor_name
    from public.profiles p
   where p.id = v_actor;

  if p_action = 'present' then
    if (p_manager_lat is null) <> (p_manager_lng is null) then
      raise exception 'approver coordinates must be paired';
    end if;
    v_kind := 'correct_present';
    v_new_status := 'present';
    v_prevents := true;
    v_distance := public.app_distance_m(
      v_outlet.latitude, v_outlet.longitude, p_manager_lat, p_manager_lng
    );
  elsif p_action = 'absent' then
    v_kind := 'correct_absent';
    v_new_status := 'absent';
    v_prevents := true;
  elsif p_action = 'allow_retry' then
    if v_day.status <> 'absent' then
      raise exception 'only an absent day can reopen retry';
    end if;
    v_kind := 'allow_retry';
    v_new_status := v_day.status;
    v_prevents := false;
  elsif p_action = 'absent_allow_retry' then
    v_kind := 'absent_allow_retry';
    v_new_status := 'absent';
    v_prevents := false;
  else
    if v_day.outcome_attempt_id is null or v_day.check_in_at is null then
      raise exception 'only settled attendance with an arrival can change check-in time';
    end if;
    if p_corrected_at > v_now then
      raise exception 'a corrected check-in time cannot be in the future';
    end if;
    if public.app_business_date(p_corrected_at, v_outlet.business_day_cutover)
       is distinct from v_day.business_date then
      raise exception 'a corrected check-in time must remain on the recorded business date';
    end if;
    if p_corrected_at = v_day.check_in_at then
      raise exception 'the corrected check-in time is unchanged';
    end if;
    if p_manager_lat is not null
       or p_manager_lng is not null
       or p_manager_accuracy_m is not null then
      raise exception 'a check-in time correction does not accept manager position';
    end if;
    v_kind := 'correct_time';
    v_new_status := v_day.status;
    v_prevents := v_day.retry_blocked;
  end if;

  perform set_config('app.attendance_command', 'on', true);
  insert into public.attendance_decisions (
    id, attendance_id, attempt_id, outlet_id, person_id, business_date, kind,
    actor_id, actor_name, decided_at, reason, prevents_retry,
    previous_status, new_status,
    manager_lat, manager_lng, manager_accuracy_m, manager_distance_m,
    previous_check_in_at, new_check_in_at, request_fingerprint
  ) values (
    p_decision_id, v_day.id, v_attempt.id, v_attempt.outlet_id, v_day.person_id,
    v_day.business_date, v_kind, v_actor, v_actor_name, v_now, v_reason, v_prevents,
    v_day.status, v_new_status,
    case when p_action = 'present' then p_manager_lat else null end,
    case when p_action = 'present' then p_manager_lng else null end,
    case when p_action = 'present' then p_manager_accuracy_m else null end,
    case when p_action = 'present' then v_distance else null end,
    case when p_action = 'time' then v_day.check_in_at else null end,
    case when p_action = 'time' then p_corrected_at else null end,
    v_fingerprint
  );

  if p_action = 'time' then
    update public.attendance
       set check_in_at = p_corrected_at,
           state_version = state_version + 1
     where id = v_day.id
     returning * into v_day;
  else
    update public.attendance
       set outlet_id = v_attempt.outlet_id,
           status = v_new_status,
           current_attempt_id = null,
           outcome_attempt_id = v_attempt.id,
           latest_decision_id = p_decision_id,
           retry_blocked = v_prevents,
           approved_by = case when p_action = 'present' then v_actor else null end,
           approved_by_name = case when p_action = 'present' then v_actor_name else null end,
           approval_reason = case when p_action = 'present' then v_reason else null end,
           approved_at = case when p_action = 'present' then v_now else null end,
           approver_lat = case when p_action = 'present' then p_manager_lat else null end,
           approver_lng = case when p_action = 'present' then p_manager_lng else null end,
           approver_accuracy_m = case when p_action = 'present' then p_manager_accuracy_m else null end,
           approver_distance_m = case when p_action = 'present' then v_distance else null end,
           state_version = state_version + 1
     where id = v_day.id
     returning * into v_day;
  end if;
  perform set_config('app.attendance_command', 'off', true);
  return v_day;
end;
$$;

revoke execute on function public.attendance_correct(
  uuid, uuid, integer, text, text, double precision, double precision, numeric,
  timestamptz
) from public, anon;
grant execute on function public.attendance_correct(
  uuid, uuid, integer, text, text, double precision, double precision, numeric,
  timestamptz
) to authenticated;
