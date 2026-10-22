-- staff-roles-include-other-roles: which staff role includes which, written
-- down once as plain rows, and asked by every check of what a staff member may
-- do instead of naming roles; and the change gate that turns those checks on.
-- change-gate: role-includes
--
-- Every object here is new. On and Off give the same answer to every role that
-- exists (design D7): the gate is a safety switch for the new code path, not a
-- feature. Each `_v2` below is its original's latest body with only the role
-- comparison replaced, generated and asserted line by line, so a reviewer diffs
-- two bodies and sees that line alone.
--
-- What waits for the cleanup (design D4): `expense_guard`, the trigger on
-- `expenses`; `account_actor_may_replace_set`, read by the Team functions the
-- admin-accounts Edge Function calls; and `app_may_hold_counter_shift`, read by
-- six counter-shift functions. Each is rewritten in place by the contract
-- migration, through the helpers this migration exercises in production first.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name)
values
  ('role-includes', 'RI', 'change', 'Role includes',
   'Who counts as staff, and who may hold a counter, is answered by which roles include which, everywhere the database asks.',
   'Each check names Employee and Biller itself.',
   'staff-roles-include-other-roles');

-- ── Staff roles, and which includes which (design D1) ───────────────────────
--
-- A staff role is a role a person holds to work at an outlet. A role includes
-- another when it can do everything the other can: a Biller includes an
-- Employee. A role may include any number of others, and be included by any
-- number, so the roles form a tree that may branch, never a numbered line.
-- Managers and the owner are not staff roles; their authority is their own and
-- unchanged.
create table public.staff_roles (
  role public.app_role primary key,
  constraint staff_roles_not_management check (role not in ('super_admin', 'franchise_admin'))
);

comment on table public.staff_roles is
  'The roles a person holds to work at an outlet. Added to by a migration, never by a client.';

create table public.staff_role_includes (
  role public.app_role not null references public.staff_roles (role),
  includes public.app_role not null references public.staff_roles (role),
  primary key (role, includes),
  constraint staff_role_includes_not_itself check (role <> includes)
);

comment on table public.staff_role_includes is
  'One row says one thing: this staff role can do everything that one can. Read transitively, so a role includes whatever the roles it includes include.';

insert into public.staff_roles (role) values ('employee'), ('biller');
insert into public.staff_role_includes (role, includes) values ('biller', 'employee');

-- A row that would make a role include itself through others is refused: the
-- roles must stay a tree that can be walked down and always ends.
create function public.staff_role_includes_no_loop()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    with recursive below(role) as (
      select new.includes
      union
      select i.includes from public.staff_role_includes i join below b on i.role = b.role
    )
    select 1 from below where role = new.role
  ) then
    raise exception '% already includes %, so % cannot include it', new.includes, new.role, new.role
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger staff_role_includes_no_loop
  before insert or update on public.staff_role_includes
  for each row execute function public.staff_role_includes_no_loop();

alter table public.staff_roles enable row level security;
alter table public.staff_role_includes enable row level security;

create policy staff_roles_select on public.staff_roles
  for select to authenticated using (true);
create policy staff_role_includes_select on public.staff_role_includes
  for select to authenticated using (true);

revoke insert, update, delete on public.staff_roles from authenticated, anon;
revoke insert, update, delete on public.staff_role_includes from authenticated, anon;

-- Whether a held role includes the required one: it is that role, or a role it
-- includes, followed down any number of rows. False, never null, when either is
-- not a staff role, so a manager check cannot be written through it.
create function public.app_role_includes(p_held public.app_role, p_required public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff_roles r where r.role = p_held)
     and exists (select 1 from public.staff_roles r where r.role = p_required)
     and (
       p_held = p_required
       or exists (
         with recursive below(role) as (
           select i.includes from public.staff_role_includes i where i.role = p_held
           union
           select i.includes from public.staff_role_includes i join below b on i.role = b.role
         )
         select 1 from below where role = p_required
       )
     )
$$;

-- Whether the caller can act as the required role at this outlet: they hold a
-- live assignment there whose role includes it. The scalar form, for function
-- bodies and triggers.
create function public.app_acts_as(p_required public.app_role, p_outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
     where a.person_id = auth.uid()
       and a.ended_on is null
       and a.outlet_id = p_outlet
       and public.app_role_includes(a.role, p_required)
  )
$$;

-- The outlets where the caller can act as the required role. Set-returning,
-- for `outlet_id in (select …)` policies, the shape `app_outlets_for` has.
create function public.app_outlets_acting_as(p_required public.app_role)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.outlet_id
    from public.assignments a
   where a.person_id = auth.uid()
     and a.ended_on is null
     and a.outlet_id is not null
     and public.app_role_includes(a.role, p_required)
$$;

revoke execute on function public.app_role_includes(public.app_role, public.app_role) from public, anon;
revoke execute on function public.app_acts_as(public.app_role, uuid) from public, anon;
revoke execute on function public.app_outlets_acting_as(public.app_role) from public, anon;
grant execute on function public.app_role_includes(public.app_role, public.app_role) to authenticated;
grant execute on function public.app_acts_as(public.app_role, uuid) to authenticated;
grant execute on function public.app_outlets_acting_as(public.app_role) to authenticated;

-- ── Functions a build calls (design D2) ─────────────────────────────────────


-- Check-in: staff here, anyone who can act as an Employee.

create function public.attendance_submit_attempt_v2(
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
     or not public.app_acts_as('employee', p_outlet_id) then
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

revoke execute on function public.attendance_submit_attempt_v2(uuid, uuid, date, timestamptz, double precision, double precision, numeric, integer) from public, anon;
grant execute on function public.attendance_submit_attempt_v2(uuid, uuid, date, timestamptz, double precision, double precision, numeric, integer) to authenticated;

-- A manager's manual entry: the person held a role that includes Employee.

create function public.attendance_record_manual_v2(
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
       and public.app_role_includes(a.role, 'employee')
       and a.ended_on is null
  ) then
    raise exception 'person is not current staff at this outlet';
  end if;
  if not exists (
    select 1
      from public.assignments a
     where a.person_id = p_person_id
       and a.outlet_id = p_outlet_id
       and public.app_role_includes(a.role, 'employee')
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

revoke execute on function public.attendance_record_manual_v2(uuid, uuid, uuid, uuid, date, timestamptz) from public, anon;
grant execute on function public.attendance_record_manual_v2(uuid, uuid, uuid, uuid, date, timestamptz) to authenticated;

-- Who on a manager's roll-call checked in elsewhere: roles that include Employee.

create function public.attendance_elsewhere_v2(
  p_outlets uuid[],
  p_business_date date
)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope uuid[];
begin
  -- Same two gates the select policy opens with, so a deactivated account or a
  -- revoked counter device learns nothing here that it could not read directly.
  if not public.app_account_active() or not public.app_device_ok() then
    return;
  end if;

  -- Intersect rather than refuse. The owner reads every outlet; everybody else
  -- reads the ones they hold a live Franchise Admin assignment at, which is
  -- exactly the set `attendance_select` would have returned rows for.
  if (select public.app_is_owner()) then
    v_scope := p_outlets;
  else
    select coalesce(array_agg(o), '{}')
      into v_scope
      from unnest(p_outlets) as o
     where public.app_has_role_at('franchise_admin', o);
  end if;

  if v_scope is null or cardinality(v_scope) = 0 then
    return;
  end if;

  return query
    select distinct a.person_id
      from public.attendance a
     where a.business_date = p_business_date
       and not (a.outlet_id = any (v_scope))
       -- On one of the caller's own staff lists. Somebody they do not already
       -- see on their roll-call is not somebody this may say anything about.
       -- Staff, for attendance, is an Employee or a Biller assignment.
       and exists (
         select 1
           from public.assignments s
          where s.person_id = a.person_id
            and s.outlet_id = any (v_scope)
            and public.app_role_includes(s.role, 'employee')
            and s.ended_on is null
       );
end;
$$;

revoke execute on function public.attendance_elsewhere_v2(uuid[], date) from public, anon;
grant execute on function public.attendance_elsewhere_v2(uuid[], date) to authenticated;

-- The names on the expense list: anyone here who can act as an Employee.

create function public.expense_people_v2()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name
    from public.profiles p
   where public.app_account_active()
     and exists (
       select 1 from public.expenses e
        where p.id in (e.recorded_by, e.updated_by, e.voided_by)
          and (
            (select public.app_is_owner())
            or e.outlet_id in (select public.app_outlets_for('franchise_admin'))
            or public.app_acts_as('employee', e.outlet_id)
          )
     )
$$;

revoke execute on function public.expense_people_v2() from public, anon;
grant execute on function public.expense_people_v2() to authenticated;

-- A flagged bill re-attributed: the operator held a role that includes Biller that day.

create function public.review_billing_attribution_v2(
  p_bill_id uuid,
  p_outcome text,
  p_resolved_operator_id uuid default null,
  p_reason text default null
)
returns public.billing_attribution_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.bills%rowtype;
  v_review public.billing_attribution_reviews%rowtype;
begin
  if auth.uid() is null or not public.app_account_active() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select * into v_bill from public.bills where id = p_bill_id;
  if not found or not v_bill.recorded_after_shift_end then
    raise exception 'no flagged bill' using errcode = 'P0001';
  end if;
  if not ((select public.app_is_owner())
      or public.app_has_role_at('franchise_admin', v_bill.outlet_id)) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_outcome = 'confirmed_original' then
    p_resolved_operator_id := v_bill.biller_profile_id;
    p_reason := null;
  elsif p_outcome = 'assigned_other' then
    if p_resolved_operator_id is null or p_resolved_operator_id = v_bill.biller_profile_id
       or not exists (
         select 1 from public.assignments a
          where a.person_id = p_resolved_operator_id
            and a.outlet_id = v_bill.outlet_id
            and public.app_role_includes(a.role, 'biller')
            and a.started_on <= v_bill.business_date
            and (a.ended_on is null or a.ended_on >= v_bill.business_date)
       ) then
      raise exception 'the selected person was not an eligible biller for this outlet and date'
        using errcode = 'P0001';
    end if;
    p_reason := null;
  elsif p_outcome = 'operator_unknown' then
    p_resolved_operator_id := null;
    p_reason := nullif(btrim(p_reason), '');
    if p_reason is null then
      raise exception 'a reason is required when the operator is unknown' using errcode = 'P0001';
    end if;
  else
    raise exception 'invalid attribution outcome' using errcode = 'P0001';
  end if;

  insert into public.billing_attribution_reviews (
    outlet_id, bill_id, original_operator_id, outcome,
    resolved_operator_id, reason, reviewed_by)
  values (
    v_bill.outlet_id, v_bill.id, v_bill.biller_profile_id, p_outcome,
    p_resolved_operator_id, p_reason, auth.uid())
  returning * into v_review;
  return v_review;
exception when unique_violation then
  raise exception 'this attribution exception has already been reviewed' using errcode = 'P0001';
end;
$$;

revoke execute on function public.review_billing_attribution_v2(uuid, text, uuid, text) from public, anon;
grant execute on function public.review_billing_attribution_v2(uuid, text, uuid, text) to authenticated;

-- Whom a person may see on Team and the rail: a manager, or anyone holding a
-- role that includes Biller, at a shared outlet. Read by
-- profiles_select_includes below.

create function public.app_may_see_person_v2(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.assignments target
      join public.assignments mine on mine.outlet_id = target.outlet_id
     where target.person_id = person
       and target.ended_on is null
       and mine.person_id = auth.uid()
       and mine.ended_on is null
       and (mine.role = 'franchise_admin' or public.app_role_includes(mine.role, 'biller'))
  )
$$;

revoke execute on function public.app_may_see_person_v2(uuid) from public, anon;
grant execute on function public.app_may_see_person_v2(uuid) to authenticated;

-- ── Policies: a gated twin beside each (design D3) ──────────────────────────
--
-- Permissive policies combine by OR, so with the gate on a row is admitted if
-- either policy admits it, and for every role that exists both admit the same
-- rows. supabase/tests/98_staff_roles_include_other_roles.sql proves each twin
-- alone, with its original dropped inside a subtransaction.

create policy assignments_insert_includes on public.assignments
  for insert to authenticated
  with check (
    (select public.app_change_gate('role-includes')) and (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or (
        public.app_role_includes(role, 'employee')
        and outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  ));

create policy assignments_update_includes on public.assignments
  for update to authenticated
  using (
    (select public.app_change_gate('role-includes')) and (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or (
        public.app_role_includes(role, 'employee')
        and outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  )
  )
  with check (
    (select public.app_change_gate('role-includes')) and (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or (
        public.app_role_includes(role, 'employee')
        and outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  ));

create policy expense_categories_insert_includes on public.expense_categories
  for insert to authenticated
  with check (
    (select public.app_change_gate('role-includes')) and (
    public.app_account_active()
    and created_by = auth.uid()
    and (
      (select public.app_is_owner())
      or exists (select 1 from public.app_outlets_for('franchise_admin'))
      or exists (select 1 from public.app_outlets_acting_as('employee'))
    )
  ));

create policy expenses_insert_includes on public.expenses
  for insert to authenticated
  with check (
    (select public.app_change_gate('role-includes')) and (
    (outlet_id = (select public.app_counter_shift_outlet()) and is_cash)
    or (
      public.app_account_active()
      and recorded_by = auth.uid()
      and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
        or (
          public.app_acts_as('employee', outlet_id)
          and is_cash
        )
      )
    )
  ));

create policy expenses_select_includes on public.expenses
  for select to authenticated
  using (
    (select public.app_change_gate('role-includes')) and (
    (outlet_id = (select public.app_counter_shift_outlet()) and is_cash)
    or (
      public.app_account_active()
      and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
        or (
          public.app_acts_as('employee', outlet_id)
          and is_cash
        )
      )
    )
  ));

create policy expenses_update_includes on public.expenses
  for update to authenticated
  using (
    (select public.app_change_gate('role-includes')) and (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or (
        recorded_by = auth.uid()
        and public.app_acts_as('employee', outlet_id)
        and is_cash
      )
    )
  )
  )
  with check (
    (select public.app_change_gate('role-includes')) and (
    public.app_account_active()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or (
        recorded_by = auth.uid()
        and public.app_acts_as('employee', outlet_id)
        and is_cash
      )
    )
  ));

create policy menu_categories_select_includes on public.menu_categories
  for select to authenticated using (
    (select public.app_change_gate('role-includes')) and (
    public.app_device_ok() and (
      outlet_id = (select public.app_counter_shift_outlet())
      or outlet_id = (select public.app_kitchen_shift_outlet())
      or (public.app_account_active() and (
        (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
        or outlet_id in (select public.app_outlets_acting_as('biller')))))));

create policy menu_discounts_select_includes on public.menu_discounts
  for select to authenticated
  using (
    (select public.app_change_gate('role-includes')) and (
    public.app_device_ok()
    and (
      outlet_id = (select public.app_counter_shift_outlet())
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
          or outlet_id in (select public.app_outlets_acting_as('biller'))
        )
      )
    )
  ));

create policy menu_items_select_includes on public.menu_items
  for select to authenticated
  using (
    (select public.app_change_gate('role-includes')) and (
    public.app_device_ok()
    and (
      outlet_id = (select public.app_counter_shift_outlet())
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
          or outlet_id in (select public.app_outlets_acting_as('biller'))
        )
      )
    )
  ));

create policy profiles_select_includes on public.profiles
  for select to authenticated
  using (
    (select public.app_change_gate('role-includes')) and (
    public.app_account_active()
    and public.app_device_ok()
    and (
      id = auth.uid()
      or (select public.app_is_owner())
      or public.app_may_see_person_v2(id)
    )
  ));
