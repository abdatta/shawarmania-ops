-- Zomato settlement, read rather than typed.
--
-- The owner types a Zomato figure from the dashboard and a commission rate once,
-- and nothing has ever compared either against the payout that reaches the bank.
-- Measured against the live account on 2026-08-16, the effective rate moves
-- between 24% and 35% across days, so a stored rate misstates every day it was
-- not measured on. This migration is the destination for figures read from
-- Zomato itself.
--
-- Four properties are deliberate and worth stating before the columns.
--
--   * **The triple is measured, not derived.** Gross, commission and net are each
--     stored as read. Reproducing one measured day from a rounded basis-point
--     rate lands nine paise adrift, which is nothing as money and fatal as a
--     check: the whole value of this change is being able to say a week matched
--     to the paisa.
--
--   * **A settled day carries what it replaced.** Where settling moved the
--     figures, the provisional ones are kept beside them. The live dashboard
--     omits refunds paid when an order is cancelled after preparation, so a day
--     legitimately grows days later; without the retained figures that growth is
--     an unexplained movement, which is the thing this change exists to remove.
--
--   * **A paid week that does not add up is `disputed`, not `provisional`.**
--     Provisional means *not yet paid*. A refused cycle left reading provisional
--     would be indistinguishable from the current week and would sit unresolved
--     forever.
--
--   * **A synced day cannot also carry a typed figure.** Where the triple is
--     present the typed revenue and rate are forced to zero and the typed figure
--     moves to its own columns, so the two can never both reach a total.
--
-- Nothing here derives anything. `src/features/manual-ledger/ledger.ts` computes
-- every figure, as it already does for the typed ledger.

-- ---------------------------------------------------------------------------
-- 1. manual_ledger_days — the measured triple, its state, and what it replaced.

alter table public.manual_ledger_days
  add column zomato_gross_paise bigint,
  add column zomato_commission_paise bigint,
  add column zomato_net_paise bigint,

  -- provisional: the week is not paid yet.
  -- settled:     the week is paid and its figures reconcile against the payout.
  -- disputed:    the week is paid and its figures do NOT reconcile.
  add column zomato_settlement_state text,

  -- What the owner had typed before the sync took the day over. Retained so the
  -- manual estimates can be compared against settled truth, and excluded from
  -- every computation by the read path.
  add column zomato_typed_revenue_paise bigint,
  add column zomato_typed_commission_bp integer,
  add column zomato_superseded_at timestamptz,

  -- What the day read before its week settled, kept only where settling actually
  -- moved it. Present is precisely what "revised" means; there is no separate
  -- boolean, so the marker cannot disagree with the figures behind it.
  add column zomato_provisional_gross_paise bigint,
  add column zomato_provisional_commission_paise bigint,
  add column zomato_provisional_net_paise bigint,
  add column zomato_revised_at timestamptz;

alter table public.manual_ledger_days
  add constraint manual_ledger_days_zomato_state_known check (
    zomato_settlement_state is null
    or zomato_settlement_state in ('provisional', 'settled', 'disputed')
  ),

  -- All three or none. A partial triple would let a total read from two figures
  -- and silently omit the third.
  add constraint manual_ledger_days_zomato_triple_together check (
    (zomato_gross_paise is null
      and zomato_commission_paise is null
      and zomato_net_paise is null)
    or (zomato_gross_paise is not null
      and zomato_commission_paise is not null
      and zomato_net_paise is not null)
  ),

  add constraint manual_ledger_days_zomato_triple_adds_up check (
    zomato_gross_paise is null
    or zomato_gross_paise = zomato_commission_paise + zomato_net_paise
  ),

  -- The state and the figures arrive together: a state with no figures describes
  -- nothing, and figures with no state cannot be read as provisional or final.
  add constraint manual_ledger_days_zomato_state_with_figures check (
    (zomato_settlement_state is null) = (zomato_gross_paise is null)
  ),

  -- A synced day's typed inputs are zeroed, so no path can add a typed figure to
  -- a measured one.
  add constraint manual_ledger_days_zomato_synced_supersedes_typed check (
    zomato_gross_paise is null
    or (zomato_revenue_paise = 0 and zomato_commission_bp = 0)
  ),

  -- The retained typed figure travels with the moment it was retained.
  add constraint manual_ledger_days_zomato_typed_retained_together check (
    (zomato_typed_revenue_paise is null
      and zomato_typed_commission_bp is null
      and zomato_superseded_at is null)
    or (zomato_typed_revenue_paise is not null
      and zomato_typed_commission_bp is not null
      and zomato_superseded_at is not null)
  ),

  add constraint manual_ledger_days_zomato_typed_rate_ranged check (
    zomato_typed_commission_bp is null
    or zomato_typed_commission_bp between 0 and 10000
  ),

  -- Nothing can be superseded without something superseding it.
  add constraint manual_ledger_days_zomato_typed_needs_synced check (
    zomato_superseded_at is null or zomato_gross_paise is not null
  ),

  add constraint manual_ledger_days_zomato_revised_together check (
    (zomato_provisional_gross_paise is null
      and zomato_provisional_commission_paise is null
      and zomato_provisional_net_paise is null
      and zomato_revised_at is null)
    or (zomato_provisional_gross_paise is not null
      and zomato_provisional_commission_paise is not null
      and zomato_provisional_net_paise is not null
      and zomato_revised_at is not null)
  ),

  -- Only a settled day can have been revised, and a revision must have moved
  -- something. Retaining a figure identical to the one beside it would mark a day
  -- as changed when it did not change.
  add constraint manual_ledger_days_zomato_revised_only_when_settled check (
    zomato_revised_at is null
    or (zomato_settlement_state = 'settled'
      and (zomato_provisional_gross_paise, zomato_provisional_commission_paise,
           zomato_provisional_net_paise)
          is distinct from
          (zomato_gross_paise, zomato_commission_paise, zomato_net_paise))
  );

-- The state machine, as a trigger rather than a CHECK, because a CHECK cannot see
-- the previous row.
--
--   provisional → settled     the week was paid and reconciled
--   provisional → disputed    the week was paid and did not reconcile
--   disputed    → settled     a later run, or the owner, resolved it
--   settled     → (nothing)   terminal
--
-- A settled day going back to provisional is the failure this exists to stop: a
-- later run reading the live dashboard for an already-settled week would
-- otherwise overwrite the settled figures with figures that omit refunds.
create or replace function public.guard_manual_ledger_settlement_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.zomato_settlement_state is not distinct from new.zomato_settlement_state then
    return new;
  end if;

  if old.zomato_settlement_state = 'settled' then
    raise exception
      'a settled Zomato day is final; it cannot become %', new.zomato_settlement_state;
  end if;

  if old.zomato_settlement_state = 'disputed'
     and new.zomato_settlement_state = 'provisional' then
    raise exception
      'a disputed Zomato week has already been paid and cannot return to provisional';
  end if;

  return new;
end;
$$;

create trigger manual_ledger_days_settlement_state_guarded
  before update of zomato_settlement_state on public.manual_ledger_days
  for each row execute function public.guard_manual_ledger_settlement_state();

-- No signed-in account may type a settlement figure, at any outlet, whatever the
-- policies would otherwise allow.
--
-- The day row itself is writable by the owner and by a Franchise Admin at the
-- outlet they are assigned to — that is `the-ledger-opens-to-the-outlet`, and it
-- is correct for the drawer and the typed channels. These columns are different
-- in kind: they are read from Zomato and reconciled against the payout, and a
-- figure a person could type is a figure the reconciliation gate never saw. The
-- only writer is the Edge Function, which holds the service role.
--
-- The role is checked rather than the account, because this is not a question of
-- authority: the owner is the most trusted account there is and still must not
-- type one of these.
-- Deliberately SECURITY INVOKER, unlike every other guard in this file. A
-- definer function runs as its owner, so `current_role` inside one always reads
-- `postgres` and the check below would pass for everybody. The function needs no
-- privilege of its own — it only compares the row it was handed.
create or replace function public.guard_manual_ledger_settlement_is_read()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_role <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.zomato_gross_paise is not null
       or new.zomato_settlement_state is not null
       or new.zomato_superseded_at is not null
       or new.zomato_revised_at is not null then
      raise exception
        'Zomato settlement figures are read from Zomato, not entered';
    end if;
    return new;
  end if;

  if (new.zomato_gross_paise, new.zomato_commission_paise, new.zomato_net_paise,
      new.zomato_settlement_state, new.zomato_typed_revenue_paise,
      new.zomato_typed_commission_bp, new.zomato_superseded_at,
      new.zomato_provisional_gross_paise, new.zomato_provisional_commission_paise,
      new.zomato_provisional_net_paise, new.zomato_revised_at)
     is distinct from
     (old.zomato_gross_paise, old.zomato_commission_paise, old.zomato_net_paise,
      old.zomato_settlement_state, old.zomato_typed_revenue_paise,
      old.zomato_typed_commission_bp, old.zomato_superseded_at,
      old.zomato_provisional_gross_paise, old.zomato_provisional_commission_paise,
      old.zomato_provisional_net_paise, old.zomato_revised_at) then
    raise exception
      'Zomato settlement figures are read from Zomato, not entered';
  end if;

  return new;
end;
$$;

create trigger manual_ledger_days_settlement_is_read
  before insert or update on public.manual_ledger_days
  for each row execute function public.guard_manual_ledger_settlement_is_read();

-- ---------------------------------------------------------------------------
-- 2. manual_ledger_expenses — where a row came from.
--
-- A hand-entered row keeps a null source, which is what distinguishes the
-- owner's own record from one the sync wrote. The unique index is what makes a
-- re-run update in place instead of adding a second copy of the same purchase.

alter table public.manual_ledger_expenses
  add column source_system text,
  add column source_ref text;

-- A synced row was recorded by nobody, and saying otherwise would be a lie with
-- somebody's name on it. `recorded_by` therefore becomes nullable, and is null
-- exactly when a source system is present.
--
-- This grants no account anything: every insert policy still carries
-- `recorded_by = auth.uid()`, which a null fails, so no signed-in session can
-- write an unattributed row. Only the Edge Function can, and only for a row it
-- also stamps with where it came from.
alter table public.manual_ledger_expenses
  alter column recorded_by drop not null;

alter table public.manual_ledger_expenses
  add constraint manual_ledger_expenses_recorder_or_source check (
    (recorded_by is null) = (source_system is not null)
  );

alter table public.manual_ledger_expenses
  add constraint manual_ledger_expenses_source_together check (
    (source_system is null and source_ref is null)
    or (source_system is not null and source_ref is not null)
  ),
  add constraint manual_ledger_expenses_source_not_blank check (
    (source_system is null or length(btrim(source_system)) > 0)
    and (source_ref is null or length(btrim(source_ref)) > 0)
  );

create unique index manual_ledger_expenses_source_idx
  on public.manual_ledger_expenses (outlet_id, source_system, source_ref)
  where source_system is not null;

-- ---------------------------------------------------------------------------
-- 3. aggregator_cycle_deductions — what belongs to no trading day.
--
-- Two kinds, both of which would be misdated by any business date they were
-- given:
--
--   * **Tax deducted at source.** Zomato emits it through the orders channel
--     wearing an order's clothes: an id of the form `TDS::<res>::<yyyymmdd>`, a
--     null date that renders as 01 Jan 1970, a REJECTED status and a negative
--     amount — and it refers to a week other than the one paying it.
--
--   * **An accepted unexplained settlement difference.** Where a paid week will
--     not reconcile and the owner accepts it anyway, the gap is recorded here
--     rather than spread across the week's days. Spreading it would make every
--     day slightly wrong, make the total look right, and destroy the only
--     evidence that anything was ever off.
--
-- Amounts are signed: a deduction is negative, and an unexplained difference
-- takes whichever sign the gap had.

create table public.aggregator_cycle_deductions (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  channel text not null,
  kind text not null,

  -- The period the record NAMES, which is not the cycle that paid it.
  period_start date not null,
  period_end date not null,

  amount_paise bigint not null,

  source_system text not null,
  source_ref text not null,

  -- Set only on an accepted difference: who decided, and when.
  accepted_by uuid references public.profiles (id),
  accepted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint aggregator_cycle_deductions_channel_known check (channel in ('zomato')),
  constraint aggregator_cycle_deductions_kind_known check (
    kind in ('tax_deducted_at_source', 'unexplained_settlement_difference')
  ),
  constraint aggregator_cycle_deductions_period_ordered check (period_start <= period_end),
  constraint aggregator_cycle_deductions_source_not_blank check (
    length(btrim(source_system)) > 0 and length(btrim(source_ref)) > 0
  ),
  constraint aggregator_cycle_deductions_acceptance_together check (
    (accepted_by is null) = (accepted_at is null)
  ),
  -- An unexplained difference is a decision somebody made. Recording one with
  -- nobody's name on it would make it look like a fact Zomato reported.
  constraint aggregator_cycle_deductions_difference_is_accepted check (
    kind <> 'unexplained_settlement_difference' or accepted_by is not null
  ),
  constraint aggregator_cycle_deductions_one_per_source
    unique (outlet_id, source_system, source_ref)
);

create index aggregator_cycle_deductions_outlet_period_idx
  on public.aggregator_cycle_deductions (outlet_id, period_start);

alter table public.aggregator_cycle_deductions enable row level security;

create trigger aggregator_cycle_deductions_set_updated_at
  before update on public.aggregator_cycle_deductions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. outlet_channel_sync — from which trading day a channel is sourced.
--
-- The same problem `billing_live_from` already solved for cash and UPI, and the
-- same shape: an explicit stored date per outlet per channel, set deliberately,
-- never derived from the presence of synced rows. Deriving it would move the
-- boundary onto a day that was already typed and count that day twice.

create table public.outlet_channel_sync (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  channel text not null,
  synced_from date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint outlet_channel_sync_channel_known check (channel in ('zomato')),
  constraint outlet_channel_sync_one_per_channel unique (outlet_id, channel)
);

alter table public.outlet_channel_sync enable row level security;

create trigger outlet_channel_sync_set_updated_at
  before update on public.outlet_channel_sync
  for each row execute function public.set_updated_at();

-- A date that has already started is refused, for the reason `billing_live_from`
-- refuses one: the boundary must be scheduled, never applied retrospectively over
-- days somebody has already typed.
create or replace function public.guard_outlet_channel_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutover time;
  v_today date;
begin
  if tg_op = 'UPDATE' and new.synced_from is not distinct from old.synced_from then
    return new;
  end if;

  select business_day_cutover into v_cutover
    from public.outlets where id = new.outlet_id;

  if v_cutover is null then
    raise exception 'unknown outlet %', new.outlet_id;
  end if;

  v_today := public.app_business_date(now(), v_cutover);

  if tg_op = 'UPDATE' and old.synced_from <= v_today then
    raise exception 'the % sync date has already started and cannot be changed', new.channel;
  end if;

  if new.synced_from <= v_today then
    raise exception
      'a % sync date must be scheduled; the next eligible business date is %',
      new.channel, v_today + 1;
  end if;

  return new;
end;
$$;

create trigger outlet_channel_sync_guarded
  before insert or update on public.outlet_channel_sync
  for each row execute function public.guard_outlet_channel_sync();

-- ---------------------------------------------------------------------------
-- 5. aggregator_sync_runs — what each run did, and which way it failed.
--
-- The three failure classes need three different people, which is the whole
-- reason they are told apart rather than collapsed into "failed":
--
--   session_lapsed         the owner reconnects
--   shape_changed          a maintainer reads the response
--   reconciliation_failed  a question about money, for the owner to resolve

create table public.aggregator_sync_runs (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  channel text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  outcome text not null,

  -- What a human needs in order to act. Free text on purpose: the useful detail
  -- differs per failure class and inventing a column per class would leave most
  -- of them null.
  detail text,

  created_at timestamptz not null default now(),

  constraint aggregator_sync_runs_channel_known check (channel in ('zomato')),
  constraint aggregator_sync_runs_outcome_known check (
    outcome in ('ok', 'session_lapsed', 'shape_changed', 'reconciliation_failed')
  ),
  constraint aggregator_sync_runs_finished_after_started check (
    finished_at is null or finished_at >= started_at
  ),
  constraint aggregator_sync_runs_detail_not_blank check (
    detail is null or length(btrim(detail)) > 0
  )
);

create index aggregator_sync_runs_outlet_started_idx
  on public.aggregator_sync_runs (outlet_id, started_at desc);

alter table public.aggregator_sync_runs enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Grants and policies.
--
-- Owner-only, with deliberately NO outlet-role predicate anywhere below: no
-- outlet role has any access to grant. This matches `manual_ledger_days`, which
-- refuses a Franchise Admin, Biller and Employee every verb at every outlet
-- including their own. These three tables carry settlement money and the
-- decisions taken about it, so they answer the same way.
--
-- Insert and update are granted to `authenticated` on the deduction table alone,
-- and only so the owner can accept a disputed week from the app. The sync itself
-- writes through an Edge Function with the service role; it does not sign in.

grant select on public.aggregator_cycle_deductions to authenticated;
grant insert, update on public.aggregator_cycle_deductions to authenticated;
grant select on public.outlet_channel_sync to authenticated;
grant insert, update on public.outlet_channel_sync to authenticated;
grant select on public.aggregator_sync_runs to authenticated;

grant all on public.aggregator_cycle_deductions to service_role;
grant all on public.outlet_channel_sync to service_role;
grant all on public.aggregator_sync_runs to service_role;

create policy aggregator_cycle_deductions_select on public.aggregator_cycle_deductions
  for select to authenticated
  using (public.app_is_owner() and public.app_account_active());

create policy aggregator_cycle_deductions_insert on public.aggregator_cycle_deductions
  for insert to authenticated
  with check (
    public.app_is_owner()
    and public.app_account_active()
    -- The owner may record only their own decision, and only the kind that is
    -- one. Zomato's own deductions arrive through the Edge Function.
    and kind = 'unexplained_settlement_difference'
    and accepted_by = auth.uid()
  );

create policy aggregator_cycle_deductions_update on public.aggregator_cycle_deductions
  for update to authenticated
  using (public.app_is_owner() and public.app_account_active())
  with check (public.app_is_owner() and public.app_account_active());

create policy outlet_channel_sync_select on public.outlet_channel_sync
  for select to authenticated
  using (public.app_is_owner() and public.app_account_active());

create policy outlet_channel_sync_insert on public.outlet_channel_sync
  for insert to authenticated
  with check (public.app_is_owner() and public.app_account_active());

create policy outlet_channel_sync_update on public.outlet_channel_sync
  for update to authenticated
  using (public.app_is_owner() and public.app_account_active())
  with check (public.app_is_owner() and public.app_account_active());

create policy aggregator_sync_runs_select on public.aggregator_sync_runs
  for select to authenticated
  using (public.app_is_owner() and public.app_account_active());

-- ---------------------------------------------------------------------------
-- 7. The write contract.
--
-- One payout cycle for one outlet, accepted or refused as a unit. This is a
-- database function rather than a sequence of statements in the Edge Function
-- because the reconciliation identity is a property of the whole cycle: it
-- cannot be enforced per insert, and "all rows or none" has to mean one
-- transaction rather than a best effort followed by an apology.
--
-- **A date with no ledger row yet is left alone and reported, never created.**
-- The sync runs twice a day and re-reads two cycles every run, so a day the
-- owner records tonight collects its figures tomorrow morning. Creating the row
-- instead would mean inventing an opening balance and a drawer count of zero for
-- a day nobody has counted, and a fabricated count that reconciles is worse than
-- an absent one.
--
-- Executable by `service_role` alone. It is SECURITY DEFINER and therefore
-- writes past both Row-Level Security and the guard that stops a person typing a
-- settlement figure, so the outlet in the payload is checked against the outlets
-- the caller was permitted rather than trusted.

create or replace function public.ingest_aggregator_cycle(
  p_payload jsonb,
  p_permitted_outlets uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- An order with no placement time cannot be dated. Falling back to the
  -- aggregator's own date would misdate every order between midnight and the
  -- cutover, silently and in the direction that makes a late night look like the
  -- next morning.
  select string_agg(o ->> 'order_id', ', ')
    into v_unattributed
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
   where nullif(o ->> 'placed_at', '') is null;

  if v_unattributed is not null then
    raise exception 'these orders carry no placement time and were not written: %',
      v_unattributed using errcode = '22023';
  end if;

  -- ---------------------------------------------------------------------
  -- The reconciliation gate.
  --
  -- Tolerance is one rupee. Zomato renders every figure to two decimal places,
  -- so summing a hundred displayed values drifts a few paise against its own
  -- unrounded arithmetic; four of eight measured cycles drifted 4 to 8 paise and
  -- meant nothing. The one that mattered was 79.15 rupees. Zero would cry wolf
  -- nightly and a hundred rupees would have missed the real finding.
  --
  -- The tolerance decides whether to accept the cycle. It is never applied to
  -- the figures, which are always Zomato's own.

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

    if abs(v_difference) > v_tolerance and v_accepted_by is null then
      -- Refused whole. Every stored figure for these dates is left exactly as it
      -- was; the days are marked disputed so they cannot be mistaken for the
      -- current week, and the difference is reported for a person to resolve.
      update public.manual_ledger_days
         set zomato_settlement_state = 'disputed'
       where outlet_id = v_outlet
         and business_date between v_cycle_start and v_cycle_end
         and zomato_settlement_state = 'provisional';

      return jsonb_build_object(
        'outcome', 'reconciliation_failed',
        'computed_paise', v_computed,
        'stated_payout_paise', v_stated_payout,
        'difference_paise', v_difference);
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- The orders, grouped onto trading days by the outlet's own cutover.

  create temporary table if not exists ingest_days (
    business_date date primary key,
    gross_paise bigint,
    commission_paise bigint,
    net_paise bigint
  ) on commit drop;
  -- `truncate`, not a bare `delete`. Supabase preloads `safeupdate` for the
  -- `authenticator` role, which refuses an UPDATE or DELETE with no WHERE clause
  -- with "DELETE requires a WHERE clause". pgTAP runs as `postgres` and never
  -- sees it, so a bare delete here passes every test in this repo and then fails
  -- on the first real call through the Edge Function.
  truncate table ingest_days;

  insert into ingest_days (business_date, gross_paise, commission_paise, net_paise)
  select public.app_business_date((o ->> 'placed_at')::timestamptz, v_cutover),
         sum((o ->> 'gross_paise')::bigint),
         sum((o ->> 'commission_paise')::bigint),
         sum((o ->> 'net_paise')::bigint)
    from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]'::jsonb)) o
   group by 1;

  for v_day in select * from ingest_days order by business_date loop
    select * into v_existing
      from public.manual_ledger_days
     where outlet_id = v_outlet and business_date = v_day.business_date;

    if not found then
      -- Reported, not created. See the note at the top of this function.
      continue;
    end if;

    if v_existing.zomato_settlement_state = 'settled' then
      -- Terminal. A later run reading the live dashboard must not overwrite a
      -- settled figure with one that omits cancellation refunds.
      continue;
    end if;

    update public.manual_ledger_days d
       set zomato_gross_paise = v_day.gross_paise,
           zomato_commission_paise = v_day.commission_paise,
           zomato_net_paise = v_day.net_paise,
           zomato_settlement_state = v_state,

           -- The typed inputs are zeroed so no path can add a typed figure to a
           -- measured one, and what was typed moves aside once, the first time.
           zomato_revenue_paise = 0,
           zomato_commission_bp = 0,
           zomato_typed_revenue_paise = case
             when d.zomato_superseded_at is not null then d.zomato_typed_revenue_paise
             when d.zomato_revenue_paise <> 0 or d.zomato_commission_bp <> 0
               then d.zomato_revenue_paise
             else null end,
           zomato_typed_commission_bp = case
             when d.zomato_superseded_at is not null then d.zomato_typed_commission_bp
             when d.zomato_revenue_paise <> 0 or d.zomato_commission_bp <> 0
               then d.zomato_commission_bp
             else null end,
           zomato_superseded_at = case
             when d.zomato_superseded_at is not null then d.zomato_superseded_at
             when d.zomato_revenue_paise <> 0 or d.zomato_commission_bp <> 0
               then now()
             else null end,

           -- Revised: settling moved a figure the owner had already seen. Kept
           -- only where it actually moved, so the marker cannot claim a change
           -- that did not happen.
           zomato_provisional_gross_paise = case
             when v_state = 'settled'
               and d.zomato_settlement_state = 'provisional'
               and (d.zomato_gross_paise, d.zomato_commission_paise, d.zomato_net_paise)
                   is distinct from
                   (v_day.gross_paise, v_day.commission_paise, v_day.net_paise)
               then d.zomato_gross_paise
             else d.zomato_provisional_gross_paise end,
           zomato_provisional_commission_paise = case
             when v_state = 'settled'
               and d.zomato_settlement_state = 'provisional'
               and (d.zomato_gross_paise, d.zomato_commission_paise, d.zomato_net_paise)
                   is distinct from
                   (v_day.gross_paise, v_day.commission_paise, v_day.net_paise)
               then d.zomato_commission_paise
             else d.zomato_provisional_commission_paise end,
           zomato_provisional_net_paise = case
             when v_state = 'settled'
               and d.zomato_settlement_state = 'provisional'
               and (d.zomato_gross_paise, d.zomato_commission_paise, d.zomato_net_paise)
                   is distinct from
                   (v_day.gross_paise, v_day.commission_paise, v_day.net_paise)
               then d.zomato_net_paise
             else d.zomato_provisional_net_paise end,
           zomato_revised_at = case
             when v_state = 'settled'
               and d.zomato_settlement_state = 'provisional'
               and (d.zomato_gross_paise, d.zomato_commission_paise, d.zomato_net_paise)
                   is distinct from
                   (v_day.gross_paise, v_day.commission_paise, v_day.net_paise)
               then now()
             else d.zomato_revised_at end
     where d.outlet_id = v_outlet and d.business_date = v_day.business_date;

    v_written := v_written + 1;
  end loop;

  select string_agg(i.business_date::text, ', ' order by i.business_date)
    into v_pending
    from ingest_days i
   where not exists (
     select 1 from public.manual_ledger_days d
      where d.outlet_id = v_outlet and d.business_date = i.business_date);

  -- ---------------------------------------------------------------------
  -- Deductions, dated to the spend rather than to the payout that collected it.
  -- A supply purchase settles four to eleven days later, sometimes in a cycle
  -- other than the one containing its date, so booking it to the payout would
  -- put a July cost in August.

  insert into public.manual_ledger_expenses
    (outlet_id, business_date, category, is_cash, amount_paise, description,
     source_system, source_ref, recorded_by)
  select v_outlet,
         (d ->> 'spent_on')::date,
         coalesce(nullif(d ->> 'category', ''), 'Other'),
         -- Never cash: it never passed through the drawer, it was taken out of a
         -- bank transfer. Marking it cash would make the day's count fail to
         -- reconcile by the amount of a Hyperpure invoice.
         false,
         (d ->> 'amount_paise')::bigint,
         d ->> 'description',
         'zomato',
         d ->> 'source_ref',
         null
    from jsonb_array_elements(coalesce(p_payload -> 'deductions', '[]'::jsonb)) d
  on conflict (outlet_id, source_system, source_ref) where source_system is not null
  do update set amount_paise = excluded.amount_paise,
                business_date = excluded.business_date,
                description = excluded.description,
                category = excluded.category
  -- A withdrawn row stays withdrawn. The owner voided it for a reason and a
  -- re-run must not quietly bring it back.
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

  -- ---------------------------------------------------------------------
  -- An accepted difference, where the owner resolved a disputed week by
  -- recording the gap rather than by making it disappear.

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
    'computed_paise', v_computed,
    'stated_payout_paise', v_stated_payout,
    'difference_paise', v_difference);
end;
$$;

revoke execute on function public.ingest_aggregator_cycle(jsonb, uuid[]) from public;
grant execute on function public.ingest_aggregator_cycle(jsonb, uuid[]) to service_role;

-- Recording a run is the machine's own account of itself, so no signed-in
-- account may write one; a run somebody could type is a run that need not have
-- happened.
create or replace function public.record_aggregator_sync_run(
  p_outlet_id uuid,
  p_channel text,
  p_started_at timestamptz,
  p_outcome text,
  p_detail text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.aggregator_sync_runs
    (outlet_id, channel, started_at, finished_at, outcome, detail)
  values (p_outlet_id, p_channel, p_started_at, now(), p_outcome,
          nullif(btrim(coalesce(p_detail, '')), ''))
  returning id;
$$;

revoke execute on function public.record_aggregator_sync_run(uuid, text, timestamptz, text, text)
  from public;
grant execute on function public.record_aggregator_sync_run(uuid, text, timestamptz, text, text)
  to service_role;
