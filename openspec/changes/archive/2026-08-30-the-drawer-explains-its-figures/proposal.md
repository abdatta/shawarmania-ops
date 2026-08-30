# The drawer explains its figures

> **Model**: Opus 5 · **Kind**: owner feedback plus two walked-past clauses, not a roadmap change · **Gate**:
> **every term in "In the drawer now" is reachable from the figure that states
> it** — Cash from Bills opens a day-by-day reading of the interval, Cash
> Expenses opens the same list the Expenses tab renders, grouped by day with its
> own Add on each, and both reconcile to the tile they came from, asserted rather
> than eyeballed; the standalone collection and spend are gone from the surface;
> and the newest count is editable in full, its instant included, with its
> expected total recomputed from the instant it was moved to.

## Why

Four strands, and they meet at the same card.

**1. The balance states four terms and explains none of them.** The owner asked
for it directly [owner, 2026-08-29]: tapping Cash from Bills should say what came
in on each day since the last count, and tapping Cash Expenses should open the
expense list itself, by day, with an Add on each day. Standing at the drawer with
the cash in hand, the question is never *what is the total* — the total is on
screen. It is *which day did that come from*, and *did Tuesday's vegetable money
ever get entered*.

**2. Two of the figures already on that card are wrong.** Not stale, wrong.

- `cashReceiptsSinceCount` is counted from `nearbyCashBills`, a list capped at
  twelve and drawn from the last forty settled bills. Forty cash bills since the
  last count still reports twelve.
- `cashExpensesSinceCount` is the literal `0`, hardcoded in the adapter.

Neither is load-bearing for the money — both are the small grey row count under a
figure — but a breakdown makes them glaring, because the day groups will sum to
more rows than the tile claims. Grouping the reads in the database fixes both on
the way past.

**3. `daysCovered` is computed off a hardcoded cutover.** `const CUTOVER =
'04:00'` sits in `src/data-access/supabase-adapters/cash-drawer.ts` with no
comment defending it. It happens to be right — both outlets read `04:00`,
measured on production 2026-08-29 — and it is exactly the kind of constant that
is right until an outlet opens with a different one. A day-by-day breakdown built
on it would inherit that. Grouped in SQL, the outlet's own cutover is read from
its own row and the constant goes.

**4. `cash-drawer` says an observation SHALL be "fully editable", and the surface
edits one field.** The Fix this count sheet offers the counted amount and nothing
else. Two consequences:

- **The instant cannot be corrected.** The instant is the whole thesis of #11 — a
  count at 22:00 is measured against cash received up to 22:00. Record it at
  23:30 having counted at 22:00 and the expected total carries ninety minutes of
  bills that were never in the drawer, and the only knob offered is the counted
  amount. The screen's one affordance is to falsify the physical count until it
  balances, which is the precise inversion of what this surface is for.
- **Fixing the amount silently wipes the note.** The surface calls
  `editObservation(id, paise)` with no note; `p_note` defaults to null and
  `edit_drawer_observation` assigns `note = p_note` unconditionally. Type a note,
  correct a typo in the figure, the note is gone with no warning.

## What Changes

### Cash from Bills opens a day-by-day reading

A new grouped reader, `drawer_cash_receipts_by_day`, returning one row per
business date in `(last count, now]` with its cash total and its bill count,
grouped through the outlet's own `business_day_cutover`. Newest first. The oldest
day in the interval is partial and says so, naming the count that cut it:

```
Today                                        ₹2,300   9 bills
28 Aug · since the count at 11:23 pm           ₹120    1 bill
```

`cashReceiptsSinceCount` becomes the sum of those bill counts, which is the
figure it was always meant to be.

### Cash Expenses opens the expense list, by day

The same `ExpenseList` the Expenses tab renders, one instance per business date,
each with the date as its heading and its own Add button — which is the shape
that component already has, heading left and Add right.

Adding from there is the point, not a convenience: an expense recorded now
against 27 Aug carries today's recording instant, so it lands inside the current
interval and the expected balance moves the moment it is saved. That is exactly
what somebody standing at an unreconciled drawer wants.

**The popup shows the interval, not the whole day** [owner, 2026-08-29, choosing
this over showing whole days]. A count at 11:23 pm cuts 28 Aug in half, and the
cash spent before it was settled by that count. Showing the whole day would make
the popup disagree with the tile it opened from. Where a day is partial, a muted
line names what is not shown — *4 earlier expenses this day were in the last
count* — so nothing reads as missing.

Non-cash expenses are listed and marked, as they already are, and excluded from
the subtotal. Hiding them would make somebody re-enter an expense they had
already recorded.

### Only Collect and Other Spend leave the surface

Both are deleted, with their sheets. **Neither has ever been used**: measured on
production 2026-08-29, `drawer_cash_out` holds two rows, both collections, both
attached to a count, and zero standalone movements and zero spends of either kind
at either outlet.

`Other Spend` existed for drawer cash buying capital — the ₹40,000 fridge that
must reconcile the drawer without polluting the month. The owner has ruled that
case out: major spending is always online, and only small amounts are ever cash
[owner, 2026-08-29]. With no case to serve, it is a button that widens the model
for nobody.

**What this buys is not tidiness.** `In the drawer now` is four terms — opening,
plus receipts, less expenses, less cash out — and the strip beneath it shows
three. Cash out has no tile. Take ₹5,000 out between counts today and the
headline falls by ₹5,000 with nothing on the card accounting for it. Removing the
two ways to create a standalone movement makes every cash-out part of a count,
folded into `Last Left` by `nextOpeningPaise` — so the three tiles become a
complete account of the headline **by construction**, rather than by adding a
fourth tile for a term nobody uses. The rule reduces to one sentence: *cash
leaves the drawer only at a count.*

The database is untouched. `drawer_cash_out` keeps its `kind`, its constraints,
its policies and its `spend` branch; `record_cash_out` keeps its grant. Nothing
is dropped and nothing is revoked, so a later change that finds a real spend case
re-exposes it by adding a control, not by writing a migration.

### The newest count becomes editable in full

`edit_drawer_observation` gains the counted instant and takes the note as given
rather than as a default. Moving the instant **recomputes that observation's
expected total** from the same three interval readers that computed it at
recording, and its difference from the recomputed expected — because moving the
boundary genuinely changes which bills were in the drawer, which is the entire
reason to move it. The instant is bounded exactly as recording bounds it: not in
the future, later than the previous observation, not before the outlet's earliest
drawer activity, each refusal naming what it collided with.

The edit sheet grows the same movable-boundary control the count sheet already
carries, and states what moving it did: *"₹840 of cash rung after 10:00 pm is no
longer inside this count."*

## Non-goals

- **No fourth tile.** Deleting the two movement buttons removes the term the
  fourth tile would have shown. Adding one anyway would reserve space for a
  figure that is now always nought.

- **No change to `drawer_cash_out`, its policies, or the `spend` kind.** Only the
  surface narrows. See above for why the record stays whole.

- **The Ledger's month `spends` card stays, guarded as it is.** It already renders
  only when `month.spends.length > 0`, so it will simply never fire. It is not
  deleted, because a historical spend must stay readable if one is ever recorded
  by any path, and a card that renders nothing costs nothing.

- **No adjustment-path change.** A count a later one has anchored on is still
  corrected only by an attributed adjustment with a reason. This change widens
  the *edit*, which is the path for a count nothing has anchored on, and
  `cash-drawer` already requires exactly one of the two to be offered.

- **`suggestedInstant` stays null.** The edit sheet moves the boundary the
  recorder chooses. It does not propose one, and `CountAdvice.suggestedInstant`
  remains a field that is always null with the test asserting it, for the reason
  that field's own comment gives.

- **No collection recorded from a popup.** The breakdowns explain the figures and
  let an expense be added, because a missing expense is the thing somebody finds
  while reading them. A collection is not something you discover you forgot.

- **No date navigator on the drawer.** The drawer is a balance now, not a day.
  The interval it explains is bounded by counts, and `expenses-open-to-any-day`
  and the Ledger both already answer "what about some other day".
