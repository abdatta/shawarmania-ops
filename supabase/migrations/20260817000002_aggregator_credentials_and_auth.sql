-- Aggregator credentials, and repairing a login from the app.
--
-- The settlement migration beside this one gave the sync somewhere to write. It
-- deliberately said nothing about how the reader signs in, because at the time
-- the answer was "a person runs a script". That is no longer the answer: the
-- owner asked to start a run and repair a session from the phone in their
-- apron, which means the identifier and the one-time password have to travel
-- through this database rather than through a terminal.
--
-- Three things are added:
--
--   1. A place to keep the Zomato session between runs, so a twice-daily job
--      keeps its own session alive on the sliding 24-hour window rather than
--      asking for an OTP every time.
--   2. A place to keep the login identifier, so a reconnect is one tap and a
--      code rather than one tap, a phone number and a code.
--   3. A mailbox for the one-time password, open for minutes and consumed once.
--
-- **Nothing here is readable by any signed-in account, including the owner.**
-- Not by policy — by there being no grant and no policy to reach for. The owner
-- can ask *about* the credential through one function that returns dates and
-- booleans, and can *set* the identifier and answer a code through the service
-- role. They can never read either back. An account that cannot read a secret
-- cannot leak one, and the owner's phone is the least protected device in this
-- system.

-- ---------------------------------------------------------------------------
-- 1. The secrets themselves live in Vault, not in a column.
--
-- This is not belt-and-braces. The owner takes production dumps as a matter of
-- routine (a snapshot was taken before the identity migration in July, and will
-- be taken again). `pg_dump` of a table containing a session JWT produces a file
-- on a laptop that grants full access to both outlets' finances for as long as
-- the sliding window holds. Vault's secrets are encrypted with a key held
-- outside the database, so the same dump carries ciphertext.
--
-- The table below therefore holds only *metadata*: which secret, saved when,
-- good until when. Everything that would be worth stealing is a uuid pointing
-- somewhere else.

create table public.aggregator_channel_credentials (
  channel text primary key,

  -- Vault secret ids. Null means "never set", which is a different state from
  -- "set and expired" and the surface says so differently.
  session_secret_id uuid,
  login_identifier_secret_id uuid,

  session_saved_at timestamptz,

  -- Zomato's `bExp`: the moment the session dies if nothing touches it. Slides
  -- forward on every use, which is the whole reason a twice-daily schedule
  -- keeps itself signed in. Stored so the app can say how long is left without
  -- being able to read the token that says it.
  session_expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint aggregator_channel_credentials_channel_known check (channel in ('zomato')),

  -- A saved session has all three or none of them. A row claiming to hold a
  -- session with no expiry would make "is it still good?" unanswerable, and the
  -- honest answer to an unanswerable question there is to refuse the row.
  constraint aggregator_channel_credentials_session_whole check (
    (session_secret_id is null and session_saved_at is null and session_expires_at is null)
    or (session_secret_id is not null and session_saved_at is not null and session_expires_at is not null)
  )
);

alter table public.aggregator_channel_credentials enable row level security;

create trigger aggregator_channel_credentials_set_updated_at
  before update on public.aggregator_channel_credentials
  for each row execute function public.set_updated_at();

comment on table public.aggregator_channel_credentials is
  'Metadata about the aggregator login. The session and identifier are Vault secrets; this table holds only their ids and validity. No client role can read it.';

-- ---------------------------------------------------------------------------
-- 2. The one-time password mailbox.
--
-- Zomato sends the code to the phone the merchant account is registered to,
-- which is in the owner's pocket, while the thing that needs it is a browser on
-- a GitHub runner. This table is the whole of the channel between them.
--
-- It is a mailbox, not a log. A code arrives, is collected once, and the column
-- is emptied. What survives is that a request happened and how it ended, which
-- is what the sync surface needs in order to say "waiting for a code" and stop
-- saying it.

create table public.aggregator_auth_requests (
  id uuid primary key default gen_random_uuid(),
  channel text not null,

  -- Which outlet the owner was looking at when they asked. The login is
  -- account-wide and repairs both outlets at once, so this is for the sentence
  -- on screen and nothing else: it must not be read as scoping the request.
  requested_from_outlet_id uuid references public.outlets (id),
  requested_by uuid references public.profiles (id),

  requested_at timestamptz not null default now(),

  -- Zomato's own code lifetime, set by the caller rather than defaulted here,
  -- because the number belongs to Zomato and hard-coding it in a constraint
  -- would make their changing it our migration.
  expires_at timestamptz not null,

  -- The code, in the clear, for the few minutes between the owner typing it and
  -- the runner collecting it. Not in Vault, deliberately: a secret whose whole
  -- life is shorter than the gap between backups, which is emptied on
  -- collection, and which is worthless once used, would cost a permanent Vault
  -- entry per reconnect and a cleanup job to match. It is unreadable by every
  -- client role, which is the requirement.
  code text,
  answered_at timestamptz,

  -- Collected by the runner. From here the code column is empty and the request
  -- can only be re-opened by the runner asking again after Zomato rejected it.
  consumed_at timestamptz,

  -- Zomato rejects a mistyped code and offers the field again. Counted so a
  -- request cannot be fed codes indefinitely, and so the surface can say "that
  -- code was not accepted" rather than silently waiting again.
  attempts integer not null default 0,

  closed_at timestamptz,
  outcome text,

  created_at timestamptz not null default now(),

  constraint aggregator_auth_requests_channel_known check (channel in ('zomato')),
  constraint aggregator_auth_requests_expires_after_request check (expires_at > requested_at),
  constraint aggregator_auth_requests_attempts_sane check (attempts between 0 and 3),
  constraint aggregator_auth_requests_code_not_blank check (
    code is null or length(btrim(code)) > 0
  ),
  constraint aggregator_auth_requests_outcome_known check (
    outcome is null or outcome in ('signed_in', 'expired', 'refused', 'abandoned')
  ),
  -- Closed and open are the two states, and `outcome` is what closed means. A
  -- row with one and not the other is a request nothing will ever finish.
  constraint aggregator_auth_requests_closed_with_outcome check (
    (closed_at is null) = (outcome is null)
  ),
  -- A code cannot be collected before it is given.
  constraint aggregator_auth_requests_consumed_after_answered check (
    consumed_at is null or answered_at is not null
  ),
  -- Emptied on collection. This is the constraint that makes "the code lives for
  -- minutes" a property of the schema rather than of the code that happens to
  -- clear it.
  constraint aggregator_auth_requests_code_cleared_on_consume check (
    consumed_at is null or code is null
  )
);

-- One open request per channel. Two would mean two runners racing for one code,
-- and the owner watching a screen that could not say which of them got it.
create unique index aggregator_auth_requests_one_open
  on public.aggregator_auth_requests (channel)
  where closed_at is null;

create index aggregator_auth_requests_recent_idx
  on public.aggregator_auth_requests (channel, requested_at desc);

alter table public.aggregator_auth_requests enable row level security;

comment on table public.aggregator_auth_requests is
  'A mailbox carrying one one-time password from the owner to a running reader. The code is emptied on collection. No client role can read this table.';

-- ---------------------------------------------------------------------------
-- 3. Grants and policies: none, on purpose.
--
-- Row level security is enabled on both tables and no policy is created, so
-- every `authenticated` request matches nothing. No select is granted either,
-- so the request fails before RLS is consulted. Two independent refusals for
-- the same thing, because this is the pair of tables where being wrong once
-- hands somebody a live merchant session.
--
-- `service_role` bypasses RLS, which is how the reader and the Edge Functions
-- reach these at all.

grant all on public.aggregator_channel_credentials to service_role;
grant all on public.aggregator_auth_requests to service_role;

-- ---------------------------------------------------------------------------
-- 4. Reading and writing the secrets.
--
-- Every one of these is `security definer` and executable by `service_role`
-- alone. They exist so that no caller ever writes `vault.decrypted_secrets` in
-- a query of their own: the Vault schema's own grants have changed across
-- Supabase releases, and a capability that depends on which release is running
-- is a capability that breaks on an upgrade nobody scheduled.

create or replace function public.save_aggregator_session(
  p_channel text,
  p_session text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if p_session is null or length(btrim(p_session)) = 0 then
    raise exception 'refusing to save an empty % session', p_channel;
  end if;

  select session_secret_id into v_secret_id
    from public.aggregator_channel_credentials where channel = p_channel;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_session,
      'aggregator_session_' || p_channel,
      'Live ' || p_channel || ' merchant session. Read only by the sync reader.'
    );
    insert into public.aggregator_channel_credentials (
      channel, session_secret_id, session_saved_at, session_expires_at
    )
    values (p_channel, v_secret_id, now(), p_expires_at)
    on conflict (channel) do update set
      session_secret_id = excluded.session_secret_id,
      session_saved_at = excluded.session_saved_at,
      session_expires_at = excluded.session_expires_at;
  else
    perform vault.update_secret(v_secret_id, p_session);
    update public.aggregator_channel_credentials
       set session_saved_at = now(),
           session_expires_at = p_expires_at
     where channel = p_channel;
  end if;
end;
$$;

create or replace function public.read_aggregator_session(p_channel text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_secret text;
begin
  select session_secret_id into v_secret_id
    from public.aggregator_channel_credentials where channel = p_channel;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where id = v_secret_id;

  return v_secret;
end;
$$;

-- Clearing the session is how a lapse is simulated deliberately, and how a
-- compromised session is revoked from this side. The metadata goes with it: a
-- row claiming an expiry for a session that is gone would have the surface
-- counting down to nothing.
create or replace function public.forget_aggregator_session(p_channel text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select session_secret_id into v_secret_id
    from public.aggregator_channel_credentials where channel = p_channel;

  update public.aggregator_channel_credentials
     set session_secret_id = null,
         session_saved_at = null,
         session_expires_at = null
   where channel = p_channel;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

create or replace function public.set_aggregator_login_identifier(
  p_channel text,
  p_identifier text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if p_identifier is null or length(btrim(p_identifier)) = 0 then
    raise exception 'refusing to save an empty % login identifier', p_channel;
  end if;

  select login_identifier_secret_id into v_secret_id
    from public.aggregator_channel_credentials where channel = p_channel;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      btrim(p_identifier),
      'aggregator_identifier_' || p_channel,
      'The identifier the ' || p_channel || ' merchant account signs in with.'
    );
    insert into public.aggregator_channel_credentials (channel, login_identifier_secret_id)
    values (p_channel, v_secret_id)
    on conflict (channel) do update set
      login_identifier_secret_id = excluded.login_identifier_secret_id;
  else
    perform vault.update_secret(v_secret_id, btrim(p_identifier));
    update public.aggregator_channel_credentials
       set updated_at = now()
     where channel = p_channel;
  end if;
end;
$$;

create or replace function public.read_aggregator_login_identifier(p_channel text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_secret text;
begin
  select login_identifier_secret_id into v_secret_id
    from public.aggregator_channel_credentials where channel = p_channel;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where id = v_secret_id;

  return v_secret;
end;
$$;

revoke execute on function public.save_aggregator_session(text, text, timestamptz) from public;
revoke execute on function public.read_aggregator_session(text) from public;
revoke execute on function public.forget_aggregator_session(text) from public;
revoke execute on function public.set_aggregator_login_identifier(text, text) from public;
revoke execute on function public.read_aggregator_login_identifier(text) from public;

grant execute on function public.save_aggregator_session(text, text, timestamptz) to service_role;
grant execute on function public.read_aggregator_session(text) to service_role;
grant execute on function public.forget_aggregator_session(text) to service_role;
grant execute on function public.set_aggregator_login_identifier(text, text) to service_role;
grant execute on function public.read_aggregator_login_identifier(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4b. Collecting the code, exactly once.
--
-- This has to be a function rather than an update issued over the API, and the
-- reason is not style. `RETURNING` yields the NEW row, and the whole point of the
-- statement is to null the code out — so an update that empties the column and
-- returns it hands back null, every time. The reader would collect nothing and
-- wait forever while the owner watched a screen saying the code had been taken.
--
-- The CTE reads the code before the update runs and `RETURNING` names the CTE's
-- copy, so the old value comes back while the column is emptied in the same
-- statement. `for update skip locked` settles the race rather than praying about
-- it: two runners cannot both collect one code, and the loser sees nothing to
-- collect rather than blocking on a lock.

create or replace function public.claim_aggregator_code(p_channel text)
returns table (request_id uuid, code text)
language sql
security definer
set search_path = ''
as $$
  with claimable as (
    select r.id, r.code
      from public.aggregator_auth_requests r
     where r.channel = p_channel
       and r.closed_at is null
       and r.consumed_at is null
       and r.code is not null
       and r.expires_at > now()
     order by r.requested_at desc
     for update skip locked
     limit 1
  ),
  claimed as (
    update public.aggregator_auth_requests r
       set consumed_at = now(), code = null
      from claimable
     where r.id = claimable.id
    returning r.id as request_id, claimable.code as code
  )
  select request_id, code from claimed;
$$;

revoke execute on function public.claim_aggregator_code(text) from public;
grant execute on function public.claim_aggregator_code(text) to service_role;

comment on function public.claim_aggregator_code(text) is
  'Hands the waiting one-time password to the reader and empties the column in the same statement. Returns the code as it was before the emptying, which a plain RETURNING cannot.';

-- ---------------------------------------------------------------------------
-- 5. What the owner is allowed to know.
--
-- The one function on this page an `authenticated` account may call, and the
-- only route from the app to any of it. It answers three questions — is there a
-- session, how long has it got, is a code being waited for — and returns
-- nothing that could be replayed.
--
-- `security definer` so it can see tables the caller cannot, with the owner
-- check written inside rather than left to RLS, because RLS is not consulted
-- for a definer function and a missing check here would be a missing check
-- everywhere.

create or replace function public.aggregator_credential_health(p_channel text)
returns table (
  has_session boolean,
  session_expires_at timestamptz,
  has_login_identifier boolean,
  awaiting_code_since timestamptz,
  awaiting_code_expires_at timestamptz,
  awaiting_code_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.app_is_owner() and public.app_account_active()) then
    raise exception 'only the owner may read the aggregator credential state';
  end if;

  return query
  select
    credential.session_secret_id is not null,
    credential.session_expires_at,
    credential.login_identifier_secret_id is not null,
    open_request.requested_at,
    open_request.expires_at,
    coalesce(open_request.attempts, 0)
  from (select p_channel as channel) as asked
  left join public.aggregator_channel_credentials as credential
    on credential.channel = asked.channel
  left join public.aggregator_auth_requests as open_request
    on open_request.channel = asked.channel
   and open_request.closed_at is null;
end;
$$;

revoke execute on function public.aggregator_credential_health(text) from public;
grant execute on function public.aggregator_credential_health(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. A run that is waiting on a person is not a run that failed.
--
-- `session_lapsed` means the session died and nobody has done anything about
-- it. `awaiting_one_time_password` means somebody already has: a login is under
-- way and it is holding for a code. Collapsing the two would have the surface
-- telling the owner to reconnect while a reconnect they started is on screen
-- waiting for them.

alter table public.aggregator_sync_runs
  drop constraint aggregator_sync_runs_outcome_known;

alter table public.aggregator_sync_runs
  add constraint aggregator_sync_runs_outcome_known check (
    outcome in (
      'ok',
      'session_lapsed',
      'awaiting_one_time_password',
      'shape_changed',
      'reconciliation_failed'
    )
  );
