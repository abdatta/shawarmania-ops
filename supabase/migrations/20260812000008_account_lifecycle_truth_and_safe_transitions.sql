-- Account lifecycle truth and safe transitions.
--
-- Credentials, account access and placement are independent facts. This
-- migration gives one-time links an explicit purpose and gives the privileged
-- account boundary one atomic command for a person's facts plus complete live
-- assignment set. Every function below is service-role-only: browser sessions
-- cannot bypass the Edge authority check by calling it directly.

create type public.account_invite_purpose as enum ('activation', 'password_reset');

alter table public.account_invites
  add column purpose public.account_invite_purpose not null default 'activation';

-- Only behaviorally live rows need reconstruction. Inert history remains at
-- the safe historical default because no product behavior reads it.
update public.account_invites i
   set purpose = 'password_reset'
  from auth.users u
 where u.id = i.profile_id
   and u.last_sign_in_at is not null
   and i.consumed_at is null
   and i.superseded_at is null
   and i.expires_at > now();

grant select (
  id, profile_id, issued_by, issued_at, expires_at, attempts,
  consumed_at, superseded_at, purpose
) on public.account_invites to authenticated;

-- The purpose-aware form is the canonical address. An explicit four-argument
-- compatibility wrapper below keeps already-deployed activation callers working
-- without making four- and five-argument calls ambiguous.
drop function public.issue_account_invite(uuid, uuid, text, interval);

create function public.issue_account_invite(
  p_profile_id uuid,
  p_issued_by uuid,
  p_code_hash text,
  p_valid_for interval,
  p_purpose public.account_invite_purpose
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
    from public.profiles p
   where p.id = p_profile_id and p.is_active
   for update;
  if not found then
    raise exception 'no such active profile: %', p_profile_id
      using errcode = 'no_data_found';
  end if;

  -- One purpose replaces only the same purpose. The older global-live unique
  -- index remains a defence in depth: a contradictory cross-purpose state is
  -- refused rather than silently accumulated.
  update public.account_invites
     set superseded_at = now()
   where profile_id = p_profile_id
     and purpose = p_purpose
     and consumed_at is null
     and superseded_at is null;

  insert into public.account_invites
    (profile_id, code_hash, issued_by, expires_at, purpose)
  values
    (p_profile_id, p_code_hash, p_issued_by, now() + p_valid_for, p_purpose)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.issue_account_invite(
  uuid, uuid, text, interval, public.account_invite_purpose
) from public, anon, authenticated;
grant execute on function public.issue_account_invite(
  uuid, uuid, text, interval, public.account_invite_purpose
) to service_role;

-- Keep the deployed four-argument SQL address during the Edge rollout. It is
-- an exact service-only wrapper, so existing callers retain activation
-- semantics while new callers state a purpose explicitly.
create function public.issue_account_invite(
  p_profile_id uuid,
  p_issued_by uuid,
  p_code_hash text,
  p_valid_for interval
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.issue_account_invite(
    p_profile_id, p_issued_by, p_code_hash, p_valid_for, 'activation'
  )
$$;

revoke execute on function public.issue_account_invite(uuid, uuid, text, interval)
  from public, anon, authenticated;
grant execute on function public.issue_account_invite(uuid, uuid, text, interval)
  to service_role;

comment on function public.issue_account_invite(
  uuid, uuid, text, interval, public.account_invite_purpose
) is
  'Service-only one-time handover issuance. Stores only the hash and replaces '
  'a live row of the same explicit purpose.';

-- Assignment edits invalidate only first-activation handovers. An established
-- password-reset handover remains attached to the account and redeemable after
-- placement changes.
create or replace function public.supersede_invites_on_reassignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  v_person := case tg_op when 'DELETE' then old.person_id else new.person_id end;

  update public.account_invites
     set superseded_at = now()
   where profile_id = v_person
     and purpose = 'activation'
     and consumed_at is null
     and superseded_at is null
     and expires_at > now();
  return null;
end;
$$;

-- One opaque digest covers every fact whose concurrent change could make an
-- intended-set edit stale. Ordering is explicit, so equal state hashes equally.
create function public.account_state_fingerprint(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'profile', jsonb_build_object(
            'id', p.id,
            'fullName', p.full_name,
            'phone', p.phone,
            'roleTitle', p.role_title,
            'isActive', p.is_active
          ),
          'accountEmail', e.email,
          'hasSignedIn', (u.last_sign_in_at is not null),
          'assignments', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', a.id,
                'role', a.role,
                'outletId', a.outlet_id,
                'startedOn', a.started_on
              ) order by a.id
            )
              from public.assignments a
             where a.person_id = p.id
               and a.ended_on is null
          ), '[]'::jsonb),
          'invite', (
            select jsonb_build_object(
              'id', i.id,
              'purpose', i.purpose,
              'expiresAt', i.expires_at
            )
              from public.account_invites i
             where i.profile_id = p.id
               and i.consumed_at is null
               and i.superseded_at is null
               and i.expires_at > now()
             order by i.issued_at desc
             limit 1
          )
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.account_emails e on e.profile_id = p.id
   where p.id = p_profile_id
$$;

revoke execute on function public.account_state_fingerprint(uuid)
  from public, anon, authenticated;
grant execute on function public.account_state_fingerprint(uuid) to service_role;

-- Complete current/desired authorization shared by edit and departure. The
-- actor is re-read from assignments even though the Edge boundary already did
-- so; service execution is a capability, never authorization by itself.
create function public.account_actor_may_replace_set(
  p_actor_id uuid,
  p_profile_id uuid,
  p_desired jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_is_owner boolean;
  v_actor_managed uuid[];
begin
  if p_actor_id = p_profile_id then return false; end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_actor_id and p.is_active
  ) then return false; end if;

  select exists (
    select 1 from public.assignments a
     where a.person_id = p_actor_id
       and a.role = 'super_admin'
       and a.ended_on is null
  ) into v_actor_is_owner;
  if v_actor_is_owner then return true; end if;

  select coalesce(array_agg(a.outlet_id), '{}'::uuid[])
    into v_actor_managed
    from public.assignments a
   where a.person_id = p_actor_id
     and a.role = 'franchise_admin'
     and a.ended_on is null;
  if cardinality(v_actor_managed) = 0 then return false; end if;

  if exists (
    select 1 from public.assignments a
     where a.person_id = p_profile_id
       and a.ended_on is null
       and (
         a.role not in ('employee', 'biller')
         or a.outlet_id is null
         or not (a.outlet_id = any(v_actor_managed))
       )
  ) then return false; end if;

  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p_desired, '[]'::jsonb))
        as wanted("outletId" uuid, role public.app_role)
     where wanted.role not in ('employee', 'biller')
        or wanted."outletId" is null
        or not (wanted."outletId" = any(v_actor_managed))
  ) then return false; end if;

  return true;
end;
$$;

revoke execute on function public.account_actor_may_replace_set(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.account_actor_may_replace_set(uuid, uuid, jsonb)
  to service_role;

create function public.edit_account_assignment_set(
  p_actor_id uuid,
  p_profile_id uuid,
  p_expected_fingerprint text,
  p_full_name text,
  p_phone text,
  p_role_title text,
  p_account_email text,
  p_assignments jsonb,
  p_issued_by uuid,
  p_activation_code_hash text,
  p_valid_for interval
)
returns table (
  profile_id uuid,
  state_fingerprint text,
  assignments jsonb,
  invite_id uuid,
  invite_expires_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_current_fingerprint text;
  v_actor_is_owner boolean;
  v_existing_email text;
  v_normalized_email text := public.app_normalize_account_email(p_account_email);
  v_had_live_activation boolean;
  v_invite_id uuid;
  v_invite_expires_at timestamptz;
begin
  perform 1 from public.profiles p where p.id = p_profile_id for update;
  if not found then
    raise exception 'no such profile: %', p_profile_id using errcode = 'no_data_found';
  end if;

  perform 1
    from public.assignments a
   where a.person_id = p_profile_id and a.ended_on is null
   order by a.id
   for update;

  v_current_fingerprint := public.account_state_fingerprint(p_profile_id);
  if v_current_fingerprint is distinct from p_expected_fingerprint then
    raise exception 'stale account state' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments) = 0 then
    raise exception 'ordinary edit requires a non-empty intended assignment set'
      using errcode = 'check_violation';
  end if;

  -- Parsing every row through typed record columns rejects malformed role,
  -- outlet and date values before any write occurs.
  if exists (
    select 1
      from jsonb_to_recordset(p_assignments)
        as wanted("assignmentId" uuid, "outletId" uuid,
                  role public.app_role, "startedOn" date)
     where wanted."startedOn" is null
        or (wanted.role = 'super_admin') <> (wanted."outletId" is null)
  ) then
    raise exception 'invalid intended assignment shape' using errcode = 'check_violation';
  end if;

  if (
    select count(*) from jsonb_to_recordset(p_assignments)
      as wanted("assignmentId" uuid, "outletId" uuid,
                role public.app_role, "startedOn" date)
  ) <> (
    select count(distinct coalesce(wanted."outletId"::text, 'owner'))
      from jsonb_to_recordset(p_assignments)
        as wanted("assignmentId" uuid, "outletId" uuid,
                  role public.app_role, "startedOn" date)
  ) then
    raise exception 'one live role per outlet is required' using errcode = 'unique_violation';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_assignments)
        as wanted("assignmentId" uuid, "outletId" uuid,
                  role public.app_role, "startedOn" date)
     where wanted."assignmentId" is not null
       and not exists (
         select 1 from public.assignments a
          where a.id = wanted."assignmentId"
            and a.person_id = p_profile_id
            and a.ended_on is null
       )
  ) then
    raise exception 'intended set names an unknown live assignment'
      using errcode = 'check_violation';
  end if;

  if not public.account_actor_may_replace_set(p_actor_id, p_profile_id, p_assignments) then
    raise exception 'forbidden assignment-set edit' using errcode = 'insufficient_privilege';
  end if;

  select exists (
    select 1 from public.assignments a
     where a.person_id = p_actor_id and a.role = 'super_admin' and a.ended_on is null
  ) into v_actor_is_owner;
  select e.email into v_existing_email
    from public.account_emails e where e.profile_id = p_profile_id;

  if not v_actor_is_owner and v_normalized_email is distinct from coalesce(v_existing_email, '') then
    raise exception 'franchise admin cannot change account email'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_assignments)
      as wanted(role public.app_role)
     where wanted.role = 'super_admin'
  ) then
    if not public.app_account_email_valid(v_normalized_email) then
      raise exception 'super admin assignment requires account email'
        using errcode = 'check_violation';
    end if;
    insert into public.account_emails (profile_id, email)
    values (p_profile_id, v_normalized_email)
    on conflict on constraint account_emails_pkey do update set email = excluded.email;
  elsif v_actor_is_owner and v_normalized_email <> '' then
    -- Demotion retains the private email; an explicitly supplied valid value
    -- may be normalized atomically, but null/empty never deletes the row.
    if not public.app_account_email_valid(v_normalized_email) then
      raise exception 'invalid account email' using errcode = 'check_violation';
    end if;
    insert into public.account_emails (profile_id, email)
    values (p_profile_id, v_normalized_email)
    on conflict on constraint account_emails_pkey do update set email = excluded.email;
  end if;

  select exists (
    select 1 from public.account_invites i
     where i.profile_id = p_profile_id
       and i.purpose = 'activation'
       and i.consumed_at is null
       and i.superseded_at is null
       and i.expires_at > now()
  ) into v_had_live_activation;

  update public.profiles
     set full_name = p_full_name,
         phone = p_phone,
         role_title = p_role_title
   where id = p_profile_id;

  -- Any current row not represented exactly is history from today. A desired
  -- row whose ID changed shape is inserted below as a new immutable placement.
  update public.assignments a
     set ended_on = current_date
   where a.person_id = p_profile_id
     and a.ended_on is null
     and not exists (
       select 1
         from jsonb_to_recordset(p_assignments)
           as wanted("assignmentId" uuid, "outletId" uuid,
                     role public.app_role, "startedOn" date)
        where wanted."assignmentId" = a.id
          and wanted."outletId" is not distinct from a.outlet_id
          and wanted.role = a.role
          and wanted."startedOn" = a.started_on
     );

  insert into public.assignments (person_id, role, outlet_id, started_on)
  select p_profile_id, wanted.role, wanted."outletId", wanted."startedOn"
    from jsonb_to_recordset(p_assignments)
      as wanted("assignmentId" uuid, "outletId" uuid,
                role public.app_role, "startedOn" date)
   where not exists (
     select 1 from public.assignments a
      where a.id = wanted."assignmentId"
        and a.person_id = p_profile_id
        and a.ended_on is null
        and a.outlet_id is not distinct from wanted."outletId"
        and a.role = wanted.role
        and a.started_on = wanted."startedOn"
   );

  if v_had_live_activation then
    v_invite_id := public.issue_account_invite(
      p_profile_id, p_issued_by, p_activation_code_hash, p_valid_for, 'activation'
    );
    select i.expires_at into v_invite_expires_at
      from public.account_invites i where i.id = v_invite_id;
  end if;

  return query
  select p_profile_id,
         public.account_state_fingerprint(p_profile_id),
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'role', a.role,
             'outletId', a.outlet_id,
             'startedOn', a.started_on,
             'endedOn', a.ended_on
           ) order by a.started_on, a.id)
             from public.assignments a
            where a.person_id = p_profile_id and a.ended_on is null
         ), '[]'::jsonb),
         v_invite_id,
         v_invite_expires_at;
end;
$$;

revoke execute on function public.edit_account_assignment_set(
  uuid, uuid, text, text, text, text, text, jsonb, uuid, text, interval
) from public, anon, authenticated;
grant execute on function public.edit_account_assignment_set(
  uuid, uuid, text, text, text, text, text, jsonb, uuid, text, interval
) to service_role;

create function public.mark_account_as_left(
  p_actor_id uuid,
  p_profile_id uuid,
  p_expected_fingerprint text
)
returns table (
  profile_id uuid,
  state_fingerprint text,
  assignments jsonb
)
language plpgsql
set search_path = ''
as $$
declare
  v_current_fingerprint text;
begin
  perform 1 from public.profiles p where p.id = p_profile_id for update;
  if not found then
    raise exception 'no such profile: %', p_profile_id using errcode = 'no_data_found';
  end if;
  perform 1 from public.assignments a
   where a.person_id = p_profile_id and a.ended_on is null
   order by a.id for update;

  v_current_fingerprint := public.account_state_fingerprint(p_profile_id);
  if v_current_fingerprint is distinct from p_expected_fingerprint then
    raise exception 'stale account state' using errcode = 'P0001';
  end if;

  if not public.account_actor_may_replace_set(p_actor_id, p_profile_id, '[]'::jsonb) then
    raise exception 'forbidden departure' using errcode = 'insufficient_privilege';
  end if;

  update public.assignments
     set ended_on = current_date
   where person_id = p_profile_id and ended_on is null;
  update public.profiles set is_active = false where id = p_profile_id;

  return query
  select p_profile_id,
         public.account_state_fingerprint(p_profile_id),
         '[]'::jsonb;
end;
$$;

revoke execute on function public.mark_account_as_left(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_account_as_left(uuid, uuid, text)
  to service_role;

comment on column public.account_invites.purpose is
  'Whether this one-use handover establishes the first password or replaces an established password.';
comment on function public.edit_account_assignment_set(
  uuid, uuid, text, text, text, text, text, jsonb, uuid, text, interval
) is
  'Service-only atomic profile plus complete intended live assignment-set transition with stale-state and actor-authority validation.';
comment on function public.mark_account_as_left(uuid, uuid, text) is
  'Service-only explicit departure: end every live assignment and deactivate sign-in atomically.';
