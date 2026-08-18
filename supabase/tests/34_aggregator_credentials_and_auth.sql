-- The credential boundary: what nobody signed in can reach.
--
-- Every other table in this repo is proved with the question "can the wrong
-- outlet see this row". These two are proved with a stronger one: **can any
-- signed-in account see any row at all, including the owner.** They hold a live
-- merchant session and a one-time password, and the answer has to be no for
-- everybody, because the account that can read a credential is the account that
-- can leak one — and the owner's device is a phone in an apron.
--
-- The refusal is deliberately doubled: no grant, and no policy. Each test below
-- would still pass if one of the two were removed, which is the point. A
-- capability this size should not rest on remembering both.
--
-- The definer functions are checked the other way round: they are the only route
-- in, so what matters is that `authenticated` cannot execute the ones that
-- return secrets, and that the one it can execute returns no secret to return.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

create function pg_temp.impersonate(p_sub uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text,
    true);
  execute 'set local role authenticated';
end;
$$;

create function pg_temp.unimpersonate()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

\set OWNER '10000000-0000-4000-a000-000000000001'
\set FA_KAL '10000000-0000-4000-a000-000000000002'
\set BILLER_KAL '10000000-0000-4000-a000-00000000000a'
\set EMPLOYEE_KAL '10000000-0000-4000-a000-000000000006'
\set KAL '00000000-0000-4000-a000-000000000001'

-- ---------------------------------------------------------------------------
-- 1. The tables are unreachable by everybody who signs in.

select ok(
  not has_table_privilege('authenticated', 'public.aggregator_channel_credentials', 'SELECT'),
  'authenticated is granted no select on the credential table'
);
select ok(
  not has_table_privilege('authenticated', 'public.aggregator_auth_requests', 'SELECT'),
  'authenticated is granted no select on the auth request table'
);
select ok(
  not has_table_privilege('anon', 'public.aggregator_channel_credentials', 'SELECT'),
  'anon is granted no select on the credential table'
);
select ok(
  not has_table_privilege('anon', 'public.aggregator_auth_requests', 'SELECT'),
  'anon is granted no select on the auth request table'
);

-- Row level security is on and carries no policy, so even if a grant were added
-- back by mistake there is nothing for a request to match. Proved from the
-- catalog rather than by attempting a read, because the grant already refuses
-- and a passing read test would not tell us which of the two did the work.
select is(
  (select relrowsecurity from pg_class where oid = 'public.aggregator_channel_credentials'::regclass),
  true,
  'row level security is enabled on the credential table'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'aggregator_channel_credentials')::int,
  0,
  'the credential table carries no policy, so authenticated matches nothing'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.aggregator_auth_requests'::regclass),
  true,
  'row level security is enabled on the auth request table'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'aggregator_auth_requests')::int,
  0,
  'the auth request table carries no policy, so authenticated matches nothing'
);

-- And the same claim made the way somebody would actually try it. The owner is
-- used on purpose: they are the one role that reaches every other table in this
-- capability, so they are the one whose refusal here is worth stating.
select pg_temp.impersonate(:'OWNER'::uuid);

select throws_ok(
  'select * from public.aggregator_channel_credentials',
  '42501',
  null,
  'the owner is refused the credential table outright'
);
select throws_ok(
  'select * from public.aggregator_auth_requests',
  '42501',
  null,
  'the owner is refused the auth request table outright'
);

select pg_temp.unimpersonate();

-- ---------------------------------------------------------------------------
-- 2. The secret-bearing functions are service_role only.
--
-- These are `security definer`, so an accidental grant to `authenticated` would
-- hand a signed-in phone a live merchant session with no policy in the way. The
-- revoke is the only thing standing there, and it is worth an assertion each.

select ok(
  not has_function_privilege(
    'authenticated', 'public.read_aggregator_session(text)', 'EXECUTE'),
  'authenticated cannot execute the session reader'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.save_aggregator_session(text, text, timestamptz)', 'EXECUTE'),
  'authenticated cannot execute the session writer'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.read_aggregator_login_identifier(text)', 'EXECUTE'),
  'authenticated cannot execute the identifier reader'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.set_aggregator_login_identifier(text, text)', 'EXECUTE'),
  'authenticated cannot execute the identifier writer'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.forget_aggregator_session(text)', 'EXECUTE'),
  'authenticated cannot revoke the session'
);
select ok(
  has_function_privilege(
    'service_role', 'public.read_aggregator_session(text)', 'EXECUTE'),
  'the service role can read the session, since the reader is the point'
);

-- ---------------------------------------------------------------------------
-- 3. A session round-trips, and is never in the table.

select public.set_aggregator_login_identifier('zomato', '9999999999');
select public.save_aggregator_session('zomato', 'session-token-abc', now() + interval '24 hours');

select is(
  public.read_aggregator_session('zomato'),
  'session-token-abc',
  'the reader gets back exactly what was saved'
);
select is(
  public.read_aggregator_login_identifier('zomato'),
  '9999999999',
  'the identifier round-trips too'
);

-- The claim that makes the Vault detour worth its complexity: a dump of the
-- public schema carries no session. The owner takes production dumps as a
-- matter of routine, and a token in a column would be a token on a laptop.
select is(
  (select count(*) from public.aggregator_channel_credentials
    where channel = 'zomato'
      and (session_secret_id::text like '%session-token%'
        or login_identifier_secret_id::text like '%9999999999%'))::int,
  0,
  'the credential table holds ids, not values'
);

-- Saving again updates in place rather than stacking secrets. A reconnect every
-- few weeks that left the old session behind would leave a trail of live
-- credentials nobody is watching.
select public.save_aggregator_session('zomato', 'session-token-def', now() + interval '24 hours');
select is(
  public.read_aggregator_session('zomato'),
  'session-token-def',
  'a re-save replaces the session'
);
select is(
  (select count(*) from vault.secrets where name = 'aggregator_session_zomato')::int,
  1,
  'and leaves exactly one secret behind, not a pile of old ones'
);

select throws_ok(
  $$select public.save_aggregator_session('zomato', '   ', now() + interval '24 hours')$$,
  null,
  null,
  'an empty session is refused rather than stored as a session that exists'
);

-- ---------------------------------------------------------------------------
-- 4. Forgetting a session really forgets it.
--
-- This is the path the OTP test drives: the session is dropped on purpose to
-- watch the app repair it. If forget left the secret behind, that test would
-- prove the reconnect worked while the old session was doing the work.

select public.forget_aggregator_session('zomato');
select is(public.read_aggregator_session('zomato'), null, 'the session is gone');
select is(
  (select count(*) from vault.secrets where name = 'aggregator_session_zomato')::int,
  0,
  'and so is the secret, not just the pointer to it'
);
select is(
  (select session_expires_at from public.aggregator_channel_credentials where channel = 'zomato'),
  null,
  'the expiry goes with it, so nothing counts down to a session that is gone'
);
select is(
  public.read_aggregator_login_identifier('zomato'),
  '9999999999',
  'the identifier survives, since forgetting a session is not forgetting the account'
);

-- ---------------------------------------------------------------------------
-- 5. The health function tells the owner enough and no more.

select public.save_aggregator_session('zomato', 'session-token-ghi', now() + interval '9 hours');

select pg_temp.impersonate(:'OWNER'::uuid);

select is(
  (select has_session from public.aggregator_credential_health('zomato')),
  true,
  'the owner can learn that a session exists'
);
select ok(
  (select session_expires_at from public.aggregator_credential_health('zomato')) > now(),
  'and when it runs out'
);
select is(
  (select has_login_identifier from public.aggregator_credential_health('zomato')),
  true,
  'and that the account has an identifier on file'
);

-- The whole reason this returns booleans and timestamps: there is no column in
-- its result that could be replayed against Zomato. Stated as an assertion so
-- that adding one later fails here rather than in production.
-- Read from `pg_proc` rather than `information_schema.columns`: a set-returning
-- function's columns are OUT parameters and never appear there, so the obvious
-- query returns nothing and an assertion built on it passes while checking
-- absolutely nothing.
select bag_eq(
  $$select returned.name::text
      from pg_proc p, unnest(p.proargnames, p.proargmodes) as returned(name, mode)
     where p.proname = 'aggregator_credential_health' and returned.mode = 't'$$,
  $$values ('has_session'), ('session_expires_at'), ('has_login_identifier'),
           ('awaiting_code_since'), ('awaiting_code_expires_at'), ('awaiting_code_attempts')$$,
  'the health function returns nothing that could be replayed'
);

select pg_temp.unimpersonate();

-- Every other role is refused it, including at their own outlet. A manager
-- learning that the owner's Zomato session expires at 3am learns something
-- about when a sync is unattended.
select pg_temp.impersonate(:'FA_KAL'::uuid);
select throws_ok(
  $$select * from public.aggregator_credential_health('zomato')$$,
  null,
  null,
  'a franchise admin is refused the credential state'
);
select pg_temp.unimpersonate();

select pg_temp.impersonate(:'BILLER_KAL'::uuid);
select throws_ok(
  $$select * from public.aggregator_credential_health('zomato')$$,
  null,
  null,
  'a biller is refused the credential state'
);
select pg_temp.unimpersonate();

select pg_temp.impersonate(:'EMPLOYEE_KAL'::uuid);
select throws_ok(
  $$select * from public.aggregator_credential_health('zomato')$$,
  null,
  null,
  'an employee is refused the credential state'
);
select pg_temp.unimpersonate();

-- ---------------------------------------------------------------------------
-- 6. The one-time password mailbox.

insert into public.aggregator_auth_requests
  (channel, requested_from_outlet_id, requested_by, expires_at)
values ('zomato', :'KAL'::uuid, :'OWNER'::uuid, now() + interval '5 minutes');

-- One open request per channel. Two would be two runners racing for one code,
-- and a screen that could not say which of them got it.
select throws_ok(
  format(
    $$insert into public.aggregator_auth_requests (channel, requested_by, expires_at)
      values ('zomato', %L, now() + interval '5 minutes')$$,
    :'OWNER'::uuid),
  '23505',
  null,
  'a second open request for the same channel is refused'
);

-- Closing the first one frees the channel, which is what makes a retry possible
-- after Zomato rejects a code.
update public.aggregator_auth_requests
   set closed_at = now(), outcome = 'refused'
 where channel = 'zomato' and closed_at is null;

select lives_ok(
  format(
    $$insert into public.aggregator_auth_requests (channel, requested_by, expires_at)
      values ('zomato', %L, now() + interval '5 minutes')$$,
    :'OWNER'::uuid),
  'once the first is closed, another request can open'
);

select throws_ok(
  $$update public.aggregator_auth_requests set closed_at = now() where closed_at is null$$,
  '23514',
  null,
  'a request cannot be closed without saying how it ended'
);

-- The constraint that makes "the code lives for minutes" a property of the
-- schema. Code plus consumed is the state this table exists to make
-- unrepresentable: a collected code still sitting in a column is a credential
-- waiting for a backup to carry it away.
update public.aggregator_auth_requests
   set code = '123456', answered_at = now()
 where closed_at is null;

select throws_ok(
  $$update public.aggregator_auth_requests set consumed_at = now() where closed_at is null$$,
  '23514',
  null,
  'a code cannot be marked collected while it is still in the column'
);

select lives_ok(
  $$update public.aggregator_auth_requests
      set consumed_at = now(), code = null where closed_at is null$$,
  'collecting a code and emptying it is one statement, so it cannot half-happen'
);

-- Collected before given is a sequence that would mean the runner read a code
-- nobody sent.
update public.aggregator_auth_requests set closed_at = now(), outcome = 'signed_in'
 where closed_at is null;

select throws_ok(
  format(
    $$insert into public.aggregator_auth_requests
        (channel, requested_by, expires_at, consumed_at)
      values ('zomato', %L, now() + interval '5 minutes', now())$$,
    :'OWNER'::uuid),
  '23514',
  null,
  'a code cannot be collected before it was answered'
);

select throws_ok(
  format(
    $$insert into public.aggregator_auth_requests (channel, requested_by, expires_at, attempts)
      values ('zomato', %L, now() + interval '5 minutes', 4)$$,
    :'OWNER'::uuid),
  '23514',
  null,
  'a request cannot be fed codes indefinitely'
);

select throws_ok(
  format(
    $$insert into public.aggregator_auth_requests (channel, requested_by, expires_at)
      values ('zomato', %L, now() - interval '1 minute')$$,
    :'OWNER'::uuid),
  '23514',
  null,
  'a request cannot expire before it was made'
);

-- ---------------------------------------------------------------------------
-- 6b. Collecting the code, exactly once.
--
-- The claim that made this a function rather than an update: `RETURNING` yields
-- the NEW row, and the statement's purpose is to empty the code column, so the
-- obvious version returns null and the reader collects nothing while the owner
-- watches a screen saying their code was taken.

insert into public.aggregator_auth_requests
  (channel, requested_from_outlet_id, requested_by, expires_at)
values ('zomato', :'KAL'::uuid, :'OWNER'::uuid, now() + interval '5 minutes');

update public.aggregator_auth_requests
   set code = '654321', answered_at = now()
 where channel = 'zomato' and closed_at is null;

create temporary table first_claim as select * from public.claim_aggregator_code('zomato');

select is(
  (select code from first_claim),
  '654321',
  'the reader is handed the code as it was before the column was emptied'
);

select is(
  (select count(*)::int from public.claim_aggregator_code('zomato')),
  0,
  'and a second collection finds nothing, so two runners cannot share one code'
);

-- Addressed by the id the claim returned, not by channel. Section 6 above leaves
-- several closed requests behind on purpose, and a subquery matching all of them
-- fails on the row count rather than on the claim being tested.
select is(
  (select code from public.aggregator_auth_requests
    where id = (select request_id from first_claim)),
  null,
  'the code is gone from the column'
);

select ok(
  (select consumed_at is not null and answered_at is not null
     from public.aggregator_auth_requests
    where id = (select request_id from first_claim)),
  'and the row records both that it arrived and that it was taken'
);

-- An expired code is not collected. The reader would submit it, Zomato would
-- refuse it, and an attempt would be spent on a code that was never going to
-- work.
-- Backdated whole, request and expiry together. Setting only the expiry into the
-- past trips `expires_after_request`, which is the constraint doing its job: a
-- request cannot have expired before it was made, so an expired one is an old
-- one.
update public.aggregator_auth_requests
   set code = '111111', answered_at = now(), consumed_at = null,
       requested_at = now() - interval '10 minutes',
       expires_at = now() - interval '5 minutes'
 where id = (select request_id from first_claim);

select is(
  (select count(*)::int from public.claim_aggregator_code('zomato')),
  0,
  'an expired code is left where it is rather than handed over'
);

select ok(
  not has_function_privilege(
    'authenticated', 'public.claim_aggregator_code(text)', 'EXECUTE'),
  'and no signed-in account can collect a code, which would be reading one'
);

update public.aggregator_auth_requests
   set closed_at = now(), outcome = 'expired', code = null
 where id = (select request_id from first_claim);

-- ---------------------------------------------------------------------------
-- 7. A reconnect under way is not a failure.
--
-- Told apart so the surface does not tell the owner to reconnect while the
-- reconnect they started is on screen waiting for them.

select lives_ok(
  format(
    $$insert into public.aggregator_sync_runs (outlet_id, channel, started_at, outcome)
      values (%L, 'zomato', now(), 'awaiting_one_time_password')$$,
    :'KAL'::uuid),
  'a run can report that it is holding for a code'
);

select throws_ok(
  format(
    $$insert into public.aggregator_sync_runs (outlet_id, channel, started_at, outcome)
      values (%L, 'zomato', now(), 'gave_up')$$,
    :'KAL'::uuid),
  '23514',
  null,
  'and cannot report an outcome nobody handles'
);

select * from finish();
rollback;
