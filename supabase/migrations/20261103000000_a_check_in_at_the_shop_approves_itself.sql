-- a-check-in-at-the-shop-approves-itself (#81): a check-in the database
-- measures inside the outlet's own fence is approved automatically, and each
-- outlet's managers choose whether every check-in still needs them and whether
-- check-ins away from the shop are refused.
-- change-gate: auto-approve-at-the-shop
--
-- Every object here is new or added: two columns on `outlets`, a decision kind,
-- a column on `attendance_decisions`, two new commands, and one check widened
-- so the new kind can name no actor (design D4, agreed by the owner
-- 2026-10-26). v1 and v2 of the check-in are untouched.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('auto-approve-at-the-shop', 'AA', 'change', 'Auto-approve at the shop',
   'A check-in measured inside the outlet''s fence is approved at once, and each outlet''s managers choose whether every check-in still needs them and whether check-ins away from the shop are refused.',
   'Every check-in waits for a manager.',
   'a-check-in-at-the-shop-approves-itself', 81),
  ('refreshed-staff-screens', 'RS', 'change', 'Refreshed staff screens',
   'The staff phone''s Home, My attendance and Expenses, the counter''s and managers'' expense lists, and the manager''s By staff use the new layouts.',
   'Every screen reads as it does today.',
   'a-check-in-at-the-shop-approves-itself', 81);

insert into public.change_gate_dependencies (gate_key, depends_on)
values ('refreshed-staff-screens', 'auto-approve-at-the-shop');

-- ── An outlet's attendance rules (design D2) ────────────────────────────────
--
-- On the outlet row, as #60's service settings are, because `outlets_select`
-- already gives the row to everybody who needs it. Both off by default: off and
-- off is the new behaviour, `attendance_needs_manager` on is today's. They are
-- changed only through `set_outlet_attendance_rules` (§7), by the owner and the
-- outlet's own managers; `outlets_update` stays the owner's, because the
-- outlet's position and radius prove where a franchise trades.
alter table public.outlets
  add column attendance_needs_manager boolean not null default false,
  add column attendance_blocks_away boolean not null default false;

comment on column public.outlets.attendance_needs_manager is
  'Every check-in waits for a manager, even one measured inside the fence (#81). Off: a check-in at the shop is approved automatically.';
comment on column public.outlets.attendance_blocks_away is
  'A check-in outside the fence, or with no position, is refused and nothing is written (#81). The manager records the arrival instead.';

-- ── A decision nobody made (design D4) ──────────────────────────────────────
--
-- The fence decided, so the decision names no actor; its kind says what
-- happened, and it stamps the radius that judged it, because the attempt
-- stamps its distance and deadline but not the radius, and a radius edited
-- later would otherwise leave "it was inside" unanswerable.
alter type public.attendance_decision_kind add value if not exists 'auto_approved';

alter table public.attendance_decisions
  add column fence_radius_m integer;

comment on column public.attendance_decisions.fence_radius_m is
  'The outlet radius that judged an auto_approved decision (#81). Null on every other kind.';

-- ── The check-in, v3 (design D3) ────────────────────────────────────────────
--
-- v2's body, plus the block before any write and the settle after the
-- arrival. It reads the gate itself, so with `auto-approve-at-the-shop` off it
-- is v2 exactly: turning the gate off reaches a phone still calling v3 at once.

create function public.attendance_submit_attempt_v3(
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
  v_rules_on boolean := public.app_change_gate('auto-approve-at-the-shop');
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
  if v_rules_on and v_outlet.attendance_blocks_away then
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
  if v_rules_on
     and not v_outlet.attendance_needs_manager
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

revoke execute on function public.attendance_submit_attempt_v3(uuid, uuid, date, timestamptz, double precision, double precision, numeric, integer) from public, anon;
grant execute on function public.attendance_submit_attempt_v3(uuid, uuid, date, timestamptz, double precision, double precision, numeric, integer) to authenticated;

-- ── An outlet's attendance rules, changed (design D2) ───────────────────────
--
-- The owner anywhere, or a Franchise Admin at this outlet, as #60's service
-- settings. These two columns and nothing else: the position and radius stay
-- the owner's, through `outlets_update`.

create function public.set_outlet_attendance_rules(
  p_outlet uuid,
  p_needs_manager boolean,
  p_blocks_away boolean
)
returns public.outlets
language plpgsql security definer
set search_path = ''
as $$
declare
  v_outlet public.outlets;
begin
  if auth.uid() is null or not public.app_account_active() or not public.app_device_ok()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', p_outlet)) then
    raise exception 'only the owner or this outlet''s manager may change its attendance rules'
      using errcode = 'insufficient_privilege';
  end if;
  if p_needs_manager is null or p_blocks_away is null then
    raise exception 'both attendance rules must be given';
  end if;

  update public.outlets
     set attendance_needs_manager = p_needs_manager,
         attendance_blocks_away = p_blocks_away
   where id = p_outlet
  returning * into v_outlet;
  if not found then
    raise exception 'no such outlet' using errcode = 'no_data_found';
  end if;
  return v_outlet;
end;
$$;

comment on function public.set_outlet_attendance_rules is
  'Owner or same-outlet franchise admin writes only the two attendance rules (#81).';

revoke execute on function public.set_outlet_attendance_rules(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_outlet_attendance_rules(uuid, boolean, boolean) to authenticated;

-- ── The one widened check (design D4) ───────────────────────────────────────
--
-- Compared as text: the enum value added above cannot be cast to in the same
-- transaction that adds it.
-- release-lint: allow drop, constraint — widened so the on path can write a decision no person made; no published build writes auto_approved, and every row it accepted it still accepts
alter table public.attendance_decisions
  drop constraint attendance_decision_actor_required,
  add constraint attendance_decision_actor_required
    check (kind::text in ('legacy_outcome', 'auto_approved') or actor_id is not null);
