-- ===========================================================================
-- Expenses are read where they are written
--
-- `cash-is-counted-not-closed` (#11) shipped two live surfaces that read
-- `public.expenses` and one comment explaining why: *"public.expenses only. The
-- notebook is never read by a live surface."* The sentence is a good rule about
-- `manual_ledger_days` — decision 18 refuses to seed the drawer's opening from
-- the notebook's day-close figures, and that refusal stands. It was applied to
-- the wrong table.
--
-- **Nothing writes `public.expenses`, and nothing ever has.** Expenses went live
-- in #36 and #38 against `manual_ledger_expenses`, which is where the Expenses
-- tab writes today, for every role, at both outlets. Measured on production
-- 2026-08-28: `public.expenses` 0 rows; `manual_ledger_expenses` 118 rows, 65 of
-- them cash, spanning 2026-08-01 to 2026-08-28.
--
-- So both live surfaces read an empty table and reported nought:
--
--   * the Ledger's Expenses card said *"Nothing recorded"* on days with real
--     expenses, which is what the owner saw and reported; and
--   * `drawer_cash_expenses_paise()` returned 0, so the drawer's expected
--     balance was **overstated by every cash expense since the last count** —
--     ₹290 at Kalyani on 2026-08-28 alone. The next count at either outlet would
--     have read short by exactly that, and a manufactured shortfall in a cash
--     reconciliation app is the specific fiction #11 was written to remove.
--
-- The demo hid it, and it is worth saying how: the mock store writes and reads
-- one `expenses` array, so demo mode is self-consistent by construction. Only
-- production has two tables, one written and the other read.
--
-- The fix names the live expense record wherever it currently lives, and leaves
-- the callers pointing at that name for good. When #12 carries the notebook rows
-- into `public.expenses`, this view collapses to its first branch and not one
-- caller changes.
--
-- Additive, in the same spirit as #11: one view, three functions replaced in
-- place. No table is dropped, renamed or altered, and no row is moved.

-- ---------------------------------------------------------------------------
-- 1. The live expense record, wherever it lives.
--
-- `security_invoker = true` is load-bearing, not decoration. Without it the view
-- runs as its owner, RLS on the base tables is bypassed, and any authenticated
-- session could read every outlet's expenses through it — the exact tenancy
-- failure the base policies exist to prevent. With it, a reader sees precisely
-- what `manual_ledger_expenses_select` and `expenses_select` already allow them.
-- `effective_bill_payments` is built the same way and for the same reason.
create or replace view public.effective_expenses
with (security_invoker = true) as
  select
    e.id,
    e.outlet_id,
    e.business_date,
    e.category,
    e.description,
    e.amount_paise,
    e.payment_method = 'cash' as is_cash,
    e.occurred_at,
    e.created_at,
    e.recorded_by,
    'expenses'::text as source_table
  from public.expenses e
  union all
  select
    m.id,
    m.outlet_id,
    m.business_date,
    m.category,
    m.description,
    m.amount_paise,
    m.is_cash,
    m.occurred_at,
    m.created_at,
    m.recorded_by,
    'manual_ledger_expenses'::text as source_table
  from public.manual_ledger_expenses m
  -- A voided expense is a row somebody withdrew. It stays on the record and it
  -- must not reach a total, a drawer interval or a month.
  where m.voided_at is null;

comment on view public.effective_expenses is
  'The live expense record wherever it currently lives: public.expenses, plus '
  'the un-voided rows of the manual_ledger_expenses stopgap that every live '
  'Expenses surface actually writes. Read by the derived Ledger and by the '
  'drawer interval arithmetic, so neither can report nought for a table nobody '
  'writes. retire-the-manual-ledger (#12) carries the rows across, after which '
  'the second branch is empty and may be deleted without touching a caller.';

grant select on public.effective_expenses to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The drawer's expense term, reading what exists.
--
-- Same arithmetic, same interval convention, same `coalesce(occurred_at,
-- created_at)` so a backdated cash expense lands where it belongs. Only the
-- relation changes — and `is_cash` replaces `payment_method = 'cash'`, which the
-- view has already normalised across the two shapes.
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
  select coalesce(sum(x.amount_paise), 0)::bigint
    from public.effective_expenses x
   where x.outlet_id = p_outlet_id
     and x.is_cash
     and (p_from is null or coalesce(x.occurred_at, x.created_at) > p_from)
     and coalesce(x.occurred_at, x.created_at) <= p_to
     and public.app_may_reach_drawer(p_outlet_id)
$$;

-- ---------------------------------------------------------------------------
-- 3. The other two interval readers, given the authority check they shipped
--    without.
--
-- **This is a tenancy defect, found while fixing the one above.** All three
-- readers are `security definer` — so they bypass RLS by design, which is
-- correct, because they are the database's half of the drawer arithmetic — and
-- all three are granted to `authenticated` while taking `p_outlet_id` from the
-- caller and checking nothing. A Biller or an Employee holding a valid session
-- could call any of them against an outlet they have no assignment at and read
-- that outlet's cash receipts, cash expenses or collections as an aggregate.
--
-- AGENTS.md states the rule they break in the first person: *"A Franchise Admin,
-- Biller, or Employee MUST NOT be able to read or write another outlet's rows —
-- including via a hand-crafted API request with a valid session."* Every table
-- in #11 carries `app_may_reach_drawer()` in its policy; these three functions
-- are the one path around those policies, and they were the one place it was not
-- applied.
--
-- The guard is the same predicate the policies use, so the answer cannot drift
-- from theirs. `record_drawer_observation()` calls all three internally and
-- checks the same predicate before it does, so nothing legitimate changes: a
-- caller who may record a count may read the terms that count is measured
-- against, and the guard returning false makes the sum nought rather than
-- raising, which is what a caller with no reach should learn.
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
  -- Unchanged from #11 but for the guard: the latest accepted EFFECTIVE Cash
  -- allocation of settled bills, at the bill's own `paid_at`, in `(p_from,
  -- p_to]`. A superseded allocation and an earlier correction revision
  -- contribute nothing; UPI, Swiggy and Zomato never appear.
  select coalesce(sum(e.amount_paise), 0)::bigint
    from public.bills b
    join public.effective_bill_payments e on e.bill_id = b.id
   where b.outlet_id = p_outlet_id
     and b.status = 'settled'
     and e.method = 'cash'
     and (p_from is null or b.paid_at > p_from)
     and b.paid_at <= p_to
     and public.app_may_reach_drawer(p_outlet_id)
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
  -- Unchanged from #11 but for the guard: summed WITH SIGNS, and the
  -- observation's own movements excluded — a collection saved together with a
  -- count is in neither that count's expected total nor its counted total. It
  -- reduces the next opening.
  select coalesce(sum(c.amount_paise), 0)::bigint
    from public.drawer_cash_out c
   where c.outlet_id = p_outlet_id
     and (p_exclude_observation is null
          or c.observation_id is distinct from p_exclude_observation)
     and (p_from is null or c.occurred_at > p_from)
     and c.occurred_at <= p_to
     and public.app_may_reach_drawer(p_outlet_id)
$$;

comment on function public.drawer_cash_expenses_paise(uuid, timestamptz, timestamptz) is
  'Cash expenses in (p_from, p_to] by occurrence instant, from '
  'public.effective_expenses so the notebook rows every live Expenses surface '
  'writes are counted. Refuses an outlet the caller may not reach.';
