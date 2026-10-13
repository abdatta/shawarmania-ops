-- a-release-can-be-switched-off (#75): change gates.
--
-- A change gate applies or removes one change while the app runs, turned by the
-- owner from the Change gates page (design D3, D21). Every device reads every
-- gate; only the owner turns one, through set_change_gate, which re-derives the
-- caller's authority from their own token. A gate is one answer for the whole
-- business. A gate may depend on others: it can be turned on only while all of
-- them are on, and turning any of them off turns it off too.
--
-- This migration builds machinery rather than serving a gate's on path, so it
-- declares no `change-gate`. It only adds: no existing table, column, function,
-- view, trigger or policy is touched, which is the rule it brings in.

-- ---------------------------------------------------------------------------
-- 1. The gates. One row per gate ever declared, never deleted, holding its
-- declaration and its current answer. Only migrations insert rows.

create table public.change_gates (
  key text primary key
    constraint change_gates_key_shape check (key ~ '^[a-z][a-z0-9-]{1,62}$'),
  -- Two characters, capitals or digits, at least one a letter. Unique among
  -- gates not yet retired (the partial index below), so a retired gate's code
  -- may be given out again; its key never is.
  code text not null
    constraint change_gates_code_shape check (code ~ '^[A-Z0-9]{2}$' and code ~ '[A-Z]'),
  kind text not null
    constraint change_gates_kind_known check (kind in ('change', 'ops')),
  title text not null constraint change_gates_title_present check (length(btrim(title)) between 1 and 60),
  on_means text not null constraint change_gates_on_means_present check (length(btrim(on_means)) between 1 and 240),
  off_means text not null constraint change_gates_off_means_present check (length(btrim(off_means)) between 1 and 240),
  -- The OpenSpec change that introduced it. Every gate has one.
  change_name text not null constraint change_gates_change_present check (length(btrim(change_name)) > 0),
  -- Its roadmap number, which is how the owner knows a change; null for fixes
  -- and tooling, which have no row.
  change_number integer constraint change_gates_change_number_positive check (change_number > 0),
  -- A migration declares a gate off; only the owner turns it.
  enabled boolean not null default false,
  changed_at timestamptz,
  changed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  -- Set by the contract migration of its retirement change. A retired gate reads
  -- off everywhere and cannot be turned.
  retired_at timestamptz,
  constraint change_gates_retired_is_off check (retired_at is null or not enabled)
);

create unique index change_gates_live_code_unique
  on public.change_gates (code) where retired_at is null;

comment on table public.change_gates is
  'Change gates: one row per gate ever declared, never deleted. Turned only through set_change_gate (owner) or change_gate_force (operator). Design D3 of a-release-can-be-switched-off.';

-- ---------------------------------------------------------------------------
-- 2. Dependencies. A gate depends on any number of others (D21). Inserted by the
-- migration that declares the dependent gate; never a loop.

create table public.change_gate_dependencies (
  gate_key text not null references public.change_gates (key),
  depends_on text not null references public.change_gates (key),
  primary key (gate_key, depends_on),
  constraint change_gate_dependencies_not_self check (gate_key <> depends_on)
);

create or replace function public.change_gate_dependencies_no_loop()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Would the new edge let `depends_on` reach `gate_key`? Then it closes a loop.
  if exists (
    with recursive reach(key) as (
      select new.depends_on
      union
      select d.depends_on
        from public.change_gate_dependencies d
        join reach r on d.gate_key = r.key
    )
    select 1 from reach where key = new.gate_key
  ) then
    raise exception 'change gate % cannot depend on %: that would be a loop',
      new.gate_key, new.depends_on using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger change_gate_dependencies_no_loop
  before insert or update on public.change_gate_dependencies
  for each row execute function public.change_gate_dependencies_no_loop();

-- ---------------------------------------------------------------------------
-- 3. History. Append-only: who turned what, when, why, and how.

create table public.change_gate_events (
  id uuid primary key default gen_random_uuid(),
  -- Text, not a cascading key, so the history outlives the gate's retirement.
  gate_key text not null,
  enabled boolean not null,
  reason text constraint change_gate_events_reason_length check (length(reason) <= 200),
  -- `app` from the Change gates page; `operator` from the Supabase dashboard.
  source text not null constraint change_gate_events_source_known check (source in ('app', 'operator')),
  changed_by uuid references public.profiles (id),
  at timestamptz not null default clock_timestamp()
);

create index change_gate_events_gate_at_idx on public.change_gate_events (gate_key, at desc);

create or replace function public.change_gate_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'change gate events are append-only' using errcode = '42501';
end;
$$;

create trigger change_gate_events_append_only
  before update or delete on public.change_gate_events
  for each row execute function public.change_gate_events_append_only();

-- ---------------------------------------------------------------------------
-- 4. Tablet health (D13). One row per tablet, overwritten by each report:
-- resource counts and durations only, never a query, a name or an amount.

create table public.device_health (
  device_id uuid primary key references public.counter_devices (id),
  outlet_id uuid not null references public.outlets (id),
  build text not null constraint device_health_build_length check (length(build) between 1 and 40),
  -- The gates this tablet's page loaded with on.
  booted_gates text[] not null default '{}'
    constraint device_health_booted_gates_bounded check (cardinality(booted_gates) <= 64),
  window_seconds integer not null constraint device_health_window_positive check (window_seconds between 1 and 3600),
  requests integer not null constraint device_health_requests_counted check (requests >= 0),
  failed integer not null constraint device_health_failed_counted check (failed between 0 and requests),
  slowest_ms integer not null constraint device_health_slowest_counted check (slowest_ms >= 0),
  reported_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Row-level security.
--
-- Gates and their dependencies hold no outlet data: every signed-in principal —
-- every person, every counter and kitchen tablet — reads them, and this policy is
-- also what lets Realtime deliver a turn to every device. Not `anon`.
--
-- History is the owner's. Tablet health is outlet-scoped: the owner and that
-- outlet's Franchise Admins read it. Nobody writes any of these directly.

alter table public.change_gates enable row level security;
alter table public.change_gate_dependencies enable row level security;
alter table public.change_gate_events enable row level security;
alter table public.device_health enable row level security;

create policy change_gates_select on public.change_gates
  for select to authenticated using (
    public.app_device_ok()
    and (public.app_counter_device() is not null or public.app_account_active()));

create policy change_gate_dependencies_select on public.change_gate_dependencies
  for select to authenticated using (
    public.app_device_ok()
    and (public.app_counter_device() is not null or public.app_account_active()));

create policy change_gate_events_select on public.change_gate_events
  for select to authenticated using (
    public.app_account_active() and (select public.app_is_owner()));

create policy device_health_select on public.device_health
  for select to authenticated using (
    public.app_device_ok() and public.app_account_active() and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))));

revoke all on public.change_gates from anon, authenticated;
revoke all on public.change_gate_dependencies from anon, authenticated;
revoke all on public.change_gate_events from anon, authenticated;
revoke all on public.device_health from anon, authenticated;
grant select on public.change_gates to authenticated;
grant select on public.change_gate_dependencies to authenticated;
grant select on public.change_gate_events to authenticated;
grant select on public.device_health to authenticated;
-- The service role is granted table by table here, as every table since
-- 20260726000010_grants_hygiene.sql is: the dashboard and the test cleanup use it.
grant all on public.change_gates to service_role;
grant all on public.change_gate_dependencies to service_role;
grant all on public.change_gate_events to service_role;
grant all on public.device_health to service_role;

-- ---------------------------------------------------------------------------
-- 6. Turning a gate. One internal function does the work for both callers.

create or replace function public.change_gate_apply(
  p_key text,
  p_enabled boolean,
  p_reason text,
  p_by uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate public.change_gates;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_blocking text;
begin
  if v_reason is not null and length(v_reason) > 200 then
    raise exception 'A reason is at most 200 characters.' using errcode = '22001';
  end if;

  select * into v_gate from public.change_gates where key = p_key for update;
  if not found then
    raise exception 'That change gate does not exist.' using errcode = 'P0002';
  end if;
  if v_gate.retired_at is not null then
    raise exception 'That change gate is retired and cannot be turned.' using errcode = '22023';
  end if;

  if p_enabled then
    select string_agg(g.title, ' and ' order by g.title)
      into v_blocking
      from public.change_gate_dependencies d
      join public.change_gates g on g.key = d.depends_on
     where d.gate_key = p_key and not g.enabled;
    if v_blocking is not null then
      raise exception 'Turn on % first: % is dependent on it.', v_blocking, v_gate.title
        using errcode = '22023';
    end if;
  end if;

  update public.change_gates
     set enabled = p_enabled, changed_at = now(), changed_by = p_by
   where key = p_key;
  insert into public.change_gate_events (gate_key, enabled, reason, source, changed_by)
  values (p_key, p_enabled, v_reason, p_source, p_by);

  -- Turning a gate off turns off every gate that depends on it, at any depth,
  -- that is on — each its own turn in the history (D21).
  if not p_enabled then
    with recursive dependents(key) as (
      select d.gate_key from public.change_gate_dependencies d where d.depends_on = p_key
      union
      select d.gate_key
        from public.change_gate_dependencies d
        join dependents x on d.depends_on = x.key
    ),
    turned as (
      update public.change_gates g
         set enabled = false, changed_at = now(), changed_by = p_by
        from dependents x
       where g.key = x.key and g.enabled
      returning g.key
    )
    insert into public.change_gate_events (gate_key, enabled, reason, source, changed_by)
    select key, false, 'Turned off with ' || v_gate.title, p_source, p_by from turned;
  end if;
end;
$$;

revoke execute on function public.change_gate_apply(text, boolean, text, uuid, text)
  from public, anon, authenticated;

/**
 * The owner turns a gate. Authority comes from the caller's own token, never
 * from the request: every other caller is refused with one sentence.
 */
create or replace function public.set_change_gate(p_key text, p_enabled boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.app_device_ok() and public.app_account_active() and public.app_is_owner()) then
    raise exception 'Only the owner turns a change gate.' using errcode = '42501';
  end if;
  perform public.change_gate_apply(p_key, p_enabled, p_reason, auth.uid(), 'app');
end;
$$;

revoke execute on function public.set_change_gate(text, boolean, text) from public, anon;
grant execute on function public.set_change_gate(text, boolean, text) to authenticated;

/**
 * The same turn from the Supabase dashboard, when the app cannot be opened
 * (`docs/OPERATIONS.md`). For the database owner and the service role only.
 */
create or replace function public.change_gate_force(p_key text, p_enabled boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.change_gate_apply(p_key, p_enabled, p_reason, null, 'operator');
end;
$$;

revoke execute on function public.change_gate_force(text, boolean, text) from public, anon, authenticated;
grant execute on function public.change_gate_force(text, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. The database's own read, for triggers and policies, which have no caller
-- to choose a path (D8). On only while the gate and every gate it depends on,
-- at any depth, are on; false for an unknown or retired key.

create or replace function public.app_change_gate(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive needed(key) as (
    select p_key
    union
    select d.depends_on
      from public.change_gate_dependencies d
      join needed n on d.gate_key = n.key
  )
  select exists (select 1 from public.change_gates where key = p_key)
     and not exists (
       select 1
         from needed n
         left join public.change_gates g on g.key = n.key
        where g.key is null or not g.enabled or g.retired_at is not null)
$$;

revoke execute on function public.app_change_gate(text) from public, anon;
grant execute on function public.app_change_gate(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. A tablet reports its health. The device and its outlet come from the
-- caller's own device session, never from arguments.

create or replace function public.report_device_health(
  p_build text,
  p_booted_gates text[],
  p_window_seconds integer,
  p_requests integer,
  p_failed integer,
  p_slowest_ms integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device uuid := public.app_counter_device();
  v_outlet uuid := public.app_counter_device_outlet();
begin
  if v_device is null or v_outlet is null then
    raise exception 'Only a tablet reports its health.' using errcode = '42501';
  end if;
  insert into public.device_health
    (device_id, outlet_id, build, booted_gates, window_seconds, requests, failed, slowest_ms, reported_at)
  values
    (v_device, v_outlet, p_build, coalesce(p_booted_gates, '{}'), p_window_seconds,
     p_requests, p_failed, p_slowest_ms, now())
  on conflict (device_id) do update set
    outlet_id = excluded.outlet_id,
    build = excluded.build,
    booted_gates = excluded.booted_gates,
    window_seconds = excluded.window_seconds,
    requests = excluded.requests,
    failed = excluded.failed,
    slowest_ms = excluded.slowest_ms,
    reported_at = excluded.reported_at;
end;
$$;

revoke execute on function public.report_device_health(text, text[], integer, integer, integer, integer)
  from public, anon;
grant execute on function public.report_device_health(text, text[], integer, integer, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Every device hears a turn at once.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.change_gates;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. This change's own two gates, off (design D16). Their words are the ones
-- the demo shows.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('probe', 'PB', 'change', 'Probe',
   'Every build code includes PB.',
   'PB is not in the build code.',
   'a-release-can-be-switched-off', 75),
  ('tablet-health', 'TH', 'change', 'Tablet health',
   'Every tablet reports, each minute, how many requests it made, how many failed and the slowest one.',
   'Tablets report nothing new.',
   'a-release-can-be-switched-off', 75);
