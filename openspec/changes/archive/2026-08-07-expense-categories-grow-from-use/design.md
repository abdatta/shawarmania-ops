## Context

The manual ledger (#36) went live on 2026-08-04 and has been filled in nightly
since. On 2026-08-07 production held **nine expense rows** across six trading
days at both outlets, worth ₹79,528, and **all nine carry `raw_materials`**. The
eight-value `public.expense_category` enum is storing one bit of information.

What the owner actually recorded is in `description`, the field the form labels
"What was it for". Three distinct values across the nine rows: `Hyperpure` (7
uses), `Chicken` (1), `Staff Food` (1). Lengths run 7 to 10 characters. The
case-insensitive and case-sensitive distinct counts are both 3, so there is not
one spelling variant to reconcile. These are category names, and they have been
category names since the ledger shipped, written into a free-text field because
the category field could not hold them.

The consequence is that the month's expenses-by-category breakdown, which exists
to answer where the money went, currently answers `Raw materials: ₹79,528` and
nothing else.

The enum reaches two tables. `manual_ledger_expenses` (nine production rows) and
`expenses` (#2), whose surface is demo-gated so it holds **no production rows at
all**. Nine consumers exist in the tree, of which the load-bearing ones are
`LEDGER_CATEGORIES` and `CATEGORY_WORDS` in `src/features/manual-ledger/ledger.ts`,
`groupExpensesByCategory` in the same file, and the demo-gated
`src/features/expenses/expenses-surface.tsx`.

Three constraints frame every decision below:

- **The `manual-ledger` capability spec forbids three categories by name**
  (aggregator commission, cash banked, an owner drawing), because each is
  accounted for elsewhere and a category for one would double-count it. That
  requirement was written against a closed list.
- **#12 inherits an obligation** to carry the ledger's rows into the live
  expense record with "no translation table", justified explicitly by both sides
  sharing this enum.
- **#38 is sequenced immediately after this change** and rewrites the six RLS
  policies on the same two tables. This change must not touch a policy on
  `manual_ledger_expenses` or `expenses`, so that the two migrations do not
  overlap and #38 can be reasoned about against a settled schema.

Owner decisions taken during the 2026-08-07 grilling are recorded inline below
as **[owner, 2026-08-07]**.

## Goals / Non-Goals

**Goals:**

- An expense category is free text, typed once and offered as a suggestion from
  then on, business-wide across every outlet.
- The month's breakdown groups by what was actually bought, not by a bucket
  eight values wide.
- Renaming or merging a category is a deliberate, logged act, never a silent
  restatement of history.
- Both `manual_ledger_expenses` and `expenses` come off the enum in one
  migration, while `expenses` is still empty.
- The nine production rows keep every word already typed into them.

**Non-Goals:**

- **No outlet-scoped categories.** A category is a kind of cost, not a property
  of a shop [owner, 2026-08-07].
- **No supplier axis.** Production shows a supplier (`Hyperpure`), a good
  (`Chicken`) and a kind of cost (`Staff Food`) used interchangeably as
  categories. The owner has accepted the mix at this volume and will merge later
  if the month stops reading cleanly [owner, 2026-08-07]. Do not design a second
  dimension here.
- No budgets, spend limits or per-category thresholds.
- No hierarchy or nesting.
- **No RLS change on either expense table.** That is #38's whole job.

## Decisions

### D1 — The expense stores the category as `text`, and the suggestion list is a separate table

`manual_ledger_expenses.category` and `expenses.category` become `text not null`
with a not-blank check, matching every other required text column since #19. A
new `public.expense_categories` table holds one row per distinct category and
powers suggestions and curation.

**No foreign key between them.** This is the same rule bill lines already follow
for `item_name` and `unit_price`: a historical row must not be re-labelled by an
edit to a live list, exactly as a price change must not rewrite last month's
revenue. A foreign key would make renaming a category silently restate every
month it appears in, which is the failure this design exists to avoid.

It also makes "the list is only suggestions" *true* rather than merely stated. A
category can be retired with no orphan handling, and an expense recorded from a
device holding a stale suggestion list is still a valid row.

**Rejected: foreign key plus a snapshot column beside it.** It carries both
shapes, and every read has to decide which one it means. The snapshot is the
answer to every question the app asks, so the key earns nothing but a join.

**Rejected: keeping the enum and adding values on demand.** `alter type ... add
value` cannot run inside a transaction in the same statement batch that uses the
new value, is irreversible, and would put a schema migration in the path of a
staff member typing a word.

### D2 — Normalisation is deterministic, applied on write, and case-insensitive on match

One exported helper, used by the form, the adapters and the database:

- trim leading and trailing whitespace
- collapse internal runs of whitespace to one space
- preserve the case as typed

Matching against the suggestion list is case-insensitive and accent-sensitive,
enforced by a `unique` index on `lower(name)` on `expense_categories`, so
`chicken` finds `Chicken` and never mints a second row. **Case is preserved, not
folded**, because `Hyperpure` is a proper noun and title-casing or lower-casing
it would make the app look broken to the person who typed it.

The check constraint on the expense column refuses a value that is not already
normalised, so the database and the form cannot disagree. This follows #19's
rule that a blank is refused by the database rather than only by the form.

**Rejected: fuzzy or edit-distance matching.** `Chicken` and `Chicken Wings` are
different categories, and a system that guesses they are one is worse than a
merge the owner performs deliberately.

### D3 — Anyone who may record an expense may mint a category

Creating a category is a side effect of recording an expense with a word not yet
in the list, not a separate privileged act. The person holding the receipt is the
person who knows what it was [owner, 2026-08-07].

`expense_categories` is business-wide, so its policy is a role predicate with no
outlet clause. `customers` (#32) is the existing precedent for a table that is
not outlet-scoped, and its isolation test shape is what to follow.

**In this change the writers are the owner alone**, because #36's policies still
restrict both expense tables to `app_is_owner()`. The category policy is
nevertheless written to match *whoever may record an expense*, so #38 widens the
expense policies without having to revisit this one. Its isolation tests assert
the eventual shape, not just today's.

**Rejected: owner-only minting.** It puts the owner in the loop of every novel
purchase, which is the friction #38 exists to remove, and it would have to be
undone one change later.

### D4 — Rename and merge are explicit bulk rewrites, and each writes one log row

D1 makes a rename affect new rows only. That is the safe default, and it is not
what the owner wants every time: `chicken` should be able to become `meat`
across history, and a `chicken` / `Chicken` pair created before D2 landed should
be collapsible [owner, 2026-08-07].

So three owner-only operations on the curation surface:

- **Rename** — update the category row, and update every expense row whose
  stored text matches, in both tables, in one transaction.
- **Merge** — rewrite every expense row carrying A to B, in both tables, then
  delete A.
- **Retire** — remove from suggestions, touch no expense row.

Each of rename and merge writes exactly one row to
`public.expense_category_operations`: the operation, the text before, the text
after, how many rows moved in each table, when, and by whom.

**Its own table, not a column on the category row**, because a merge deletes one
of its two inputs and a column cannot survive the operation it describes.

**Why a log at all, when the ledger is deliberately history-free.** #36's design
D6 says a wrong figure is retyped because there is one reader and one writer, and
that stays true of a single row. Silently restating four months of category
totals across two outlets is a different act. One small table is the whole price
of being able to answer "the month changed, why" later, and it survives into
#38, where the surface has five writers rather than one.

**Merge is not reversible.** The log records what it did, which is enough to
reverse it by hand and not enough to offer a button. The confirmation states the
row count it is about to move, per table, before it moves anything.

### D5 — The three forbidden categories become a warning, not a refusal

The `manual-ledger` spec forbids aggregator commission, cash banked and an owner
drawing as categories. Against a closed list that was a guarantee. Against free
text it cannot be, and pretending otherwise would leave a requirement the code
does not enforce.

A soft, dismissable warning fires when a typed category matches a small
normalised phrase list, explaining where the figure belongs instead: commission
is netted from aggregator revenue, and cash taken from the drawer is recorded on
the day rather than as an expense. The word is still accepted.

**Rejected: a hard refusal.** Free text routes around a blocklist by spelling.
A refusal teaches nothing and produces `commision`, which the month then counts
anyway and which no future blocklist catches.

**The spec delta says this plainly**, downgrading the requirement from a
guarantee to a stated warning with the reason. A requirement the implementation
cannot honour is worse than an honest weaker one.

### D6 — `description` becomes optional and is relabelled "Note"

It is mandatory today, and #36's design D10 gives the reason: a category and an
amount identify a purchase for about a week. A free-text category now carries
that meaning, so **the requirement moves rather than disappears** — the not-blank
guarantee transfers to `category`, and the note is free for detail like `200 kg`
[owner, 2026-08-07].

Keeping both required would make somebody at a counter type the same word twice,
which is how a fast surface becomes one people work around.

The column stays `text` and keeps its not-blank-when-present check, the same
treatment `manual_ledger_days.note` already has.

### D7 — `expenses` converts in this change, while it is empty

`expenses` is demo-gated and holds no production rows, so its conversion is a
column type change against zero data today and a data migration once #11
promotes it.

It also keeps a promise already made: #12's inherited obligation says the
ledger's rows carry across with "no translation table", justified by both sides
sharing the enum. Converting one side and not the other quietly breaks that for
whoever picks up #12.

`public.expense_category` is dropped once neither table references it.

**Accepted cost:** the `expenses` half cannot be verified by using it, because
nothing renders it outside demo mode. Its isolation tests and the generated-types
diff are what prove it landed.

### D8 — The migration promotes the description text to category on all nine rows

For every existing `manual_ledger_expenses` row, the normalised `description`
becomes `category`, and `description` is left exactly as it is rather than
blanked. The seven `Hyperpure` rows, one `Chicken` and one `Staff Food` arrive
carrying the words already typed into them, and `expense_categories` is seeded
with those three distinct values.

**The enum values are discarded, not preserved anywhere** [owner, 2026-08-07].
`raw_materials` on all nine rows carries no information, and keeping it as a
second column would be a permanent monument to a modelling mistake.

The migration asserts its own outcome before committing: nine rows converted,
zero rows left with a blank category, three seeded categories. A migration that
silently converts eight of nine is worse than one that fails.

**Rejected: seeding the suggestion list empty and letting it rebuild from use.**
This was the recommendation until production was actually read. It is right when
the source text is prose and wrong here, where three clean words would have to be
retyped on day one for no benefit.

### D9 — Curation is an owner surface behind the Ledger, not a new navigation tab

The owner's bottom bar already carries six entries, which is what a phone holds.
Rename, merge and retire are reached from the Ledger's month view, beside the
expenses-by-category breakdown, which is where somebody notices that two
spellings need collapsing. This follows the same reasoning that put `owner-pnl`
and `owner-reports` behind the console rather than in the bar (#8, design D14).

A new gate registry entry with no `nav` block, state `live`, matching the
`owner-manual-ledger` entry it sits behind. **The gate registry is on the
`/quickfix` refusal list**, so this change runs the full local gate set including
the Docker job.

## Risks / Trade-offs

- **A forward-only migration converts nine rows of the only record of August
  2026 trading.** → The rows are the value here, not the surface. Take a
  snapshot of both ledger tables before `db push`, following the procedure in
  the 2026-07-29 pre-deploy snapshot. The migration asserts its converted row
  count inside the transaction, so a partial conversion rolls back rather than
  committing.

- **The month's grouping is the actual deliverable, and it is the easy thing to
  leave half-done.** → `groupExpensesByCategory` must group by the normalised
  stored text, not by raw text. A change that ships suggestions and leaves the
  month grouping unnormalised has shipped the visible half and missed the point.
  The gate names the month, not the dropdown.

- **Free text lets the same cost be recorded under two names for a fortnight
  before anybody notices.** → D2 removes the case and spacing variants, which
  are the mechanical majority. The rest is what merge is for, which is why merge
  ships in this change rather than being deferred.

- **The generated types file will not fail `typecheck` when it is stale.** →
  Two tables change shape and a type is dropped. Run `db:types` after
  `db:reset` and stage the result; the CI diff check is clean only once it is.

- **Nine consumers of `ExpenseCategory` exist in the tree**, including
  `fixtures.test-d.ts`, which is the type-level fixture guard. → The guard is an
  asset here: a fixture that still names an enum value fails to compile, which is
  exactly how the demo-gated `expenses` surface reports that it was missed.

- **#38 rewrites the RLS on both these tables immediately afterwards.** → This
  change touches no policy on `manual_ledger_expenses` or `expenses`, so the two
  migrations do not overlap. The one new policy here is on `expense_categories`,
  a table #38 does not modify.

- **A soft warning is a weaker guarantee than the spec currently makes.** →
  Stated as such in the spec delta and in `docs/LIMITATIONS.md`, with the reason.
  The alternative is a requirement nothing enforces, which is worse than an
  honest weaker one.

## Open Questions

- **What the curation surface shows for a category that no expense row uses.**
  Retire is obvious for a live category; a category seeded from history whose
  rows were later re-categorised is a different case, and the surface should
  probably show a usage count beside each entry so retire is never a guess.
- **Whether the operations log is readable by a Franchise Admin after #38.** It
  explains a change to a month they will then be able to read. Deferred to #38,
  where the reader set changes; this change makes it owner-only, which is the
  narrower starting point.
