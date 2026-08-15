-- One manager act over an explicitly selected set of waiting attendance rows.
--
-- The roll-call already asked the adapter for a multi-row approval and the
-- adapter faked it: a loop of `attendance_approve_attempt`, one call per row,
-- minting a fresh decision id inside the loop. That loop is not atomic, so a
-- failure part way through leaves some of a morning settled and some not with
-- nothing recording that they were one act; and it is not idempotent, because a
-- retry mints new identities rather than replaying the same command.
--
-- `attendance_decide_set` replaces both single-row commands. The per-row Approve
-- and Deny buttons stay in the UI and call it with a set of one, so the reason
-- rule, the evidence rule, the authority rule and the device rule have exactly
-- one implementation rather than two.
--
-- It also closes a gap the dropped commands carried: they check
-- `app_account_active()` but never `app_device_ok()`, which every read policy on
-- `attendance_attempts` and `attendance_decisions` requires. A removed counter
-- tablet's session could not read the attendance day it would be deciding, and
-- could still settle rows on it through a hand-crafted request.

-- ---------------------------------------------------------------------------
-- 1. The batch identity.
--
-- Added now rather than later because `attendance_decisions` is sealed by
-- `attendance_decision_guard()`, which refuses every update and delete: a column
-- retrofitted afterwards is a second migration against live rows that could not
-- be backfilled anyway. Rows written before this change stay null, because those
-- decisions were made one at a time and inventing a batch for them would be
-- fiction.

alter table public.attendance_decisions add column command_id uuid;

comment on column public.attendance_decisions.command_id is
  'The one manager action that wrote this decision. Shared by every decision in '
  'a set, null for a decision made by a single-row command or before sets '
  'existed. It correlates decisions; it never replaces them.';

create index attendance_decisions_command_id_idx
  on public.attendance_decisions (command_id)
  where command_id is not null;

-- ---------------------------------------------------------------------------
-- 2. The command.

create or replace function public.attendance_decide_set(
  p_command_id uuid,
  p_action text,
  p_items jsonb,
  p_reason text default null,
  p_prevent_retry boolean default false,
  p_manager_lat double precision default null,
  p_manager_lng double precision default null,
  p_manager_accuracy_m numeric default null
)
returns setof public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_reason text := nullif(btrim(p_reason), '');
  v_prevent boolean := coalesce(p_prevent_retry, false);
  v_now timestamptz := now();
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_count integer;
  v_ids uuid[];
  v_decisions uuid[];
  v_fingerprint text;
  v_seen_actor uuid;
  v_seen_fingerprint text;
  v_item record;
  v_day public.attendance;
  v_attempt public.attendance_attempts;
  v_outlet public.outlets;
  v_distance numeric;
  v_needs_reason boolean;
  v_stored_reason text;
begin
  if p_action is null or p_action not in ('approve', 'deny') then
    raise exception 'unknown attendance decision action';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'a decision set must name at least one row';
  end if;

  -- The bound is checked before anything is read or locked, so a hand-crafted
  -- request cannot ask one transaction to lock an unbounded set. A day's
  -- roll-call is far smaller than this; a surface that legitimately needs more
  -- raises it deliberately rather than discovering there was never a bound.
  v_count := jsonb_array_length(v_items);
  if v_count > 100 then
    raise exception 'a decision set carries at most 100 rows';
  end if;

  select array_agg((item->>'attendance_id')::uuid),
         array_agg((item->>'decision_id')::uuid)
    into v_ids, v_decisions
    from jsonb_array_elements(v_items) as item;

  if v_ids is null or array_position(v_ids, null) is not null
     or v_decisions is null or array_position(v_decisions, null) is not null then
    raise exception 'a decision set item must name a row and a decision';
  end if;
  if v_count <> (select count(distinct value) from unnest(v_ids) as value) then
    raise exception 'a decision set names one row twice';
  end if;
  if v_count <> (select count(distinct value) from unnest(v_decisions) as value) then
    raise exception 'a decision set names one decision twice';
  end if;

  -- The fingerprint covers the WHOLE payload, with the items in a stable order,
  -- so a replayed command id has to be replaying the same act. Facts the chosen
  -- action ignores are normalised away rather than compared: a denial stores no
  -- position and an approval reads no retry choice, so neither should make an
  -- otherwise identical replay look like a different request.
  v_fingerprint := public.attendance_request_fingerprint(jsonb_build_object(
    'kind', 'decide_set',
    'action', p_action,
    'items', (select jsonb_agg(jsonb_build_object(
                       'attendance', item->>'attendance_id',
                       'attempt', item->>'attempt_id',
                       'version', (item->>'expected_version')::integer,
                       'decision', item->>'decision_id')
                     order by item->>'attendance_id')
                from jsonb_array_elements(v_items) as item),
    'reason', v_reason,
    'prevent', case when p_action = 'deny' then v_prevent else null end,
    'lat', case when p_action = 'approve' then p_manager_lat else null end,
    'lng', case when p_action = 'approve' then p_manager_lng else null end,
    'accuracy', case when p_action = 'approve' then p_manager_accuracy_m else null end
  ));

  -- Replay. The response to the first call may simply have been lost, and the
  -- honest answer to the same act arriving twice is the rows it settled.
  select d.actor_id, d.request_fingerprint
    into v_seen_actor, v_seen_fingerprint
    from public.attendance_decisions d
   where d.command_id = p_command_id
   limit 1;
  if found then
    if v_seen_actor is distinct from v_actor
       or v_seen_fingerprint is distinct from v_fingerprint then
      raise exception 'command id was reused with a changed payload';
    end if;
    return query
      select a.*
        from public.attendance a
       where a.id in (select d.attendance_id
                        from public.attendance_decisions d
                       where d.command_id = p_command_id)
       order by a.id;
    return;
  end if;

  -- The same enrolled-device condition reading the attendance day already
  -- requires. It passes for every ordinary person session and fails only for a
  -- counter tablet that has been removed.
  if v_actor is null or not public.app_account_active() or not public.app_device_ok() then
    raise exception 'attendance decisions are not permitted from this session'
      using errcode = 'insufficient_privilege';
  end if;

  if p_action = 'deny' and v_reason is null then
    raise exception 'a denial requires a reason';
  end if;
  if p_action = 'approve' and ((p_manager_lat is null) <> (p_manager_lng is null)) then
    raise exception 'approver coordinates must be paired';
  end if;

  -- A decision id that already exists and did not come from this command is a
  -- spent identity being carried into a different act.
  if exists (
    select 1 from public.attendance_decisions d where d.id = any(v_decisions)
  ) then
    raise exception 'decision id was reused with a changed payload';
  end if;

  -- Deterministic lock order, in one statement, before any decision is
  -- appended: a set and a concurrent single decision then acquire rows in the
  -- same order and cannot deadlock each other.
  perform 1 from public.attendance a where a.id = any(v_ids) order by a.id for update;

  -- Pass one: authority for every named row, before anything about state is
  -- reported back. The surface lists only readable rows; the database validates
  -- the set it was actually handed.
  for v_item in
    select (item->>'attendance_id')::uuid as attendance_id
      from jsonb_array_elements(v_items) as item
     order by (item->>'attendance_id')::uuid
  loop
    select * into v_day from public.attendance where id = v_item.attendance_id;
    if not found then
      raise exception 'attendance state is stale';
    end if;
    if not (public.app_is_owner()
            or public.app_has_role_at('franchise_admin', v_day.outlet_id)) then
      raise exception 'only a manager for this outlet may decide attendance'
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  -- Pass two: the complete set is validated before the first insert. Any
  -- failure refuses the whole command and leaves every selected row as it was.
  for v_item in
    select (item->>'attendance_id')::uuid as attendance_id,
           (item->>'attempt_id')::uuid as attempt_id,
           (item->>'expected_version')::integer as expected_version
      from jsonb_array_elements(v_items) as item
     order by (item->>'attendance_id')::uuid
  loop
    select * into v_day from public.attendance where id = v_item.attendance_id;
    if v_day.current_attempt_id is distinct from v_item.attempt_id
       or v_day.state_version is distinct from v_item.expected_version then
      raise exception 'attendance state is stale';
    end if;
    select * into v_attempt from public.attendance_attempts where id = v_item.attempt_id;
    if not found then
      raise exception 'attendance state is stale';
    end if;
    if not (public.app_is_owner()
            or public.app_has_role_at('franchise_admin', v_attempt.outlet_id)) then
      raise exception 'only a manager for this outlet may decide attendance'
        using errcode = 'insufficient_privilege';
    end if;

    if p_action = 'approve' then
      select * into v_outlet from public.outlets where id = v_attempt.outlet_id;
      v_distance := public.app_distance_m(
        v_outlet.latitude, v_outlet.longitude, p_manager_lat, p_manager_lng
      );
      -- One reading, measured against THIS row's own outlet and judged against
      -- THIS row's own business day. Measuring one instant against several fixed
      -- points is arithmetic, not a claim to have occupied all of them.
      if not (v_distance is not null
              and v_distance <= v_outlet.geofence_radius_m
              and v_day.business_date = public.app_business_date(v_now, v_outlet.business_day_cutover))
         and v_reason is null then
        raise exception 'an approval from away from the outlet, or after the row''s own business day, requires a reason';
      end if;
    end if;
  end loop;

  select p.full_name into v_actor_name from public.profiles p where p.id = v_actor;

  perform set_config('app.attendance_command', 'on', true);
  for v_item in
    select (item->>'attendance_id')::uuid as attendance_id,
           (item->>'attempt_id')::uuid as attempt_id,
           (item->>'decision_id')::uuid as decision_id
      from jsonb_array_elements(v_items) as item
     order by (item->>'attendance_id')::uuid
  loop
    select * into v_day from public.attendance where id = v_item.attendance_id;
    select * into v_attempt from public.attendance_attempts where id = v_item.attempt_id;
    select * into v_outlet from public.outlets where id = v_attempt.outlet_id;

    if p_action = 'approve' then
      v_distance := public.app_distance_m(
        v_outlet.latitude, v_outlet.longitude, p_manager_lat, p_manager_lng
      );
      v_needs_reason := not (
        v_distance is not null
        and v_distance <= v_outlet.geofence_radius_m
        and v_day.business_date = public.app_business_date(v_now, v_outlet.business_day_cutover)
      );
      -- The shared reason is stored only where the rule asked for it. A row
      -- approved on the plain terms keeps none, exactly as a single on-site
      -- approval does today.
      v_stored_reason := case when v_needs_reason then v_reason else null end;

      insert into public.attendance_decisions (
        id, attendance_id, attempt_id, outlet_id, person_id, business_date, kind,
        actor_id, actor_name, decided_at, reason, prevents_retry,
        previous_status, new_status,
        manager_lat, manager_lng, manager_accuracy_m, manager_distance_m,
        request_fingerprint, command_id
      ) values (
        v_item.decision_id, v_day.id, v_attempt.id, v_attempt.outlet_id, v_day.person_id,
        v_day.business_date, 'approve', v_actor, v_actor_name, v_now,
        v_stored_reason, true, v_day.status, 'present',
        p_manager_lat, p_manager_lng, p_manager_accuracy_m, v_distance,
        v_fingerprint, p_command_id
      );
      update public.attendance_attempts set settled_at = v_now where id = v_attempt.id;
      update public.attendance
         set outlet_id = v_attempt.outlet_id,
             status = 'present', current_attempt_id = null,
             outcome_attempt_id = v_attempt.id, latest_decision_id = v_item.decision_id,
             retry_blocked = true,
             approved_by = v_actor, approved_by_name = v_actor_name,
             approval_reason = v_stored_reason, approved_at = v_now,
             approver_lat = p_manager_lat, approver_lng = p_manager_lng,
             approver_accuracy_m = p_manager_accuracy_m, approver_distance_m = v_distance,
             state_version = state_version + 1
       where id = v_day.id;
    else
      -- Denial says the attempt should not count. It does not vouch that the
      -- manager stood anywhere, so any position handed to it is discarded
      -- rather than recorded.
      insert into public.attendance_decisions (
        id, attendance_id, attempt_id, outlet_id, person_id, business_date, kind,
        actor_id, actor_name, decided_at, reason, prevents_retry,
        previous_status, new_status, request_fingerprint, command_id
      ) values (
        v_item.decision_id, v_day.id, v_attempt.id, v_attempt.outlet_id, v_day.person_id,
        v_day.business_date, 'deny', v_actor, v_actor_name, v_now, v_reason,
        v_prevent, v_day.status, 'absent', v_fingerprint, p_command_id
      );
      update public.attendance_attempts set settled_at = v_now where id = v_attempt.id;
      update public.attendance
         set outlet_id = v_attempt.outlet_id,
             status = 'absent', current_attempt_id = null,
             outcome_attempt_id = v_attempt.id, latest_decision_id = v_item.decision_id,
             retry_blocked = v_prevent,
             approved_by = null, approved_by_name = null, approval_reason = null,
             approved_at = null, approver_lat = null, approver_lng = null,
             approver_accuracy_m = null, approver_distance_m = null,
             state_version = state_version + 1
       where id = v_day.id;
    end if;
  end loop;
  perform set_config('app.attendance_command', 'off', true);

  return query select a.* from public.attendance a where a.id = any(v_ids) order by a.id;
end;
$$;

revoke execute on function public.attendance_decide_set(
  uuid, text, jsonb, text, boolean, double precision, double precision, numeric
) from public, anon;
grant execute on function public.attendance_decide_set(
  uuid, text, jsonb, text, boolean, double precision, double precision, numeric
) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. One write path, not three.
--
-- Keeping the single-row commands would leave an unused write path carrying its
-- own copy of the reason rule and its own missing device check, which is the
-- silent over-permission a green functional suite does not describe. Their only
-- caller is the adapter this change rewrites.

drop function public.attendance_approve_attempt(
  uuid, uuid, uuid, integer, text, double precision, double precision, numeric
);
drop function public.attendance_deny_attempt(uuid, uuid, uuid, integer, text, boolean);
