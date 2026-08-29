# Design: Expenses opens to any day

## D1 — One surface asking one question, not two surfaces

Two shapes were considered and the second was rejected.

**Rejected: a second surface.** Keep `StaffExpensesSurface` as it is, add an
`OutletExpensesSurface` beside it, and point `owner-expenses` and
`admin-ledger-expenses` at a new route. It has a real argument — the shapes
genuinely differ, and `manual-ledger` warns against one surface rendering
different amounts of truth by role.

It loses on three counts. Two new gate entries and a new route for a screen that
renders the same list from the same rows. Two files that must not drift, when the
whole reason `ExpenseList` was extracted in the first place was that the list and
its form have exactly one implementation. And it answers a warning that is not
about this: the clause is *"different amounts of **financial truth**… a role
check in front of every **figure** it draws, and each such check is a place a
**figure** can later leak."* The leak it fears is revenue or a drawer balance
appearing to a Biller. This surface has neither, for anybody, and this change
adds neither.

**Chosen: one surface, one question, asked once at the top.**

```ts
const { outletId, managed, selector } = useOutletScope()
const session = useSession()
const fullReach = holdsRole(session, 'super_admin') || managed
```

That expression is the policy's own predicate, transcribed:

| Database | Surface |
|---|---|
| `app_is_owner()` | `holdsRole(session, 'super_admin')` |
| `outlet_id in app_outlets_for('franchise_admin')` | `managed` from `useOutletScope` |

`managed` is already defined as *every outlet in scope is one I manage*, which is
the right reading: a manager viewing an outlet they do not manage gets the
narrow shape, and the database would refuse them anyway.

One boolean, computed once, feeding two things: which day control renders, and
`viewer.mayTouchAnyRow`. It is a role check in front of a *control*, which is
what a control is for. There is no third use, and a future reader adding one
should stop and re-read D1.

## D2 — Full reach gets one day and a bar; staff keep two days and none

| | Days shown | Day control | `showDates` | `mayTouchAnyRow` | Add records against |
|---|---|---|---|---|---|
| Owner, manager at this outlet | 1 | `PeriodBar` + `DayField` | off | **true** | the day on screen |
| Biller, Employee | 2 | none | on | false | today |

**Why one day for full reach rather than two days under a bar.**
`outlet-expenses` says *"the expenses recorded against a single business date"*.
Bills says one business date. The Ledger's day view says one business date. A
two-day list sitting under a bar that names one day is a control disagreeing
with the thing beneath it, and the reader has to work out which of the two the
bar is about. Yesterday is one tap back.

**Why staff keep two days with no bar.** `manual-ledger` requires it — *"SHALL
open on the expenses recorded against the two most recent business days"* — and
it is right to: the window matches the only days they may write against, so the
surface never shows them a day whose Add button will be refused. `showDates`
stays on there for the reason it was added, that two days on one list means each
row has to say which day it is.

**The two-day window stays a presentation default, not a boundary.** The spec is
explicit that it *"SHALL NOT be enforced by the database"*, and this change adds
no read predicate anywhere. A staff reader who reaches an older row by any other
means still reads it; they simply cannot change it, which is the guard's answer
and not this surface's.

## D3 — How far back the calendar reaches, and why it is a floor and not a limit

`earliestOffered(today)` from `manager-billing-history.tsx`: one year back, to the
first of that month. Lifted rather than re-derived, and its own comment already
says what it is — *"a floor on the picker, which needs one, not on the history."*
The steps either side still walk further, one day at a time, and no read is
bounded.

Not the Ledger's `monthsBackFrom(today, MONTHS_OFFERED)`. That floor exists
because the Ledger's month view is built from months and wants the two controls
to agree about how far back the surface goes. Expenses has one control and no
month view, so it takes the plainer floor.

Forward stops at the outlet's own today, resolved through its cutover, because
`manual_ledger_guard()` raises on a future business date and a control offering
one is offering a failure.

## D4 — An empty past day still offers its Add button

`ExpenseList` renders `EmptyState` with no action when the list is empty, and its
comment gives the reason: *"the Add button sits directly above this box, so a
second one would be the same door twice."* That reasoning holds here unchanged —
the header row's Add button is always rendered, above the empty box, whatever day
is on screen.

So stepping to a day with nothing on it shows an empty state and a live Add
button, and adding there works. This is the case the whole change exists for: the
Tuesday nobody recorded.

The empty copy differs by day, because *"Nothing spent here yet today. Add what
you bought, as you buy it"* is wrong on a Tuesday three weeks ago.

- Today, full reach or staff: the existing copy, unchanged.
- Any other day: *"Nothing was recorded for this day."* A statement, not an
  instruction — the reader stepped here to find out, and the answer is the whole
  content.

## D5 — The totals card, and why it is two lines and not four

Under the list on the full-reach view only:

```
Spent this day          ₹4,210
Of which cash           ₹1,890
```

Summed on the client from the rows already on screen, because they are already on
screen — a second read to total a list the surface is holding would be a round
trip to re-learn what it knows. Withdrawn rows (`voidedAt !== null`) count toward
neither, which is what withdrawal means and what `effective_expenses` already
does in SQL.

Two lines rather than a per-category breakdown: `near-miss-category-matching-reaches-expenses`
records that stored category text is not yet reliable enough to group by, so a
breakdown would split *Vegetables* from *vegetables* and read as a data problem.

Not on the staff view. Their surface spans two days, so a "this day" total has no
single day to be about, and a two-day total is a figure nobody asked for.

## D6 — The rename, and what it costs

`staff-expenses-surface.tsx` → `outlet-expenses-surface.tsx`,
`StaffExpensesSurface` → `OutletExpensesSurface`. The file has served all four
roles since #11 and its doc comment opens *"What this outlet spent, for the
people who spend it"*, which was true when only staff reached it.

Cost is three import sites (`src/routes/surfaces.tsx` and its tests) and the
doc comment, which is rewritten anyway because it now has to say which reader
gets which shape and why.

The `data-testid` values keep their `staff-expenses-` prefix on the staff-shaped
elements, because they name what that shape is, and gain `expenses-` names for
the bar following `PeriodBar`'s `testIdPrefix` contract. Renaming a test id that
still means what it says is churn.

## D7 — What proves it, and what the test must fail on first

Two assertions at the surface, both failing on the tree before the change:

1. **A manager steps back and corrects.** Mount with a Franchise Admin session at
   an outlet they manage, step the bar back one day, and assert the day's rows
   are listed and a row recorded by somebody else offers its Edit action. On the
   tree there is no bar to step, so the test cannot even reach its assertion.

2. **A Biller gets neither.** Mount with a Biller session and assert no day bar
   is rendered, two business dates are requested, and no row recorded by
   somebody else offers an action. This is the regression guard for D1: it is the
   test that fails if a later change collapses the two shapes into one.

A third, cheaper one worth having: adding on a stepped-to past day passes that
day's business date to `createExpense`, not today's. The guard would refuse the
wrong one at the database, but a test that reads the argument says which day the
surface *meant*, and it fails on the tree because the surface always means today.
