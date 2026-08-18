-- What reconciliation concluded about each payout cycle.
--
-- The gate computes three figures for every settled cycle — what the orders and
-- deductions came to, what the aggregator says it paid, and the gap — and then throws
-- all three away. The outcome survives only as a word on the run (`ok` or
-- `reconciliation_failed`) and a sentence of prose with no numbers in it.
--
-- That is enough to refuse a week and not enough to explain one. The owner-facing
-- surface is meant to say "this week is off by ₹79.15, here is what to do about it",
-- and ₹79.15 is exactly the figure being discarded. A disputed day carries no better
-- record either: when a cycle is refused its day figures are deliberately left
-- untouched, so they are the OLD numbers and the computed total cannot be recovered
-- from them.
--
-- So one row per cycle per outlet, written whichever way the gate decided. Both
-- outcomes, not only the failures: a week that reconciled is the evidence that it did,
-- and "settled, ₹10,642.70, matched to the paisa" is worth being able to show.

create table public.aggregator_cycle_reconciliations (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  channel text not null,

  cycle_start date not null,
  cycle_end date not null,

  -- What this system computed from the orders and deductions it read.
  computed_paise bigint not null,
  -- What the aggregator states it paid for that cycle.
  stated_payout_paise bigint not null,

  -- `reconciled` the two agree within the tolerance; `disputed` they do not.
  -- Deliberately not carrying the tolerance itself: it is a property of the contract,
  -- not of a cycle, and storing it per row would invite two rows disagreeing about
  -- what "agree" means.
  outcome text not null,

  -- The moment the owner accepted the gap, where they did. Null on a cycle that
  -- reconciled and on one still waiting for a decision.
  accepted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint aggregator_cycle_reconciliations_channel_known check (channel in ('zomato')),
  constraint aggregator_cycle_reconciliations_outcome_known check (
    outcome in ('reconciled', 'disputed')
  ),
  constraint aggregator_cycle_reconciliations_cycle_ordered check (cycle_end >= cycle_start),
  -- One conclusion per cycle. A second row would mean two answers to "did this week
  -- add up", and the surface would have to pick one.
  constraint aggregator_cycle_reconciliations_one_per_cycle
    unique (outlet_id, channel, cycle_start),
  -- Only a disputed cycle can have been accepted. Accepting a week that reconciled
  -- describes a decision nobody had to make.
  constraint aggregator_cycle_reconciliations_accepted_only_when_disputed check (
    accepted_at is null or outcome = 'disputed'
  )
);

create index aggregator_cycle_reconciliations_outlet_cycle_idx
  on public.aggregator_cycle_reconciliations (outlet_id, cycle_start desc);

alter table public.aggregator_cycle_reconciliations enable row level security;

create trigger aggregator_cycle_reconciliations_set_updated_at
  before update on public.aggregator_cycle_reconciliations
  for each row execute function public.set_updated_at();

-- Owner-only, and with deliberately no outlet-role predicate, exactly as the three
-- tables this joins. It says what an outlet earned and what was paid for it, which is
-- settlement money by another name.
grant select on public.aggregator_cycle_reconciliations to authenticated;
grant all on public.aggregator_cycle_reconciliations to service_role;

create policy aggregator_cycle_reconciliations_select
  on public.aggregator_cycle_reconciliations
  for select to authenticated
  using (public.app_is_owner() and public.app_account_active());

comment on table public.aggregator_cycle_reconciliations is
  'One row per payout cycle per outlet: what was computed, what was stated, and which way the gate decided. Written by ingest_aggregator_cycle, read by the owner.';

-- ---------------------------------------------------------------------------
-- The write contract records its own conclusion.
--
-- Two lines added to a function otherwise unchanged from
-- 20260818000001: one before the refusal returns, one on the way through a cycle that
-- reconciled. Replaced whole because PL/pgSQL has no way to patch a body.

create or replace function public.ingest_aggregator_cycle(
  p_payload jsonb,
  p_permitted_outlets uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $ingest$
declare
  v_outlet uuid;
  v_channel text;
  v_cycle_start date;
  v_cycle_end date;
  v_state text;
  v_stated_payout bigint;
  v_accepted_by uuid;
  v_cutover time;
  v_orders_net bigint;
  v_deductions bigint;
  v_cycle_deductions bigint;
  v_computed bigint;
  v_difference bigint;
  v_unattributed text;
  v_written int := 0;
  v_pending text;
  v_day record;
  v_existing record;
  v_tolerance constant bigint := 100;
  v_synced_from date;
  v_deductions_skipped int := 0;
begin
  if coalesce((p_payload ->> 'contract_version')::int, 0) <> 1 then
    raise exception 'unsupported contract version %',
      coalesce(p_payload ->> 'contract_version', 'none')
      using errcode = '22023';
  end if;

  v_outlet  := (p_payload ->> 'outlet_id')::uuid;
  v_channel := p_payload ->> 'channel';
  v_cycle_start := (p_payload ->> 'cycle_start')::date;
  v_cycle_end   := (p_payload ->> 'cycle_end')::date;
  v_state       := p_payload ->> 'cycle_state';
  v_stated_payout := nullif(p_payload ->> 'stated_payout_paise', '')::bigint;
  v_accepted_by   := nullif(p_payload ->> 'accepted_by', '')::uuid;

  if v_outlet is null or not (v_outlet = any (p_permitted_outlets)) then
    raise exception 'this credential may not write settlement for outlet %', v_outlet
      using errcode = '42501';
  end if;

  if v_channel is distinct from 'zomato' then
    raise exception 'unknown channel %', v_channel using errcode = '22023';
  end if;

  if v_state not in ('provisional', 'settled') then
    raise exception 'a cycle arrives provisional or settled, not %', v_state
      using errcode = '22023';
  end if;

  select business_day_cutover into v_cutover from public.outlets where id = v_outlet;
  if v_cutover is null then
    raise exception 'unknown outlet %', v_outlet using errcode = '22023';
  end if;

  select synced_from into v_synced_from
    from public.outlet_channel_sync
   where outlet_id = v_outlet and channel = v_channel;

  if v_synced_from is null then
    raise exception 'the % sync is not switched on for outlet %', v_channel, v_outlet
      using errcode = '22023';
  end if;

  select string_agg(o ->> 'order_id', ', ')
    into v_unattributed
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
   where nullif(o ->> 'placed_at', '') is null;

  if v_unattributed is not null then
    raise exception 'these orders carry no placement time and were not written: %',
      v_unattributed using errcode = '22023';
  end if;

  select coalesce(sum((o ->> 'net_paise')::bigint), 0)
    into v_orders_net
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o;

  select coalesce(sum((d ->> 'amount_paise')::bigint), 0)
    into v_deductions
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d;

  select coalesce(sum((c ->> 'amount_paise')::bigint), 0)
    into v_cycle_deductions
    from jsonb_array_elements(coalesce(p_payload -> 'cycle_deductions', '[]'::jsonb)) c;

  v_computed := v_orders_net + v_cycle_deductions - v_deductions;
  v_difference := case when v_stated_payout is null then null
                       else v_computed - v_stated_payout end;

  if v_state = 'settled' then
    if v_stated_payout is null then
      raise exception 'a settled cycle must state the payout it is reconciled against'
        using errcode = '22023';
    end if;

    -- The conclusion, whichever way it went, before anything acts on it. Recorded
    -- here rather than at each exit so there is one place it is written and no path
    -- out of this branch that forgets to.
    insert into public.aggregator_cycle_reconciliations
      (outlet_id, channel, cycle_start, cycle_end, computed_paise, stated_payout_paise,
       outcome, accepted_at)
    values (v_outlet, v_channel, v_cycle_start, v_cycle_end, v_computed, v_stated_payout,
            case when abs(v_difference) > v_tolerance then 'disputed' else 'reconciled' end,
            case when abs(v_difference) > v_tolerance and v_accepted_by is not null
                 then now() else null end)
    on conflict (outlet_id, channel, cycle_start) do update set
      cycle_end = excluded.cycle_end,
      computed_paise = excluded.computed_paise,
      stated_payout_paise = excluded.stated_payout_paise,
      outcome = excluded.outcome,
      -- An acceptance already recorded is not withdrawn by a later re-read. The owner
      -- made that decision about that gap, and a run finding the same gap again has
      -- not unmade it.
      accepted_at = coalesce(public.aggregator_cycle_reconciliations.accepted_at,
                             excluded.accepted_at);

    if abs(v_difference) > v_tolerance and v_accepted_by is null then
      update public.manual_ledger_days
         set zomato_settlement_state = 'disputed'
       where outlet_id = v_outlet
         and business_date between v_cycle_start and v_cycle_end
         and business_date >= v_synced_from
         and zomato_settlement_state = 'provisional';

      return jsonb_build_object(
        'outcome', 'reconciliation_failed',
        'computed_paise', v_computed,
        'stated_payout_paise', v_stated_payout,
        'difference_paise', v_difference);
    end if;
  end if;

  create temporary table if not exists ingest_days (
    business_date date primary key,
    gross_paise bigint,
    commission_paise bigint
  ) on commit drop;
  truncate table ingest_days;

  insert into ingest_days (business_date, gross_paise, commission_paise)
  select public.app_business_date((o ->> 'placed_at')::timestamptz, v_cutover),
         sum((o ->> 'gross_paise')::bigint),
         case
           when count(*) filter (where (o ->> 'commission_paise') is null) > 0 then null
           else sum((o ->> 'commission_paise')::bigint)
         end
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
   group by 1;

  for v_day in select * from ingest_days order by business_date loop
    select * into v_existing
      from public.manual_ledger_days
     where outlet_id = v_outlet and business_date = v_day.business_date;

    if not found then
      continue;
    end if;

    if v_day.business_date < v_synced_from then
      continue;
    end if;

    if v_existing.zomato_settlement_state = 'settled' then
      continue;
    end if;

    update public.manual_ledger_days d
       set zomato_revenue_paise = v_day.gross_paise,
           zomato_commission_paise = v_day.commission_paise,
           zomato_settlement_state = v_state,

           zomato_superseded_revenue_paise = case
             when d.zomato_superseded_at is not null then d.zomato_superseded_revenue_paise
             when d.zomato_settlement_state is null then d.zomato_revenue_paise
             else null end,
           zomato_superseded_commission_paise = case
             when d.zomato_superseded_at is not null then d.zomato_superseded_commission_paise
             when d.zomato_settlement_state is null then d.zomato_commission_paise
             else null end,
           zomato_superseded_at = case
             when d.zomato_superseded_at is not null then d.zomato_superseded_at
             when d.zomato_settlement_state is null then now()
             else null end,

           zomato_provisional_revenue_paise = case
             when v_state = 'settled'
               and d.zomato_settlement_state = 'provisional'
               and (d.zomato_revenue_paise, d.zomato_commission_paise)
                   is distinct from (v_day.gross_paise, v_day.commission_paise)
               then d.zomato_revenue_paise
             else d.zomato_provisional_revenue_paise end,
           zomato_provisional_commission_paise = case
             when v_state = 'settled'
               and d.zomato_settlement_state = 'provisional'
               and (d.zomato_revenue_paise, d.zomato_commission_paise)
                   is distinct from (v_day.gross_paise, v_day.commission_paise)
               then d.zomato_commission_paise
             else d.zomato_provisional_commission_paise end,
           zomato_revised_at = case
             when v_state = 'settled'
               and d.zomato_settlement_state = 'provisional'
               and (d.zomato_revenue_paise, d.zomato_commission_paise)
                   is distinct from (v_day.gross_paise, v_day.commission_paise)
               then now()
             else d.zomato_revised_at end
     where d.outlet_id = v_outlet and d.business_date = v_day.business_date;

    v_written := v_written + 1;
  end loop;

  select string_agg(i.business_date::text, ', ' order by i.business_date)
    into v_pending
    from ingest_days i
   where i.business_date >= v_synced_from
     and not exists (
       select 1 from public.manual_ledger_days d
        where d.outlet_id = v_outlet and d.business_date = i.business_date);

  select count(*) into v_deductions_skipped
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d
   where (d ->> 'spent_on')::date < v_synced_from;

  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description,
     source_system, source_ref, recorded_by)
  select v_outlet,
         (d ->> 'spent_on')::date,
         coalesce(nullif(d ->> 'category', ''), 'Other'),
         false,
         (d ->> 'amount_paise')::bigint,
         d ->> 'description',
         'zomato',
         d ->> 'source_ref',
         null
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d
   where (d ->> 'spent_on')::date >= v_synced_from
  on conflict (outlet_id, source_system, source_ref) where source_system is not null
  do update set amount_paise = excluded.amount_paise,
                business_date = excluded.business_date,
                description = excluded.description,
                category = excluded.category
  where public.manual_ledger_expenses.voided_at is null;

  insert into public.aggregator_cycle_deductions
    (outlet_id, channel, kind, period_start, period_end, amount_paise,
     source_system, source_ref)
  select v_outlet, v_channel,
         c ->> 'kind',
         (c ->> 'period_start')::date,
         (c ->> 'period_end')::date,
         (c ->> 'amount_paise')::bigint,
         'zomato',
         c ->> 'source_ref'
    from jsonb_array_elements(coalesce(p_payload -> 'cycle_deductions', '[]'::jsonb)) c
  on conflict (outlet_id, source_system, source_ref)
  do update set amount_paise = excluded.amount_paise,
                period_start = excluded.period_start,
                period_end = excluded.period_end;

  if v_accepted_by is not null and v_difference is not null and abs(v_difference) > v_tolerance then
    insert into public.aggregator_cycle_deductions
      (outlet_id, channel, kind, period_start, period_end, amount_paise,
       source_system, source_ref, accepted_by, accepted_at)
    values (v_outlet, v_channel, 'unexplained_settlement_difference',
            v_cycle_start, v_cycle_end, -v_difference,
            'owner', format('accepted::%s::%s', v_cycle_start, v_cycle_end),
            v_accepted_by, now())
    on conflict (outlet_id, source_system, source_ref) do nothing;
  end if;

  return jsonb_build_object(
    'outcome', 'ok',
    'days_written', v_written,
    'days_pending', coalesce(v_pending, ''),
    'deductions_before_boundary', v_deductions_skipped,
    'computed_paise', v_computed,
    'stated_payout_paise', v_stated_payout,
    'difference_paise', v_difference);
end;
$ingest$;
