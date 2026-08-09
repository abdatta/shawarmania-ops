-- Five findings from the adversarial review of #9, fixed at the database.
--
-- Four of them share one shape, and it is worth naming before the code: **the
-- boundary was drawn in the right place and then something was handed out beside
-- it.** A column granted next to a policy, a helper granted next to the function
-- that uses it, a limit passed next to the rule it implements. Each of these was
-- one line, and none of them was visible from the policy that was supposedly
-- doing the work.

-- ---------------------------------------------------------------------------
-- 1. The tablet could tell a real username from an invented one.
--
-- `counter_shift_requests.person_id` is nullable **precisely so that an unknown
-- username produces a row indistinguishable from a real one** — that is why the
-- column has no foreign-key cascade and why the request is written either way.
-- It was then included in the column grant to `authenticated`, and a tablet may
-- read its own request. So the tablet could ask for a name and read back a UUID
-- for a person who works here and a NULL for one who does not.
--
-- The screen never showed it, which is exactly why this survived: the enumeration
-- safety was true of the UI and false of the boundary, and the tests asserted the
-- UI. A counter anybody can reach across could have been used to check names off
-- a list, one every two minutes, with nothing recorded but ordinary requests.
--
-- The column stays on the table, because the policies and the privileged
-- functions need it. It simply stops being readable by anyone.
revoke select (person_id) on public.counter_shift_requests from authenticated;

-- Row-level security on THIS table is unaffected: `counter_shift_requests_select`
-- names `person_id` in its own USING clause, and a policy's own expression is
-- evaluated for the policy rather than against the caller's column privileges.
--
-- **A policy on ANOTHER table that reads this one is a different matter**, and
-- it is what the revoke above broke on the first run. `counter_devices_select`
-- gained a branch in `20260810000004` that asks "has this tablet asked for me",
-- and a subquery inside a policy IS evaluated with the caller's privileges — so
-- the moment `person_id` stopped being readable, every operator lost the tablet
-- row the card needs to name.
--
-- The branch moves into a security-definer helper, which is how every other
-- cross-table question in this schema is asked. It takes no person argument and
-- derives the caller from `auth.uid()`, deliberately: finding 2 below is exactly
-- what happens when a helper that answers about people accepts an id.
create or replace function public.app_counter_device_concerns_me(p_device uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.counter_shift_requests r
     where r.device_id = p_device
       and r.person_id = auth.uid()
       and r.resolution is null
       and r.expires_at > now()
  ) or exists (
    select 1
      from public.counter_shifts s
     where s.device_id = p_device
       and s.person_id = auth.uid()
       and s.ended_at is null
       and s.expires_at > now()
  )
$$;

revoke execute on function public.app_counter_device_concerns_me(uuid) from public, anon;
grant execute on function public.app_counter_device_concerns_me(uuid) to authenticated;

drop policy counter_devices_select on public.counter_devices;
create policy counter_devices_select on public.counter_devices
  for select to authenticated
  using (
    public.app_device_ok()
    and (
      -- The tablet reading its own row, outside the person branch because a
      -- tablet has no profile and `app_account_active()` is a question about a
      -- person.
      id = auth.uid()
      or (
        public.app_account_active()
        and (
          (select public.app_is_owner())
          or outlet_id in (select public.app_outlets_for('franchise_admin'))
          -- A tablet that is asking for this person, or one they are standing
          -- at. Bounded by the request and the shift rather than by employment.
          or public.app_counter_device_concerns_me(id)
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Any authenticated session could ask who is allowed to bill where.
--
-- `app_may_hold_counter_shift(person, outlet)` takes two arbitrary ids, is
-- SECURITY DEFINER, and was executable by `authenticated`. It answers true or
-- false about **other people**, and it does not care whether the caller is a
-- person, a tablet, or a tablet that was removed last month.
--
-- That is an eligibility oracle over the whole staff list: point it at every
-- account id and it maps out who bills at which outlet. It was granted because
-- it sits in the same block as the helpers policies call; it is called from
-- exactly one place, `confirm_counter_shift`, which is SECURITY DEFINER and
-- therefore runs as the owner regardless of who may execute this.
--
-- Nothing loses a capability here. The grant was never used.
revoke execute on function public.app_may_hold_counter_shift(uuid, uuid)
  from authenticated;

-- ---------------------------------------------------------------------------
-- 3. A spent confirmation code stayed on the row for ever.
--
-- The spec says the code is "destroyed with its request", and it was not: a
-- confirmed, rejected, cancelled, superseded or exhausted request kept its
-- `code_hash` indefinitely. Four digits is 10,000 possibilities, so the hash is
-- not a one-way function in any meaningful sense — anybody who reached that
-- column would read the code straight off it.
--
-- It is worth being precise about what that would have cost, because it is less
-- than it sounds and the fix is worth doing anyway: a resolved request cannot be
-- confirmed, so a recovered code opens nothing. What it leaks is a record of
-- which four digits were shown on a counter on a given evening, which is exactly
-- the kind of thing that is harmless until it is combined with something else.
--
-- The constraint is the point rather than the UPDATE. "Cleared on resolution"
-- written as a rule the table enforces cannot be forgotten by the next function
-- that resolves a request; written as a line in five functions, it can.

update public.counter_shift_requests set code_hash = null where resolution is not null;

alter table public.counter_shift_requests alter column code_hash drop not null;

alter table public.counter_shift_requests
  add constraint counter_shift_requests_code_lives_with_the_request
  check ((resolution is null) = (code_hash is not null));

-- ---------------------------------------------------------------------------
-- 4. How long a request lives, and how many wrong codes kill it, were the
--    caller's to choose.
--
-- `request_counter_shift` took any interval and `confirm_counter_shift` took any
-- attempt limit. The Edge Function passes two minutes and three, and the design
-- argues for both at length — but the argument lived in TypeScript, and the
-- database would have accepted a request valid for a year, retried a hundred
-- times.
--
-- Only the service role can reach these functions, so this was never reachable
-- from a browser. It is fixed anyway, because "the rule is in the database" is
-- the house rule and a rule that holds only while one caller behaves is a
-- convention. The bounds are ceilings rather than fixed values: a caller may ask
-- for less, and cannot ask for more.

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
  -- Long enough to walk round a counter and read four digits aloud; short
  -- enough that a request nobody answers is gone before anybody wanders off.
  v_valid interval := least(greatest(coalesce(p_valid_for, interval '2 minutes'),
                                     interval '30 seconds'),
                            interval '5 minutes');
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
  -- v_person null and changes nothing else about what happens next — and since
  -- this migration, nothing can read that column to tell which happened.
  if public.app_username_valid(v_username) then
    select u.id into v_person
      from auth.users u
     where lower(u.email) = v_username || '@login.shawarmania.invalid'
     limit 1;
  end if;

  update public.counter_shift_requests
     set resolution = 'superseded', resolved_at = now(), code_hash = null
   where device_id = p_device_id and resolution is null;

  v_expires := now() + v_valid;

  insert into public.counter_shift_requests
    (device_id, outlet_id, person_id, requested_username, code_hash, expires_at)
  values
    (p_device_id, v_outlet, v_person, v_username, p_code_hash, v_expires)
  returning id into v_id;

  return query select 'ok'::text, v_id, v_expires;
end;
$$;

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
     set resolution = 'cancelled', resolved_at = now(), code_hash = null
   where device_id = p_device_id and resolution is null;
  get diagnostics v_count = row_count;
  return case when v_count > 0 then 'ok' else 'none' end;
end;
$$;

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
     set resolution = 'rejected', resolved_at = now(), code_hash = null
   where id = p_request_id
     and person_id = p_person_id
     and resolution is null;
  get diagnostics v_count = row_count;
  return case when v_count = 1 then 'ok' else 'invalid' end;
end;
$$;

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
  -- Three, and never more, whatever the caller asks for. A typo loop has to end
  -- in a fresh code rather than in an indefinite retry against four digits.
  v_max integer := least(greatest(coalesce(p_max_attempts, 3), 1), 3);
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

    if v_req.attempts >= v_max then
      update public.counter_shift_requests
         set resolution = 'exhausted', resolved_at = now(), code_hash = null
       where id = v_req.id;
      return query select 'exhausted'::text, null::uuid;
      return;
    end if;

    return query select 'wrong_code'::text, null::uuid;
    return;
  end if;

  if not public.app_may_hold_counter_shift(p_person_id, v_req.outlet_id) then
    update public.counter_shift_requests
       set resolution = 'not_eligible', resolved_at = now(), code_hash = null
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
     set resolution = 'confirmed', resolved_at = now(), shift_id = v_shift,
         code_hash = null
   where id = v_req.id;

  return query select 'ok'::text, v_shift;
end;
$$;

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
     set resolution = 'cancelled', resolved_at = now(), code_hash = null
   where device_id = p_device_id and resolution is null;

  update public.counter_devices
     set removed_at = now()
   where id = p_device_id;

  return 'ok';
end;
$$;

-- A setup code is not a confirmation code and its ceiling is its own: it travels
-- across a shop in somebody's hand rather than across a counter by eye.
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
  v_valid interval := least(greatest(coalesce(p_valid_for, interval '15 minutes'),
                                     interval '1 minute'),
                            interval '1 hour');
begin
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
    (p_outlet_id, p_label, p_code_hash, p_issued_by, now() + v_valid)
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A tablet could read every shift ever held on it.
--
-- `counter_shifts_select` admitted the tablet to its own rows without asking
-- whether they were live, so a tablet standing idle could read the whole
-- history of who has worked that counter and when. The claim in the change was
-- that a tablet with no live shift reaches nothing; that was true of the menu,
-- the bills and the customer directory, and not true here.
--
-- The narrowing is to the shift that is actually open. What a tablet still reads
-- with no shift is its own `counter_devices` row and its own outlet, and it
-- needs both to render the screen that asks for one — that is the honest
-- boundary, and it is now the documented one.
--
-- Note for #10 and #33: a bill draining after its shift ended carries
-- `shift_id`, and the tablet will not be able to read that row back. It does not
-- need to — the attribution travels with the command — but a change that starts
-- joining a queued bill to its shift on the tablet will meet this deliberately.
drop policy counter_shifts_select on public.counter_shifts;
create policy counter_shifts_select on public.counter_shifts
  for select to authenticated
  using (
    (
      device_id = auth.uid()
      and public.app_device_ok()
      and ended_at is null
      and expires_at > now()
    )
    or (
      public.app_account_active()
      and (
        person_id = auth.uid()
        or (select public.app_is_owner())
        or outlet_id in (select public.app_outlets_for('franchise_admin'))
      )
    )
  );
