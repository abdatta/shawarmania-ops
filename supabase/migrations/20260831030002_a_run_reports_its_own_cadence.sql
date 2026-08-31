-- A run says how often it is scheduled to happen.
--
-- The surface told the owner "twice a day" for weeks after the readers moved to
-- four, because the cadence was a sentence in this repository describing crons
-- in another one. Nothing could notice: the number was prose, and prose does not
-- fail a build.
--
-- **The runner is the only thing that knows.** It runs *under* the schedule, its
-- own workflow file is in its checkout, and GitHub hands it the path in
-- `GITHUB_WORKFLOW_REF`. So it parses its own cron and reports the answer with
-- every run, and this repository stops asserting a fact it cannot check.
--
-- Recorded per run rather than as configuration, for two reasons. The health
-- line already reads the newest run, so the value costs no extra query and is
-- always the freshest thing anybody said. And a run that ran under the old
-- schedule keeps saying so, which means the history reads correctly across a
-- cadence change instead of retelling every past run under today's number.
--
-- Null means the runner did not say — an older runner, or a schedule it could
-- not read confidently. The surface falls back to its own constant and the app
-- carries on; it does not guess a cadence from timings.

alter table public.aggregator_sync_runs
  add column reads_per_day integer;

alter table public.aggregator_sync_runs
  add constraint aggregator_sync_runs_reads_per_day_sane
    check (reads_per_day is null or (reads_per_day > 0 and reads_per_day <= 288));

comment on column public.aggregator_sync_runs.reads_per_day is
  'How many times a day this run was scheduled to happen, parsed by the runner '
  'from its own workflow cron and reported with the run. Null means the runner '
  'did not say, not that it never runs. Capped at 288 (every five minutes): a '
  'larger figure is a parse gone wrong rather than a schedule anybody set.';

-- ---------------------------------------------------------------------------
-- The recorder takes it, like the other two things a run reports about itself.
--
-- Nine arguments replaces eight for the reason eight replaced seven: two
-- overloads differing only by defaulted trailing arguments make every call site
-- ambiguous to the reader, and the older one would quietly record every run as
-- having no schedule at all.

create or replace function public.record_aggregator_sync_run(
  p_outlet_id uuid,
  p_channel text,
  p_started_at timestamptz,
  p_outcome text,
  p_detail text,
  p_rehearsal boolean default false,
  p_started_by text default null,
  p_summary jsonb default null,
  p_reads_per_day integer default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.aggregator_sync_runs
    (outlet_id, channel, started_at, finished_at, outcome, detail, rehearsal,
     started_by, summary, reads_per_day)
  values (p_outlet_id, p_channel, p_started_at, now(), p_outcome,
          nullif(btrim(coalesce(p_detail, '')), ''), coalesce(p_rehearsal, false),
          nullif(btrim(coalesce(p_started_by, '')), ''),
          p_summary,
          p_reads_per_day)
  returning id;
$$;

revoke execute on function public.record_aggregator_sync_run(
  uuid, text, timestamptz, text, text, boolean, text, jsonb, integer) from public;
grant execute on function public.record_aggregator_sync_run(
  uuid, text, timestamptz, text, text, boolean, text, jsonb, integer) to service_role;

drop function if exists public.record_aggregator_sync_run(
  uuid, text, timestamptz, text, text, boolean, text, jsonb);
