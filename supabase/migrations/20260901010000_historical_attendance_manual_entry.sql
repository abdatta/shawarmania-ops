-- Managers may restore a missed arrival on an earlier business day. The
-- command keeps the existing immutable attempt/decision ledger and broadens
-- only the date guard: future dates remain impossible, the supplied instant
-- must resolve to the named outlet business day, and the subject must be both
-- current visible staff and historically assigned on that date.

create or replace function public.attendance_record_manual(
  p_attempt_id uuid,
  p_decision_id uuid,
  p_person_id uuid,
  p_outlet_id uuid,
  p_business_date date,
  p_attempted_at timestamptz
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_day public.attendance;
  v_outlet public.outlets;
  v_fingerprint text;
  v_attempt public.attendance_attempts;
  v_day_exists boolean;
  v_now timestamptz := now();
begin
  select * into v_outlet from public.outlets where id = p_outlet_id;
  if v_actor is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet_id)) then
    raise exception 'only a manager for this outlet may record a manual entry' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1
      from public.assignments a
     where a.person_id = p_person_id
       and a.outlet_id = p_outlet_id
       and a.role in ('employee', 'biller')
       and a.ended_on is null
  ) then
    raise exception 'person is not current staff at this outlet';
  end if;
  if not exists (
    select 1
      from public.assignments a
     where a.person_id = p_person_id
       and a.outlet_id = p_outlet_id
       and a.role in ('employee', 'biller')
       and a.started_on <= p_business_date
       and (a.ended_on is null or a.ended_on >= p_business_date)
  ) then
    raise exception 'person was not staff at this outlet on the named business date';
  end if;
  if p_business_date is null
     or p_business_date > public.app_business_date(v_now, v_outlet.business_day_cutover) then
    raise exception 'a manual entry cannot be recorded for a future business day';
  end if;
  if p_attempted_at > v_now then
    raise exception 'a manual entry cannot be recorded for the future';
  end if;
  if public.app_business_date(p_attempted_at, v_outlet.business_day_cutover)
     is distinct from p_business_date then
    raise exception 'manual entry time does not belong to the named business date';
  end if;
  v_fingerprint := public.attendance_request_fingerprint(jsonb_build_object(
    'person', p_person_id, 'outlet', p_outlet_id, 'date', p_business_date,
    'at', p_attempted_at, 'decision', p_decision_id, 'kind', 'manual'
  ));
  select a.* into v_day
    from public.attendance_attempts at
    join public.attendance a on a.id = at.attendance_id
   where at.id = p_attempt_id and at.request_fingerprint = v_fingerprint;
  if found then return v_day; end if;
  if exists (select 1 from public.attendance_attempts where id = p_attempt_id)
     or exists (select 1 from public.attendance_decisions where id = p_decision_id) then
    raise exception 'attendance command id was reused with a changed payload';
  end if;
  select * into v_day from public.attendance
   where person_id = p_person_id and business_date = p_business_date for update;
  v_day_exists := found;
  if found and (v_day.current_attempt_id is not null or v_day.outcome_attempt_id is not null
                or v_day.check_in_at is not null) then
    raise exception 'a check-in is already recorded for this day';
  end if;
  select p.full_name into v_actor_name from public.profiles p where p.id = v_actor;
  perform set_config('app.attendance_command', 'on', true);
  if not v_day_exists then
    insert into public.attendance (outlet_id, person_id, business_date, status)
      values (p_outlet_id, p_person_id, p_business_date, 'absent') returning * into v_day;
  end if;
  insert into public.attendance_attempts (
    id, attendance_id, outlet_id, person_id, business_date, attempted_at,
    source, entered_by, entered_by_name, arrival_deadline, request_fingerprint
  ) values (
    p_attempt_id, v_day.id, p_outlet_id, p_person_id, p_business_date, p_attempted_at,
    'manual', v_actor, v_actor_name, v_outlet.arrival_deadline, v_fingerprint
  ) returning * into v_attempt;
  insert into public.attendance_decisions (
    id, attendance_id, attempt_id, outlet_id, person_id, business_date, kind,
    actor_id, actor_name, decided_at, reason, prevents_retry,
    previous_status, new_status, request_fingerprint
  ) values (
    p_decision_id, v_day.id, v_attempt.id, p_outlet_id, p_person_id, p_business_date,
    'manual_present', v_actor, v_actor_name, v_now, null, true,
    v_day.status, 'present', v_fingerprint
  );
  update public.attendance_attempts set settled_at = v_now where id = v_attempt.id;
  update public.attendance
     set outlet_id = p_outlet_id, status = 'present',
         current_attempt_id = null, outcome_attempt_id = v_attempt.id,
         latest_decision_id = p_decision_id, retry_blocked = true,
         check_in_at = p_attempted_at, check_in_lat = null, check_in_lng = null,
         check_in_accuracy_m = null, check_in_distance_m = null,
         check_in_source = 'manual', check_in_entered_by = v_actor,
         check_in_entered_by_name = v_actor_name, arrival_deadline = v_attempt.arrival_deadline,
         approved_by = v_actor, approved_by_name = v_actor_name,
         approval_reason = null, approved_at = v_now,
         approver_lat = null, approver_lng = null,
         approver_accuracy_m = null, approver_distance_m = null,
         state_version = state_version + 1
   where id = v_day.id returning * into v_day;
  perform set_config('app.attendance_command', 'off', true);
  return v_day;
end;
$$;

revoke execute on function public.attendance_record_manual(uuid, uuid, uuid, uuid, date, timestamptz) from public, anon;
grant execute on function public.attendance_record_manual(uuid, uuid, uuid, uuid, date, timestamptz) to authenticated;
