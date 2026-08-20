-- "These two are both real", remembered.
--
-- The possible-duplicate signal pairs a hand-entered expense with a synced one
-- that sits near it in amount and date. Buying the same thing twice in a day is
-- ordinary, so the flag has to be answerable — and the answer has to be kept, or
-- it returns on the next read and the owner settles the same question forever.
-- The pair carries no state of its own, being derived from two expense rows, so
-- the decision is stored here instead: the two rows, and who set them apart.

create table public.aggregator_dismissed_duplicates (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id),
  -- The two expenses the signal paired. Ordered by the caller as the event names
  -- them; the unique constraint is on the ordered pair, which is stable because
  -- the event id is built the same way each read.
  expense_a uuid not null references public.manual_ledger_expenses (id) on delete cascade,
  expense_b uuid not null references public.manual_ledger_expenses (id) on delete cascade,
  dismissed_by uuid not null references public.profiles (id),
  dismissed_at timestamptz not null default now(),

  constraint aggregator_dismissed_duplicates_two_rows check (expense_a <> expense_b),
  constraint aggregator_dismissed_duplicates_pair unique (outlet_id, expense_a, expense_b)
);

comment on table public.aggregator_dismissed_duplicates is
  'A possible-duplicate pair the owner has confirmed are two real purchases, so the signal does not raise it again. Neither expense row is touched.';

alter table public.aggregator_dismissed_duplicates enable row level security;

-- The same authority the sync surface has: the owner, across outlets. The pair
-- is financial and follows the settlement records' rule, not the wider expenses
-- one.
create policy dismissed_duplicates_owner_reads
  on public.aggregator_dismissed_duplicates
  for select to authenticated
  using (public.app_is_owner() and public.app_account_active());

create policy dismissed_duplicates_owner_writes
  on public.aggregator_dismissed_duplicates
  for insert to authenticated
  with check (
    public.app_is_owner()
    and public.app_account_active()
    and dismissed_by = (select auth.uid())
  );

grant select, insert on public.aggregator_dismissed_duplicates to authenticated;
