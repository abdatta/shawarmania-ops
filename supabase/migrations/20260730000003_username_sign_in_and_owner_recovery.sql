-- Username sign-in and private owner recovery.
--
-- Supabase Auth remains the password/session authority. A canonical username
-- is encoded as a deliberately non-deliverable Auth alias:
--
--   <username>@login.shawarmania.invalid
--
-- The alias is provider plumbing, never a person's email. A real email is
-- retained only in private account_emails when explicitly associated with an
-- account. Every live Super Admin must have one; another role may have none.

-- ---------------------------------------------------------------------------
-- Canonical username and account-email helpers.

create or replace function public.app_normalize_username(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(input, '')))
$$;

create or replace function public.app_username_valid(input text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    char_length(public.app_normalize_username(input)) between 3 and 30
    and public.app_normalize_username(input) ~ '^[a-z0-9._]+$'
    and public.app_normalize_username(input) !~ '^\.'
    and public.app_normalize_username(input) !~ '\.$'
    and public.app_normalize_username(input) !~ '\.\.'
$$;

create or replace function public.app_username_from_auth_alias(input text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_alias text := lower(btrim(coalesce(input, '')));
  v_suffix constant text := '@login.shawarmania.invalid';
  v_username text;
begin
  if not right(v_alias, char_length(v_suffix)) = v_suffix then
    return null;
  end if;

  v_username := left(v_alias, char_length(v_alias) - char_length(v_suffix));
  if not public.app_username_valid(v_username) then
    return null;
  end if;
  return public.app_normalize_username(v_username);
end;
$$;

create or replace function public.app_normalize_account_email(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(input, '')))
$$;

create or replace function public.app_account_email_valid(input text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    char_length(public.app_normalize_account_email(input)) between 3 and 320
    and public.app_normalize_account_email(input)
      ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
$$;

revoke execute on function public.app_normalize_username(text)
  from public, anon, authenticated;
revoke execute on function public.app_username_valid(text)
  from public, anon, authenticated;
revoke execute on function public.app_username_from_auth_alias(text)
  from public, anon, authenticated;
revoke execute on function public.app_normalize_account_email(text)
  from public, anon, authenticated;
revoke execute on function public.app_account_email_valid(text)
  from public, anon, authenticated;
grant execute on function public.app_normalize_username(text) to service_role;
grant execute on function public.app_username_valid(text) to service_role;
grant execute on function public.app_username_from_auth_alias(text) to service_role;
grant execute on function public.app_normalize_account_email(text) to service_role;
grant execute on function public.app_account_email_valid(text) to service_role;

-- ---------------------------------------------------------------------------
-- Private optional account emails.

create table public.account_emails (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_emails_email_normalized
    check (email = public.app_normalize_account_email(email)),
  constraint account_emails_email_valid
    check (public.app_account_email_valid(email)),
  constraint account_emails_email_unique unique (email)
);

create trigger account_emails_set_updated_at
  before update on public.account_emails
  for each row execute function public.set_updated_at();

alter table public.account_emails enable row level security;

-- No client policy exists. The grant revocation is an independent boundary:
-- a future accidental policy still cannot expose private account emails.
revoke all privileges on public.account_emails
  from public, anon, authenticated;
grant all privileges on public.account_emails to service_role;

-- Existing live Super Admins retain their current real Auth address as their
-- account email. The operator-reviewed migration later changes the same Auth user to a
-- reserved alias without touching this private copy.
insert into public.account_emails (profile_id, email)
select distinct a.person_id, public.app_normalize_account_email(u.email)
  from public.assignments a
  join public.profiles p on p.id = a.person_id
  join auth.users u on u.id = a.person_id
 where a.role = 'super_admin'
   and a.ended_on is null
   and public.app_account_email_valid(u.email);

-- The one-way invariant is checked after the completed transaction so
-- privileged operations can write assignment plus account email atomically,
-- while a hand-crafted owner assignment without email still fails at commit.
create or replace function public.enforce_super_admin_account_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid;
  v_is_owner boolean;
  v_has_account_email boolean;
begin
  if tg_table_name = 'assignments' then
    v_person := new.person_id;
  else
    v_person := case when tg_op = 'DELETE' then old.profile_id else new.profile_id end;
  end if;

  select exists (
    select 1
      from public.assignments a
     where a.person_id = v_person
       and a.role = 'super_admin'
       and a.ended_on is null
  ) into v_is_owner;

  select exists (
    select 1
      from public.account_emails r
     where r.profile_id = v_person
  ) into v_has_account_email;

  if v_is_owner and not v_has_account_email then
    raise exception
      'a live super admin assignment requires one account email'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger assignments_super_admin_account_email
  after insert or update of role, ended_on on public.assignments
  deferrable initially deferred
  for each row execute function public.enforce_super_admin_account_email();

create constraint trigger account_email_owner_requirement
  after insert or update or delete on public.account_emails
  deferrable initially deferred
  for each row execute function public.enforce_super_admin_account_email();

revoke execute on function public.enforce_super_admin_account_email()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic provisioning and Super Admin account-email maintenance.

create or replace function public.provision_account_with_invite(
  p_profile_id uuid,
  p_full_name text,
  p_phone text,
  p_role public.app_role,
  p_outlet_ids uuid[],
  p_role_title text,
  p_started_on date,
  p_account_email text,
  p_issued_by uuid,
  p_code_hash text,
  p_valid_for interval
)
returns table (
  profile_id uuid,
  invite_id uuid,
  invite_expires_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_account_email text := public.app_normalize_account_email(p_account_email);
  v_invite_id uuid;
  v_invite_expires_at timestamptz;
begin
  if btrim(coalesce(p_full_name, '')) = '' then
    raise exception 'a person needs a name' using errcode = 'check_violation';
  end if;

  if p_role = 'super_admin' then
    if cardinality(p_outlet_ids) <> 0
       or not public.app_account_email_valid(v_account_email) then
      raise exception 'super admin provisioning requires account email and no outlets'
        using errcode = 'check_violation';
    end if;
  else
    if cardinality(p_outlet_ids) < 1
       or (select count(distinct outlet_id) from unnest(p_outlet_ids) outlet_id)
          <> cardinality(p_outlet_ids)
       or v_account_email <> '' then
      raise exception 'outlet role provisioning has invalid outlets or account email'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.profiles (id, full_name, phone, is_active, role_title)
  values (p_profile_id, p_full_name, p_phone, true, p_role_title);

  if p_role = 'super_admin' then
    insert into public.account_emails (profile_id, email)
    values (p_profile_id, v_account_email);

    insert into public.assignments (person_id, role, outlet_id, started_on)
    values (p_profile_id, p_role, null, coalesce(p_started_on, current_date));
  else
    insert into public.assignments (person_id, role, outlet_id, started_on)
    select p_profile_id, p_role, outlet_id, coalesce(p_started_on, current_date)
      from unnest(p_outlet_ids) outlet_id;
  end if;

  v_invite_id := public.issue_account_invite(
    p_profile_id,
    p_issued_by,
    p_code_hash,
    p_valid_for
  );
  select expires_at
    into v_invite_expires_at
    from public.account_invites
   where id = v_invite_id;

  return query select p_profile_id, v_invite_id, v_invite_expires_at;
end;
$$;

revoke execute on function public.provision_account_with_invite(
  uuid, text, text, public.app_role, uuid[], text, date, text, uuid, text, interval
) from public, anon, authenticated;
grant execute on function public.provision_account_with_invite(
  uuid, text, text, public.app_role, uuid[], text, date, text, uuid, text, interval
) to service_role;

create or replace function public.set_super_admin_account_email(
  p_profile_id uuid,
  p_email text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_email text := public.app_normalize_account_email(p_email);
begin
  perform 1
    from public.assignments
   where person_id = p_profile_id
     and role = 'super_admin'
     and ended_on is null
   for update;
  if not found or not public.app_account_email_valid(v_email) then
    raise exception 'account email update requires a live super admin assignment'
      using errcode = 'check_violation';
  end if;

  insert into public.account_emails (profile_id, email)
  values (p_profile_id, v_email)
  on conflict (profile_id) do update set email = excluded.email;
end;
$$;

revoke execute on function public.set_super_admin_account_email(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_super_admin_account_email(uuid, text)
  to service_role;

-- Granting an owner role writes its account email in the same transaction.
drop function public.grant_assignment_with_invite(
  uuid, public.app_role, uuid, uuid, text, interval
);

create function public.grant_assignment_with_invite(
  p_person_id uuid,
  p_role public.app_role,
  p_outlet_id uuid,
  p_account_email text,
  p_issued_by uuid,
  p_code_hash text,
  p_valid_for interval
)
returns table (
  assignment_id uuid,
  invite_id uuid,
  invite_expires_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_had_invite boolean;
  v_invite_id uuid;
  v_invite_expires_at timestamptz;
  v_account_email text := public.app_normalize_account_email(p_account_email);
begin
  perform 1
    from public.profiles
   where id = p_person_id
   for update;
  if not found then
    raise exception 'no such profile: %', p_person_id using errcode = 'no_data_found';
  end if;

  if p_role = 'super_admin' then
    if p_outlet_id is not null or not public.app_account_email_valid(v_account_email) then
      raise exception 'super admin grant requires account email and no outlet'
        using errcode = 'check_violation';
    end if;
    insert into public.account_emails (profile_id, email)
    values (p_person_id, v_account_email)
    on conflict (profile_id) do update set email = excluded.email;
  elsif v_account_email <> '' then
    raise exception 'ordinary assignment cannot carry account email'
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1
      from public.account_invites
     where profile_id = p_person_id
       and consumed_at is null
       and superseded_at is null
  ) into v_had_invite;

  insert into public.assignments (person_id, role, outlet_id)
  values (p_person_id, p_role, p_outlet_id)
  returning id into v_assignment_id;

  if v_had_invite then
    v_invite_id := public.issue_account_invite(
      p_person_id,
      p_issued_by,
      p_code_hash,
      p_valid_for
    );
    select expires_at
      into v_invite_expires_at
      from public.account_invites
     where id = v_invite_id;
  end if;

  return query select v_assignment_id, v_invite_id, v_invite_expires_at;
end;
$$;

revoke execute on function public.grant_assignment_with_invite(
  uuid, public.app_role, uuid, text, uuid, text, interval
) from public, anon, authenticated;
grant execute on function public.grant_assignment_with_invite(
  uuid, public.app_role, uuid, text, uuid, text, interval
) to service_role;

-- Ending the final live Super Admin assignment retains its private account
-- email as a permanent alternate sign-in identifier. The existing last-owner
-- guard still proves another owner remains before the assignment ends.
create or replace function public.end_assignment_with_invite(
  p_assignment_id uuid,
  p_issued_by uuid,
  p_code_hash text,
  p_valid_for interval
)
returns table (
  person_id uuid,
  assignment_id uuid,
  invite_id uuid,
  invite_expires_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_person_id uuid;
  v_role public.app_role;
  v_had_invite boolean;
  v_invite_id uuid;
  v_invite_expires_at timestamptz;
begin
  select a.person_id, a.role
    into v_person_id, v_role
    from public.assignments a
   where a.id = p_assignment_id
     and a.ended_on is null;
  if not found then
    raise exception 'no such live assignment: %', p_assignment_id
      using errcode = 'no_data_found';
  end if;

  perform 1 from public.profiles where id = v_person_id for update;

  perform 1
    from public.assignments a
   where a.id = p_assignment_id
     and a.person_id = v_person_id
     and a.ended_on is null;
  if not found then
    raise exception 'no such live assignment: %', p_assignment_id
      using errcode = 'no_data_found';
  end if;

  select exists (
    select 1
      from public.account_invites
     where profile_id = v_person_id
       and consumed_at is null
       and superseded_at is null
  ) into v_had_invite;

  update public.assignments
     set ended_on = current_date
   where id = p_assignment_id
     and ended_on is null;

  if v_had_invite then
    v_invite_id := public.issue_account_invite(
      v_person_id,
      p_issued_by,
      p_code_hash,
      p_valid_for
    );
    select expires_at
      into v_invite_expires_at
      from public.account_invites
     where id = v_invite_id;
  end if;

  return query
  select v_person_id, p_assignment_id, v_invite_id, v_invite_expires_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invite preview and redemption resolve the current username from Auth.

drop function public.preview_account_invite(text, text);
create function public.preview_account_invite(
  p_code_hash text,
  p_ip_hash text default null
)
returns table (status text, username text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv record;
  v_username text;
begin
  if public.invite_attempts_exceeded(p_ip_hash) then
    return query select 'rate_limited'::text, null::text;
    return;
  end if;

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

  select public.app_username_from_auth_alias(u.email)
    into v_username
    from auth.users u
   where u.id = v_inv.profile_id;

  if v_username is null then
    perform public.record_invite_failure(p_ip_hash);
    return query select 'invalid'::text, null::text;
    return;
  end if;

  return query select 'ok'::text, v_username;
end;
$$;

drop function public.redeem_account_invite(text, text);
create function public.redeem_account_invite(
  p_code_hash text,
  p_username text,
  p_ip_hash text default null
)
returns table (status text, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv record;
  v_username text;
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

  select public.app_username_from_auth_alias(u.email)
    into v_username
    from auth.users u
   where u.id = v_inv.profile_id;

  if v_username is null then
    perform public.record_invite_failure(p_ip_hash);
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if not public.app_username_valid(p_username)
     or public.app_normalize_username(p_username) <> v_username then
    perform public.record_invite_failure(p_ip_hash);
    return query select 'username_mismatch'::text, null::uuid;
    return;
  end if;

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

revoke execute on function public.preview_account_invite(text, text)
  from public, anon, authenticated;
revoke execute on function public.redeem_account_invite(text, text, text)
  from public, anon, authenticated;
grant execute on function public.preview_account_invite(text, text) to service_role;
grant execute on function public.redeem_account_invite(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Enumeration-safe email sign-in resolution and attempt ledger.

create table public.email_sign_in_attempts (
  id bigint generated always as identity primary key,
  ip_hash text,
  email_hash text not null,
  attempted_at timestamptz not null default now()
);

create index email_sign_in_attempts_at_idx
  on public.email_sign_in_attempts (attempted_at desc);
create index email_sign_in_attempts_email_idx
  on public.email_sign_in_attempts (email_hash, attempted_at desc);

alter table public.email_sign_in_attempts enable row level security;
revoke all privileges on public.email_sign_in_attempts
  from public, anon, authenticated;
grant all privileges on public.email_sign_in_attempts to service_role;

create or replace function public.resolve_email_sign_in(
  p_email text,
  p_ip_hash text,
  p_window interval default interval '15 minutes',
  p_per_ip integer default 30,
  p_per_email integer default 10,
  p_global integer default 1000
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.app_normalize_account_email(p_email);
  v_email_hash text;
  v_ip_count bigint;
  v_email_count bigint;
  v_global_count bigint;
  v_auth_alias text;
begin
  v_email_hash := encode(extensions.digest(v_email, 'sha256'), 'hex');

  delete from public.email_sign_in_attempts
   where attempted_at <= now() - p_window;

  select count(*),
         count(*) filter (where p_ip_hash is not null and ip_hash = p_ip_hash),
         count(*) filter (where email_hash = v_email_hash)
    into v_global_count, v_ip_count, v_email_count
    from public.email_sign_in_attempts
   where attempted_at > now() - p_window;

  insert into public.email_sign_in_attempts (ip_hash, email_hash)
  values (p_ip_hash, v_email_hash);

  if v_global_count >= p_global
     or v_ip_count >= p_per_ip
     or v_email_count >= p_per_email
     or not public.app_account_email_valid(v_email) then
    return null;
  end if;

  select u.email
    into v_auth_alias
    from public.account_emails e
    join public.profiles p on p.id = e.profile_id and p.is_active
    join auth.users u on u.id = e.profile_id
   where e.email = v_email
     and public.app_username_from_auth_alias(u.email) is not null
   limit 1;

  return v_auth_alias;
end;
$$;

revoke execute on function public.resolve_email_sign_in(
  text, text, interval, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.resolve_email_sign_in(
  text, text, interval, integer, integer, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- Enumeration-safe owner recovery resolution and attempt ledger.

create table public.owner_recovery_attempts (
  id bigint generated always as identity primary key,
  ip_hash text,
  email_hash text not null,
  attempted_at timestamptz not null default now()
);

create index owner_recovery_attempts_at_idx
  on public.owner_recovery_attempts (attempted_at desc);
create index owner_recovery_attempts_email_idx
  on public.owner_recovery_attempts (email_hash, attempted_at desc);

alter table public.owner_recovery_attempts enable row level security;
revoke all privileges on public.owner_recovery_attempts
  from public, anon, authenticated;
grant all privileges on public.owner_recovery_attempts to service_role;

create or replace function public.resolve_owner_recovery(
  p_email text,
  p_ip_hash text,
  p_window interval default interval '15 minutes',
  p_per_ip integer default 5,
  p_per_email integer default 3,
  p_global integer default 100
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.app_normalize_account_email(p_email);
  v_email_hash text;
  v_ip_count bigint;
  v_email_count bigint;
  v_global_count bigint;
  v_profile_id uuid;
begin
  v_email_hash := encode(extensions.digest(v_email, 'sha256'), 'hex');

  delete from public.owner_recovery_attempts
   where attempted_at <= now() - p_window;

  select count(*),
         count(*) filter (where p_ip_hash is not null and ip_hash = p_ip_hash),
         count(*) filter (where email_hash = v_email_hash)
    into v_global_count, v_ip_count, v_email_count
    from public.owner_recovery_attempts
   where attempted_at > now() - p_window;

  insert into public.owner_recovery_attempts (ip_hash, email_hash)
  values (p_ip_hash, v_email_hash);

  if v_global_count >= p_global
     or v_ip_count >= p_per_ip
     or v_email_count >= p_per_email
     or not public.app_account_email_valid(v_email) then
    return null;
  end if;

  select c.profile_id
    into v_profile_id
    from public.account_emails c
    join public.profiles p on p.id = c.profile_id and p.is_active
   where c.email = v_email
     and exists (
       select 1
         from public.assignments a
        where a.person_id = c.profile_id
          and a.role = 'super_admin'
          and a.ended_on is null
     )
   limit 1;

  return v_profile_id;
end;
$$;

revoke execute on function public.resolve_owner_recovery(
  text, text, interval, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.resolve_owner_recovery(
  text, text, interval, integer, integer, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- Deployment readiness.
--
-- GitHub Pages is static: once a bundle is published it cannot wait for a
-- database migration or an Edge Function to catch up. The deployment workflow
-- therefore calls email-sign-in before it uploads the permanent username UI.
-- Only the service-role function behind that endpoint may inspect these
-- invariants, and it returns one boolean rather than counts or identifiers.

create or replace function public.username_rollout_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- At least one active live Super Admin remains able to operate the system.
    exists (
      select 1
        from public.assignments a
        join public.profiles p on p.id = a.person_id
        join public.account_emails e on e.profile_id = a.person_id
       where a.role = 'super_admin'
         and a.ended_on is null
         and p.is_active
    )
    -- Every non-deleted Auth account is the same human profile, carries a
    -- canonical reserved alias, and has a matching email-provider identity.
    and not exists (
      select 1
        from auth.users u
        left join public.profiles p on p.id = u.id
       where u.deleted_at is null
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
    -- No application profile was orphaned from its Auth identity.
    and not exists (
      select 1
        from public.profiles p
        left join auth.users u
          on u.id = p.id
         and u.deleted_at is null
       where u.id is null
          or public.app_username_from_auth_alias(u.email) is null
    )
    -- The deferred write constraint protects new transactions; this explicit
    -- read protects an existing production state at the release boundary.
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

revoke execute on function public.username_rollout_ready()
  from public, anon, authenticated;
grant execute on function public.username_rollout_ready() to service_role;

comment on table public.account_emails is
  'Optional private alternate sign-in email; required for every live Super '
  'Admin. No client role has table privileges or an RLS policy.';
comment on table public.email_sign_in_attempts is
  'Enumeration-safe email sign-in ledger. Stores only hashed IP and email.';
comment on table public.owner_recovery_attempts is
  'Enumeration-safe owner recovery ledger. Stores only hashed IP and address.';
