-- A measured figure is not part of the day a person keeps.
--
-- `manual_ledger_days.opening_cash_paise` and `counted_cash_paise` are NOT NULL,
-- so that row cannot exist without a drawer count. And the day whose aggregator
-- revenue most needs reading is precisely the day nobody counted: the sync has
-- been reporting "days with no ledger row yet" since it went live, and refusing
-- to write them, because creating the row would have meant inventing an opening
-- balance and a count nobody took. A fabricated count that reconciles looks like
-- evidence, which is worse than an absent one.
--
-- Making those two columns nullable was the obvious alternative and is worse
-- still: it collapses "counted zero" into "never counted" and removes the only
-- check the drawer has.
--
-- So the figures move out. The day row keeps what a person records. This table
-- keeps what was measured, and needs no day row to exist.
--
-- FOUR TYPED DAYS ARE DISCARDED, on the owner's instruction [owner, 2026-08-18].
-- Production holds 32 day rows: 28 carry figures the sync wrote, and 4 carry
-- Rs 10,576.50 the owner typed on days the sync had not reached. Those four are
-- dropped rather than carried across, which costs nothing real: all four fall
-- inside the synced window, so the next run replaces an estimate with a measured
-- figure. Carrying them would have needed a legacy origin and a nullable
-- settlement state, which is a permanent complication in every constraint here
-- for four rows that are about to be superseded anyway.

create table public.aggregator_channel_days (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  channel text not null,
  business_date date not null,

  revenue_paise bigint not null,

  -- Absent means UNDETERMINED, not nought. Zomato does not say what it kept
  -- until the week closes, and its own portal will not release a settlement
  -- report until the cycle is paid, so there is a window in which no route
  -- reaches this number. A zero here would state that the whole of the revenue
  -- arrived, which is the one wrong answer that looks plausible.
  commission_paise bigint,

  settlement_state text not null,
  origin text not null,

  -- What this figure replaced, kept rather than overwritten.
  superseded_revenue_paise bigint,
  superseded_commission_paise bigint,
  superseded_at timestamptz,

  -- What a settled figure replaced, where settling moved it.
  provisional_revenue_paise bigint,
  provisional_commission_paise bigint,
  revised_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint aggregator_channel_days_one_per_day
    unique (outlet_id, channel, business_date),

  constraint aggregator_channel_days_channel_known
    check (channel in ('zomato')),

  constraint aggregator_channel_days_origin_known
    check (origin in ('daily_reader', 'settlement', 'supplied_by_hand')),

  constraint aggregator_channel_days_state_known
    check (settlement_state in ('provisional', 'settled', 'disputed')),

  -- Commission cannot exceed the revenue it was charged on, in either direction,
  -- so a charge against revenue that does not exist is refused rather than
  -- stored as a figure in the wrong box.
  constraint aggregator_channel_days_commission_within_revenue
    check (commission_paise is null
           or (revenue_paise = 0 and commission_paise = 0)
           or commission_paise between least(0, revenue_paise)
                                   and greatest(0, revenue_paise)),

  -- A retained figure and the moment it was retained arrive together. Half a
  -- trace is worse than none: it reads as a record of a change while being
  -- unable to say when, or as a moment with nothing attached to it.
  constraint aggregator_channel_days_superseded_together
    check ((superseded_revenue_paise is null) = (superseded_at is null)),

  constraint aggregator_channel_days_revised_together
    check ((provisional_revenue_paise is null) = (revised_at is null)),

  -- Only a settled figure can have been revised, and only if settling actually
  -- moved it. Marking an unchanged day as revised invites somebody to look for a
  -- change that never happened.
  constraint aggregator_channel_days_revised_only_when_settled
    check (revised_at is null
           or (settlement_state = 'settled'
               and (provisional_revenue_paise is distinct from revenue_paise
                    or provisional_commission_paise is distinct from commission_paise)))
);

comment on table public.aggregator_channel_days is
  'A channel''s measured revenue and commission for a business date, held apart from the day a person records so it can exist for a day nobody counted. Written only by the ingest path; no client role may write it.';

create index aggregator_channel_days_by_outlet_date
  on public.aggregator_channel_days (outlet_id, business_date);

create trigger aggregator_channel_days_set_updated_at
  before update on public.aggregator_channel_days
  for each row execute function public.set_updated_at();

-- The state machine moves forward only. It followed the columns here from the
-- day row, where it was `guard_manual_ledger_settlement_state`, because a CHECK
-- cannot see the value a row is moving away from.
--
--   provisional -> settled | disputed
--   disputed    -> settled
--   settled     -> nothing at all
--
-- Settled being terminal is the one that matters most. A later run reading the
-- live dashboard must not quietly reopen a week that has already been paid and
-- reconciled, because the live figure omits cancellation refunds and would
-- silently lower a settled day.
create or replace function public.guard_aggregator_settlement_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $guard$
begin
  if old.settlement_state is not distinct from new.settlement_state then
    return new;
  end if;

  if old.settlement_state = 'settled' then
    raise exception 'a settled % day is final; it cannot become %',
      old.channel, new.settlement_state;
  end if;

  if old.settlement_state = 'disputed' and new.settlement_state = 'provisional' then
    raise exception
      'a disputed % week has already been paid and cannot return to provisional',
      old.channel;
  end if;

  return new;
end;
$guard$;

create trigger aggregator_channel_days_state_guarded
  before update of settlement_state on public.aggregator_channel_days
  for each row execute function public.guard_aggregator_settlement_state();

alter table public.aggregator_channel_days enable row level security;

-- Readable by the role that already reads the ledger's financial rows, refused
-- to everyone the ledger already refuses. Writable by NOBODY: the freeze is the
-- absence of a permitted writer, so a hand-crafted request and a missing form
-- field are refused by one rule rather than two, and there is no state in which
-- the screen and the database disagree about whether typing is allowed.
create policy aggregator_channel_days_owner_reads
  on public.aggregator_channel_days
  for select
  to authenticated
  using (public.app_is_owner() and public.app_account_active());

-- SELECT only, and the omission is the freeze. Every other table in this ledger
-- grants insert, update and delete to `authenticated` and then narrows by policy;
-- here the privilege is simply never granted, so a client is refused before any
-- policy is consulted and there is no policy to get wrong later.
grant select on public.aggregator_channel_days to authenticated;

-- Backfill, sourced days only. Origin is derived from the state the figure
-- already carried: a provisional figure came from the daily read, a settled one
-- from the settlement report.
insert into public.aggregator_channel_days
  (outlet_id, channel, business_date, revenue_paise, commission_paise,
   settlement_state, origin,
   superseded_revenue_paise, superseded_commission_paise, superseded_at,
   provisional_revenue_paise, provisional_commission_paise, revised_at)
select d.outlet_id,
       'zomato',
       d.business_date,
       d.zomato_revenue_paise,
       d.zomato_commission_paise,
       d.zomato_settlement_state,
       case when d.zomato_settlement_state = 'settled' then 'settlement'
            else 'daily_reader' end,
       d.zomato_superseded_revenue_paise,
       d.zomato_superseded_commission_paise,
       d.zomato_superseded_at,
       d.zomato_provisional_revenue_paise,
       d.zomato_provisional_commission_paise,
       d.zomato_revised_at
  from public.manual_ledger_days d
 where d.zomato_settlement_state is not null;

-- Every sourced day must have produced exactly one figure row, carrying exactly
-- the figures it had. A silent shortfall here would drop revenue invisibly,
-- because the column it came from is about to stop existing.
do $verify$
declare
  v_sourced bigint;
  v_figures bigint;
begin
  select count(*) into v_sourced
    from public.manual_ledger_days where zomato_settlement_state is not null;
  select count(*) into v_figures
    from public.aggregator_channel_days where channel = 'zomato';

  if v_sourced <> v_figures then
    raise exception 'backfill dropped rows: % sourced days produced % figure rows',
      v_sourced, v_figures;
  end if;

  if exists (
    select 1
      from public.manual_ledger_days d
      join public.aggregator_channel_days a
        on a.outlet_id = d.outlet_id
       and a.business_date = d.business_date
       and a.channel = 'zomato'
     where a.revenue_paise is distinct from d.zomato_revenue_paise
        or a.commission_paise is distinct from d.zomato_commission_paise
        or a.settlement_state is distinct from d.zomato_settlement_state
  ) then
    raise exception 'backfill moved a figure';
  end if;
end;
$verify$;

-- Both settlement guards go with the columns they police, and this is the
-- clearest statement of what the move buys.
--
-- `manual_ledger_days_settlement_is_read` existed to refuse a client write that
-- carried settlement figures, and `manual_ledger_days_settlement_state_guarded`
-- to refuse an illegal state transition on the day row. Neither has anything
-- left to guard: there is no column to carry a figure into, and the state now
-- lives on a table no client may write at all. A guard kept past the thing it
-- guarded is a guard nobody can reason about.
drop trigger manual_ledger_days_settlement_is_read on public.manual_ledger_days;
drop trigger manual_ledger_days_settlement_state_guarded on public.manual_ledger_days;
drop function public.guard_manual_ledger_settlement_is_read();
drop function public.guard_manual_ledger_settlement_state();

-- The columns go. After this a client still sending them gets an error naming a
-- column that does not exist, which is the loudest possible failure and better
-- than a write that appears to succeed and changes nothing.
alter table public.manual_ledger_days
  drop constraint if exists manual_ledger_days_zomato_commission_within_revenue,
  drop column zomato_revenue_paise,
  drop column zomato_commission_paise,
  drop column zomato_settlement_state,
  drop column zomato_superseded_revenue_paise,
  drop column zomato_superseded_commission_paise,
  drop column zomato_superseded_at,
  drop column zomato_provisional_revenue_paise,
  drop column zomato_provisional_commission_paise,
  drop column zomato_revised_at;

-- Swiggy's columns stay. It is not sourced, so it is still typed, and the form
-- keeps its fields for that channel.
