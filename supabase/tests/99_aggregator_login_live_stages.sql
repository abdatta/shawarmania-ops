-- aggregator-login-live-stages (#46): the stage of a sign-in, and what it does
-- not carry with it.
--
-- The stage sits on the credentials row, beside pointers to a live merchant
-- session. So the questions are the credential boundary's own: does the stage
-- open any new way into the table (it must not), does the owner's read return
-- one word and a time and nothing replayable, and does everybody else stay out.

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

-- ---------------------------------------------------------------------------
-- 1. The columns, and the words they take.

select has_column('public', 'aggregator_channel_credentials', 'login_stage', 'the stage column exists');
select has_column('public', 'aggregator_channel_credentials', 'login_stage_at', 'and its time');
select col_is_null('public', 'aggregator_channel_credentials', 'login_stage', 'a channel with no sign-in since #46 has no stage');

select public.save_aggregator_session('zomato', 'session-token-stage', now() + interval '9 hours');

select lives_ok(
  $$update public.aggregator_channel_credentials
       set login_stage = 'waiting_for_code', login_stage_at = now()
     where channel = 'zomato'$$,
  'a stage from the vocabulary is stored'
);
select throws_ok(
  $$update public.aggregator_channel_credentials
       set login_stage = 'almost there' where channel = 'zomato'$$,
  '23514',
  null,
  'a word outside the vocabulary is refused, so a stepper cannot stall on one'
);

-- ---------------------------------------------------------------------------
-- 2. The stage opens no new door.
--
-- The whole reason Realtime was rejected: carrying the stage live would have
-- needed a select on this table. Asserted so that a later "just grant select
-- for the stepper" fails here.

select ok(
  not has_table_privilege('authenticated', 'public.aggregator_channel_credentials', 'SELECT'),
  'authenticated still has no select on the credential table'
);
select ok(
  not has_table_privilege('authenticated', 'public.aggregator_auth_requests', 'SELECT'),
  'nor on the code mailbox'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('aggregator_channel_credentials', 'aggregator_auth_requests')),
  0,
  'and neither table has gained a policy'
);

-- ---------------------------------------------------------------------------
-- 3. The owner's read: v1 plus one word and a time, nothing replayable.

select bag_eq(
  $$select returned.name::text
      from pg_proc p, unnest(p.proargnames, p.proargmodes) as returned(name, mode)
     where p.proname = 'aggregator_credential_health_v2' and returned.mode = 't'$$,
  $$values ('has_session'), ('session_expires_at'), ('has_login_identifier'),
           ('awaiting_code_since'), ('awaiting_code_expires_at'), ('awaiting_code_attempts'),
           ('login_stage'), ('login_stage_at')$$,
  'v2 returns v1''s columns plus the stage and its time, and nothing else'
);

select pg_temp.impersonate(:'OWNER'::uuid);

select is(
  (select login_stage from public.aggregator_credential_health_v2('zomato')),
  'waiting_for_code',
  'the owner reads where the sign-in has got to'
);
select ok(
  (select login_stage_at from public.aggregator_credential_health_v2('zomato')) is not null,
  'and when it got there'
);
select is(
  (select has_session from public.aggregator_credential_health_v2('zomato')),
  true,
  'v2 still answers everything v1 did'
);
select is(
  (select login_stage from public.aggregator_credential_health_v2('swiggy')),
  null,
  'a channel with no row reads as no stage rather than failing'
);

select pg_temp.unimpersonate();

-- v1 is untouched for the published build that calls it.
select bag_eq(
  $$select returned.name::text
      from pg_proc p, unnest(p.proargnames, p.proargmodes) as returned(name, mode)
     where p.proname = 'aggregator_credential_health' and returned.mode = 't'$$,
  $$values ('has_session'), ('session_expires_at'), ('has_login_identifier'),
           ('awaiting_code_since'), ('awaiting_code_expires_at'), ('awaiting_code_attempts')$$,
  'v1 keeps its shape for the build that calls it'
);

-- ---------------------------------------------------------------------------
-- 4. Everybody else is refused, at their own outlet too.

select pg_temp.impersonate(:'FA_KAL'::uuid);
select throws_ok(
  $$select * from public.aggregator_credential_health_v2('zomato')$$,
  null,
  null,
  'a franchise admin is refused the sign-in stage'
);
select pg_temp.unimpersonate();

select pg_temp.impersonate(:'BILLER_KAL'::uuid);
select throws_ok(
  $$select * from public.aggregator_credential_health_v2('zomato')$$,
  null,
  null,
  'a biller is refused the sign-in stage'
);
select pg_temp.unimpersonate();

select ok(
  not has_function_privilege('anon', 'public.aggregator_credential_health_v2(text)', 'EXECUTE'),
  'anon cannot call it at all'
);

select * from finish();
rollback;
