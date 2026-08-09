-- The counter tablet stops being a person, and a shift opens by a code the
-- operator reads off the tablet and types on their own phone.
--
-- Three things change and they are inseparable, which is why they are one
-- migration:
--
--   1. **A tablet is a machine principal.** Until now each tablet carried a
--      profile and a Biller assignment, so every policy that asked "is this an
--      active account with a Biller assignment here" answered yes to a piece of
--      hardware sitting on a counter all evening. The profile and the assignment
--      go; what replaces them is a device session that reaches exactly what a
--      live shift says it may.
--   2. **Setup is a one-time code**, issued by an admin on their own phone,
--      hashed at rest, single-use, and consumed on the tablet. No account
--      password is typed on the tablet — not at setup, not ever. The shape is
--      `account_invites`, deliberately: it is already built, already proven, and
--      already understood by whoever runs this shop.
--   3. **A shift opens through a two-device handshake.** The tablet submits a
--      username and displays a four-digit code; the named person enters that
--      code on their own device; the shift opens. Requiring the code — rather
--      than a single Approve button — is the substantive decision here, because
--      a request approved by one tap is approved by habit, and the property
--      actually wanted is that the person can see the tablet.
--
-- The code does no work against guessing, and is not meant to: entering it at
-- all requires an authenticated session belonging to the named person. Four
-- digits is enough to prove presence and short enough to type during a rush.
-- Three wrong entries destroy the request rather than inviting an indefinite
-- retry loop.
--
-- Every state change below happens inside one privileged function, for the
-- reason `account_invites` gives: "check then consume" spread over several round
-- trips has a race in it, and the race is the whole attack.

-- ---------------------------------------------------------------------------
-- 1. Vocabulary, in the schema as well as the specs.
--
-- A tablet is **set up** and **removed**. It is not enrolled, provisioned,
-- revoked or deactivated, and there is no paused state: a paused tablet is a
-- security question that a removed one is not, and returning hardware to service
-- costs exactly one code.

alter table public.counter_devices rename column enrolled_by to set_up_by;
alter table public.counter_devices rename column enrolled_at to set_up_at;
alter table public.counter_devices rename column revoked_at to removed_at;

-- At most one active tablet per outlet, for launch. Partial, so an outlet keeps
-- the history of every tablet it has retired. #35 lifts this without touching
-- money history; until then two tablets at one counter is an attribution problem
-- before it is a UI problem.
create unique index counter_devices_one_active_per_outlet
  on public.counter_devices (outlet_id)
  where removed_at is null;

-- The last count of writes the tablet said it had not sent yet. Reported by the
-- tablet, so the management surface must present it as last reported rather than
-- as a current fact — which is a claim about the SCREEN, and is why the column
-- is named for what it is.
alter table public.counter_devices
  add column last_reported_unsent integer not null default 0
    check (last_reported_unsent >= 0);

create or replace function public.app_device_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select d.removed_at is null from public.counter_devices d where d.id = auth.uid()),
    true
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Setup codes.
--
-- No client role holds any privilege on this table at all — not select, not the
-- non-secret columns, nothing. `account_invites` grants a column list because a
-- manager's screen lists outstanding invites by person; nothing lists these. A
-- setup code exists for as long as it takes to walk to the counter.

create table public.counter_device_setup_codes (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  label text not null,
  code_hash text not null,
  issued_by uuid not null references public.profiles (id),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  consumed_at timestamptz,
  -- Deferred, because redemption consumes the code and then creates the tablet,
  -- in that order and in one transaction: consuming first is what makes two
  -- simultaneous redemptions of one code unable to both win.
  consumed_device_id uuid references public.counter_devices (id)
    deferrable initially deferred,
  superseded_at timestamptz,
  constraint counter_device_setup_codes_label_not_blank check (length(btrim(label)) > 0)
);

create index counter_device_setup_codes_outlet_id_idx
  on public.counter_device_setup_codes (outlet_id);

-- At most one live code per outlet, enforced here rather than by remembering to
-- supersede, and it is also what lets redemption find "the" code for an outlet
-- without ambiguity.
create unique index counter_device_setup_codes_one_live_per_outlet
  on public.counter_device_setup_codes (outlet_id)
  where consumed_at is null and superseded_at is null;

alter table public.counter_device_setup_codes enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Shift requests.
--
-- `person_id` is nullable **on purpose**: a username belonging to nobody still
-- produces a request, still shows a code, and still times out after the same
-- interval. Without that, the tablet is an oracle for who works here, answerable
-- by anybody who can stand at a counter.

create table public.counter_shift_requests (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.counter_devices (id) on delete cascade,
  outlet_id uuid not null references public.outlets (id),
  -- No `on delete cascade`, unlike `account_invites`. Profiles are deactivated
  -- rather than deleted here, and the three keys that do cascade are recorded as
  -- exceptions in supabase/tests/09_outlet_and_staff_setup.sql; a two-minute row
  -- is not worth becoming the fourth.
  person_id uuid references public.profiles (id),
  -- What was typed, kept so the tablet can say who it is waiting for after a
  -- reload. Not an identifier and not sensitive: it is either a username the
  -- person tells colleagues anyway, or a typo.
  requested_username text not null,
  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolution text check (
    resolution in ('confirmed', 'rejected', 'cancelled', 'superseded', 'exhausted', 'not_eligible')
  ),
  resolved_at timestamptz,
  shift_id uuid,
  constraint counter_shift_requests_resolution_paired
    check ((resolution is null) = (resolved_at is null))
);

create index counter_shift_requests_person_id_idx
  on public.counter_shift_requests (person_id)
  where resolution is null;

-- One pending request per tablet. This is what bounds how fast requests can be
-- aimed at anybody's phone: a second one supersedes the first rather than
-- stacking, so the person is never looking at a queue of cards to tap through.
create unique index counter_shift_requests_one_pending_per_device
  on public.counter_shift_requests (device_id)
  where resolution is null;

alter table public.counter_shift_requests enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Shifts.
--
-- Who is on the counter, at which tablet, for which trading day. Expiry is a
-- stored timestamp rather than a job that runs at 04:00: a shift is live only
-- while its expiry is ahead of the clock, so the cutover ends it with nothing
-- scheduled and nothing to go wrong when the scheduler does not.

create table public.counter_shifts (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.counter_devices (id),
  outlet_id uuid not null references public.outlets (id),
  person_id uuid not null references public.profiles (id),
  opened_at timestamptz not null default now(),
  business_date date not null,
  expires_at timestamptz not null,
  ended_at timestamptz,
  ended_reason text check (ended_reason in ('operator', 'device_removed')),
  constraint counter_shifts_end_paired check ((ended_at is null) = (ended_reason is null))
);

create index counter_shifts_outlet_business_date_idx
  on public.counter_shifts (outlet_id, business_date);
create index counter_shifts_person_live_idx
  on public.counter_shifts (person_id)
  where ended_at is null;

create unique index counter_shifts_one_open_per_device
  on public.counter_shifts (device_id)
  where ended_at is null;

alter table public.counter_shifts enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Helpers.
--
-- All `security definer` for the reason every other helper here is: definer
-- rights are what keep a policy that reads these tables from recursing into the
-- policy on those tables.

-- When is this outlet's next cutover, from this instant? The single definition,
-- so a shift's expiry and a bill's business date cannot disagree about when the
-- trading day ends.
create or replace function public.app_next_cutover(ts timestamptz, cutover time)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((public.app_business_date(ts, cutover) + 1)::timestamp + cutover)
           at time zone 'Asia/Kolkata'
$$;

-- The caller's tablet, or null if the caller is a person (or a removed tablet).
create or replace function public.app_counter_device()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from public.counter_devices d
   where d.id = auth.uid() and d.removed_at is null
$$;

-- The outlet that tablet belongs to. Separate from the shift helpers below,
-- because a tablet knows which shop it is in from the moment it is set up and
-- long before anybody opens a counter on it.
create or replace function public.app_counter_device_outlet()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.outlet_id from public.counter_devices d
   where d.id = auth.uid() and d.removed_at is null
$$;

-- The live shift on the caller's tablet, and the two facts every policy below
-- asks of it. Three functions rather than one composite because a policy reads
-- better as `outlet_id = public.app_counter_shift_outlet()` than as a join, and
-- each is an InitPlan evaluated once per query.
create or replace function public.app_counter_shift()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
   where s.device_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
$$;

create or replace function public.app_counter_shift_outlet()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.outlet_id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
   where s.device_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
$$;

create or replace function public.app_counter_shift_operator()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.person_id
    from public.counter_shifts s
    join public.counter_devices d on d.id = s.device_id and d.removed_at is null
   where s.device_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
$$;

-- May this person hold a shift at this outlet? An active account holding a live
-- Biller assignment there, that outlet's live Franchise Admin, or the owner.
-- Ordinary Employees cannot, which is the difference between working at a shop
-- and taking its money.
create or replace function public.app_may_hold_counter_shift(person uuid, outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = person and p.is_active)
     and exists (
       select 1 from public.assignments a
        where a.person_id = person
          and a.ended_on is null
          and (
            a.role = 'super_admin'
            or (a.role in ('biller', 'franchise_admin') and a.outlet_id = outlet)
          )
     )
$$;

revoke execute on function public.app_next_cutover(timestamptz, time) from public, anon;
revoke execute on function public.app_counter_device() from public, anon;
revoke execute on function public.app_counter_device_outlet() from public, anon;
revoke execute on function public.app_counter_shift() from public, anon;
revoke execute on function public.app_counter_shift_outlet() from public, anon;
revoke execute on function public.app_counter_shift_operator() from public, anon;
revoke execute on function public.app_may_hold_counter_shift(uuid, uuid) from public, anon;
grant execute on function public.app_next_cutover(timestamptz, time) to authenticated;
grant execute on function public.app_counter_device() to authenticated;
grant execute on function public.app_counter_device_outlet() to authenticated;
grant execute on function public.app_counter_shift() to authenticated;
grant execute on function public.app_counter_shift_outlet() to authenticated;
grant execute on function public.app_counter_shift_operator() to authenticated;
grant execute on function public.app_may_hold_counter_shift(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Policies and grants for the three new tables.
--
-- Reads only. Every state change goes through the privileged functions below,
-- which is what makes "only the named person may confirm" a boundary rather than
-- an application rule.

-- A shift request is between ONE tablet and ONE person. Not the outlet's
-- manager, not the owner: there is no fallback approver, so there is nobody else
-- with a reason to look at a pending request, and a row nobody else can read is
-- one fewer place the handshake can be observed from.
create policy counter_shift_requests_select on public.counter_shift_requests
  for select to authenticated
  using (
    (device_id = auth.uid() and public.app_device_ok())
    or (person_id = auth.uid() and public.app_account_active())
  );

-- The operator, the tablet, and the managers who need to know who is on a
-- counter. Unlike the request, a shift is an operational fact about the outlet.
create policy counter_shifts_select on public.counter_shifts
  for select to authenticated
  using (
    (device_id = auth.uid() and public.app_device_ok())
    or (
      public.app_account_active()
      and (
        person_id = auth.uid()
        or (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  );

-- The column list is the point, as it is on `account_invites`: `code_hash` is
-- absent, so a request naming it — or `select *`, which expands to it — is
-- refused with 42501 for every client role, including the person the code was
-- generated for. The code exists on the tablet's screen and nowhere else a
-- client can reach.
grant select (
  id, device_id, outlet_id, person_id, requested_username,
  attempts, created_at, expires_at, resolution, resolved_at, shift_id
) on public.counter_shift_requests to authenticated;

grant select on public.counter_shifts to authenticated;

grant all on public.counter_device_setup_codes to service_role;
grant all on public.counter_shift_requests to service_role;
grant all on public.counter_shifts to service_role;

-- Defence in depth, matching profiles, counter_devices and account_invites: the
-- write verbs are revoked outright, so a future policy mistake cannot quietly
-- open them.
revoke insert, update, delete
  on public.counter_shift_requests, public.counter_shifts from authenticated, anon;
revoke all privileges on public.counter_device_setup_codes from authenticated, anon;
revoke all privileges on public.counter_shift_requests from anon;
revoke all privileges on public.counter_shifts from anon;

-- ---------------------------------------------------------------------------
-- 7. Setting a tablet up.

create or replace function public.issue_counter_device_setup_code(
  p_outlet_id uuid,
  p_issued_by uuid,
  p_label text,
  p_code_hash text,
  p_valid_for interval
)
returns table (status text, code_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Authority is re-derived here and never taken from the request body, which
  -- is the house rule for every privileged function: being an Edge Function is
  -- not authorisation.
  if not exists (select 1 from public.outlets o where o.id = p_outlet_id and o.is_active) then
    return query select 'not_authorised'::text, null::uuid;
    return;
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = p_issued_by and p.is_active
  ) or not exists (
    select 1 from public.assignments a
     where a.person_id = p_issued_by
       and a.ended_on is null
       and (
         a.role = 'super_admin'
         or (a.role = 'franchise_admin' and a.outlet_id = p_outlet_id)
       )
  ) then
    return query select 'not_authorised'::text, null::uuid;
    return;
  end if;

  -- Refused early as well as at redemption. The redemption check is the
  -- boundary; this one exists so an admin is told at the point of asking rather
  -- than after walking to the counter with a code that cannot work.
  if exists (
    select 1 from public.counter_devices d
     where d.outlet_id = p_outlet_id and d.removed_at is null
  ) then
    return query select 'tablet_exists'::text, null::uuid;
    return;
  end if;

  update public.counter_device_setup_codes
     set superseded_at = now()
   where outlet_id = p_outlet_id
     and consumed_at is null
     and superseded_at is null;

  insert into public.counter_device_setup_codes
    (outlet_id, label, code_hash, issued_by, expires_at)
  values
    (p_outlet_id, p_label, p_code_hash, p_issued_by, now() + p_valid_for)
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$$;

-- Redeem. The machine Auth identity is created by the caller immediately before
-- this, and deleted again if the answer is anything but 'ok' — which is what
-- makes a failed setup leave nothing behind that can authenticate.
--
-- One failure value for every way a code can be bad: unknown, wrong, expired,
-- consumed, superseded, attempts exhausted. `tablet_exists` is the single
-- specific refusal, and it is allowed to be specific because it describes the
-- OUTLET rather than the code, to a caller who already holds a live code for
-- that outlet and therefore already knows which outlet it is.
create or replace function public.redeem_counter_device_setup_code(
  p_code_hash text,
  p_device_id uuid,
  p_max_attempts integer default 5
)
returns table (status text, device_id uuid, outlet_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code record;
  v_consumed integer;
begin
  select * into v_code
    from public.counter_device_setup_codes c
   where c.code_hash = p_code_hash
     and c.consumed_at is null
     and c.superseded_at is null;

  if not found or v_code.expires_at <= now() or v_code.attempts >= p_max_attempts then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.counter_devices d
     where d.outlet_id = v_code.outlet_id and d.removed_at is null
  ) then
    -- Not consumed: the outlet is full, the code is not at fault, and the admin
    -- should be able to remove the old tablet and use the same code.
    return query select 'tablet_exists'::text, null::uuid, null::uuid;
    return;
  end if;

  if not exists (select 1 from auth.users u where u.id = p_device_id) then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  -- Atomic single consumption: two simultaneous redemptions of the same code
  -- cannot both win, because only one UPDATE can see consumed_at as null.
  update public.counter_device_setup_codes
     set consumed_at = now(), consumed_device_id = p_device_id
   where id = v_code.id and consumed_at is null;
  get diagnostics v_consumed = row_count;

  if v_consumed <> 1 then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  insert into public.counter_devices (id, outlet_id, label, set_up_by)
  values (p_device_id, v_code.outlet_id, v_code.label, v_code.issued_by);

  return query select 'ok'::text, p_device_id, v_code.outlet_id;
end;
$$;

-- Removal. Permanent, immediate, and it takes the live shift with it: the
-- hardware is gone from the counter, so nobody is standing at it.
create or replace function public.remove_counter_device(
  p_device_id uuid,
  p_removed_by uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
begin
  select d.outlet_id into v_outlet
    from public.counter_devices d
   where d.id = p_device_id and d.removed_at is null;

  if v_outlet is null then
    return 'invalid';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = p_removed_by and p.is_active
  ) or not exists (
    select 1 from public.assignments a
     where a.person_id = p_removed_by
       and a.ended_on is null
       and (
         a.role = 'super_admin'
         or (a.role = 'franchise_admin' and a.outlet_id = v_outlet)
       )
  ) then
    return 'not_authorised';
  end if;

  update public.counter_shifts
     set ended_at = now(), ended_reason = 'device_removed'
   where device_id = p_device_id and ended_at is null;

  update public.counter_shift_requests
     set resolution = 'cancelled', resolved_at = now()
   where device_id = p_device_id and resolution is null;

  update public.counter_devices
     set removed_at = now()
   where id = p_device_id;

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The handshake.

-- Ask. Takes a username and returns nothing about it — same answer, same code,
-- same timeout, whether or not anybody answers to that name.
create or replace function public.request_counter_shift(
  p_device_id uuid,
  p_username text,
  p_code_hash text,
  p_valid_for interval
)
returns table (status text, request_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
  v_person uuid;
  v_username text;
  v_id uuid;
  v_expires timestamptz;
begin
  select d.outlet_id into v_outlet
    from public.counter_devices d
   where d.id = p_device_id and d.removed_at is null;

  if v_outlet is null then
    return query select 'device_unknown'::text, null::uuid, null::timestamptz;
    return;
  end if;

  v_username := public.app_normalize_username(p_username);

  -- Resolved through the same Auth alias the password grant uses, so the name
  -- typed on the tablet is exactly the name typed at sign-in. A miss leaves
  -- v_person null and changes nothing else about what happens next.
  if public.app_username_valid(v_username) then
    select u.id into v_person
      from auth.users u
     where lower(u.email) = v_username || '@login.shawarmania.invalid'
     limit 1;
  end if;

  update public.counter_shift_requests
     set resolution = 'superseded', resolved_at = now()
   where device_id = p_device_id and resolution is null;

  v_expires := now() + p_valid_for;

  insert into public.counter_shift_requests
    (device_id, outlet_id, person_id, requested_username, code_hash, expires_at)
  values
    (p_device_id, v_outlet, v_person, v_username, p_code_hash, v_expires)
  returning id into v_id;

  return query select 'ok'::text, v_id, v_expires;
end;
$$;

-- The tablet withdraws its own request, for the ordinary case of a mistyped
-- name. Resolving it rather than deleting it is what lets the person's phone
-- notice the card should disappear.
create or replace function public.cancel_counter_shift_request(p_device_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.counter_shift_requests
     set resolution = 'cancelled', resolved_at = now()
   where device_id = p_device_id and resolution is null;
  get diagnostics v_count = row_count;
  return case when v_count > 0 then 'ok' else 'none' end;
end;
$$;

-- "That was not me." Needs no code, because refusing something is not an action
-- anybody needs to prove they were standing in front of a counter to take.
create or replace function public.reject_counter_shift_request(
  p_person_id uuid,
  p_request_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.counter_shift_requests
     set resolution = 'rejected', resolved_at = now()
   where id = p_request_id
     and person_id = p_person_id
     and resolution is null;
  get diagnostics v_count = row_count;
  return case when v_count = 1 then 'ok' else 'invalid' end;
end;
$$;

-- Confirm. The one function in this change where getting it wrong is silent, so
-- every clause is a refusal:
--
--   * the request must exist, be pending, and be unexpired;
--   * it must name THIS person — an FA, an SA or a colleague submitting the
--     correct code for somebody else's request is refused, because there is no
--     fallback approver by decision;
--   * the code must match, and a wrong one is counted;
--   * eligibility is re-derived HERE rather than trusted from request time,
--     because an assignment can end in between and the moment that matters is
--     the moment the counter opens.
create or replace function public.confirm_counter_shift(
  p_person_id uuid,
  p_request_id uuid,
  p_code_hash text,
  p_max_attempts integer default 3
)
returns table (status text, shift_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
  v_cutover time;
  v_shift uuid;
begin
  select * into v_req
    from public.counter_shift_requests r
   where r.id = p_request_id
     and r.person_id = p_person_id
     and r.resolution is null
     and r.expires_at > now()
   for update;

  if not found then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if v_req.code_hash <> p_code_hash then
    update public.counter_shift_requests
       set attempts = attempts + 1
     where id = v_req.id
    returning attempts into v_req.attempts;

    if v_req.attempts >= p_max_attempts then
      -- A typo loop ends in a fresh start rather than an indefinite retry: the
      -- request dies and the tablet asks again with a new code.
      update public.counter_shift_requests
         set resolution = 'exhausted', resolved_at = now()
       where id = v_req.id;
      return query select 'exhausted'::text, null::uuid;
      return;
    end if;

    return query select 'wrong_code'::text, null::uuid;
    return;
  end if;

  if not public.app_may_hold_counter_shift(p_person_id, v_req.outlet_id) then
    update public.counter_shift_requests
       set resolution = 'not_eligible', resolved_at = now()
     where id = v_req.id;
    return query select 'not_eligible'::text, null::uuid;
    return;
  end if;

  -- A tablet holds one shift at a time. Whatever was open is closed by the
  -- handover, and old work keeps its own shift reference and its attribution.
  update public.counter_shifts
     set ended_at = now(), ended_reason = 'operator'
   where device_id = v_req.device_id and ended_at is null;

  select o.business_day_cutover into v_cutover
    from public.outlets o where o.id = v_req.outlet_id;

  insert into public.counter_shifts
    (device_id, outlet_id, person_id, business_date, expires_at)
  values
    (v_req.device_id, v_req.outlet_id, p_person_id,
     public.app_business_date(now(), v_cutover),
     public.app_next_cutover(now(), v_cutover))
  returning id into v_shift;

  update public.counter_shift_requests
     set resolution = 'confirmed', resolved_at = now(), shift_id = v_shift
   where id = v_req.id;

  return query select 'ok'::text, v_shift;
end;
$$;

-- End it from the phone that opened it. Deliberately not a remote wipe: work
-- already accepted on the tablet stays exactly where it is and keeps draining,
-- because it is money that was already taken.
create or replace function public.end_counter_shift(
  p_person_id uuid,
  p_shift_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.counter_shifts
     set ended_at = now(), ended_reason = 'operator'
   where id = p_shift_id
     and person_id = p_person_id
     and ended_at is null;
  get diagnostics v_count = row_count;
  return case when v_count = 1 then 'ok' else 'invalid' end;
end;
$$;

-- The tablet's own heartbeat. The only thing a device session may write about
-- itself, and it writes no payload: a count and a timestamp, so the management
-- surface can say "42 unsent as of 19:40" and be honest that both numbers are
-- what the tablet last said rather than what is true now.
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
         last_reported_unsent = greatest(coalesce(p_unsent, 0), 0)
   where id = auth.uid() and removed_at is null;
  get diagnostics v_count = row_count;
  return case when v_count = 1 then 'ok' else 'invalid' end;
end;
$$;

revoke execute on function public.issue_counter_device_setup_code(uuid, uuid, text, text, interval)
  from public, anon, authenticated;
revoke execute on function public.redeem_counter_device_setup_code(text, uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.remove_counter_device(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.request_counter_shift(uuid, text, text, interval)
  from public, anon, authenticated;
revoke execute on function public.cancel_counter_shift_request(uuid)
  from public, anon, authenticated;
revoke execute on function public.reject_counter_shift_request(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.confirm_counter_shift(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke execute on function public.end_counter_shift(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.issue_counter_device_setup_code(uuid, uuid, text, text, interval)
  to service_role;
grant execute on function public.redeem_counter_device_setup_code(text, uuid, integer)
  to service_role;
grant execute on function public.remove_counter_device(uuid, uuid) to service_role;
grant execute on function public.request_counter_shift(uuid, text, text, interval) to service_role;
grant execute on function public.cancel_counter_shift_request(uuid) to service_role;
grant execute on function public.reject_counter_shift_request(uuid, uuid) to service_role;
grant execute on function public.confirm_counter_shift(uuid, uuid, text, integer) to service_role;
grant execute on function public.end_counter_shift(uuid, uuid) to service_role;

-- The heartbeat is the exception: the tablet calls it with its own session, and
-- it derives its subject from `auth.uid()` rather than from an argument, so
-- there is nothing to forge.
revoke execute on function public.report_counter_device_state(integer) from public, anon;
grant execute on function public.report_counter_device_state(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. What a tablet reaches, now that it is not a person.
--
-- Every policy below previously admitted the counter through
-- `app_outlets_for('biller')` — which worked only because each tablet carried a
-- synthetic Biller assignment. That assignment is gone, so the reach is restated
-- as what it always meant: **the caller is a tablet holding a live shift at this
-- outlet.** No shift, no menu, no customers, no bills.
--
-- These are the pre-#33 billing tables and #33 replaces them wholesale. They are
-- corrected rather than left broken because a policy that is dead for one change
-- and alive for the next is how over-permission survives a rewrite.

-- The tablet reads its own outlet from the moment it is set up, before any shift
-- exists. It has to: the cutover decides which trading day a bill belongs to and
-- when the shift expires, and the shift-request screen names the outlet the
-- person is being asked to open. This is the one read a tablet holds without a
-- shift, and it is one row.
drop policy outlets_select on public.outlets;
create policy outlets_select on public.outlets
  for select to authenticated
  using (
    public.app_device_ok()
    and (
      id = (select public.app_counter_device_outlet())
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or id in (
            select a.outlet_id from public.assignments a
             where a.person_id = auth.uid() and a.ended_on is null
          )
        )
      )
    )
  );

drop policy menu_categories_select on public.menu_categories;
create policy menu_categories_select on public.menu_categories
  for select to authenticated
  using (
    public.app_device_ok()
    and (
      outlet_id = (select public.app_counter_shift_outlet())
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
          or outlet_id in (select public.app_outlets_for('biller'))
        )
      )
    )
  );

drop policy menu_items_select on public.menu_items;
create policy menu_items_select on public.menu_items
  for select to authenticated
  using (
    public.app_device_ok()
    and (
      outlet_id = (select public.app_counter_shift_outlet())
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
          or outlet_id in (select public.app_outlets_for('biller'))
        )
      )
    )
  );

-- `customers` needs nothing here. It has held no select policy since #32 made it
-- a business-wide identity: every billing read goes through
-- `customer_lookup_by_phone`, gated by `app_may_look_up_customer`, which is
-- rewritten at the end of this file.

drop policy shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated
  using (
    public.app_device_ok()
    and (
      (counter_device_id = auth.uid() and (select public.app_counter_shift()) is not null)
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
        )
      )
    )
  );

drop policy shifts_insert on public.shifts;
create policy shifts_insert on public.shifts
  for insert to authenticated
  with check (
    public.app_device_ok()
    and counter_device_id = auth.uid()
    and outlet_id = (select public.app_counter_shift_outlet())
    and biller_profile_id = (select public.app_counter_shift_operator())
  );

drop policy shifts_update on public.shifts;
create policy shifts_update on public.shifts
  for update to authenticated
  using (
    public.app_device_ok()
    and counter_device_id = auth.uid()
    and (select public.app_counter_shift()) is not null
  )
  with check (
    public.app_device_ok()
    and counter_device_id = auth.uid()
    and outlet_id = (select public.app_counter_shift_outlet())
  );

drop policy bills_select on public.bills;
create policy bills_select on public.bills
  for select to authenticated
  using (
    public.app_device_ok()
    and (
      (
        counter_device_id = auth.uid()
        and shift_id in (
          select s.id from public.shifts s
           where s.counter_device_id = auth.uid() and s.closed_at is null
        )
      )
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
        )
      )
    )
  );

drop policy bills_insert on public.bills;
create policy bills_insert on public.bills
  for insert to authenticated
  with check (
    public.app_device_ok()
    and counter_device_id = auth.uid()
    and outlet_id = (select public.app_counter_shift_outlet())
    -- Attribution comes from the shift, not from the request body: the tablet
    -- cannot ring a bill under a name that is not the one standing at it.
    and biller_profile_id = (select public.app_counter_shift_operator())
    and shift_id in (
      select s.id from public.shifts s where s.counter_device_id = auth.uid()
    )
  );

drop policy bill_items_insert on public.bill_items;
create policy bill_items_insert on public.bill_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.bills b
       where b.id = bill_id
         and b.outlet_id = (select public.app_counter_shift_outlet())
    )
  );

-- `app_may_look_up_customer` loses its `revoked_at` reference along with the
-- column rename. Tightening it to require a live shift is task 3.4 and lands
-- with the rest of the session boundary; this is the rename only.
create or replace function public.app_may_look_up_customer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.counter_devices d
       where d.id = auth.uid() and d.removed_at is null
    )
    or (
      public.app_account_active()
      and exists (
        select 1 from public.assignments a
         where a.person_id = auth.uid()
           and a.role = 'biller'
           and a.ended_on is null
      )
    )
$$;

-- ---------------------------------------------------------------------------
-- 10. A tablet is an Auth account that is deliberately not a person.
--
-- `username_rollout_ready()` refuses to publish while any non-deleted Auth user
-- lacks a profile, because until now that could only mean an orphaned account.
-- It can now also mean a counter tablet, which is the whole point of this
-- change, so the check has to be able to tell the two apart. It still refuses an
-- Auth user that is neither.

create or replace function public.username_rollout_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
        from public.assignments a
        join public.profiles p on p.id = a.person_id
        join public.account_emails e on e.profile_id = a.person_id
       where a.role = 'super_admin'
         and a.ended_on is null
         and p.is_active
    )
    and not exists (
      select 1
        from auth.users u
        left join public.profiles p on p.id = u.id
       where u.deleted_at is null
         and not exists (select 1 from public.counter_devices d where d.id = u.id)
         and (
           p.id is null
           or public.app_username_from_auth_alias(u.email) is null
           or not exists (
             select 1
               from auth.identities i
              where i.user_id = u.id
                and i.provider = 'email'
                and i.email = u.email
           )
         )
    )
    and not exists (
      select 1
        from public.profiles p
        left join auth.users u
          on u.id = p.id
         and u.deleted_at is null
       where u.id is null
          or public.app_username_from_auth_alias(u.email) is null
    )
    and not exists (
      select 1
        from public.assignments a
        join public.profiles p on p.id = a.person_id
       where a.role = 'super_admin'
         and a.ended_on is null
         and (
           not p.is_active
           or not exists (
             select 1
               from public.account_emails e
              where e.profile_id = a.person_id
           )
         )
    )
$$;
