-- A run records how it began, and what it changed.
--
-- The sync surface reports the last run and nothing else, and three whole
-- classes of run are invisible even while they are happening. #48 turns the
-- surface's second section into a history of runs, and a history is only worth
-- reading if each line says what the run actually did.
--
-- Two columns on `aggregator_sync_runs`, no new table and no new index. The
-- read is "this run's changes", which is a fetch of the run's own row either
-- way; a child table would add a join, an index, a policy and an isolation case
-- to serve a payload that is rendered as prose and never filtered (design D1).
--
-- **Why this is recorded rather than derived**, stated once here so nobody has
-- to rediscover it. `aggregator_channel_days.superseded_*` and `provisional_*`
-- capture the movements settling chose to mark, not the movements that
-- happened. After the write commits, a day restated identically is
-- indistinguishable from a day touched, and a first measurement looks like
-- every other row. The question "what did THIS run change" stops being
-- answerable the moment the transaction ends — so it is answered inside it.

-- ---------------------------------------------------------------------------
-- 1. How the run began.
--
-- Posted by the process that ran it, never inferred. Two scheduled runs and one
-- the owner asked for inside the same minute are indistinguishable by time, and
-- this list exists to be believed.
--
-- Named `started_by` rather than `origin` deliberately (design D4).
-- `aggregator_channel_days.origin` already exists in this domain, is read
-- through the same adapter file, and its four values all name where a FIGURE
-- came from; a second `origin` a table away meaning something else would be
-- read as the same kind of thing.

alter table public.aggregator_sync_runs
  add column started_by text,
  add column summary jsonb;

alter table public.aggregator_sync_runs
  add constraint aggregator_sync_runs_started_by_known
    check (started_by is null or started_by in ('schedule', 'owner'));

comment on column public.aggregator_sync_runs.started_by is
  'How this run began, reported by the process that ran it: ''schedule'' for a '
  'timed read, ''owner'' for one somebody asked for. Never inferred from timing '
  'or from which control was on screen. NOTE: unlike every other _by column in '
  'this schema this is a word, not a uuid — the check constraint above is what '
  'makes that unmistakable. Null means a run recorded before #48, not a run '
  'nobody started.';

comment on column public.aggregator_sync_runs.summary is
  'What this run changed, determined inside the transaction that wrote it: '
  'business days whose figures moved (old and new), days measured for the first '
  'time, the cycle that settled against its payout, supply orders added or '
  'amended, and dates left unwritten for want of a recorded day. Money is '
  'integer paise. Only movement is recorded — a day restated identically '
  'contributes nothing. Null means a run recorded before #48, not a run that '
  'changed nothing; a run that changed nothing carries an empty summary.';

-- ---------------------------------------------------------------------------
-- 2. No new policy, and that is the assertion rather than the assumption.
--
-- `aggregator_sync_runs` already carries an owner-only select policy with no
-- outlet-role predicate anywhere in it, and a policy is a rule about rows, not
-- about columns — so two new columns on an existing row are covered by
-- construction. The isolation suite re-asserts it against these two columns by
-- name rather than trusting this paragraph.

-- ---------------------------------------------------------------------------
-- 3. The recorder carries both.
--
-- The seven-argument form replaces the six for the same reason the six replaced
-- the five: two overloads differing only by defaulted trailing arguments make
-- every call site ambiguous to the reader, and the older one would quietly
-- record every run as having begun nowhere and changed nothing.

create or replace function public.record_aggregator_sync_run(
  p_outlet_id uuid,
  p_channel text,
  p_started_at timestamptz,
  p_outcome text,
  p_detail text,
  p_rehearsal boolean default false,
  p_started_by text default null,
  p_summary jsonb default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.aggregator_sync_runs
    (outlet_id, channel, started_at, finished_at, outcome, detail, rehearsal,
     started_by, summary)
  values (p_outlet_id, p_channel, p_started_at, now(), p_outcome,
          nullif(btrim(coalesce(p_detail, '')), ''), coalesce(p_rehearsal, false),
          -- Constrained rather than trusted: the runner posts one of two words
          -- and anything else is a bug worth failing on, not a value to store.
          nullif(btrim(coalesce(p_started_by, '')), ''),
          p_summary)
  returning id;
$$;

revoke execute on function public.record_aggregator_sync_run(
  uuid, text, timestamptz, text, text, boolean, text, jsonb) from public;
grant execute on function public.record_aggregator_sync_run(
  uuid, text, timestamptz, text, text, boolean, text, jsonb) to service_role;

drop function if exists
  public.record_aggregator_sync_run(uuid, text, timestamptz, text, text, boolean);
