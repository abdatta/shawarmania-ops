-- Hyperpure joins the channels the owner can see the health of — and only those.
--
-- Model A: Hyperpure rides Zomato's login, so its session is stored and each read
-- records its outcome, but it has no one-time-password, no payout cycle and no
-- revenue day of its own. This proves both halves at once: the two channels it now
-- shares, and the four shapes it must not have leaked into. The second half is the
-- real point — widening a channel check is easy to do too broadly.

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
\set KAL '00000000-0000-4000-a000-000000000001'

-- ---------------------------------------------------------------------------
-- 1. A Hyperpure session round-trips through the credential store.

select public.save_aggregator_session('hyperpure', 'hp-session-xyz', now() + interval '24 hours');
select is(
  public.read_aggregator_session('hyperpure'),
  'hp-session-xyz',
  'the credential store accepts and returns a hyperpure session'
);

-- ---------------------------------------------------------------------------
-- 2. The owner can read Hyperpure's health, and it reports the live session with
--    no code ever awaited — because Hyperpure has no password of its own.

select pg_temp.impersonate(:'OWNER'::uuid);
select ok(
  (select has_session from public.aggregator_credential_health('hyperpure')),
  'the owner sees a live hyperpure session in the health view'
);
select ok(
  (select awaiting_code_since from public.aggregator_credential_health('hyperpure')) is null,
  'no one-time-password is ever awaited for hyperpure'
);
select pg_temp.unimpersonate();

-- ---------------------------------------------------------------------------
-- 3. A Hyperpure read records its outcome, so a failure is the owner's to see
--    rather than a red CI job only a maintainer reads.

select public.record_aggregator_sync_run(
  :'KAL'::uuid, 'hyperpure', now() - interval '1 minute', 'ok', null, false);
select is(
  (select count(*) from public.aggregator_sync_runs
     where channel = 'hyperpure' and outcome = 'ok')::int,
  1,
  'a hyperpure read is recorded like a zomato one'
);

select public.record_aggregator_sync_run(
  :'KAL'::uuid, 'hyperpure', now(), 'shape_changed', 'the SOA lost a column', false);
select is(
  (select count(*) from public.aggregator_sync_runs
     where channel = 'hyperpure' and outcome = 'shape_changed')::int,
  1,
  'a failed hyperpure read is recorded, not silently dropped'
);

-- ---------------------------------------------------------------------------
-- 4. What Model A must NOT have leaked into.

-- Hyperpure has no one-time-password mailbox. The insert is byte-for-byte the
-- zomato one that succeeds elsewhere; only the channel differs, so the sole reason
-- it can fail is the channel check.
select throws_ok(
  $$insert into public.aggregator_auth_requests
      (channel, requested_from_outlet_id, requested_by, expires_at)
    values ('hyperpure', '00000000-0000-4000-a000-000000000001'::uuid,
            '10000000-0000-4000-a000-000000000001'::uuid, now() + interval '5 minutes')$$,
  '23514',
  null,
  'the one-time-password mailbox still refuses hyperpure'
);

-- No payout-cycle or revenue-day shape carries hyperpure.
select ok(
  pg_get_constraintdef((select oid from pg_constraint
    where conname = 'aggregator_channel_days_channel_known')) not like '%hyperpure%',
  'the revenue-day table stays zomato-only'
);
select ok(
  pg_get_constraintdef((select oid from pg_constraint
    where conname = 'aggregator_cycle_deductions_channel_known')) not like '%hyperpure%',
  'the cycle-deduction table stays zomato-only'
);
select ok(
  pg_get_constraintdef((select oid from pg_constraint
    where conname = 'aggregator_cycle_reconciliations_channel_known')) not like '%hyperpure%',
  'the cycle-reconciliation table stays zomato-only'
);

-- And the two that did widen actually admit hyperpure at the constraint level.
select ok(
  pg_get_constraintdef((select oid from pg_constraint
    where conname = 'aggregator_channel_credentials_channel_known')) like '%hyperpure%',
  'the credential table admits hyperpure'
);
select ok(
  pg_get_constraintdef((select oid from pg_constraint
    where conname = 'aggregator_sync_runs_channel_known')) like '%hyperpure%',
  'the sync-run table admits hyperpure'
);

select * from finish();
rollback;
