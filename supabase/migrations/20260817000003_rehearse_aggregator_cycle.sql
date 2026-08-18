-- Reading a real cycle without writing it.
--
-- The first run against the live account points at production, because a GitHub
-- runner cannot reach a database on somebody's laptop. That is fine for the
-- eventual state and alarming for the first attempt: the first time this code
-- meets a real payout cycle, the owner would rather read what it decided than
-- discover it in their ledger.
--
-- So a rehearsal runs every check the real path runs, against the real payload,
-- and reports what it *would* have written. Then it throws the writes away.
--
-- **Rehearsal is a separate function, not a parameter.** A boolean on the write
-- path is a boolean that can be left set, or unset, by an Edge Function deploy
-- nobody reviewed closely. Two names cannot be confused by a default, the run
-- record says which one ran, and the surface can tell the owner that a run that
-- reported seven days wrote none of them.

-- ---------------------------------------------------------------------------
-- 1. A rehearsal is visibly a rehearsal.
--
-- Without this the sync surface would show "7 days written" for a run that
-- wrote nothing, which is the one sentence a rehearsal must never produce.

alter table public.aggregator_sync_runs
  add column rehearsal boolean not null default false;

comment on column public.aggregator_sync_runs.rehearsal is
  'True when the run read a real cycle, reconciled it, and deliberately wrote nothing.';

create or replace function public.record_aggregator_sync_run(
  p_outlet_id uuid,
  p_channel text,
  p_started_at timestamptz,
  p_outcome text,
  p_detail text,
  p_rehearsal boolean default false
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.aggregator_sync_runs
    (outlet_id, channel, started_at, finished_at, outcome, detail, rehearsal)
  values (p_outlet_id, p_channel, p_started_at, now(), p_outcome,
          nullif(btrim(coalesce(p_detail, '')), ''), coalesce(p_rehearsal, false))
  returning id;
$$;

revoke execute on function
  public.record_aggregator_sync_run(uuid, text, timestamptz, text, text, boolean) from public;
grant execute on function
  public.record_aggregator_sync_run(uuid, text, timestamptz, text, text, boolean) to service_role;

-- The five-argument form is dropped rather than left beside the six. Two
-- overloads differing only by a defaulted trailing argument make every call site
-- ambiguous to the reader, and the older one would quietly record rehearsals as
-- real runs.
drop function if exists
  public.record_aggregator_sync_run(uuid, text, timestamptz, text, text);

-- ---------------------------------------------------------------------------
-- 2. The rehearsal itself.
--
-- Calls the real function inside a subtransaction and forces that subtransaction
-- to roll back by raising, then swallows its own exception. PL/pgSQL rolls the
-- database changes back and keeps the variable assignments, which is exactly the
-- asymmetry needed here: the verdict survives, the writes do not.
--
-- Everything the real path decides is therefore decided by the real path. A
-- rehearsal that reimplemented the reconciliation gate would be testing a second
-- implementation and telling the owner about the first.

create or replace function public.rehearse_aggregator_cycle(
  p_payload jsonb,
  p_permitted_outlets uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_verdict jsonb;
  v_outlet uuid;
  v_cycle_start date;
  v_cycle_end date;
  v_before jsonb;
  v_after jsonb;
  v_would_change jsonb;
  v_expenses_before int;
  v_expenses_after int;
  v_deductions_before int;
  v_deductions_after int;
begin
  v_outlet := (p_payload ->> 'outlet_id')::uuid;
  v_cycle_start := (p_payload ->> 'cycle_start')::date;
  v_cycle_end := (p_payload ->> 'cycle_end')::date;

  /*
   * A real snapshot, taken before anything is called.
   *
   * The first version of this read the pre-image out of the `zomato_provisional_*`
   * columns, which only carry one thing: what a *settling* run moved a
   * *provisional* figure from. On the far more common first sync of a day the
   * owner typed, those columns are null, the fallback returned the new value, and
   * the report cheerfully said the day changed from 2160.00 to 2160.00.
   *
   * The typed figures are captured too, because on that first sync they are the
   * "from" that matters: the owner wants to see their own number beside Zomato's.
   */
  select jsonb_object_agg(d.business_date::text, jsonb_build_object(
           'gross_paise', d.zomato_gross_paise,
           'commission_paise', d.zomato_commission_paise,
           'net_paise', d.zomato_net_paise,
           'state', d.zomato_settlement_state,
           'typed_revenue_paise', d.zomato_revenue_paise,
           'typed_commission_bp', d.zomato_commission_bp))
    into v_before
    from public.manual_ledger_days d
   where d.outlet_id = v_outlet
     and d.business_date between v_cycle_start and v_cycle_end;

  select count(*) into v_expenses_before
    from public.manual_ledger_expenses
   where outlet_id = v_outlet and source_system = 'zomato';

  select count(*) into v_deductions_before
    from public.aggregator_cycle_deductions
   where outlet_id = v_outlet;

  begin
    v_verdict := public.ingest_aggregator_cycle(p_payload, p_permitted_outlets);

    select jsonb_object_agg(d.business_date::text, jsonb_build_object(
             'gross_paise', d.zomato_gross_paise,
             'commission_paise', d.zomato_commission_paise,
             'net_paise', d.zomato_net_paise,
             'state', d.zomato_settlement_state,
             'typed_revenue_paise', d.zomato_revenue_paise,
             'typed_commission_bp', d.zomato_commission_bp))
      into v_after
      from public.manual_ledger_days d
     where d.outlet_id = v_outlet
       and d.business_date between v_cycle_start and v_cycle_end;

    select count(*) into v_expenses_after
      from public.manual_ledger_expenses
     where outlet_id = v_outlet and source_system = 'zomato';

    select count(*) into v_deductions_after
      from public.aggregator_cycle_deductions
     where outlet_id = v_outlet;

    -- The rollback. Raised deliberately with a code nothing else uses, and
    -- caught immediately below, so the subtransaction unwinds and every write
    -- above it disappears. The variables survive it, which is the asymmetry the
    -- whole function rests on.
    raise exception 'rehearsal' using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then
      null;
  end;

  -- The diff, computed outside the block from two saved snapshots. Only days that
  -- actually moved appear: a report listing every day in the cycle would bury the
  -- one the owner needs to look at.
  select jsonb_agg(
           jsonb_build_object(
             'business_date', moved.business_date,
             'from', v_before -> moved.business_date,
             'to', v_after -> moved.business_date)
           order by moved.business_date)
    into v_would_change
    from jsonb_object_keys(coalesce(v_after, '{}'::jsonb)) as moved(business_date)
   where (v_before -> moved.business_date) is distinct from (v_after -> moved.business_date);

  return coalesce(v_verdict, jsonb_build_object('outcome', 'rehearsal_failed'))
    || jsonb_build_object(
         'rehearsal', true,
         'days_that_would_change', coalesce(v_would_change, '[]'::jsonb),
         'expenses_that_would_appear', coalesce(v_expenses_after - v_expenses_before, 0),
         'cycle_deductions_that_would_appear',
           coalesce(v_deductions_after - v_deductions_before, 0));
end;
$$;

revoke execute on function public.rehearse_aggregator_cycle(jsonb, uuid[]) from public;
grant execute on function public.rehearse_aggregator_cycle(jsonb, uuid[]) to service_role;

comment on function public.rehearse_aggregator_cycle(jsonb, uuid[]) is
  'Runs the real write contract against a real payload and throws the writes away, reporting what it would have changed.';
