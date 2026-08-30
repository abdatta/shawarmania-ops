# Design: The drawer explains its figures

## D1 — The interval is the subject; the day is only how it is read

The card states a balance over `(last count, now]`. That interval is bounded by
instants, not by dates, and nothing in this change may quietly re-bound it to a
date — that is the model #11 replaced.

So both breakdowns partition **the interval** by business date. They do not show
days and then trim them. The distinction decides every edge case below, and the
oldest group is where it shows: it is a *fragment* of a business date, and its
heading says which count cut it.

```
        last count 28 Aug 11:23 pm                             now
                 |                                              |
   ══════════════|══════════════════|═══════════════════════════
    28 Aug (already counted)    cutover 04:00           29 Aug = "Today"
                 └── group 2 ──────┘└──────── group 1 ──────────┘
                  partial, names the count      whole so far
```

Group 1 is labelled `Today`. Group 2 is labelled `28 Aug · since the count at
11:23 pm`. A group that is a whole business date carries no qualifier, which
happens whenever a count landed before that date's cutover.

## D2 — The grouping belongs in SQL, and pays for two defects on the way

Two new readers beside the three `cash-is-counted-not-closed` shipped, in the
same file, same shape, same `(p_from, p_to]` convention, same
`app_may_reach_drawer()` guard the 2026-08-28 migration added to all three:

```sql
drawer_cash_receipts_by_day(p_outlet_id, p_from, p_to)
  returns table (business_date date, paise bigint, bills int)

drawer_cash_expenses_by_day(p_outlet_id, p_from, p_to)
  returns table (business_date date, paise bigint, rows int)
```

Receipts read `bills` joined to `effective_bill_payments` and group by
`app_business_date(b.paid_at, o.business_day_cutover)`. Expenses read
`effective_expenses`, filter `is_cash`, and group by
`app_business_date(coalesce(x.occurred_at, x.created_at), o.business_day_cutover)`.
Both take the cutover from the outlet's own row.

**Three reasons this is not client-side arithmetic.**

*The cutover.* `const CUTOVER = '04:00'` in the adapter is a guess that is
currently correct. Grouping in SQL reads `outlets.business_day_cutover` and the
constant is deleted rather than depended on further.

*Reconciliation by construction.* The tile totals come from
`drawer_cash_receipts_paise` and `drawer_cash_expenses_paise`. If the groups come
from a different filter written in TypeScript, the two can disagree, and a
breakdown that does not sum to the figure it explains is worse than no breakdown.
Same relation, same predicate, same interval convention, one `group by` apart.

*The two wrong counts.* `cashReceiptsSinceCount` is `nearbyCashBills.filter(...)`
over a list capped at twelve; `cashExpensesSinceCount` is the literal `0`. Both
become sums over the grouped rows, which is the honest count and costs nothing
extra because the reads are already happening.

**`nearbyCashBills` is not touched.** It stays capped at twelve and drawn from
forty, because its job is the movable boundary and the exact-coincidence report —
a bounded window around the count instant, deliberately not a complete set. Only
the *count* stops being derived from it.

## D3 — The expenses popup shows the interval, and names what it is not showing

Decided by the owner over the alternative of showing whole days
[owner, 2026-08-29].

The tile says `−₹290`. If the 28 Aug group listed the whole of 28 Aug, it would
include cash spent before 11:23 pm — money the previous count already settled —
and the popup would not add up to the number it opened from. This app is careful
never to put two disagreeing figures on one screen, and a breakdown disagreeing
with its own headline is the loudest possible version of that.

**So the rows are the interval's rows**, filtered by
`coalesce(occurredAt, createdAt) > lastCountedAt`, the same expression the SQL
uses. That requires carrying `occurredAt` onto `ManualLedgerExpense`, which the
row type does not have today; without it the client would filter on `createdAt`
alone and drift from the database the first time a backdated expense exists.

**And a partial group says what it omits**, in muted text under its heading:

> 4 earlier expenses this day were in the last count

Counted, never listed. Listing them would re-raise the disagreement the filter
exists to prevent; omitting the sentence would let somebody re-enter an expense
they already recorded, which is the specific mistake this popup is most likely to
cause. The count comes from the same grouped reader over the *previous* interval
bound, so it is one more row from a query already being run.

## D4 — One `ExpenseList` per group, because the component is already that shape

`ExpenseList`'s header row is `heading` on the left and `AddButton` on the right.
The owner's request — a date header with its own Add — is that row with the date
as the heading. Nothing new is built.

```tsx
{groups.map((group) => (
  <ExpenseList
    key={group.businessDate}
    heading={headingFor(group)}          // "Today" · "28 Aug · since the count at 11:23 pm"
    businessDate={group.businessDate}    // what Add records against
    currentBusinessDate={today}
    expenses={group.rows}
    viewer={{ id: userId, mayTouchAnyRow: true }}
    showDates={false}                    // the heading says it
    emptyTitle="Nothing was recorded for this day."
    onChanged={reload}
  />
))}
```

`mayTouchAnyRow` is true unconditionally here, and that is safe rather than lazy:
the drawer surface is already gated by `app_may_reach_drawer()`, which is the
owner-or-manager-at-this-outlet predicate. Nobody who cannot correct an expense
can open this popup at all. It is not the same expression
`outlet-expenses-surface.tsx` computes, and it must not be copied from there —
that surface serves Billers and Employees and this one cannot be reached by
either.

**Each group holds its own component state** — its own draft, its own expanded
row, its own category fetch. That is a real cost: N groups means N category
loads on first open of N forms. It is accepted because the interval is one to
three days in every observed case, and the alternative is lifting `ExpenseList`'s
form state into a parent, which is a refactor of the component two other surfaces
and the tablet depend on.

**Today's group renders even when empty**, so there is always somewhere to add.
Past groups render only where the interval holds rows for them.

## D5 — Deleting the two buttons is what makes the strip complete

`In the drawer now` is `opening + receipts − expenses − cashOut`. The strip shows
`Last Left`, `Cash from Bills`, `Cash Expenses`. `cashOutSincePaise` is a term
with no tile, and it is not rendered anywhere on the surface.

Two ways to close that gap:

| | |
|---|---|
| Add a fourth tile | The strip becomes four-up on a phone, for a term measured at zero occurrences in production, that only the two buttons being deleted can produce |
| Delete the two buttons | Every cash-out becomes part of a count, folded into `Last Left` by `nextOpeningPaise`. The three tiles account for the headline exactly, always |

The second, and it is not merely cheaper: it makes the completeness structural.
With no standalone movement, `cashOutSincePaise` is nought for reasons the model
guarantees rather than for reasons that happen to hold this week.

`submitCount` already hardcodes `kind: 'collection'` on the cash-out it writes
with a count, so the surviving path needs no change at all.

**What stays in the database, and why that is not hedging.** `drawer_cash_out`
keeps its `kind` column, its positive-spend constraint, its policies and its
grants; `record_cash_out` keeps its grant and its adapter method. #11 dropped and
renamed nothing on purpose and this change inherits that posture. Concretely: two
production rows already exist and must keep reading correctly, the `spend` branch
still binds anything that reaches the table by any path, and if the owner ever
buys a fridge with drawer cash the fix is a control, not a migration.

*The dead adapter method is left with a comment saying it is unreachable from the
app and why*, rather than deleted, so the next reader does not spend an afternoon
working out whether it was an oversight.

## D6 — Editing the instant means recomputing the expected total

The current function's comment is explicit about what it does not do:

> Recomputed from the SAME expected total: the interval did not move, only what
> was found in the drawer.

That is correct for an amount-only edit and wrong the moment the instant moves,
because the instant *is* the interval's upper bound. So `edit_drawer_observation`
gains `p_counted_at` and, when it differs, recomputes:

```
expected_paise := opening
                + drawer_cash_receipts_paise(outlet, previous_counted_at, p_counted_at)
                - drawer_cash_expenses_paise(outlet, previous_counted_at, p_counted_at)
                - drawer_cash_out_paise(outlet, previous_counted_at, p_counted_at, this_observation)
difference_paise := counted_total - expected_paise   -- null on an anchor
```

The same three readers `record_drawer_observation` calls, in the same order, with
the same exclusion of the observation's own movements. **They are called, not
reimplemented**, which is the rule that keeps the database's arithmetic and
`src/domain/drawer.ts` in agreement.

Bounds are the recording bounds, unchanged and re-asserted here: not in the
future, strictly later than the previous observation's instant, not before the
outlet's earliest drawer activity. The existing later-observation lock still
applies first — this path only ever edits a count nothing has anchored on, so no
downstream opening can move.

**The note stops defaulting to null.** `p_note` is currently omitted by the
adapter and assigned unconditionally by the function, so every amount edit wipes
the note. The adapter passes the note it holds and the sheet renders it as a
field. This is a bug fix riding along, and it is here rather than in a separate
change because it is the same function and the same sheet.

**What the sheet says when the boundary moves.** The count sheet already computes
this through `expectedAtInstant` in `src/features/cash/drawer-arithmetic.ts`,
which takes a `DrawerState` and a candidate instant and returns the excluded
total and bill count. The edit sheet renders the same sentence from the same
function: *"₹840 of cash rung after 10:00 pm is no longer inside this count."*
No second implementation, and `countAdvice`'s refusal to ever propose an instant
is untouched.

## D7 — A dialog inside a dialog, which this surface has already proved

The expenses popup contains `ExpenseList`, which contains its own `FormSheet` for
Add and Edit, plus a `ConfirmDialog` for Withdraw. That is `showModal()` on a
second `<dialog>` while a first is open.

It works, and the fix that makes it work is already in the tree for this exact
surface. `src/components/ui/modal.tsx` stops the `close` event:

> A `close` event does not bubble in the DOM, but React's synthetic system
> propagates it up the REACT tree — and a portalled modal's React parent may be a
> component sitting inside another modal. Without this, dismissing an explanation
> opened over the count sheet closed the count sheet with it, losing everything
> typed.

So nesting needs no new machinery. It needs a test that dismissing the Add form
leaves the breakdown open, because that is the regression the comment describes
and it will be re-broken by anyone who touches `Modal`.

Escape is not testable in an automated in-app browser — `src/components/ui/modal.tsx`
says so and `e2e/dialog-escape.spec.ts` exists so nobody spends an afternoon on
it twice. Do not chase it.

## D8 — What proves it

**Reconciliation is the assertion that matters**, and it must be arithmetic
rather than a screenshot: the sum of the day groups equals the tile, for both
breakdowns, over an interval spanning a cutover. A breakdown that looks right and
sums wrong is the failure this whole design is arranged to prevent.

The rest, each proved to fail on the tree first:

- A count at 11:23 pm on 28 Aug, bills either side of it: the 28 Aug group holds
  only what came after, and its heading names the count.
- An interval crossing 04:00 puts the small hours in the earlier business date,
  at an outlet whose cutover is **not** 04:00, so a re-introduced constant fails.
- Adding an expense from the 27 Aug group writes business date 27 Aug and moves
  `expectedNowPaise` by that amount on reload.
- A partial group states the count of earlier expenses it is not listing.
- `cashReceiptsSinceCount` with more than twelve cash bills in the interval
  reports the true number. This one fails loudly on the tree and is the cheapest
  proof that the cap was real.
- Neither Only Collect nor Other Spend is rendered, and `recordCashOut` is called
  from nowhere in `src/`.
- Editing the newest count's instant earlier recomputes its expected total and
  its difference; editing only the amount leaves both the expected total and the
  note as they were.
- Dismissing the Add form inside the breakdown leaves the breakdown open.
