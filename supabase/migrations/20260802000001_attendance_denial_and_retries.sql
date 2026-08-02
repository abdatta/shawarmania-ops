-- Attendance denial and retries: one outcome, several immutable claims and decisions.
--
-- `attendance` remains the canonical person/business-date row. Attempts and
-- decisions carry the evidence that used to be overwritten or impossible to
-- express. Authenticated writes enter through the commands at the bottom so a
-- cross-outlet retry is one transaction and one RLS boundary.

create type public.attendance_decision_kind as enum (
  'approve',
  'deny',
  'correct_present',
  'correct_absent',
  'allow_retry',
  'absent_allow_retry',
  'manual_present',
  'legacy_outcome'
);

alter table public.attendance
  add column state_version integer not null default 0,
  add column current_attempt_id uuid,
  add column outcome_attempt_id uuid,
  add column latest_decision_id uuid,
  add column retry_blocked boolean not null default false;

create table public.attendance_attempts (
  id uuid primary key,
  attendance_id uuid not null references public.attendance (id),
  outlet_id uuid not null references public.outlets (id),
  person_id uuid not null references public.profiles (id),
  business_date date not null,
  attempted_at timestamptz not null,
  latitude double precision,
  longitude double precision,
  accuracy_m numeric,
  distance_m numeric,
  source public.check_in_source not null,
  entered_by uuid references public.profiles (id),
  entered_by_name text,
  arrival_deadline time not null,
  superseded_at timestamptz,
  settled_at timestamptz,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint attendance_attempt_position_paired
    check ((latitude is null) = (longitude is null)),
  constraint attendance_attempt_accuracy_nonnegative
    check (accuracy_m is null or accuracy_m >= 0),
  constraint attendance_attempt_distance_nonnegative
    check (distance_m is null or distance_m >= 0),
  constraint attendance_attempt_enterer_paired
    check ((entered_by is null) = (entered_by_name is null)),
  constraint attendance_attempt_manual_shape
    check (
      (source = 'manual' and entered_by is not null
        and latitude is null and longitude is null and accuracy_m is null and distance_m is null)
      or (source <> 'manual' and entered_by is null)
    ),
  constraint attendance_attempt_identity_unique
    unique (id, attendance_id),
  constraint attendance_attempt_day_unique
    unique (id, attendance_id, person_id, business_date)
);

create index attendance_attempts_attendance_time_idx
  on public.attendance_attempts (attendance_id, attempted_at, created_at);
create index attendance_attempts_outlet_day_idx
  on public.attendance_attempts (outlet_id, business_date);
create index attendance_attempts_person_day_idx
  on public.attendance_attempts (person_id, business_date);

create table public.attendance_decisions (
  id uuid primary key,
  attendance_id uuid not null references public.attendance (id),
  attempt_id uuid,
  outlet_id uuid not null references public.outlets (id),
  person_id uuid not null references public.profiles (id),
  business_date date not null,
  kind public.attendance_decision_kind not null,
  actor_id uuid references public.profiles (id),
  actor_name text,
  decided_at timestamptz not null default now(),
  reason text,
  prevents_retry boolean not null,
  previous_status public.attendance_status not null,
  new_status public.attendance_status not null,
  manager_lat double precision,
  manager_lng double precision,
  manager_accuracy_m numeric,
  manager_distance_m numeric,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint attendance_decision_actor_paired
    check ((actor_id is null) = (actor_name is null)),
  constraint attendance_decision_actor_required
    check (kind = 'legacy_outcome' or actor_id is not null),
  constraint attendance_decision_reason_not_blank
    check (reason is null or length(btrim(reason)) > 0),
  constraint attendance_decision_reason_required
    check (
      kind not in ('deny', 'correct_present', 'correct_absent', 'allow_retry', 'absent_allow_retry')
      or reason is not null
    ),
  constraint attendance_decision_manager_position_paired
    check ((manager_lat is null) = (manager_lng is null)),
  constraint attendance_decision_manager_position_scope
    check (
      kind in ('approve', 'correct_present')
      or (manager_lat is null and manager_lng is null
          and manager_accuracy_m is null and manager_distance_m is null)
    ),
  constraint attendance_decision_manager_accuracy_nonnegative
    check (manager_accuracy_m is null or manager_accuracy_m >= 0),
  constraint attendance_decision_manager_distance_nonnegative
    check (manager_distance_m is null or manager_distance_m >= 0),
  constraint attendance_decision_retry_semantics
    check (
      (kind in ('allow_retry', 'absent_allow_retry') and not prevents_retry)
      or kind = 'deny'
      or (kind not in ('allow_retry', 'absent_allow_retry', 'deny') and prevents_retry)
    ),
  constraint attendance_decision_identity_unique
    unique (id, attendance_id),
  constraint attendance_decision_day_unique
    unique (id, attendance_id, person_id, business_date),
  constraint attendance_decision_attempt_same_day
    foreign key (attempt_id, attendance_id, person_id, business_date)
    references public.attendance_attempts (id, attendance_id, person_id, business_date)
);

create index attendance_decisions_attendance_time_idx
  on public.attendance_decisions (attendance_id, decided_at, created_at);
create index attendance_decisions_outlet_day_idx
  on public.attendance_decisions (outlet_id, business_date);
create index attendance_decisions_person_day_idx
  on public.attendance_decisions (person_id, business_date);

alter table public.attendance_attempts enable row level security;
alter table public.attendance_decisions enable row level security;

create policy attendance_attempts_select on public.attendance_attempts
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or person_id = auth.uid()
    )
  );

create policy attendance_decisions_select on public.attendance_decisions
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))
      or person_id = auth.uid()
    )
  );

grant select on public.attendance_attempts, public.attendance_decisions to authenticated;
grant all on public.attendance_attempts, public.attendance_decisions to service_role;
revoke all on public.attendance_attempts, public.attendance_decisions from anon;

-- Backfill before the insert guard exists: historical distances and deadlines
-- are facts, and must not be recomputed against a position edited later.
insert into public.attendance_attempts (
  id, attendance_id, outlet_id, person_id, business_date, attempted_at,
  latitude, longitude, accuracy_m, distance_m, source,
  entered_by, entered_by_name, arrival_deadline, request_fingerprint, created_at
)
select a.id, a.id, a.outlet_id, a.person_id, a.business_date, a.check_in_at,
       a.check_in_lat, a.check_in_lng, a.check_in_accuracy_m, a.check_in_distance_m,
       a.check_in_source, a.check_in_entered_by, a.check_in_entered_by_name,
       coalesce(a.arrival_deadline, o.arrival_deadline),
       'legacy-attempt:' || a.id::text, a.created_at
  from public.attendance a
  join public.outlets o on o.id = a.outlet_id
 where a.check_in_at is not null;

insert into public.attendance_decisions (
  id, attendance_id, attempt_id, outlet_id, person_id, business_date, kind,
  actor_id, actor_name, decided_at, reason, prevents_retry,
  previous_status, new_status,
  manager_lat, manager_lng, manager_accuracy_m, manager_distance_m,
  request_fingerprint
)
select gen_random_uuid(), a.id,
       case when a.check_in_at is null then null else a.id end,
       a.outlet_id, a.person_id, a.business_date,
       case
         when a.approved_by is not null and a.check_in_source = 'manual'
           then 'manual_present'::public.attendance_decision_kind
         when a.approved_by is not null
           then 'approve'::public.attendance_decision_kind
         else 'legacy_outcome'::public.attendance_decision_kind
       end,
       a.approved_by, a.approved_by_name,
       coalesce(a.approved_at, a.check_in_at, a.created_at),
       a.approval_reason,
       true,
       case when a.status = 'present' then 'absent'::public.attendance_status else a.status end,
       a.status,
       a.approver_lat, a.approver_lng, a.approver_accuracy_m, a.approver_distance_m,
       'legacy-decision:' || a.id::text
  from public.attendance a
 where a.approved_by is not null
    or (a.check_in_at is not null and a.status <> 'absent')
    or (a.check_in_at is null and a.status <> 'absent');

update public.attendance a
   set current_attempt_id = case
         when a.check_in_at is not null and a.approved_by is null and a.status = 'absent'
           then a.id
         else null
       end,
       outcome_attempt_id = case
         when a.check_in_at is not null
          and (a.approved_by is not null or a.status <> 'absent') then a.id
         else null
       end,
       latest_decision_id = (
         select x.id
           from public.attendance_decisions x
          where x.attendance_id = a.id
          order by x.decided_at desc, x.id desc
          limit 1
       ),
       retry_blocked = exists (
         select 1 from public.attendance_decisions x where x.attendance_id = a.id
       ),
       state_version = 1
 where exists (
   select 1 from public.attendance_decisions x where x.attendance_id = a.id
 );

-- Rows with no decision were skipped by the lateral update.
update public.attendance a
   set current_attempt_id = case
         when a.check_in_at is not null and a.approved_by is null and a.status = 'absent'
           then a.id
         else null
       end,
       retry_blocked = false,
       state_version = 1
 where a.state_version = 0;

alter table public.attendance
  add constraint attendance_current_attempt_fkey
    foreign key (current_attempt_id) references public.attendance_attempts (id),
  add constraint attendance_outcome_attempt_fkey
    foreign key (outcome_attempt_id) references public.attendance_attempts (id),
  add constraint attendance_latest_decision_fkey
    foreign key (latest_decision_id) references public.attendance_decisions (id),
  add constraint attendance_state_version_positive check (state_version >= 0),
  add constraint attendance_canonical_day_unique unique (id, person_id, business_date);

alter table public.attendance_attempts
  add constraint attendance_attempt_canonical_day
    foreign key (attendance_id, person_id, business_date)
    references public.attendance (id, person_id, business_date);

alter table public.attendance_decisions
  add constraint attendance_decision_canonical_day
    foreign key (attendance_id, person_id, business_date)
    references public.attendance (id, person_id, business_date);

alter table public.attendance
  add constraint attendance_current_attempt_same_day
    foreign key (current_attempt_id, id)
    references public.attendance_attempts (id, attendance_id),
  add constraint attendance_outcome_attempt_same_day
    foreign key (outcome_attempt_id, id)
    references public.attendance_attempts (id, attendance_id),
  add constraint attendance_latest_decision_same_day
    foreign key (latest_decision_id, id)
    references public.attendance_decisions (id, attendance_id);

-- Attempt evidence never changes. Command functions may stamp only lifecycle
-- timestamps; decisions never change at all.
create or replace function public.attendance_attempt_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'attendance attempts are append-only';
  end if;
  if current_setting('app.attendance_command', true) is distinct from 'on' then
    raise exception 'attendance attempts are append-only';
  end if;
  if new.id is distinct from old.id
     or new.attendance_id is distinct from old.attendance_id
     or new.outlet_id is distinct from old.outlet_id
     or new.person_id is distinct from old.person_id
     or new.business_date is distinct from old.business_date
     or new.attempted_at is distinct from old.attempted_at
     or new.latitude is distinct from old.latitude
     or new.longitude is distinct from old.longitude
     or new.accuracy_m is distinct from old.accuracy_m
     or new.distance_m is distinct from old.distance_m
     or new.source is distinct from old.source
     or new.entered_by is distinct from old.entered_by
     or new.entered_by_name is distinct from old.entered_by_name
     or new.arrival_deadline is distinct from old.arrival_deadline
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.created_at is distinct from old.created_at then
    raise exception 'attendance attempt evidence is immutable';
  end if;
  return new;
end;
$$;

create trigger attendance_attempt_guarded
  before update or delete on public.attendance_attempts
  for each row execute function public.attendance_attempt_guard();

create or replace function public.attendance_decision_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'attendance decisions are append-only';
end;
$$;

create trigger attendance_decision_guarded
  before update or delete on public.attendance_decisions
  for each row execute function public.attendance_decision_guard();

-- The attempt insert guard owns the database-computed distance and stamped
-- deadline. Backfill happened above so history was not re-evaluated.
create or replace function public.attendance_attempt_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_deadline time;
begin
  select o.latitude, o.longitude, o.arrival_deadline
    into v_lat, v_lng, v_deadline
    from public.outlets o
   where o.id = new.outlet_id;
  new.distance_m := public.app_distance_m(v_lat, v_lng, new.latitude, new.longitude);
  new.arrival_deadline := v_deadline;
  return new;
end;
$$;

create trigger attendance_attempt_evidence_stamped
  before insert on public.attendance_attempts
  for each row execute function public.attendance_attempt_evidence();

-- Replace the old direct-write guard. Service/seed inserts retain the small
-- compatibility stamps they need; authenticated callers must use commands.
drop trigger attendance_guarded on public.attendance;
create or replace function public.attendance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_deadline time;
begin
  if current_setting('app.attendance_command', true) = 'on' then
    return new;
  end if;

  if auth.uid() is not null then
    raise exception 'attendance writes must use an attendance command';
  end if;

  if tg_op = 'UPDATE'
     and (new.person_id is distinct from old.person_id
       or new.business_date is distinct from old.business_date) then
    raise exception 'attendance identity (person, business date) is immutable';
  end if;

  if new.check_in_at is not null and (tg_op = 'INSERT' or old.check_in_at is null) then
    select o.arrival_deadline into v_deadline
      from public.outlets o where o.id = new.outlet_id;
    new.arrival_deadline := v_deadline;
  end if;
  if new.approved_by is not null and (tg_op = 'INSERT' or old.approved_by is null) then
    new.approved_at := coalesce(new.approved_at, now());
    select p.full_name into new.approved_by_name
      from public.profiles p where p.id = new.approved_by;
  end if;
  return new;
end;
$$;

create trigger attendance_guarded
  before insert or update on public.attendance
  for each row execute function public.attendance_guard();

-- Seed and service-role inserts occur after migrations on local reset. Turn
-- their legacy row shape into the canonical history automatically.
create or replace function public.attendance_materialise_legacy_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision uuid;
  v_kind public.attendance_decision_kind;
begin
  if current_setting('app.attendance_command', true) = 'on'
     or new.check_in_at is null then
    return new;
  end if;

  insert into public.attendance_attempts (
    id, attendance_id, outlet_id, person_id, business_date, attempted_at,
    latitude, longitude, accuracy_m, distance_m, source,
    entered_by, entered_by_name, arrival_deadline, request_fingerprint, created_at
  ) values (
    new.id, new.id, new.outlet_id, new.person_id, new.business_date, new.check_in_at,
    new.check_in_lat, new.check_in_lng, new.check_in_accuracy_m, new.check_in_distance_m,
    new.check_in_source, new.check_in_entered_by, new.check_in_entered_by_name,
    new.arrival_deadline, 'legacy-attempt:' || new.id::text, new.created_at
  );

  if new.approved_by is not null or new.status <> 'absent' then
    v_kind := case
      when new.check_in_source = 'manual' then 'manual_present'::public.attendance_decision_kind
      when new.approved_by is not null then 'approve'::public.attendance_decision_kind
      else 'legacy_outcome'::public.attendance_decision_kind
    end;
    v_decision := gen_random_uuid();
    insert into public.attendance_decisions (
      id, attendance_id, attempt_id, outlet_id, person_id, business_date, kind,
      actor_id, actor_name, decided_at, reason, prevents_retry,
      previous_status, new_status,
      manager_lat, manager_lng, manager_accuracy_m, manager_distance_m,
      request_fingerprint
    ) values (
      v_decision, new.id, new.id, new.outlet_id, new.person_id, new.business_date, v_kind,
      new.approved_by, new.approved_by_name,
      coalesce(new.approved_at, new.check_in_at, new.created_at), new.approval_reason, true,
      case when new.status = 'present' then 'absent'::public.attendance_status else new.status end,
      new.status, new.approver_lat, new.approver_lng,
      new.approver_accuracy_m, new.approver_distance_m,
      'legacy-decision:' || new.id::text
    );
  end if;

  perform set_config('app.attendance_command', 'on', true);
  update public.attendance
     set current_attempt_id = case when v_decision is null then new.id else null end,
         outcome_attempt_id = case when v_decision is null then null else new.id end,
         latest_decision_id = v_decision,
         retry_blocked = v_decision is not null,
         state_version = 1
   where id = new.id;
  perform set_config('app.attendance_command', 'off', true);
  return new;
end;
$$;

create trigger attendance_materialise_legacy_inserted
  after insert on public.attendance
  for each row execute function public.attendance_materialise_legacy_insert();

drop policy attendance_insert on public.attendance;
drop policy attendance_update on public.attendance;
revoke insert, update, delete on public.attendance from authenticated, anon;

create or replace function public.attendance_request_fingerprint(payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$ select md5(payload::text) $$;

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
  v_now timestamptz := now();
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
  if p_attempted_at > v_now then
    raise exception 'an attendance attempt cannot be recorded for the future';
  end if;

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
  if p_business_date is distinct from public.app_business_date(v_now, v_outlet.business_day_cutover) then
    raise exception 'retry target no longer regards this as its current business date';
  end if;
  if p_business_date is distinct from public.app_business_date(p_attempted_at, v_outlet.business_day_cutover) then
    raise exception 'attempt time does not belong to the target business date';
  end if;

  select * into v_day
    from public.attendance
   where person_id = v_person and business_date = p_business_date
   for update;

  if found then
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
    ) values (p_outlet_id, v_person, p_business_date, 'absent', 0, false)
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
    p_attempt_id, v_day.id, p_outlet_id, v_person, p_business_date, p_attempted_at,
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

create or replace function public.attendance_approve_attempt(
  p_decision_id uuid,
  p_attendance_id uuid,
  p_expected_attempt_id uuid,
  p_expected_version integer,
  p_reason text,
  p_manager_lat double precision,
  p_manager_lng double precision,
  p_manager_accuracy_m numeric
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_fingerprint text;
  v_existing public.attendance_decisions;
  v_day public.attendance;
  v_attempt public.attendance_attempts;
  v_outlet public.outlets;
  v_distance numeric;
  v_reason text := nullif(btrim(p_reason), '');
  v_now timestamptz := now();
begin
  v_fingerprint := public.attendance_request_fingerprint(jsonb_build_object(
    'attendance', p_attendance_id, 'attempt', p_expected_attempt_id,
    'version', p_expected_version, 'reason', v_reason,
    'lat', p_manager_lat, 'lng', p_manager_lng, 'accuracy', p_manager_accuracy_m,
    'kind', 'approve'
  ));
  select * into v_existing from public.attendance_decisions where id = p_decision_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
       or v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'decision id was reused with a changed payload';
    end if;
    select * into v_day from public.attendance where id = v_existing.attendance_id;
    return v_day;
  end if;

  select * into v_day from public.attendance where id = p_attendance_id for update;
  if not found or v_day.current_attempt_id is distinct from p_expected_attempt_id
     or v_day.state_version <> p_expected_version then
    raise exception 'attendance state is stale';
  end if;
  select * into v_attempt from public.attendance_attempts where id = p_expected_attempt_id;
  select * into v_outlet from public.outlets where id = v_attempt.outlet_id;
  if v_actor is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', v_attempt.outlet_id)) then
    raise exception 'only a manager for this outlet may approve' using errcode = 'insufficient_privilege';
  end if;
  if (p_manager_lat is null) <> (p_manager_lng is null) then
    raise exception 'approver coordinates must be paired';
  end if;
  v_distance := public.app_distance_m(
    v_outlet.latitude, v_outlet.longitude, p_manager_lat, p_manager_lng
  );
  if not (v_distance is not null and v_distance <= v_outlet.geofence_radius_m
          and v_day.business_date = public.app_business_date(v_now, v_outlet.business_day_cutover))
     and v_reason is null then
    raise exception 'an approval from away from the outlet, or after the row''s own business day, requires a reason';
  end if;
  select p.full_name into v_actor_name from public.profiles p where p.id = v_actor;

  perform set_config('app.attendance_command', 'on', true);
  insert into public.attendance_decisions (
    id, attendance_id, attempt_id, outlet_id, person_id, business_date, kind,
    actor_id, actor_name, decided_at, reason, prevents_retry,
    previous_status, new_status,
    manager_lat, manager_lng, manager_accuracy_m, manager_distance_m,
    request_fingerprint
  ) values (
    p_decision_id, v_day.id, v_attempt.id, v_attempt.outlet_id, v_day.person_id,
    v_day.business_date, 'approve', v_actor, v_actor_name, v_now, v_reason, true,
    v_day.status, 'present', p_manager_lat, p_manager_lng,
    p_manager_accuracy_m, v_distance, v_fingerprint
  );
  update public.attendance_attempts set settled_at = v_now where id = v_attempt.id;
  update public.attendance
     set outlet_id = v_attempt.outlet_id,
         status = 'present', current_attempt_id = null,
         outcome_attempt_id = v_attempt.id, latest_decision_id = p_decision_id,
         retry_blocked = true,
         approved_by = v_actor, approved_by_name = v_actor_name,
         approval_reason = v_reason, approved_at = v_now,
         approver_lat = p_manager_lat, approver_lng = p_manager_lng,
         approver_accuracy_m = p_manager_accuracy_m, approver_distance_m = v_distance,
         state_version = state_version + 1
   where id = v_day.id returning * into v_day;
  perform set_config('app.attendance_command', 'off', true);
  return v_day;
end;
$$;

create or replace function public.attendance_deny_attempt(
  p_decision_id uuid,
  p_attendance_id uuid,
  p_expected_attempt_id uuid,
  p_expected_version integer,
  p_reason text,
  p_prevent_retry boolean default false
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
  v_now timestamptz := now();
begin
  if v_reason is null then raise exception 'a denial requires a reason'; end if;
  v_fingerprint := public.attendance_request_fingerprint(jsonb_build_object(
    'attendance', p_attendance_id, 'attempt', p_expected_attempt_id,
    'version', p_expected_version, 'reason', v_reason,
    'prevent', p_prevent_retry, 'kind', 'deny'
  ));
  select * into v_existing from public.attendance_decisions where id = p_decision_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
       or v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'decision id was reused with a changed payload';
    end if;
    select * into v_day from public.attendance where id = v_existing.attendance_id;
    return v_day;
  end if;
  select * into v_day from public.attendance where id = p_attendance_id for update;
  if not found or v_day.current_attempt_id is distinct from p_expected_attempt_id
     or v_day.state_version <> p_expected_version then
    raise exception 'attendance state is stale';
  end if;
  select * into v_attempt from public.attendance_attempts where id = p_expected_attempt_id;
  if v_actor is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', v_attempt.outlet_id)) then
    raise exception 'only a manager for this outlet may deny' using errcode = 'insufficient_privilege';
  end if;
  select p.full_name into v_actor_name from public.profiles p where p.id = v_actor;

  perform set_config('app.attendance_command', 'on', true);
  insert into public.attendance_decisions (
    id, attendance_id, attempt_id, outlet_id, person_id, business_date, kind,
    actor_id, actor_name, decided_at, reason, prevents_retry,
    previous_status, new_status, request_fingerprint
  ) values (
    p_decision_id, v_day.id, v_attempt.id, v_attempt.outlet_id, v_day.person_id,
    v_day.business_date, 'deny', v_actor, v_actor_name, v_now, v_reason,
    p_prevent_retry, v_day.status, 'absent', v_fingerprint
  );
  update public.attendance_attempts set settled_at = v_now where id = v_attempt.id;
  update public.attendance
     set outlet_id = v_attempt.outlet_id,
         status = 'absent', current_attempt_id = null,
         outcome_attempt_id = v_attempt.id, latest_decision_id = p_decision_id,
         retry_blocked = p_prevent_retry,
         approved_by = null, approved_by_name = null, approval_reason = null,
         approved_at = null, approver_lat = null, approver_lng = null,
         approver_accuracy_m = null, approver_distance_m = null,
         state_version = state_version + 1
   where id = v_day.id returning * into v_day;
  perform set_config('app.attendance_command', 'off', true);
  return v_day;
end;
$$;

create or replace function public.attendance_correct(
  p_decision_id uuid,
  p_attendance_id uuid,
  p_expected_version integer,
  p_action text,
  p_reason text,
  p_manager_lat double precision default null,
  p_manager_lng double precision default null,
  p_manager_accuracy_m numeric default null
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
  if v_reason is null then raise exception 'an attendance correction requires a reason'; end if;
  if p_action not in ('present', 'absent', 'allow_retry', 'absent_allow_retry') then
    raise exception 'unknown attendance correction';
  end if;
  v_fingerprint := public.attendance_request_fingerprint(jsonb_build_object(
    'attendance', p_attendance_id, 'version', p_expected_version,
    'action', p_action, 'reason', v_reason,
    'lat', p_manager_lat, 'lng', p_manager_lng, 'accuracy', p_manager_accuracy_m
  ));
  select * into v_existing from public.attendance_decisions where id = p_decision_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
       or v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'decision id was reused with a changed payload';
    end if;
    select * into v_day from public.attendance where id = v_existing.attendance_id;
    return v_day;
  end if;
  select * into v_day from public.attendance where id = p_attendance_id for update;
  if not found or v_day.state_version <> p_expected_version or v_day.current_attempt_id is not null then
    raise exception 'attendance state is stale';
  end if;
  select * into v_attempt
    from public.attendance_attempts
   where id = coalesce(v_day.outcome_attempt_id,
     (select at.id from public.attendance_attempts at
       where at.attendance_id = v_day.id order by at.attempted_at desc limit 1));
  if not found then raise exception 'a correction requires a recorded attempt'; end if;
  select * into v_outlet from public.outlets where id = v_attempt.outlet_id;
  if v_actor is null or not public.app_account_active()
     or not (public.app_is_owner() or public.app_has_role_at('franchise_admin', v_attempt.outlet_id)) then
    raise exception 'only a manager for this outlet may correct attendance' using errcode = 'insufficient_privilege';
  end if;
  select p.full_name into v_actor_name from public.profiles p where p.id = v_actor;

  if p_action = 'present' then
    if (p_manager_lat is null) <> (p_manager_lng is null) then
      raise exception 'approver coordinates must be paired';
    end if;
    v_kind := 'correct_present'; v_new_status := 'present'; v_prevents := true;
    v_distance := public.app_distance_m(
      v_outlet.latitude, v_outlet.longitude, p_manager_lat, p_manager_lng
    );
  elsif p_action = 'absent' then
    v_kind := 'correct_absent'; v_new_status := 'absent'; v_prevents := true;
  elsif p_action = 'allow_retry' then
    if v_day.status <> 'absent' then raise exception 'only an absent day can reopen retry'; end if;
    v_kind := 'allow_retry'; v_new_status := v_day.status; v_prevents := false;
  else
    v_kind := 'absent_allow_retry'; v_new_status := 'absent'; v_prevents := false;
  end if;

  perform set_config('app.attendance_command', 'on', true);
  insert into public.attendance_decisions (
    id, attendance_id, attempt_id, outlet_id, person_id, business_date, kind,
    actor_id, actor_name, decided_at, reason, prevents_retry,
    previous_status, new_status,
    manager_lat, manager_lng, manager_accuracy_m, manager_distance_m,
    request_fingerprint
  ) values (
    p_decision_id, v_day.id, v_attempt.id, v_attempt.outlet_id, v_day.person_id,
    v_day.business_date, v_kind, v_actor, v_actor_name, v_now, v_reason, v_prevents,
    v_day.status, v_new_status,
    case when p_action = 'present' then p_manager_lat else null end,
    case when p_action = 'present' then p_manager_lng else null end,
    case when p_action = 'present' then p_manager_accuracy_m else null end,
    case when p_action = 'present' then v_distance else null end,
    v_fingerprint
  );

  update public.attendance
     set outlet_id = v_attempt.outlet_id,
         status = v_new_status, current_attempt_id = null,
         outcome_attempt_id = v_attempt.id, latest_decision_id = p_decision_id,
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
   where id = v_day.id returning * into v_day;
  perform set_config('app.attendance_command', 'off', true);
  return v_day;
end;
$$;

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
  if not public.app_person_assigned_at(p_person_id, p_outlet_id) then
    raise exception 'person is not assigned to this outlet';
  end if;
  if p_business_date is distinct from public.app_business_date(v_now, v_outlet.business_day_cutover) then
    raise exception 'a manual entry belongs to the outlet''s current business day';
  end if;
  if p_attempted_at > v_now then raise exception 'a manual entry cannot be recorded for the future'; end if;
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

revoke execute on function public.attendance_request_fingerprint(jsonb) from public, anon;
revoke execute on function public.attendance_submit_attempt(uuid, uuid, date, timestamptz, double precision, double precision, numeric, integer) from public, anon;
revoke execute on function public.attendance_approve_attempt(uuid, uuid, uuid, integer, text, double precision, double precision, numeric) from public, anon;
revoke execute on function public.attendance_deny_attempt(uuid, uuid, uuid, integer, text, boolean) from public, anon;
revoke execute on function public.attendance_correct(uuid, uuid, integer, text, text, double precision, double precision, numeric) from public, anon;
revoke execute on function public.attendance_record_manual(uuid, uuid, uuid, uuid, date, timestamptz) from public, anon;

grant execute on function public.attendance_submit_attempt(uuid, uuid, date, timestamptz, double precision, double precision, numeric, integer) to authenticated;
grant execute on function public.attendance_approve_attempt(uuid, uuid, uuid, integer, text, double precision, double precision, numeric) to authenticated;
grant execute on function public.attendance_deny_attempt(uuid, uuid, uuid, integer, text, boolean) to authenticated;
grant execute on function public.attendance_correct(uuid, uuid, integer, text, text, double precision, double precision, numeric) to authenticated;
grant execute on function public.attendance_record_manual(uuid, uuid, uuid, uuid, date, timestamptz) to authenticated;

-- Backfill assertions: every check-in has one attempt; settled location facts
-- did not become waiting; canonical uniqueness remains the existing constraint.
do $$
begin
  if exists (
    select 1 from public.attendance a
     where a.check_in_at is not null
       and not exists (select 1 from public.attendance_attempts at where at.attendance_id = a.id)
  ) then
    raise exception 'attendance attempt backfill was incomplete';
  end if;
  if exists (
    select 1 from public.attendance a
     where (a.approved_by is not null or a.status in ('present', 'half_day', 'leave'))
       and a.current_attempt_id is not null
  ) then
    raise exception 'settled attendance was relabelled as waiting';
  end if;
end;
$$;
