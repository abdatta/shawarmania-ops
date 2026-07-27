-- Account invitations: the one-time code an admin hands over so a new person
-- can set their password. No SMS provider, no mail — the code travels by hand
-- (in practice WhatsApp), which is the whole reason this table exists rather
-- than GoTrue's own invite tokens, whose delivery path is email.
--
-- Three properties carry the security of the flow, and all three are enforced
-- here rather than in application code:
--   1. The code is stored only as a hash, and that column is not readable by
--      ANY client role — not even the Super Admin (column-level grants below).
--   2. No client may insert, update or delete an invite. Every write happens
--      with the service-role key, through the two functions at the bottom.
--   3. Issuing and redeeming are each ONE statement inside ONE function, so
--      "supersede then insert" and "check then consume" cannot interleave.
--      An Edge Function that had to do this in several round trips would have
--      a race in it, and the race is the whole attack.

create table public.account_invites (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Denormalised from the profile on purpose: a policy that joined profiles to
  -- find the outlet would re-enter the RLS recursion trap (docs/ARCHITECTURE.md).
  -- It cannot drift, because a reassignment supersedes outstanding invites.
  -- Null iff the invited profile is the outlet-less Super Admin.
  outlet_id uuid references public.outlets (id),
  code_hash text not null,
  issued_by uuid not null references public.profiles (id),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  consumed_at timestamptz,
  superseded_at timestamptz
);

create index account_invites_profile_id_idx on public.account_invites (profile_id);
create index account_invites_outlet_id_idx on public.account_invites (outlet_id);

-- At most one live invite per profile, enforced by the database rather than by
-- remembering to supersede. It is also what lets redemption find "the" invite
-- for an account without ambiguity.
create unique index account_invites_one_live_per_profile
  on public.account_invites (profile_id)
  where consumed_at is null and superseded_at is null;

alter table public.account_invites enable row level security;

-- ---------------------------------------------------------------------------
-- Policy. Read-only, and only for the two roles that issue codes: the Super
-- Admin across outlets, the Franchise Admin within their own. Gated on the
-- same status helpers as every other policy, so a deactivated admin or a
-- revoked device sees nothing here either.

create policy account_invites_select on public.account_invites
  for select to authenticated
  using (
    public.app_account_active()
    and public.app_device_ok()
    and (
      public.app_role() = 'super_admin'
      or (public.app_role() = 'franchise_admin' and outlet_id = public.app_outlet_id())
    )
  );

-- ---------------------------------------------------------------------------
-- Reassignment kills outstanding codes.
--
-- A trigger rather than a step inside the provisioning function, because the
-- rule must hold no matter who moves the person — an Edge Function, a future
-- admin screen, or someone at a SQL prompt. A code issued while they were a
-- Kalyani Employee must not still work once they are a Kanchrapara Biller.

create or replace function public.supersede_invites_on_reassignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role or new.outlet_id is distinct from old.outlet_id then
    update public.account_invites
       set superseded_at = now()
     where profile_id = new.id
       and consumed_at is null
       and superseded_at is null;
  end if;
  return new;
end;
$$;

create trigger profiles_reassignment_supersedes_invites
  after update of role, outlet_id on public.profiles
  for each row execute function public.supersede_invites_on_reassignment();

-- ---------------------------------------------------------------------------
-- Issue. Supersedes whatever was outstanding and inserts the replacement in
-- one statement pair inside one transaction, so the partial unique index can
-- never see two live rows.

create or replace function public.issue_account_invite(
  p_profile_id uuid,
  p_issued_by uuid,
  p_code_hash text,
  p_valid_for interval
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
  v_exists boolean;
  v_id uuid;
begin
  select outlet_id, true into v_outlet, v_exists
    from public.profiles where id = p_profile_id;
  if not coalesce(v_exists, false) then
    raise exception 'no such profile: %', p_profile_id using errcode = 'no_data_found';
  end if;

  update public.account_invites
     set superseded_at = now()
   where profile_id = p_profile_id
     and consumed_at is null
     and superseded_at is null;

  insert into public.account_invites
    (profile_id, outlet_id, code_hash, issued_by, expires_at)
  values
    (p_profile_id, v_outlet, p_code_hash, p_issued_by, now() + p_valid_for)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Redeem. Everything except actually setting the password, which only the auth
-- admin API can do.
--
-- Returns 'ok' plus the user id, or 'invalid' and nothing — ONE failure value
-- for every failure mode (unknown address, wrong code, expired, consumed,
-- superseded, attempts exhausted, deactivated account). The caller therefore
-- cannot tell an absent account from a wrong code however carefully it looks,
-- which is what stops this endpoint being an account-enumeration oracle.

create or replace function public.redeem_account_invite(
  p_email text,
  p_code_hash text,
  p_max_attempts integer default 5
)
returns table (status text, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_inv record;
  v_consumed integer;
begin
  select u.id into v_user
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
   limit 1;

  if v_user is null then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  -- The partial unique index guarantees at most one live invite per profile.
  select * into v_inv
    from public.account_invites i
   where i.profile_id = v_user
     and i.consumed_at is null
     and i.superseded_at is null;

  if not found then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if v_inv.expires_at <= now() or v_inv.attempts >= p_max_attempts then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if v_inv.code_hash <> p_code_hash then
    -- A wrong code costs an attempt. Bounded guessing, and a targeted attempt
    -- leaves a visible trail on the row instead of being unlimited and silent.
    update public.account_invites set attempts = attempts + 1 where id = v_inv.id;
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_user and p.is_active) then
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
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  return query select 'ok'::text, v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. The local stack's hardened defaults give new tables and functions no
-- privileges to anyone, so every capability below is explicit — including
-- service_role's, which the Edge Functions need and do not inherit.
--
-- The column list is the point: code_hash is absent, so a request naming it
-- (or `select *`, which expands to it) is refused with 42501 for every client
-- role. A stolen read cannot become a stolen account.

grant select (
  id, profile_id, outlet_id, issued_by, issued_at,
  expires_at, attempts, consumed_at, superseded_at
) on public.account_invites to authenticated;

grant all on public.account_invites to service_role;

-- Defence in depth, matching profiles and counter_devices: the write verbs are
-- revoked outright, so a future policy mistake cannot quietly open them.
revoke insert, update, delete on public.account_invites from authenticated, anon;
revoke all privileges on public.account_invites from anon;

-- Both functions are service-role-only. `redeem_account_invite` in particular
-- would be an email-enumeration oracle in any other hands, and PostgREST would
-- happily expose it as an RPC to whoever holds execute.
revoke execute on function public.issue_account_invite(uuid, uuid, text, interval)
  from public, anon, authenticated;
revoke execute on function public.redeem_account_invite(text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.supersede_invites_on_reassignment()
  from public, anon, authenticated;
grant execute on function public.issue_account_invite(uuid, uuid, text, interval) to service_role;
grant execute on function public.redeem_account_invite(text, text, integer) to service_role;
