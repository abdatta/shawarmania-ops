-- The drawer is a continuous balance, and a count is a point-in-time
-- observation of it.
--
-- `20260726000008_daily_cash.sql` modelled the drawer as one record per outlet
-- per business date, written by `close_business_day()` at the end of a day.
-- That is not when the drawer is counted. It is counted mid-shift, at a time the
-- collector picks, sometimes after skipping a day or two, and sometimes entered
-- an hour later from somewhere else. A count taken at 22:00 measured against a
-- whole business date's cash sales produces a difference that is fiction — and
-- fiction on every ordinary night, not in an edge case. Measured on August 2026
-- production data by `scripts/rehearse-august-drawer.mjs`, that fiction is
-- ₹4,640 in one month across two outlets, and at Kanchrapara it is the ordinary
-- case: 8 of its 13 cash dates traded past 22:00.
--
-- **This migration is deliberately additive: `create table` and
-- `add column ... null`, and nothing else.** No drop, no rename, no data
-- movement, no `alter ... type`, no `update`. That is the entire revert story
-- (design D16), and it is worth more than any flag: `daily_cash_records`,
-- `close_business_day()`, `cash_withdrawals` and `public.expenses` are all left
-- exactly as they are, dead, and `retire-the-manual-ledger` (#12) removes them
-- after asserting they were never written. Confirmed by read-only query on both
-- 2026-08-26 and 2026-08-27: all three tables hold zero rows.
--
-- Four properties are load-bearing and are stated here before the columns,
-- because each is a rule a later reader could undo without noticing:
--
--   1. **The carry-forward anchors to the COUNTED figure, never the expected
--      one** (D3). `next opening = counted_total − that observation's own cash
--      out`. This is what makes the whole design safe: every observation
--      re-anchors the balance to physical cash, so a mistake, or a correction
--      posted three weeks late, can only ever pollute the one interval it sits
--      in. It cannot ripple through a month.
--
--   2. **The opening is STORED per row and never recomputed on read** (D4),
--      exactly as `manual_ledger_days.opening_cash_paise` is and for the same
--      stated reason: correcting Tuesday must not silently move every row after
--      it. Where a stored opening disagrees with the previous observation's
--      carry-forward, the surface REPORTS the break and repairs nothing. Note
--      this is the opposite of the rule inside one row, where a third derivable
--      column is refused because it could disagree with the two it comes from.
--      Within a row, derive. Across rows, store. Both rules exist to stop a
--      figure changing without anybody deciding it should.
--
--   3. **Interval boundaries are timestamps, not business dates** (D2). Cash
--      belongs to `(previous counted_at, this counted_at]` — half-open at the
--      start, closed at the end, so a payment at exactly the previous count's
--      instant belonged to that count and one at exactly this instant belongs to
--      this one.
--
--   4. **The first observation at an outlet is a pure ANCHOR** (D18). It carries
--      no opening, no expected total and no difference — not a fabricated
--      opening and not a zero. Kalyani has traded since 2026-08-01 and its
--      drawer is not empty, so a zero would record a variance of roughly the
--      whole float as an excess, permanently, on the first row anybody reads.
--
-- Cash receipts come from `public.effective_bill_payments`, never from
-- `public.bill_payments`. Production already contains a tender correction in
-- each direction — one that removed a cash allocation (Kalyani, 2026-08-19) and
-- one that created one (Kanchrapara, 2026-08-20) — so reading the raw
-- allocations gets two real bills wrong today, not hypothetically.
--
-- Expenses come from `public.expenses`, never from
-- `public.manual_ledger_expenses`. The `manual-ledger` capability's own
-- requirement forbids a live surface reading the notebook, and #12 is what
-- carries that history across.

-- ===========================================================================
-- 1. An occurrence instant for an expense.
--
-- A business date cannot be placed on one side of a 22:00 boundary, and an
-- expense has never carried an instant. Nullable, defaulting to nothing:
-- interval membership reads `coalesce(occurred_at, created_at)`, so every
-- existing row keeps its meaning and no row is rewritten. A required instant
-- would break every row already stored and demand precision nobody has for a
-- ₹40 auto fare.

alter table public.expenses
  add column occurred_at timestamptz null;

comment on column public.expenses.occurred_at is
  'When the spend actually happened, where the person knows it. Null means '
  'created_at is the best answer available; drawer interval membership reads '
  'coalesce(occurred_at, created_at). Never required (cash-drawer, D13).';

-- The notebook's expense table gains the same column, because #12 promotes THIS
-- table to be the real one (it is the richer of the two) and a carry-over that
-- has to invent an instant is a carry-over that loses one.
alter table public.manual_ledger_expenses
  add column occurred_at timestamptz null;

comment on column public.manual_ledger_expenses.occurred_at is
  'As public.expenses.occurred_at. Present so #12 can carry these rows across '
  'without inventing an instant for them.';

-- `public.cash_withdrawals` is deliberately NOT touched. Nothing has ever
-- written it — it was only ever reachable through the day-close path, which
-- never ran — and #12 drops it. Adding a column to a table this change has no
-- use for would break the additive-only rule above for no benefit.

-- ===========================================================================
-- 2. drawer_observations — a named person saw this much, here, at this instant.

create table public.drawer_observations (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),

  -- **The two clocks, and the gap between them is the point.**
  -- `counted_at` is human-supplied: people count at 22:00 and type it at 23:04.
  -- `recorded_at` is the server's, so the lag can never be understated by a
  -- device whose clock is wrong or whose owner would rather it were.
  counted_at timestamptz not null,
  recorded_at timestamptz not null default now(),

  -- An outlet's first observation. See property 4 above and design D18.
  is_anchor boolean not null default false,

  -- The three derived figures, all null exactly when this is the anchor.
  -- `opening_paise` is stored rather than derived across rows (property 2), and
  -- is signed: a drawer topped up by more than it holds is arithmetically
  -- possible and refusing it here would only push the lie somewhere else.
  opening_paise bigint null,
  expected_paise bigint null,
  difference_paise bigint null,

  -- What was actually in the drawer. The one figure a human supplies, and the
  -- one the whole surface exists to compare something against. Non-negative:
  -- a drawer cannot hold less than nothing.
  counted_total_paise bigint not null check (counted_total_paise >= 0),

  -- **Approximate by default whenever the clocks differ** (D6), with a window
  -- in minutes so the surface can state in rupees how much of a difference the
  -- timing could account for. Stored rather than recomputed on read, so a row
  -- cannot change its own certainty when somebody edits the tolerance later.
  is_approximate boolean not null,
  tolerance_minutes integer not null default 15
    check (tolerance_minutes >= 0 and tolerance_minutes <= 240),

  -- Attribution names BOTH accounts, as `manual_ledger_days` already does, so a
  -- count the owner recorded and a manager later fixed does not read as though
  -- the owner entered what is on screen.
  recorded_by uuid not null references public.profiles (id),
  corrected_by uuid null references public.profiles (id),

  -- Where the person stood. Recorded, never required (D11): a collector who
  -- enters every count from home shows up as a column of reasons, which is
  -- oversight a refusal would not have produced. The distance is recomputed by
  -- the guard from the coordinates, so a row cannot claim a position its own
  -- coordinates contradict — the same rule attendance already follows.
  recorded_lat double precision null,
  recorded_lng double precision null,
  recorded_accuracy_m double precision null
    check (recorded_accuracy_m is null or recorded_accuracy_m >= 0),
  recorded_distance_m double precision null,
  recorded_on_site boolean not null default false,
  away_reason text null,

  note text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ── The anchor's shape, in both directions ────────────────────────────────
  -- A half-anchor cannot exist: the flag and the three null figures agree or
  -- the row is refused. Written as three equalities rather than one boolean
  -- soup so a violation message names which column disagreed.
  constraint drawer_observations_anchor_has_no_opening
    check (is_anchor = (opening_paise is null)),
  constraint drawer_observations_anchor_has_no_expected
    check (is_anchor = (expected_paise is null)),
  constraint drawer_observations_anchor_has_no_difference
    check (is_anchor = (difference_paise is null)),

  -- ── The arithmetic ────────────────────────────────────────────────────────
  -- The spec sentence, verbatim, behind one guard word. Short is negative and
  -- over is positive; a screen that flipped this would report a missing ₹500 as
  -- a surplus.
  constraint drawer_observations_difference_arithmetic
    check (is_anchor or difference_paise = counted_total_paise - expected_paise),

  -- ── The clocks ────────────────────────────────────────────────────────────
  -- No counting in the future. The stricter bounds — after the previous
  -- observation, and not before the outlet's earliest drawer activity — need to
  -- read other rows, so they live in the guard below rather than here.
  constraint drawer_observations_counted_not_after_recorded
    check (counted_at <= recorded_at),

  -- Approximate exactly when the clocks differ, unless certainty was asserted.
  -- An exact count whose clocks differ is possible (the recorder said they were
  -- sure); an approximate one whose clocks agree is not, because there is
  -- nothing to be approximate about.
  constraint drawer_observations_approximate_needs_a_gap
    check (is_approximate = false or counted_at < recorded_at),

  -- ── Being elsewhere is recorded, never refused ────────────────────────────
  -- A reason is required exactly when the recorder was not inside the fence,
  -- and is never blank when present (blank-is-not-a-value, #19).
  constraint drawer_observations_away_needs_a_reason check (
    (recorded_on_site or length(btrim(coalesce(away_reason, ''))) > 0)
    and (away_reason is null or length(btrim(away_reason)) > 0)
  ),
  constraint drawer_observations_note_not_blank
    check (note is null or length(btrim(note)) > 0)
);

-- The index the interval reader lives on: every query here is "this outlet's
-- observations, newest first" or "the one before this instant".
create index drawer_observations_outlet_counted_at_idx
  on public.drawer_observations (outlet_id, counted_at desc);

-- One anchor per outlet. This partial unique index is the concrete reason
-- decision 18 chose an explicit flag over bare nullable columns: written
-- against nullness instead (`where expected_paise is null`) it would restate
-- the anchor definition in a second place, and two places is where a definition
-- drifts.
create unique index drawer_observations_one_anchor_per_outlet
  on public.drawer_observations (outlet_id)
  where is_anchor;

alter table public.drawer_observations enable row level security;

create trigger drawer_observations_set_updated_at
  before update on public.drawer_observations
  for each row execute function public.set_updated_at();

comment on table public.drawer_observations is
  'A named account saw this much cash in this outlet''s drawer at this instant. '
  'The business day is not its container; it has none. Written only by '
  'record_drawer_observation() and edit_drawer_observation().';
comment on column public.drawer_observations.opening_paise is
  'The previous observation''s counted total less that observation''s own cash '
  'out. STORED, never recomputed on read: correcting Tuesday must not silently '
  'move every row after it. Null on the anchor, which has no interval.';
comment on column public.drawer_observations.is_anchor is
  'True for an outlet''s first observation, which carries no arithmetic at all. '
  'The drawer begins at what was counted (design D18).';

-- ===========================================================================
-- 3. drawer_cash_out — one table, one signed amount, a kind.

create table public.drawer_cash_out (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),

  -- `collection` is the nightly act: amount and instant only, no reason and no
  -- actor field, because the person is the session and asking why the owner
  -- took the day's takings collects a column of the word "collection".
  --
  -- `spend` is rare, requires a reason, and exists for drawer cash that buys
  -- something. It must NOT become an expense: docs/DATA_MODEL.md records that
  -- there is deliberately no capital marker and the month is a cash-basis
  -- OPERATING estimate, so a ₹40,000 fridge routed through expenses would move
  -- the drawer correctly and wreck the month.
  kind text not null check (kind in ('collection', 'spend')),

  -- **Signed and non-zero. Positive is cash leaving the drawer, negative is
  -- cash added to it, and there is no separate concept for cash going in.**
  --
  -- The scenario is real and already in production: a day with weak sales or
  -- heavy cash expenses leaves too little in the till, so the collector puts
  -- some of their own back at the moment of counting. It happened at both
  -- outlets in August 2026.
  --
  -- The arithmetic needs no new term, which is the whole argument for the sign:
  -- `expected = opening + receipts − expenses − cash out`, and subtracting a
  -- negative adds. A ₹1,000 top-up against a ₹450 count leaves ₹1,450 by the
  -- existing formula, with no branch anywhere.
  amount_paise bigint not null check (amount_paise <> 0),

  occurred_at timestamptz not null,

  recorded_by uuid not null references public.profiles (id),

  -- Set when this movement was recorded as part of an observation. Such a
  -- movement is excluded from that observation's expected total AND from its
  -- counted total — it reduces the NEXT opening instead.
  observation_id uuid null references public.drawer_observations (id),

  -- Nullable, and required only for a spend. Carried historical rows may hold
  -- one against a collection, so the column stays nullable rather than being
  -- split in two.
  reason text null,

  recorded_lat double precision null,
  recorded_lng double precision null,
  recorded_accuracy_m double precision null
    check (recorded_accuracy_m is null or recorded_accuracy_m >= 0),
  recorded_distance_m double precision null,
  recorded_on_site boolean not null default false,
  away_reason text null,

  created_at timestamptz not null default now(),

  -- **Drawer cash cannot un-buy a fridge.** A spend is money that left and
  -- bought something; a negative spend would be a refund from a supplier, which
  -- is a different fact and is not this one.
  constraint drawer_cash_out_spend_is_positive
    check (kind <> 'spend' or amount_paise > 0),

  -- A spend states what it bought. A collection needs neither a reason nor an
  -- actor, and that holds for a negative collection too: the owner asked for no
  -- extra fields and the surface's on-keystroke alert carries the meaning.
  constraint drawer_cash_out_spend_needs_a_reason
    check (kind <> 'spend' or length(btrim(coalesce(reason, ''))) > 0),
  constraint drawer_cash_out_reason_not_blank
    check (reason is null or length(btrim(reason)) > 0),

  constraint drawer_cash_out_away_needs_a_reason check (
    (recorded_on_site or length(btrim(coalesce(away_reason, ''))) > 0)
    and (away_reason is null or length(btrim(away_reason)) > 0)
  )
);

create index drawer_cash_out_outlet_occurred_at_idx
  on public.drawer_cash_out (outlet_id, occurred_at);
create index drawer_cash_out_observation_idx
  on public.drawer_cash_out (observation_id)
  where observation_id is not null;

alter table public.drawer_cash_out enable row level security;

comment on table public.drawer_cash_out is
  'Cash into or out of the drawer that is not a sale or an expense. One table, '
  'one signed non-zero amount, a kind of collection or spend. A negative amount '
  'is cash ADDED; there is deliberately no second table, kind or surface for it.';
comment on column public.drawer_cash_out.amount_paise is
  'Signed, non-zero. Positive leaves the drawer, negative is added to it. The '
  'interval arithmetic subtracts this term whatever its sign, so a top-up needs '
  'no branch (design D5).';

-- ===========================================================================
-- 4. drawer_observation_adjustments — a correction after the figure went
--    load-bearing.
--
-- An observation is fully editable, with no reason and no trail, until the next
-- observation at that outlet reads its `opening_paise`. That is the moment the
-- figure becomes load-bearing, and from then a correction is an append.
--
-- Freezing on save was the old model's instinct and is rejected: it makes a typo
-- permanent and pushes people to record a compensating adjustment for a mistake
-- nobody has yet relied on.

create table public.drawer_observation_adjustments (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.drawer_observations (id),
  outlet_id uuid not null references public.outlets (id),

  -- Both figures stay readable. The original is never overwritten, which is what
  -- makes this an adjustment rather than an edit wearing a reason.
  original_counted_total_paise bigint not null check (original_counted_total_paise >= 0),
  corrected_counted_total_paise bigint not null check (corrected_counted_total_paise >= 0),

  -- Required, and never blank. This is the difference between an adjustment and
  -- an edit: after the figure went load-bearing, moving it needs a stated reason.
  reason text not null check (length(btrim(reason)) > 0),

  adjusted_by uuid not null references public.profiles (id),
  adjusted_at timestamptz not null default now(),

  constraint drawer_observation_adjustments_moves_something
    check (corrected_counted_total_paise <> original_counted_total_paise)
);

create index drawer_observation_adjustments_observation_idx
  on public.drawer_observation_adjustments (observation_id, adjusted_at);
create index drawer_observation_adjustments_outlet_idx
  on public.drawer_observation_adjustments (outlet_id, adjusted_at desc);

alter table public.drawer_observation_adjustments enable row level security;

comment on table public.drawer_observation_adjustments is
  'A correction to an observation a later one has already anchored on. '
  'Append-only, attributed, reason required, both figures readable. The next '
  'observation''s stored opening does NOT move: it re-anchors the balance to '
  'physical cash, so nothing after it changes (design D3, D8).';

-- ===========================================================================
-- 5. ledger_day_verifications — an acknowledgement, not a freeze.
--
-- Verification freezes nothing and gates nothing, because aggregator settlement
-- legitimately restates a day's figures days later and a verification that
-- forbade it would be a verification nobody could use.

create table public.ledger_day_verifications (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  business_date date not null,
  verified_by uuid not null references public.profiles (id),
  verified_at timestamptz not null default now(),
  note text null check (note is null or length(btrim(note)) > 0),

  -- One verification per account per outlet-day. A second account verifying the
  -- same day is its OWN row and replaces nothing — two people having read a day
  -- is more information than one, and collapsing them would discard it.
  constraint ledger_day_verifications_one_per_account
    unique (outlet_id, business_date, verified_by)
);

create index ledger_day_verifications_outlet_date_idx
  on public.ledger_day_verifications (outlet_id, business_date);

alter table public.ledger_day_verifications enable row level security;

comment on table public.ledger_day_verifications is
  'An attributed acknowledgement that somebody read a business date. Freezes '
  'nothing, is required by nothing, and does not stop a settlement restating '
  'the day afterwards — the day is then marked changed since it was verified.';

-- ===========================================================================
-- 6. Who reaches a drawer.
--
-- Settled with the owner in this change (D11), reopening the question #28
-- deliberately left and the old #12 never answered.
--
-- A Super Admin reaches EVERY outlet's drawer holding no assignment there. The
-- live fact that forced this: both Super Admins had their Franchise Admin rows
-- DELETED rather than ended on 2026-08-01, so no live Franchise Admin
-- assignment exists at either outlet. Confirmed again 2026-08-27 — the live
-- rows are two business-wide Super Admins plus one Biller and two Employees per
-- outlet. Under the rule this change replaces, the database would refuse
-- everybody the primary action, at both outlets, on day one.
--
-- A Biller and an Employee are refused every drawer read and write at every
-- outlet, INCLUDING outlets where they hold a live assignment, by the absence of
-- a policy branch rather than by a hidden screen. That is a stronger claim than
-- ordinary outlet isolation, which is why supabase/tests writes it out rather
-- than inheriting it from the generic sweep.

create or replace function public.app_may_reach_drawer(outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_account_active()
     and (
       public.app_is_owner()
       or public.app_has_role_at('franchise_admin', outlet)
     )
$$;

revoke execute on function public.app_may_reach_drawer(uuid) from public, anon;
grant execute on function public.app_may_reach_drawer(uuid) to authenticated;

comment on function public.app_may_reach_drawer(uuid) is
  'Super Admin at any outlet, Franchise Admin at the outlets their live '
  'assignment names, nobody else anywhere. app_account_active() is what makes '
  'deactivation end this on the next request rather than at token expiry, and '
  'both role checks read live assignments, so ending one ends this the same way.';

-- ---------------------------------------------------------------------------
-- Grants. SELECT only: every write goes through a security-definer command, so
-- a client cannot supply a derived figure even with a valid session.

grant select on public.drawer_observations to authenticated;
grant select on public.drawer_cash_out to authenticated;
grant select on public.drawer_observation_adjustments to authenticated;
grant select on public.ledger_day_verifications to authenticated;

grant all on public.drawer_observations to service_role;
grant all on public.drawer_cash_out to service_role;
grant all on public.drawer_observation_adjustments to service_role;
grant all on public.ledger_day_verifications to service_role;

revoke insert, update, delete on public.drawer_observations from authenticated, anon;
revoke insert, update, delete on public.drawer_cash_out from authenticated, anon;
revoke insert, update, delete on public.drawer_observation_adjustments from authenticated, anon;
revoke insert, update, delete on public.ledger_day_verifications from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Policies. Reads only, deliberately: there is no write policy on any of these
-- four tables, and that is the refusal task 2.1 and 2.3 assert.

create policy drawer_observations_select on public.drawer_observations
  for select to authenticated
  using (public.app_may_reach_drawer(outlet_id));

create policy drawer_cash_out_select on public.drawer_cash_out
  for select to authenticated
  using (public.app_may_reach_drawer(outlet_id));

create policy drawer_observation_adjustments_select on public.drawer_observation_adjustments
  for select to authenticated
  using (public.app_may_reach_drawer(outlet_id));

create policy ledger_day_verifications_select on public.ledger_day_verifications
  for select to authenticated
  using (public.app_may_reach_drawer(outlet_id));

-- ===========================================================================
-- 7. The guard on an observation's identity and its position.
--
-- Identity is immutable: which outlet, which counted instant, who recorded it,
-- and whether it is the anchor. Correcting a figure is the point; moving an
-- observation to another outlet or instant is not a correction but a second row
-- wearing the first one's history, and it would slip past the ordering checks.
-- This is the same treatment `attendance_guard()` and `manual_ledger_guard()`
-- give their rows' identities.
--
-- Position is recomputed from the coordinates on every write, so a row cannot
-- claim a distance or an on-site verdict its own coordinates contradict.

create or replace function public.drawer_position_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_radius integer;
begin
  select latitude, longitude, geofence_radius_m
    into v_lat, v_lng, v_radius
    from public.outlets
   where id = new.outlet_id;

  if not found then
    raise exception 'unknown outlet %', new.outlet_id;
  end if;

  new.recorded_distance_m := public.app_distance_m(
    new.recorded_lat, new.recorded_lng, v_lat, v_lng);

  -- No position at all reads as NOT on site, so it asks for a reason. A missing
  -- fix and a fix from home are the same claim as far as this record is
  -- concerned: nobody can tell from the row that the person was standing there.
  new.recorded_on_site := new.recorded_distance_m is not null
    and new.recorded_distance_m <= v_radius;

  if new.recorded_on_site then
    new.away_reason := null;
  end if;

  return new;
end;
$$;

create trigger drawer_observations_position
  before insert or update on public.drawer_observations
  for each row execute function public.drawer_position_guard();

create trigger drawer_cash_out_position
  before insert or update on public.drawer_cash_out
  for each row execute function public.drawer_position_guard();

create or replace function public.drawer_observation_identity_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.outlet_id is distinct from old.outlet_id
     or new.recorded_by is distinct from old.recorded_by
     or new.is_anchor is distinct from old.is_anchor then
    raise exception
      'a drawer observation''s identity (outlet, recorder, anchor) is immutable';
  end if;
  return new;
end;
$$;

create trigger drawer_observations_identity
  before update on public.drawer_observations
  for each row execute function public.drawer_observation_identity_guard();

-- Both append-only tables mean it: no update, no delete, by anybody.
create trigger drawer_observation_adjustments_immutable
  before update or delete on public.drawer_observation_adjustments
  for each row execute function public.reject_mutation();

-- ===========================================================================
-- 8. The interval arithmetic, computed inside the writing transaction.
--
-- These three readers are the database's half of `src/domain/drawer.ts`, and
-- the two must agree. The client never supplies a derived figure; there is no
-- parameter through which it could.

create or replace function public.drawer_cash_receipts_paise(
  p_outlet_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  -- The latest accepted EFFECTIVE Cash allocation of settled bills. A
  -- superseded original allocation and an earlier correction revision
  -- contribute nothing, because `effective_bill_payments` has already resolved
  -- them. UPI, Swiggy and Zomato never appear.
  --
  -- The instant is the bill's own `paid_at`: the money physically changed hands
  -- at the sale, and a later tender correction is a correction of what was
  -- recorded rather than a second movement of cash.
  --
  -- `(p_from, p_to]` — half-open at the start, closed at the end (D2).
  select coalesce(sum(e.amount_paise), 0)::bigint
    from public.bills b
    join public.effective_bill_payments e on e.bill_id = b.id
   where b.outlet_id = p_outlet_id
     and b.status = 'settled'
     and e.method = 'cash'
     and (p_from is null or b.paid_at > p_from)
     and b.paid_at <= p_to
$$;

create or replace function public.drawer_cash_expenses_paise(
  p_outlet_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  -- `coalesce(occurred_at, created_at)`, so a backdated cash expense lands in
  -- the interval it actually belongs to. Only cash moves the drawer.
  --
  -- `public.expenses` only. The notebook is never read by a live surface.
  select coalesce(sum(x.amount_paise), 0)::bigint
    from public.expenses x
   where x.outlet_id = p_outlet_id
     and x.payment_method = 'cash'
     and (p_from is null or coalesce(x.occurred_at, x.created_at) > p_from)
     and coalesce(x.occurred_at, x.created_at) <= p_to
$$;

create or replace function public.drawer_cash_out_paise(
  p_outlet_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_exclude_observation uuid default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  -- Summed WITH SIGNS, and the observation's own movements excluded: a
  -- collection saved together with a count is not in that count's expected
  -- total and not in its counted total either. It reduces the next opening.
  select coalesce(sum(c.amount_paise), 0)::bigint
    from public.drawer_cash_out c
   where c.outlet_id = p_outlet_id
     and (p_from is null or c.occurred_at > p_from)
     and c.occurred_at <= p_to
     and (p_exclude_observation is null
          or c.observation_id is distinct from p_exclude_observation)
$$;

revoke execute on function
  public.drawer_cash_receipts_paise(uuid, timestamptz, timestamptz),
  public.drawer_cash_expenses_paise(uuid, timestamptz, timestamptz),
  public.drawer_cash_out_paise(uuid, timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function
  public.drawer_cash_receipts_paise(uuid, timestamptz, timestamptz),
  public.drawer_cash_expenses_paise(uuid, timestamptz, timestamptz),
  public.drawer_cash_out_paise(uuid, timestamptz, timestamptz, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The earliest instant an observation may claim.

create or replace function public.drawer_earliest_activity(p_outlet_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select min(b.paid_at)
    from public.bills b
   where b.outlet_id = p_outlet_id
     and b.status = 'settled'
$$;

revoke execute on function public.drawer_earliest_activity(uuid) from public, anon;
grant execute on function public.drawer_earliest_activity(uuid) to authenticated;

-- ===========================================================================
-- 9. record_drawer_observation() — the only insert path.

create or replace function public.record_drawer_observation(
  p_outlet_id uuid,
  p_counted_at timestamptz,
  p_counted_total_paise bigint,
  p_certain boolean default false,
  p_tolerance_minutes integer default 15,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_away_reason text default null,
  p_note text default null,
  -- The collection taken at the same moment, if any. Signed: negative is cash
  -- added to a thin drawer. Null means nothing was collected.
  p_cash_out_paise bigint default null,
  p_cash_out_kind text default 'collection',
  p_cash_out_reason text default null
)
returns public.drawer_observations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_previous public.drawer_observations%rowtype;
  v_earliest timestamptz;
  v_opening bigint;
  v_receipts bigint;
  v_expenses bigint;
  v_cash_out bigint;
  v_expected bigint;
  v_is_anchor boolean;
  v_approximate boolean;
  v_observation public.drawer_observations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not public.app_may_reach_drawer(p_outlet_id) then
    raise exception
      'only a Super Admin, or a Franchise Admin assigned to this outlet, may record a count here'
      using errcode = '42501';
  end if;

  if p_counted_total_paise is null or p_counted_total_paise < 0 then
    raise exception 'the counted total must be a non-negative paise amount';
  end if;
  if p_counted_at is null then
    raise exception 'a count needs the instant it was taken';
  end if;

  -- **The advisory lock is what stops two concurrent counts interleaving.**
  -- Without it, two sessions could each read the same "previous observation",
  -- each compute an opening from it, and both insert — leaving two observations
  -- claiming the same predecessor and one of them silently wrong. Taken on the
  -- outlet, so counting at Kalyani never waits on Kanchrapara.
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text, 0));

  select * into v_previous
    from public.drawer_observations
   where outlet_id = p_outlet_id
   order by counted_at desc
   limit 1;

  v_is_anchor := not found;

  -- ── The clocks ──────────────────────────────────────────────────────────
  if p_counted_at > v_now then
    raise exception
      'a count cannot be taken in the future: % is later than the server clock at %',
      p_counted_at, v_now;
  end if;

  if not v_is_anchor and p_counted_at <= v_previous.counted_at then
    raise exception
      'this outlet was already counted at %; a later count cannot be slotted into a settled interval',
      v_previous.counted_at;
  end if;

  v_earliest := public.drawer_earliest_activity(p_outlet_id);
  if v_earliest is not null and p_counted_at < v_earliest then
    raise exception
      'this outlet had no drawer activity before %; a count cannot precede it',
      v_earliest;
  end if;

  v_approximate := (not coalesce(p_certain, false)) and p_counted_at < v_now;

  -- ── The arithmetic, computed here and nowhere else ──────────────────────
  if v_is_anchor then
    -- An anchor has no interval, so it has no opening, no expected total and no
    -- difference. The drawer begins at what was counted (design D18).
    v_opening := null;
    v_expected := null;
  else
    -- `next opening = counted − that observation's OWN cash out`, and the own
    -- cash out is read from the observation link rather than from a time window,
    -- so a collection saved a second after the count still belongs to it.
    --
    -- The counted figure, never the expected one. This single line is decision
    -- 3, and it is why a ₹500 shortfall is recorded once and reaches nothing.
    v_opening := v_previous.counted_total_paise - coalesce((
      select sum(c.amount_paise)
        from public.drawer_cash_out c
       where c.observation_id = v_previous.id
    ), 0);

    v_receipts := public.drawer_cash_receipts_paise(
      p_outlet_id, v_previous.counted_at, p_counted_at);
    v_expenses := public.drawer_cash_expenses_paise(
      p_outlet_id, v_previous.counted_at, p_counted_at);
    v_cash_out := public.drawer_cash_out_paise(
      p_outlet_id, v_previous.counted_at, p_counted_at, v_previous.id);

    -- Movements already attributed to the PREVIOUS observation are its
    -- carry-forward, not this interval's, so they are excluded above.
    v_expected := v_opening + v_receipts - v_expenses - v_cash_out;
  end if;

  insert into public.drawer_observations (
    outlet_id, counted_at, recorded_at, is_anchor,
    opening_paise, expected_paise, difference_paise, counted_total_paise,
    is_approximate, tolerance_minutes,
    recorded_by, recorded_lat, recorded_lng, recorded_accuracy_m, away_reason, note
  ) values (
    p_outlet_id, p_counted_at, v_now, v_is_anchor,
    v_opening, v_expected,
    case when v_is_anchor then null else p_counted_total_paise - v_expected end,
    p_counted_total_paise,
    v_approximate, coalesce(p_tolerance_minutes, 15),
    auth.uid(), p_lat, p_lng, p_accuracy_m, p_away_reason, p_note
  )
  returning * into v_observation;

  -- The collection taken at the same moment, in the same transaction.
  if p_cash_out_paise is not null and p_cash_out_paise <> 0 then
    insert into public.drawer_cash_out (
      outlet_id, kind, amount_paise, occurred_at, recorded_by, observation_id,
      reason, recorded_lat, recorded_lng, recorded_accuracy_m, away_reason
    ) values (
      p_outlet_id, coalesce(p_cash_out_kind, 'collection'), p_cash_out_paise,
      p_counted_at, auth.uid(), v_observation.id,
      p_cash_out_reason, p_lat, p_lng, p_accuracy_m, p_away_reason
    );
  end if;

  return v_observation;
end;
$$;

revoke execute on function public.record_drawer_observation(
  uuid, timestamptz, bigint, boolean, integer, double precision, double precision,
  double precision, text, text, bigint, text, text) from public, anon;
grant execute on function public.record_drawer_observation(
  uuid, timestamptz, bigint, boolean, integer, double precision, double precision,
  double precision, text, text, bigint, text, text) to authenticated;

-- ===========================================================================
-- 10. record_drawer_cash_out() — a collection or a spend on its own.

create or replace function public.record_drawer_cash_out(
  p_outlet_id uuid,
  p_amount_paise bigint,
  p_occurred_at timestamptz default null,
  p_kind text default 'collection',
  p_reason text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_away_reason text default null
)
returns public.drawer_cash_out
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_at timestamptz := coalesce(p_occurred_at, v_now);
  v_row public.drawer_cash_out%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not public.app_may_reach_drawer(p_outlet_id) then
    raise exception
      'only a Super Admin, or a Franchise Admin assigned to this outlet, may move cash here'
      using errcode = '42501';
  end if;

  if p_amount_paise is null or p_amount_paise = 0 then
    raise exception 'a cash movement of nought is not a movement';
  end if;

  if v_at > v_now then
    raise exception 'a cash movement cannot be recorded in the future';
  end if;

  insert into public.drawer_cash_out (
    outlet_id, kind, amount_paise, occurred_at, recorded_by, observation_id,
    reason, recorded_lat, recorded_lng, recorded_accuracy_m, away_reason
  ) values (
    p_outlet_id, p_kind, p_amount_paise, v_at, auth.uid(), null,
    p_reason, p_lat, p_lng, p_accuracy_m, p_away_reason
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.record_drawer_cash_out(
  uuid, bigint, timestamptz, text, text, double precision, double precision,
  double precision, text) from public, anon;
grant execute on function public.record_drawer_cash_out(
  uuid, bigint, timestamptz, text, text, double precision, double precision,
  double precision, text) to authenticated;

-- ===========================================================================
-- 11. edit_drawer_observation() — while nothing has anchored on it.

create or replace function public.edit_drawer_observation(
  p_observation_id uuid,
  p_counted_total_paise bigint,
  p_note text default null
)
returns public.drawer_observations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_observation public.drawer_observations%rowtype;
  v_later_count integer;
  v_row public.drawer_observations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_observation
    from public.drawer_observations where id = p_observation_id;
  if not found then
    raise exception 'no such observation';
  end if;

  if not public.app_may_reach_drawer(v_observation.outlet_id) then
    raise exception 'you may not edit this outlet''s counts' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_observation.outlet_id::text, 0));

  select count(*) into v_later_count
    from public.drawer_observations
   where outlet_id = v_observation.outlet_id
     and counted_at > v_observation.counted_at;

  -- **The lock, in one sentence.** The next observation read this figure as its
  -- own stored opening, which is the moment it became load-bearing. Changing it
  -- now would break the chain the surface promises to report rather than
  -- repair — so from here a correction is an attributed adjustment.
  if v_later_count > 0 then
    raise exception
      'a later count at this outlet has already anchored on this one; post an adjustment instead';
  end if;

  if p_counted_total_paise is null or p_counted_total_paise < 0 then
    raise exception 'the counted total must be a non-negative paise amount';
  end if;

  update public.drawer_observations
     set counted_total_paise = p_counted_total_paise,
         -- Recomputed from the SAME expected total: the interval did not move,
         -- only what was found in the drawer.
         difference_paise = case
           when is_anchor then null
           else p_counted_total_paise - expected_paise
         end,
         note = p_note,
         corrected_by = case
           when auth.uid() is distinct from recorded_by then auth.uid()
           else corrected_by
         end
   where id = p_observation_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.edit_drawer_observation(uuid, bigint, text)
  from public, anon;
grant execute on function public.edit_drawer_observation(uuid, bigint, text)
  to authenticated;

-- ===========================================================================
-- 12. adjust_drawer_observation() — after it went load-bearing.

create or replace function public.adjust_drawer_observation(
  p_observation_id uuid,
  p_corrected_counted_total_paise bigint,
  p_reason text
)
returns public.drawer_observation_adjustments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_observation public.drawer_observations%rowtype;
  v_later_count integer;
  v_row public.drawer_observation_adjustments%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_observation
    from public.drawer_observations where id = p_observation_id;
  if not found then
    raise exception 'no such observation';
  end if;

  if not public.app_may_reach_drawer(v_observation.outlet_id) then
    raise exception 'you may not adjust this outlet''s counts' using errcode = '42501';
  end if;

  select count(*) into v_later_count
    from public.drawer_observations
   where outlet_id = v_observation.outlet_id
     and counted_at > v_observation.counted_at;

  -- The mirror of the edit rule, and it exists so the two paths cannot both
  -- apply. An observation nothing has anchored on is EDITED, with no reason and
  -- no trail; asking for an adjustment there would collect a reason for a
  -- mistake nobody has relied on.
  if v_later_count = 0 then
    raise exception
      'nothing has anchored on this count yet; edit it instead of adjusting it';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'an adjustment needs a reason';
  end if;

  insert into public.drawer_observation_adjustments (
    observation_id, outlet_id,
    original_counted_total_paise, corrected_counted_total_paise,
    reason, adjusted_by
  ) values (
    p_observation_id, v_observation.outlet_id,
    v_observation.counted_total_paise, p_corrected_counted_total_paise,
    btrim(p_reason), auth.uid()
  )
  returning * into v_row;

  -- **The observation itself is NOT rewritten**, and the next observation's
  -- stored opening does not move. That is decision 3 doing its job: the later
  -- count re-anchored the balance to physical cash, so nothing after it changes
  -- and the break is reported rather than repaired.
  update public.drawer_observations
     set corrected_by = auth.uid()
   where id = p_observation_id;

  return v_row;
end;
$$;

revoke execute on function public.adjust_drawer_observation(uuid, bigint, text)
  from public, anon;
grant execute on function public.adjust_drawer_observation(uuid, bigint, text)
  to authenticated;

-- ===========================================================================
-- 13. verify_ledger_day() — an acknowledgement.

create or replace function public.verify_ledger_day(
  p_outlet_id uuid,
  p_business_date date,
  p_note text default null
)
returns public.ledger_day_verifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ledger_day_verifications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not public.app_may_reach_drawer(p_outlet_id) then
    raise exception 'you may not verify this outlet''s days' using errcode = '42501';
  end if;

  begin
    insert into public.ledger_day_verifications (
      outlet_id, business_date, verified_by, note
    ) values (
      p_outlet_id, p_business_date, auth.uid(),
      case when length(btrim(coalesce(p_note, ''))) = 0 then null else btrim(p_note) end
    )
    returning * into v_row;
  exception
    when unique_violation then
      -- Replaces nothing, deliberately. The first acknowledgement is a fact
      -- about a moment, and overwriting it with a second would discard the
      -- moment while pretending to record it.
      raise exception 'you have already verified % at this outlet', p_business_date;
  end;

  return v_row;
end;
$$;

revoke execute on function public.verify_ledger_day(uuid, date, text) from public, anon;
grant execute on function public.verify_ledger_day(uuid, date, text) to authenticated;
