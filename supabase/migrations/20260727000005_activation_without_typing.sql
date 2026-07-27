-- Activation by code alone: the one-time code becomes the lookup key, and the
-- email address stops being one.
--
-- `code_hash` was always a plain SHA-256 of the normalised code, so the code
-- already identified the invite; the address was only ever a second key for a
-- row the first key found. Removing it removes the field a person on their
-- first day can mistype, and lets the address be *shown* to them instead —
-- which is safe precisely because the code is now the key, so anyone who can
-- ask has already proven possession of a live, single-use code for that one
-- account.
--
-- Two consequences this migration has to carry:
--
--   1. A code that identifies its own invite gives a WRONG code no invite to
--      charge, so `account_invites.attempts` can never increment again. The
--      column stays for the rows that already have one; the guessing bound
--      moves to the endpoint, below. Pretending the per-invite counter still
--      protects anything would be the dangerous half-measure.
--   2. "At most one live invite per profile" no longer implies "a code
--      identifies one invite". That needs its own constraint.

-- ---------------------------------------------------------------------------
-- A live code identifies exactly one invite.
--
-- Fifty bits makes a collision impossible in practice, which is an argument
-- rather than a constraint. It is also the index the new lookup rides on, so
-- the guarantee is free.

create unique index account_invites_live_code
  on public.account_invites (code_hash)
  where consumed_at is null and superseded_at is null;

-- ---------------------------------------------------------------------------
-- The guessing bound, moved to the endpoint.
--
-- Only FAILURES are recorded. A shop onboarding ten people in a morning from
-- one connection spends none of its budget, while a blind guesser produces
-- nothing but failures and so pays for all of it.
--
-- The address is stored as a hash and never in the clear: this table would
-- otherwise accumulate the IP addresses of staff activating accounts —
-- personal data, indefinitely, for a counter that only needs equality.

create table public.invite_redemption_attempts (
  id bigint generated always as identity primary key,
  -- Null when the caller's address could not be determined. Such attempts
  -- still count toward the global bound, which is the one that matters.
  ip_hash text,
  attempted_at timestamptz not null default now()
);

create index invite_redemption_attempts_at_idx
  on public.invite_redemption_attempts (attempted_at desc);

alter table public.invite_redemption_attempts enable row level security;

-- No policy, deliberately. Nothing reads this table directly — not even the
-- Super Admin, who sees only the aggregate through `invite_failure_pressure`.
-- RLS with no policy is deny-all, and the grants below say the same thing
-- twice on purpose.
grant all on public.invite_redemption_attempts to service_role;
revoke all privileges on public.invite_redemption_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recording and checking. Two functions rather than one so the guard can run
-- before anything is looked up while the record is written only on the way
-- out — a limited caller must not learn that its request reached an invite.

create or replace function public.record_invite_failure(
  p_ip_hash text,
  p_window interval default interval '15 minutes'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Opportunistic pruning: the window is all anybody asks about, so anything
  -- older is dead weight. Cheap at this size, and it means no scheduled job.
  delete from public.invite_redemption_attempts
   where attempted_at <= now() - p_window;

  insert into public.invite_redemption_attempts (ip_hash) values (p_ip_hash);
end;
$$;

-- 20 failures from one address, 500 across the endpoint, per quarter hour.
--
-- Deliberately loose, and the global number deliberately far looser than the
-- per-address one. Against 50 bits, 500 tries a quarter hour is roughly 2^15 a
-- day and still some 2^34 short of mattering, so tightening it buys nothing
-- measurable — while a *tight* global bound is itself an attack, since a few
-- hundred deliberate failures would then stall every real activation for the
-- rest of the window. The limit exists to turn "the search space is big" back
-- into a bound the design states; the admin notice fires long before it, and
-- that is the part meant to be reached.
create or replace function public.invite_attempts_exceeded(
  p_ip_hash text,
  p_window interval default interval '15 minutes',
  p_per_ip integer default 20,
  p_global integer default 500
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_global bigint;
  v_ip bigint;
begin
  select count(*),
         count(*) filter (where p_ip_hash is not null and ip_hash = p_ip_hash)
    into v_global, v_ip
    from public.invite_redemption_attempts
   where attempted_at > now() - p_window;

  return v_global >= p_global or v_ip >= p_per_ip;
end;
$$;

-- ---------------------------------------------------------------------------
-- Preview: resolve a code to the address its account will sign in with.
--
-- Consumes nothing and advances nothing, so a person can be shown the address,
-- decide it is not theirs, and leave the code exactly as redeemable as they
-- found it.
--
-- 'invalid' covers every non-live code — unknown, expired, consumed,
-- superseded, deactivated account — for the same reason redemption does: a
-- distinguishable refusal would make this an account-enumeration oracle.
-- 'rate_limited' is allowed to be specific, because it describes the caller
-- and not any account.

create or replace function public.preview_account_invite(
  p_code_hash text,
  p_ip_hash text default null
)
returns table (status text, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv record;
  v_email text;
begin
  if public.invite_attempts_exceeded(p_ip_hash) then
    return query select 'rate_limited'::text, null::text;
    return;
  end if;

  -- The partial unique index above makes this at most one row.
  select * into v_inv
    from public.account_invites i
   where i.code_hash = p_code_hash
     and i.consumed_at is null
     and i.superseded_at is null;

  if not found or v_inv.expires_at <= now() then
    perform public.record_invite_failure(p_ip_hash);
    return query select 'invalid'::text, null::text;
    return;
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = v_inv.profile_id and p.is_active
  ) then
    perform public.record_invite_failure(p_ip_hash);
    return query select 'invalid'::text, null::text;
    return;
  end if;

  select u.email::text into v_email from auth.users u where u.id = v_inv.profile_id;

  if v_email is null then
    perform public.record_invite_failure(p_ip_hash);
    return query select 'invalid'::text, null::text;
    return;
  end if;

  return query select 'ok'::text, v_email;
end;
$$;

-- ---------------------------------------------------------------------------
-- Redeem, keyed on the code. Everything except actually setting the password,
-- which only the auth admin API can do.

create or replace function public.redeem_account_invite(
  p_code_hash text,
  p_ip_hash text default null
)
returns table (status text, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv record;
  v_consumed integer;
begin
  if public.invite_attempts_exceeded(p_ip_hash) then
    return query select 'rate_limited'::text, null::uuid;
    return;
  end if;

  select * into v_inv
    from public.account_invites i
   where i.code_hash = p_code_hash
     and i.consumed_at is null
     and i.superseded_at is null;

  if not found or v_inv.expires_at <= now() then
    perform public.record_invite_failure(p_ip_hash);
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = v_inv.profile_id and p.is_active
  ) then
    perform public.record_invite_failure(p_ip_hash);
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  -- Atomic single consumption: two simultaneous redemptions of the same code
  -- cannot both win, because only one UPDATE can see consumed_at as null.
  update public.account_invites
     set consumed_at = now()
   where id = v_inv.id and consumed_at is null;
  get diagnostics v_consumed = row_count;

  if v_consumed <> 1 then
    perform public.record_invite_failure(p_ip_hash);
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  return query select 'ok'::text, v_inv.profile_id;
end;
$$;

-- The address-keyed form is gone. It is service-role only and unreachable from
-- any client, but it is a redemption path whose whole risk profile is "if this
-- were ever granted to anon, it is an enumeration oracle". Dead code shaped
-- like that should not linger.
drop function public.redeem_account_invite(text, text, integer);

-- ---------------------------------------------------------------------------
-- What an admin can see of all this.
--
-- The count, and nothing else: a hashed address and a timestamp hold nothing
-- anybody can act on beyond "something is happening", and the count is the
-- actionable part. A burst of failed redemptions is a brand-wide signal about
-- the endpoint rather than an outlet's operational business, so it is the
-- Super Admin's — the same reasoning that put the geofence in their hands.

create or replace function public.invite_failure_pressure(
  p_window interval default interval '15 minutes'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.app_account_active() or public.app_role() is distinct from 'super_admin' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_count
    from public.invite_redemption_attempts
   where attempted_at > now() - p_window;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. The local stack's hardened defaults give new functions no privileges
-- to anyone, so every capability is explicit.

revoke execute on function public.record_invite_failure(text, interval)
  from public, anon, authenticated;
revoke execute on function public.invite_attempts_exceeded(text, interval, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.preview_account_invite(text, text)
  from public, anon, authenticated;
revoke execute on function public.redeem_account_invite(text, text)
  from public, anon, authenticated;

grant execute on function public.record_invite_failure(text, interval) to service_role;
grant execute on function public.invite_attempts_exceeded(text, interval, integer, integer)
  to service_role;
grant execute on function public.preview_account_invite(text, text) to service_role;
grant execute on function public.redeem_account_invite(text, text) to service_role;

-- The one function here a signed-in client may call. It checks the caller's
-- role itself rather than trusting the grant, so a future policy or grant
-- mistake cannot quietly widen it.
revoke execute on function public.invite_failure_pressure(interval) from public, anon;
grant execute on function public.invite_failure_pressure(interval) to authenticated, service_role;
