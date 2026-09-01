# Design: Restore The Month's P&L

The deleted screen is the design reference, and it is readable in full:

```bash
git show 6c228b6^:src/features/manual-ledger/ledger-month.tsx
```

Its arithmetic is at `git show 6c228b6^:src/features/manual-ledger/ledger.ts`,
in `readMonth`. **Read both before writing code.** The owner asked for that
screen back, near enough exactly, and most of what follows is about the four
places where an exact copy would now be wrong.

## D1. An undetermined day contributes its gross, and commission is derived

**Decision.** The month sums the thirty-one day readings `getMonth` already
builds. For each aggregator channel:

```
gross      += day.grossPaise
net        += day.netPaise ?? day.grossPaise     // ← the ceiling
commission  = gross - net                        // ← derived, never accumulated
```

A day whose commission is undetermined contributes **its gross** to the net.
That is what makes the total a ceiling rather than an understatement, and it is
the owner's decision of 2026-08-17, carried across from #36 unchanged.

**Why not skip an undetermined day.** It would report a month smaller than the
shop actually earned. Understating profit is its own kind of wrong: it is the
number the owner makes decisions against. Contributing the gross says *"at most
this much arrived"*, which is true, and the undetermined-day count beside it is
what stops it being read as final.

**Why commission is subtracted rather than added up.** Deriving it from the two
running totals makes it impossible for a determined-only commission and a ceiling
net to drift apart: an undetermined day adds its gross to the net and therefore
nothing to the commission, which is exactly right. Accumulating a third total
independently reintroduces the drift the derivation forecloses.

**The netting stays inside the loop.** Each day is netted at its own stored rate
and the results added. A rate renegotiated mid-month is then right on both sides
of the change. Moving either the netting or the null-coalescing out of the loop
is the bug the whole per-day design exists to make impossible, and #36's own
comment said so.

**`isCeiling` is not enough on its own.** The day reading carries a boolean; the
month needs a **count**, because *"3 days are still waiting for their commission"*
and *"29 days are still waiting"* are different facts about how much the figure
can move. A day counts as undetermined when **any** of its channels is.

## D2. Channels are a list now, not two named columns

The notebook had `zomatoCommissionPaise` and `swiggyCommissionPaise` as fields.
`LedgerStatementDay.revenue.channels` is an array of `LedgerChannelReading` keyed
by `channel`, and #46/#48 have already been through one round of treating the two
delivery channels uniformly.

**Decision.** Accumulate into a map keyed by `channel`, and render one block per
channel in a stable order. The screen looks identical today, because today there
are exactly two channels. It does not need reopening when there is a third.

`asOfAt` per channel is the **latest** of that channel's days — the same `later()`
lexicographic comparison the notebook used, which is safe because ISO-8601 UTC
sorts as it orders and constructs no `Date` to compare two strings.

## D3. A date with no bills is reported as a date with no sales, and nothing more

**Decision.** The month always reports its aggregate. Where some of its dates
carry no bills, the reading says **how many** and offers their exact dates behind
a tap. Where none of them do, it says there are no recorded sales for that month.
No boundary is computed, and the outlet's first bill is never read.

**This replaces a boundary design, and the owner was right to reject it.** The
first version read the outlet's earliest bill and withheld the revenue and profit
figures for any month before it, on the grounds that ₹0 revenue against recorded
expenses is a loss the business did not make. It bought that protection with an
extra query, a three-case table, and a sentence — *"the outlet was not billing
yet"* — that **claims a cause the app cannot observe**. A date with no bills
might precede billing, or be a day the shop was shut, or be a day the tablet was
broken. The boundary version guessed, and dressed the guess as a fact.

*"N dates had no sales"* asserts only what the record holds. It is the smaller
claim and the true one, and it is also the more useful: it names the exact dates
rather than a cutoff, so a reader can recognise the closure or the outage
themselves. `outlets.billing_live_from`, dropped by #12, stays dropped, and the
unreachable `archived_manual_ledger_days` stays unreachable.

**It costs nothing.** The count and the dates fall out of the thirty-one day
readings the month already sums — a date with no bills is one whose cash, UPI and
channel grosses are all nought. The `min(business_date)` read is deleted from the
design rather than kept as a fallback, so this change issues **no new query at
all**.

**The note qualifies the profit figure, not only the revenue.** Expenses on an
unbilled date are real and recorded, so a month with unbilled dates reports
revenue for some dates and costs for all of them, and its profit is understated
by exactly the trade nobody rang up. The note therefore sits where the ceiling
sentence sits — against the profit figure as well as the revenue total — because
a reader who takes it only as a fact about sales will take the profit as final.

**A month with no billed dates at all offers no profit figure.** Its expenses
still list, because they were recorded and they are real. But profit needs both
halves, and with one wholly absent the answer is not a smaller number, it is not
a number. This is the July case that prompted the question, and it is the one
place the reading still withholds rather than states.

**The dates open in a `Why` modal**, which is the pattern these surfaces already
use for exactly this: the chip is the button, the explanation opens over the
surface, and nothing reflows (`src/components/ui/why.tsx`). A list of eleven
dates rendered inline is the paragraph a reader learns to skip.

## D4. The drawer becomes one line, and the line must not overclaim

**Decision.** The thirty-one-row list is replaced by a single line — *"28 of 31
days counted, 3 carried"* — which navigates to the day view.

The owner's objection is correct: the month view is about revenue, costs and
profit, and a drawer count is a different question. But `carried` is the only word
in the whole capability that says how far the numbers can be trusted, and a month
of it in a row means nobody has counted the drawer in weeks. Deleting it outright
would make an uncounted month look exactly like a counted one.

**What the line must count.** Three states exist, not two: `counted`, `carried`
and `not-tracked-yet`. A date before the outlet's anchor is **not** an uncounted
day — there is no belief there to leave unchecked, which is #11's decision D18 —
so it belongs in neither number. A month wholly before the anchor says so rather
than reporting *"0 of 31 counted"*, which would read as thirty-one failures.

## D5. `profit-estimates` is re-added, not amended out of #51

#51 is implemented and awaiting archive, and its delta **removes
`profit-estimates` whole**. The cheaper move looks like editing that delta so the
requirement never leaves.

**Decision. Let #51 remove it, and re-add it here.**

#51's reason is true and belongs in the archive: on 2026-08-31 the owner withdrew
the console, and the estimate had no live reader. This change's reason is a
different one: a derived reader now exists, on recorded rows rather than mock
data, and the stated reopen trigger fired. Editing #51's delta would erase the
first fact to save a round trip, and leave the archive claiming a decision was
never taken when it was.

The requirement does not come back unchanged. It returns **narrowed to cash
basis** — #12 had already withdrawn the consumption basis for want of inventory
movements — and it now names the Ledger month as the surface that must state the
basis, which the original could not, because it had no reader to name.

**Sequencing consequence.** This change depends on #51 and must not be applied
before #51 archives, or two deltas will disagree about one spec file.

## D6. `category` is carried as its own field

The day read collapses category into a label:
`label: row.description ?? row.category ?? 'Expense'`
([`ledger-statement.ts:255`](../../../src/data-access/supabase-adapters/ledger-statement.ts)).
So today a described expense loses its category entirely, and grouping the month
by category is impossible from the row shape.

**Decision.** Add `category` to the expense row as its own field and leave `label`
exactly as it is. `effective_expenses` already exposes the column, so no migration
and no view change. The day view keeps rendering `label` and is untouched.

**Why not parse it back out of `label`.** The label prefers the description
whenever one exists, so the category is not merely formatted differently — it is
absent. There is nothing to parse.

## D7. Two lines are dropped because the model beneath them changed

- **"N days recorded"** counted days the owner had typed into the notebook. Every
  date now always exists, so the count would always read 31 and mean nothing. It
  becomes **days with sales**, which is the fact a reader actually wanted from it.
- **"Nothing is recorded for this month"** is unreachable as written: the derived
  reader renders every date in full, so there is always something. D3's
  no-recorded-sales statement occupies that space instead, and it is the narrower
  claim — not *nothing happened here*, but *no sales were rung* — with that
  month's expenses still listed beneath it.

## Risk

**The ceiling path is the common case at launch, not the edge.** Swiggy changed a
GraphQL operation on 2026-08-31; both readers died, `sync-degradation-is-visible`
repaired the visibility, and the payouts query fix is not yet pushed. So recent
Swiggy commissions are genuinely undetermined and the month will read *"received
at most"* on ordinary days. That is the design working. It does mean the ceiling
path must be **verified as the normal rendering** rather than assumed rare, and
that the determined path needs a seeded month to be seen at all.
