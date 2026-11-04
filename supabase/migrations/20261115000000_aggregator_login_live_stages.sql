-- aggregator-login-live-stages (#46): a sign-in under way says where it has got
-- to. No gate: a clean revert away from the counter (proposal, Change gate).
--
-- Everything here is new: two nullable columns no published build selects or
-- writes, and a v2 of the owner's health read. v1 is left exactly as it is for
-- the build that calls it.

-- ---------------------------------------------------------------------------
-- 1. The stage lives on the channel's credentials row.
--
-- Not on the code mailbox, which is where the first draft put it: the mailbox
-- opens only when the code screen renders, and the first three stages happen
-- before that. The credentials row is the channel's sign-in record, there is
-- one per channel, and `login.yml` already allows one sign-in per channel at a
-- time, so one stage per channel is the true shape.
--
-- The table keeps its two refusals — no grant, no policy — and nothing here
-- touches either. A client learns the stage only through the definer read in
-- section 2, which is the point: the transport that would have needed a grant
-- (Realtime) is the one this change rejected.
--
-- The check is inline on a new nullable column, so it cannot refuse a write a
-- published build makes: no published build writes this column.

alter table public.aggregator_channel_credentials
  add column login_stage text check (
    login_stage in (
      'starting',
      'opening_portal',
      'signing_in',
      'waiting_for_code',
      'checking_code',
      'bringing_hyperpure',
      'done',
      'stopped'
    )
  ),
  add column login_stage_at timestamptz;

comment on column public.aggregator_channel_credentials.login_stage is
  'Where the latest full sign-in for this channel has got to. Written by the dispatch and the reader door (service role) only; read by the owner through aggregator_credential_health_v2. Null before the first sign-in after #46.';
comment on column public.aggregator_channel_credentials.login_stage_at is
  'When login_stage was last recorded. The surface judges a stage quiet from this, so it is written only when a stage is reached.';

-- ---------------------------------------------------------------------------
-- 2. The owner's health read, with the stage.
--
-- Everything v1 returns, plus the stage and its time. Still dates, booleans and
-- one word from a closed list: nothing that could be replayed against a
-- platform, which test 34 asserts column by column.

create function public.aggregator_credential_health_v2(p_channel text)
returns table (
  has_session boolean,
  session_expires_at timestamptz,
  has_login_identifier boolean,
  awaiting_code_since timestamptz,
  awaiting_code_expires_at timestamptz,
  awaiting_code_attempts integer,
  login_stage text,
  login_stage_at timestamptz
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
    coalesce(open_request.attempts, 0),
    credential.login_stage,
    credential.login_stage_at
  from (select p_channel as channel) as asked
  left join public.aggregator_channel_credentials as credential
    on credential.channel = asked.channel
  left join public.aggregator_auth_requests as open_request
    on open_request.channel = asked.channel
   and open_request.closed_at is null;
end;
$$;

revoke execute on function public.aggregator_credential_health_v2(text) from public;
grant execute on function public.aggregator_credential_health_v2(text) to authenticated;
