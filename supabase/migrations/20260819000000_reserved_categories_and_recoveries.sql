-- A payout recovery is not a purchase, and a reserved category is not free text.
--
-- These two arrived as separate requirements and turn out to be one mechanism.
-- Zomato states a deduction's own type in the payload, and for a Hyperpure
-- collection that type is literally "Hyperpure". The same word is the category a
-- person must no longer be able to type, because the supplier's statement now
-- owns every row that carries it. So one registry answers both questions: may a
-- person write this category, and does this deduction represent a purchase we
-- have already recorded from its own origin.
--
-- The double count this closes is not hypothetical. Order ZHPWB27-OR-0028753023
-- (Rs 9,311.11) sits in production twice: once as Rs 9,311.00 typed on 2 August,
-- and once as Rs 2,555.24 at Kalyani plus Rs 2,981.29 at Kanchrapara written by
-- the sync on 1 August, with a third slice of Rs 3,774.58 still to arrive. The
-- cause was structural: every deduction became an expense, so collecting a debt
-- was recorded as though it were incurring one.
--
-- The reconciliation sum is deliberately unchanged and still counts every
-- recovery, including recoveries of purchases dated before the sync boundary.
-- Zomato really did take that money out of this cycle's payout, and a sum that
-- omitted it would fail to reconcile against a payout that included it. The
-- boundary governs what is WRITTEN; the cycle governs what the payout is
-- MEASURED against.

-- The database's own folding rule, matching src/domain/category-match.ts:
-- diacritics stripped, case folded, anything that is not a letter or a number
-- treated as a single space. Immutable so it can sit inside a constraint.
create or replace function public.fold_expense_category(p_value text)
returns text
language sql
immutable
set search_path = ''
as $fold$
  select trim(
           regexp_replace(
             lower(
               translate(
                 p_value,
                 'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÑñÇç',
                 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc'
               )
             ),
             '[^a-z0-9]+', ' ', 'g'
           )
         );
$fold$;

comment on function public.fold_expense_category(text) is
  'Folds a category for comparison: diacritics stripped, case folded, punctuation and spacing reduced to single spaces. Mirrors foldCategory in src/domain/category-match.ts.';

-- A category an origin other than a person owns.
create table public.reserved_expense_categories (
  category text primary key
    check (category = public.normalize_expense_category(category))
    check (length(category) > 0),

  -- The origin that owns it, matching manual_ledger_expenses.source_system.
  owned_by text not null check (length(owned_by) > 0),

  -- Said to a person who tries to type it. A refusal that does not say where the
  -- number goes instead sends the number somewhere worse.
  guidance text not null check (length(guidance) > 0),

  created_at timestamptz not null default now()
);

alter table public.reserved_expense_categories enable row level security;

-- Readable by anyone who may record an expense, so the surface can refuse a
-- reserved category before the database has to. Writable by nobody: the set is
-- changed by migration, because reserving a category retires a hand-entry path
-- and that is a decision, not a setting.
create policy reserved_categories_are_readable
  on public.reserved_expense_categories
  for select
  to authenticated
  using (true);

insert into public.reserved_expense_categories (category, owned_by, guidance)
values (
  'Hyperpure',
  'hyperpure',
  'Hyperpure purchases arrive from the supplier''s own statement, one row per order, dated to the day the goods were delivered. If a purchase is missing, supply the statement on the aggregator page rather than typing the bill.'
);

-- The owner of the reserved category a typed value would collide with, or null.
--
-- Collision is deliberately wider than equality. The whole point of reserving a
-- category is that no hand-typed row may carry that cost, and the usual defence
-- of the free-text rule -- that a refusal is defeated by a different spelling --
-- is exactly what must not be available here. So "hyper pure", "HyperPure",
-- "Hyper-Pure" and "Hyperpure Goods" are all refused: fold-equal, squash-equal,
-- or one squashed form containing the other.
create or replace function public.expense_category_reserved_owner(p_category text)
returns text
language sql
stable
set search_path = ''
as $owner$
  with typed as (
    select public.fold_expense_category(coalesce(p_category, '')) as folded
  ),
  squashed as (
    select folded, replace(folded, ' ', '') as tight from typed
  )
  select r.owned_by
    from public.reserved_expense_categories r
    cross join squashed s
   where s.folded <> ''
     and (
       s.folded = public.fold_expense_category(r.category)
       or s.tight = replace(public.fold_expense_category(r.category), ' ', '')
       or s.tight like '%' || replace(public.fold_expense_category(r.category), ' ', '') || '%'
       or replace(public.fold_expense_category(r.category), ' ', '') like '%' || s.tight || '%'
     )
   order by length(r.category) desc
   limit 1;
$owner$;

revoke execute on function public.expense_category_reserved_owner(text) from anon;
grant execute on function public.expense_category_reserved_owner(text) to authenticated;

-- Three answers, not two, and the third is the double-count fix.
--
--   the owning origin        -> written, which is the point of reserving it
--   ANOTHER origin           -> SKIPPED, because an aggregator relaying a
--                               purchase it collected is reporting a payment,
--                               not a purchase, and the purchase already has a
--                               row from the origin that invoiced it
--   a person (no origin)     -> refused, with somewhere better to put it
--
-- The middle case is why this is a trigger rather than a rewrite of
-- `ingest_aggregator_cycle`. The recovery is dropped for every writer, present
-- and future, without touching the reconciliation arithmetic that must keep
-- counting it. Zomato posts these as category 'Hyperpure' with
-- source_system 'zomato': reserved, but not by its owner.
create or replace function public.enforce_reserved_expense_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $enforce$
declare
  v_owner text;
  v_guidance text;
begin
  v_owner := public.expense_category_reserved_owner(new.category);
  if v_owner is null then
    return new;
  end if;

  if new.source_system is not null then
    if new.source_system = v_owner then
      return new;
    end if;
    -- A collection, not a purchase. Drop the row and leave the cycle's sums alone.
    return null;
  end if;

  select guidance into v_guidance
    from public.reserved_expense_categories
   where owned_by = v_owner
   limit 1;

  raise exception '% is recorded by % rather than by hand. %',
    new.category, v_owner, coalesce(v_guidance, '')
    using errcode = '42501';
end;
$enforce$;

create trigger manual_ledger_expenses_enforce_reserved_category
  before insert or update of category, source_system
  on public.manual_ledger_expenses
  for each row execute function public.enforce_reserved_expense_category();
