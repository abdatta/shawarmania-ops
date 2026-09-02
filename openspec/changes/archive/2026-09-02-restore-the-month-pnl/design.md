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

## D3. A date with no recorded sales is named, and nothing more is claimed

**Decision.** The month always reports its aggregate. Where some of its dates
recorded no sales at all, the reading says **how many** and offers their exact
dates behind a tap. Where none of them do, it says there are no recorded sales for that month.
No boundary is computed, and the outlet's first bill is never read.

**This replaces a boundary design, and the owner was right to reject it.** The
first version read the outlet's earliest bill and withheld the revenue and profit
figures for any month before it, on the grounds that ₹0 revenue against recorded
expenses is a loss the business did not make. It bought that protection with an
extra query, a three-case table, and a sentence — *"the outlet was not billing
yet"* — that **claims a cause the app cannot observe**. A silent date
might precede billing, or be a day the shop was shut, or be a day the tablet was
broken. The boundary version guessed, and dressed the guess as a fact.

*"N dates had no sales"* asserts only what the record holds. It is the smaller
claim and the true one, and it is also the more useful: it names the exact dates
rather than a cutoff, so a reader can recognise the closure or the outage
themselves. `outlets.billing_live_from`, dropped by #12, stays dropped, and the
unreachable `archived_manual_ledger_days` stays unreachable.

**It costs nothing.** The count and the dates fall out of the thirty-one day
readings the month already sums — a silent date is one whose cash, UPI and
channel grosses are all nought. The `min(business_date)` read is deleted from the
design rather than kept as a fallback, so this change issues **no new query at
all**.

**The note qualifies the profit figure, not only the revenue.** Expenses on a
silent date are real and recorded, so a month with silent dates reports
revenue for some dates and costs for all of them, and its profit is understated
by exactly the trade nobody rang up. The note therefore sits where the ceiling
sentence sits — against the profit figure as well as the revenue total — because
a reader who takes it only as a fact about sales will take the profit as final.

**A month with no sale on any date offers no profit figure.** Its expenses
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

## D8. A channel that reported nothing is named, never omitted

**Added after the owner opened the built screen** and found September showing
Cash and UPI and no Zomato or Swiggy at all, under a confident
*"Revenue actually received"*.

**Decision.** The month presents a section per channel in `DELIVERY_CHANNELS`
whether or not that channel produced a figure, and where it produced none it says
so in words rather than rendering nought.

**Why it is not merely cosmetic.** A channel that took no orders and a channel
whose sync never ran are the same absence in the data. Omitting the channel makes
a revenue total that appears complete and may not be — the exact shape of the
defect `sync-degradation-is-visible` fixed one level up, where a dead channel and
a healthy one rendered identically. It is the live case rather than a
hypothetical: Swiggy's payouts query is broken as this ships, and a broken sync
writes no rows.

**Per outlet, not per application — the owner had to tell us.** Kanchrapara does
not sell on Swiggy, and the sync writes it nineteen ₹0 Swiggy rows a month
regardless. Assuming both channels everywhere put three nought rows on that
outlet’s screen every month, and would have raised a *recorded nothing* alarm in
any month the rows were absent. So the expected set is read from
`outlet_channel_restaurants` where the state is `enabled` — one indexed read per
month, and the mapping the sync itself is driven by. A channel the outlet is not
mapped to is still shown, and still counted, **where it reported revenue**:
hiding a channel and losing its money must not be the same edit.

**Where the list lives.** `DELIVERY_CHANNELS` moved from
`src/features/aggregator-sync/channel-config.ts` into `src/domain/channels.ts`,
because three layers now need it and the domain may not import a feature. The
feature re-exports it, so no caller moved.

**A channel reporting nought is not a channel reporting nothing**, and the two
render differently. Production settles that this matters: Kanchrapara's Swiggy
recorded ₹0 on nineteen August dates. Rows exist and they say nought — that is a
measurement, and it shows as figures.

**Inherited, and deliberately not fixed on the day view.** `getDay` has the same
shape, and a day with no Zomato orders is entirely ordinary; saying *Zomato
recorded nothing* on every single day would be noise. The month is the altitude at
which a silent channel is a fact worth stating.

## D9. A silent date is one with no revenue, not one with no bill

**Corrected by reading production**, which is the only place it would have shown.

The fold counts a date as having no sales when cash, UPI **and every channel
gross** are nought. The first draft of the prose around it said "a date with no
bills", which is a different and wrong rule, and August 2026 at Kalyani is the
counter-example: the counter did not begin billing until the twelfth, yet the
month holds **no** silent date, because Zomato and Swiggy recorded revenue
throughout. Under the "no bills" reading the screen would have named eleven dates
as having no sales when eleven dates had sales.

The implementation was right and the words were loose. The words now match.

## D10. The channel mapping is owner-readable only, and that is left open

**A consequence of D8 that needs a decision this change does not make.**

`outlet_channel_restaurants` carries exactly one SELECT policy —
`app_is_owner() AND app_account_active()`. A Franchise Admin therefore reads
**nought rows with no error**, because RLS filters rather than refusing. Proved
against the local stack rather than inferred from the policy text: the read
returns `rows=0, error=none`.

So the mapping cannot be trusted as "this outlet trades on nothing". An empty
result means *cannot tell*, and the month falls back to every known channel.

**Why that direction.** The fallback may show a *recorded nothing* line for a
channel the outlet does not use — a false alarm. Trusting the empty result
instead would silently drop the alarm for a manager on a month where the owner
sees it, so two people reading the same figures would disagree about whether a
sales channel is missing. On a financial screen, saying too much beats saying too
little, and an inconsistency between roles is worse than either.

**The real fix is a policy**, letting a Franchise Admin read the mapping for the
outlets their live assignment names, exactly as every other outlet-scoped table
works. That is a migration, and it needs its own `test:rls` coverage; this change
adds no migration, so it is **not done here**.

**Until it lands**, the owner sees Kanchrapara's month without a Swiggy section
and a manager sees it with a *recorded nothing* line. Both are defensible
readings of what each can see, and neither hides money — but they are not the
same screen, and that is the cost being carried deliberately rather than
discovered later.
