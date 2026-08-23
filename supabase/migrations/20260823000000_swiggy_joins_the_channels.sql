-- Swiggy joins the channels, as an independent restaurant aggregator.
--
-- The sync machinery has been channel-aware in name since Hyperpure arrived,
-- but every money table still hard-codes 'zomato', Swiggy is still typed into
-- `manual_ledger_days`, and there is nowhere to say which Swiggy restaurant is
-- which outlet. This migration lays the channel-aware foundation; it enables no
-- writes and schedules nothing. Ingest still refuses 'swiggy' until the write
-- contract itself generalises.
--
-- Four things change:
--
--   * a normalized restaurant mapping keyed by `(channel, external_ref)`
--     replaces the scalar-operator-ID assumption for restaurant channels
--     (`zomato`, `swiggy`). One outlet MAY hold several references — the Swiggy
--     account exposes an active and a dormant Kalyani identity — and one
--     reference maps to exactly one outlet. Mapping is configuration planted by
--     migration, not a runtime guess from names or amounts;
--
--   * the four restaurant-money allow-lists widen to admit 'swiggy'. Hyperpure
--     stays excluded everywhere: it is a supply channel whose statement books
--     expenses, not a payout cycle with days;
--
--   * the session machinery (credentials, auth requests, runs) widens to admit
--     'swiggy' alongside the existing pair, because Swiggy owns an independent
--     login, mailbox and reader health — never Zomato's;
--
--   * the measured-day and cycle-reconciliation shapes learn what Swiggy's
--     settlement actually reports: an explicit net payout (nullable while
--     undetermined, allowed negative when a cancelled order costs money), a
--     portal source reference and capture time, the operator's own cycle
--     identity and bank status held apart from settlement state, and a
--     `legacy_typed` origin so typed history can survive the handover without
--     ever passing itself off as sourced.

-- ---------------------------------------------------------------------------
-- 1. outlet_channel_restaurants - which external restaurant is which outlet.

create table public.outlet_channel_restaurants (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  channel text not null,
  external_ref text not null,

  -- Only an enabled reference is read or posted to. A dormant identity is kept
  -- explicit rather than deleted, because deleting it would let a future run
  -- meet the same reference unmapped and refuse money that belongs here.
  state text not null,

  -- What the operator calls this identity, for a human comparing portals.
  label text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint outlet_channel_restaurants_channel_known
    check (channel in ('zomato', 'swiggy')),
  constraint outlet_channel_restaurants_state_known
    check (state in ('enabled', 'dormant')),
  constraint outlet_channel_restaurants_ref_not_blank
    check (length(btrim(external_ref)) > 0),
  -- One reference means one outlet, per channel, forever. Two rows would make
  -- every financial command ambiguous about whose money it is moving.
  constraint outlet_channel_restaurants_one_owner_per_ref
    unique (channel, external_ref)
);

create index outlet_channel_restaurants_outlet_idx
  on public.outlet_channel_restaurants (outlet_id);

alter table public.outlet_channel_restaurants enable row level security;

create trigger outlet_channel_restaurants_set_updated_at
  before update on public.outlet_channel_restaurants
  for each row execute function public.set_updated_at();

-- Owner-readable, like the other mapping/config facts of this capability. No
-- client role writes it: references are planted from verified account evidence
-- by migration, and an app path that could edit them could silently move money
-- across tenancy. The omission of grants beyond select IS the write policy.
grant select on public.outlet_channel_restaurants to authenticated;

create policy outlet_channel_restaurants_owner_reads
  on public.outlet_channel_restaurants
  for select
  to authenticated
  using (public.app_is_owner() and public.app_account_active());

comment on table public.outlet_channel_restaurants is
  'Which operator restaurant identity (per channel) belongs to which Ops outlet, and whether automation may use it. Written only by migration from verified evidence; read by the owner.';

-- ---------------------------------------------------------------------------
-- 2. The restaurant-money tables admit swiggy. Hyperpure stays refused: its
-- statement is supply cost booked as expenses, never a payout day or cycle.

alter table public.aggregator_channel_days
  drop constraint aggregator_channel_days_channel_known,
  add constraint aggregator_channel_days_channel_known
    check (channel in ('zomato', 'swiggy'));

alter table public.aggregator_cycle_deductions
  drop constraint aggregator_cycle_deductions_channel_known,
  add constraint aggregator_cycle_deductions_channel_known
    check (channel in ('zomato', 'swiggy'));

alter table public.aggregator_cycle_reconciliations
  drop constraint aggregator_cycle_reconciliations_channel_known,
  add constraint aggregator_cycle_reconciliations_channel_known
    check (channel in ('zomato', 'swiggy'));

alter table public.outlet_channel_sync
  drop constraint outlet_channel_sync_channel_known,
  add constraint outlet_channel_sync_channel_known
    check (channel in ('zomato', 'swiggy'));

-- ---------------------------------------------------------------------------
-- 3. The session machinery admits swiggy independently.

alter table public.aggregator_channel_credentials
  drop constraint aggregator_channel_credentials_channel_known,
  add constraint aggregator_channel_credentials_channel_known
    check (channel in ('zomato', 'hyperpure', 'swiggy'));

alter table public.aggregator_auth_requests
  drop constraint aggregator_auth_requests_channel_known,
  -- Hyperpure comes OUT here as well as swiggy coming in: it never had a
  -- mailbox of its own (Model A rides Zomato's login), and the constraint was
  -- written before anything but 'zomato' could appear. A channel that cannot
  -- open a request should be refused by the same check that refuses a typo.
  add constraint aggregator_auth_requests_channel_known
    check (channel in ('zomato', 'swiggy'));

alter table public.aggregator_sync_runs
  drop constraint aggregator_sync_runs_channel_known,
  add constraint aggregator_sync_runs_channel_known
    check (channel in ('zomato', 'hyperpure', 'swiggy'));

-- ---------------------------------------------------------------------------
-- 4. The measured day states all three figures and where they came from.

alter table public.aggregator_channel_days
  -- The order-level payout after fees and taxes. Null means UNDETERMINED, the
  -- same reading commission_paise already carries for a provisional day, and
  -- the two are null together. Negative is meaningful: a cancelled order can
  -- leave zero gross and a charge the restaurant owes.
  add column net_paise bigint,
  -- Which portal artefact produced this figure: a payout id, a report row, an
  -- annexure digest. Null only on rows written before sources were named.
  add column source_ref text,
  -- How current the source was when captured. On a provisional day this is
  -- what "as of" means; a settled day carries the moment its cycle was read.
  add column as_of_at timestamptz;

-- Typed history carried through the handover keeps its values readable under
-- an origin that says where it came from. It must never be relabelled as a
-- supplied-by-hand statement, which only an operator-issued file proves.
alter table public.aggregator_channel_days
  drop constraint aggregator_channel_days_origin_known,
  add constraint aggregator_channel_days_origin_known
    check (origin in ('daily_reader', 'settlement', 'supplied_by_hand', 'legacy_typed'));

-- The old rule made any fee larger than gross impossible to store, which is
-- exactly the shape of a cancelled order at zero gross. Consistency between
-- the three figures replaces it: net plus the reduction equals gross, and a
-- figure nobody can compute is stated as undetermined rather than nought.
alter table public.aggregator_channel_days
  drop constraint aggregator_channel_days_commission_within_revenue,
  add constraint aggregator_channel_days_net_together
    check ((net_paise is null) = (commission_paise is null)),
  add constraint aggregator_channel_days_net_consistent
    check (net_paise is null or net_paise = revenue_paise - commission_paise);

-- Existing rows get their net computed once, inside this transaction.
update public.aggregator_channel_days
   set net_paise = revenue_paise - commission_paise
 where commission_paise is not null;

comment on column public.aggregator_channel_days.net_paise is
  'The order-level payout after order-level fees and taxes; null while undetermined. Always revenue_paise minus commission_paise.';

comment on column public.aggregator_channel_days.source_ref is
  'The portal artefact this figure was normalized from, when the source names one.';

comment on column public.aggregator_channel_days.as_of_at is
  'How current the source was at capture; provisional figures advance through this field.';

-- A Franchise Admin already reads the full ledger at an assigned outlet, and a
-- ledger whose aggregator days went dark the moment typing froze would be a
-- worse one than they had before. Daily aggregates follow that existing grant;
-- every settlement internal (cycles, deductions, runs, credentials, requests,
-- mappings) stays owner-only, as the policies on those tables already say.
create policy aggregator_channel_days_assigned_manager_reads
  on public.aggregator_channel_days
  for select
  to authenticated
  using (
    public.app_has_role_at('franchise_admin', outlet_id)
    and public.app_account_active()
  );

-- ---------------------------------------------------------------------------
-- 5. The reconciliation names the operator''s cycle, and bank status travels
-- separately from settlement.

alter table public.aggregator_cycle_reconciliations
  -- Swiggy''s payout cycles carry their own identity, split at month
  -- boundaries, and finality can precede payment. Storing the portal''s own
  -- reference is what lets coincident Zomato and Swiggy periods coexist and a
  -- FINAL-but-Pending payout settle before its transfer lands.
  add column operator_cycle_ref text,
  -- Pending / On Hold / Paid describe the bank, not the accounting record.
  add column bank_status text,
  add constraint aggregator_cycle_reconciliations_bank_status_known
    check (bank_status in ('pending', 'on_hold', 'paid'));

-- Legacy rows earned their identity from their start date; that stays stable
-- for them. Every later writer names the operator reference explicitly.
update public.aggregator_cycle_reconciliations
   set operator_cycle_ref = cycle_start::text
 where operator_cycle_ref is null;

alter table public.aggregator_cycle_reconciliations
  alter column operator_cycle_ref set not null;

-- One conclusion per operator cycle, per channel — not per calendar week. The
-- old start-date key would have collided the day both channels closed a cycle
-- on the same Monday.
alter table public.aggregator_cycle_reconciliations
  drop constraint aggregator_cycle_reconciliations_one_per_cycle,
  add constraint aggregator_cycle_reconciliations_one_per_operator_cycle
    unique (outlet_id, channel, operator_cycle_ref);

comment on column public.aggregator_cycle_reconciliations.operator_cycle_ref is
  'The operator''s own stable identity for this payout cycle; dates alone do not identify one.';

comment on column public.aggregator_cycle_reconciliations.bank_status is
  'The transfer''s progress as the portal reports it, independent of settlement state.';

-- ---------------------------------------------------------------------------
-- 6. The write contract carries the third figure.
--
-- Storing net makes it mandatory on every writer, and the ingest is the only
-- one. Its day roll-up now aggregates all three order figures with the same
-- undetermined-if-any-is-missing rule; the reconciliation arithmetic is
-- untouched, because it already measured the cycle against order-level nets.

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
  v_unrecorded text;
  v_day record;
  v_existing record;
  v_had boolean;
  v_origin text;
  v_sup_revenue bigint;
  v_sup_commission bigint;
  v_sup_at timestamptz;
  v_prov_revenue bigint;
  v_prov_commission bigint;
  v_revised_at timestamptz;
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

  -- One channel for now; widening this guard belongs to the change that
  -- validates swiggy payloads end to end, not to the one that widens storage.
  if v_channel is distinct from 'zomato' then
    raise exception 'unknown channel %', v_channel using errcode = '22023';
  end if;

  if v_outlet is null or not (v_outlet = any (p_permitted_outlets)) then
    raise exception 'this credential may not write settlement for outlet %', v_outlet
      using errcode = '42501';
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

  -- Every deduction counts here, recoveries included, whatever their date. This
  -- is what the payout is measured against, and it is deliberately not the same
  -- set as what gets written.
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

    if abs(v_difference) > v_tolerance and v_accepted_by is null then
      update public.aggregator_channel_days
         set settlement_state = 'disputed'
       where outlet_id = v_outlet
         and channel = v_channel
         and business_date between v_cycle_start and v_cycle_end
         and business_date >= v_synced_from
         and settlement_state = 'provisional';

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
    commission_paise bigint,
    net_paise bigint
  ) on commit drop;
  truncate table ingest_days;

  insert into ingest_days (business_date, gross_paise, commission_paise, net_paise)
  select public.app_business_date((o ->> 'placed_at')::timestamptz, v_cutover),
         sum((o ->> 'gross_paise')::bigint),
         case
           when count(*) filter (where (o ->> 'commission_paise') is null) > 0 then null
           else sum((o ->> 'commission_paise')::bigint)
         end,
         case
           when count(*) filter (where (o ->> 'net_paise') is null) > 0 then null
           else sum((o ->> 'net_paise')::bigint)
         end
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
   group by 1;

  v_origin := case when v_state = 'settled' then 'settlement' else 'daily_reader' end;

  for v_day in select * from ingest_days order by business_date loop
    if v_day.business_date < v_synced_from then
      continue;
    end if;

    select * into v_existing
      from public.aggregator_channel_days
     where outlet_id = v_outlet
       and channel = v_channel
       and business_date = v_day.business_date;
    v_had := found;

    -- Settled is terminal: a later provisional read does not reopen a paid week.
    if v_had and v_existing.settlement_state = 'settled' then
      continue;
    end if;

    -- What this write replaces, whatever origin wrote it. A run that writes the
    -- same numbers replaces nothing and leaves the trace alone, which keeps a
    -- re-run from recording that a figure superseded itself.
    if v_had
       and (v_existing.revenue_paise, v_existing.commission_paise)
           is distinct from (v_day.gross_paise, v_day.commission_paise) then
      v_sup_revenue := v_existing.revenue_paise;
      v_sup_commission := v_existing.commission_paise;
      v_sup_at := now();
    elsif v_had then
      v_sup_revenue := v_existing.superseded_revenue_paise;
      v_sup_commission := v_existing.superseded_commission_paise;
      v_sup_at := v_existing.superseded_at;
    else
      v_sup_revenue := null;
      v_sup_commission := null;
      v_sup_at := null;
    end if;

    -- Settling a provisional figure whose numbers moved keeps what they moved
    -- from, so no figure changes without a trace.
    if v_had
       and v_state = 'settled'
       and v_existing.settlement_state = 'provisional'
       and (v_existing.revenue_paise, v_existing.commission_paise)
           is distinct from (v_day.gross_paise, v_day.commission_paise) then
      v_prov_revenue := v_existing.revenue_paise;
      v_prov_commission := v_existing.commission_paise;
      v_revised_at := now();
    elsif v_had then
      v_prov_revenue := v_existing.provisional_revenue_paise;
      v_prov_commission := v_existing.provisional_commission_paise;
      v_revised_at := v_existing.revised_at;
    else
      v_prov_revenue := null;
      v_prov_commission := null;
      v_revised_at := null;
    end if;

    insert into public.aggregator_channel_days
      (outlet_id, channel, business_date, revenue_paise, commission_paise, net_paise,
       settlement_state, origin,
       superseded_revenue_paise, superseded_commission_paise, superseded_at,
       provisional_revenue_paise, provisional_commission_paise, revised_at)
    values (v_outlet, v_channel, v_day.business_date,
            v_day.gross_paise, v_day.commission_paise, v_day.net_paise,
            v_state, v_origin,
            v_sup_revenue, v_sup_commission, v_sup_at,
            v_prov_revenue, v_prov_commission, v_revised_at)
    on conflict (outlet_id, channel, business_date) do update
      set revenue_paise = excluded.revenue_paise,
          commission_paise = excluded.commission_paise,
          net_paise = excluded.net_paise,
          settlement_state = excluded.settlement_state,
          origin = excluded.origin,
          superseded_revenue_paise = excluded.superseded_revenue_paise,
          superseded_commission_paise = excluded.superseded_commission_paise,
          superseded_at = excluded.superseded_at,
          provisional_revenue_paise = excluded.provisional_revenue_paise,
          provisional_commission_paise = excluded.provisional_commission_paise,
          revised_at = excluded.revised_at;

    v_written := v_written + 1;
  end loop;

  -- Information, not a refusal. These dates now hold figures; what they lack is
  -- a drawer count, which only a person can supply.
  select string_agg(i.business_date::text, ', ' order by i.business_date)
    into v_unrecorded
    from ingest_days i
   where i.business_date >= v_synced_from
     and not exists (
       select 1 from public.manual_ledger_days d
        where d.outlet_id = v_outlet and d.business_date = i.business_date);

  select count(*) into v_deductions_skipped
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d
   where (d ->> 'spent_on')::date < v_synced_from
     and public.expense_category_reserved_owner(
           coalesce(nullif(d ->> 'category', ''), 'Other')) is null;

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
    'days_without_a_recorded_day', coalesce(v_unrecorded, ''),
    'deductions_before_boundary', v_deductions_skipped,
    'computed_paise', v_computed,
    'stated_payout_paise', v_stated_payout,
    'difference_paise', v_difference);
end;
$ingest$;
