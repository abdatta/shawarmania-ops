-- Multi-outlet hiring: one account, several initial assignments, one code;
-- and no assignment change may silently strand an outstanding activation link.
--
-- Provisioning still spans Supabase Auth and Postgres, so the Edge Function
-- keeps its existing delete-user compensation. Assignment changes are wholly
-- inside Postgres, however, and can be genuinely atomic: the assignment
-- mutation, the unchanged supersession trigger, and a conditional replacement
-- invite live in the same transaction below.

-- Serialise every issue/reissue with assignment changes for the same person.
-- A later authority change is allowed to supersede an earlier code, but two
-- concurrent transactions must not both decide they are replacing the same
-- outstanding invite.
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
  v_id uuid;
begin
  perform 1
    from public.profiles
   where id = p_profile_id
   for update;
  if not found then
    raise exception 'no such profile: %', p_profile_id using errcode = 'no_data_found';
  end if;

  update public.account_invites
     set superseded_at = now()
   where profile_id = p_profile_id
     and consumed_at is null
     and superseded_at is null;

  insert into public.account_invites
    (profile_id, code_hash, issued_by, expires_at)
  values
    (p_profile_id, p_code_hash, p_issued_by, now() + p_valid_for)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.issue_account_invite(uuid, uuid, text, interval) is
  'Atomically supersedes a person''s outstanding invite and stores one new '
  'hash. Locks the profile so invite issuance serialises with assignment '
  'changes for the same person.';

-- Grant one assignment and, only if the person held an outstanding invite
-- before the grant, replace that invite after the assignment exists. The
-- assignments_supersede_invites trigger is deliberately left to fire: it is
-- the contract that the old code dies on every authority change.
create or replace function public.grant_assignment_with_invite(
  p_person_id uuid,
  p_role public.app_role,
  p_outlet_id uuid,
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
begin
  perform 1
    from public.profiles
   where id = p_person_id
   for update;
  if not found then
    raise exception 'no such profile: %', p_person_id using errcode = 'no_data_found';
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

  return query
  select v_assignment_id, v_invite_id, v_invite_expires_at;
end;
$$;

comment on function public.grant_assignment_with_invite(
  uuid, public.app_role, uuid, uuid, text, interval
) is
  'Service-role account-admin path: grants one assignment and conditionally '
  'replaces a pending invite in the same transaction.';

-- End one assignment under the same contract. An assignment is history and is
-- never deleted; the existing guard still freezes its identity and protects
-- the last owner.
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
  v_had_invite boolean;
  v_invite_id uuid;
  v_invite_expires_at timestamptz;
begin
  select a.person_id
    into v_person_id
    from public.assignments a
   where a.id = p_assignment_id
     and a.ended_on is null;
  if not found then
    raise exception 'no such live assignment: %', p_assignment_id
      using errcode = 'no_data_found';
  end if;

  perform 1
    from public.profiles
   where id = v_person_id
   for update;

  -- Recheck after taking the per-person lock. Another privileged assignment
  -- action may have completed while this transaction was waiting.
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

  update public.assignments a
     set ended_on = current_date
   where a.id = p_assignment_id
     and a.ended_on is null;
  if not found then
    raise exception 'no such live assignment: %', p_assignment_id
      using errcode = 'no_data_found';
  end if;

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

comment on function public.end_assignment_with_invite(uuid, uuid, text, interval) is
  'Service-role account-admin path: ends one assignment and conditionally '
  'replaces a pending invite in the same transaction.';

-- These functions run with the caller's rights. Only the service role may
-- execute them; a browser session still goes through assignments RLS and its
-- guards, and can never supply a code hash to this path.
revoke execute on function public.grant_assignment_with_invite(
  uuid, public.app_role, uuid, uuid, text, interval
) from public, anon, authenticated;
revoke execute on function public.end_assignment_with_invite(
  uuid, uuid, text, interval
) from public, anon, authenticated;
grant execute on function public.grant_assignment_with_invite(
  uuid, public.app_role, uuid, uuid, text, interval
) to service_role;
grant execute on function public.end_assignment_with_invite(
  uuid, uuid, text, interval
) to service_role;
