# Expenses opens to any day

> **Model**: Opus 5 · **Kind**: walked-past clause, not a roadmap change · **Gate**:
> **the owner and a manager reach any past business date on the Expenses tab
> through the same day bar Bills and the Ledger already carry, and correct,
> withdraw and add an expense on the day they reached** — while a Biller and an
> Employee keep the two-day window and the own-rows-today clamp the database
> enforces on them, proved by a test that fails on the tree before the fix.

## Why

Three clauses already say this, and the live surface satisfies none of them.

**`outlet-expenses`** — *"The business date SHALL be shown as a date and SHALL be
selectable, never derived from the device clock at read time."* The live surface
derives two dates from the device clock at read time and offers no way to select
a third.

**`manual-ledger`** — *"An account holding a live Franchise Admin assignment
SHALL be able to record, correct and void any expense at the outlets that
assignment names, against any business date the capability allows. An account
holding a live Super Admin assignment SHALL be able to do so at every outlet."*
The surface hardcodes `mayTouchAnyRow: false` and `businessDate={today}` for
every reader, so it grants neither.

**`manual-ledger`** again — *"Outlet staff reach expenses through their own
surface"*, opening on *"the two most recent business days"*. That requirement is
scoped to a Biller and an Employee. It is not a description of what the owner
and a manager get, and it was never meant to be.

**How it happened is documented in the gate registry and is worth keeping.**
`cash-is-counted-not-closed` (#11) found that expenses had become unreachable for
the two roles that read the Ledger nightly, and fixed reachability the cheapest
way that could not break anything: it pointed `owner-expenses` and
`admin-ledger-expenses` at `ledger/expenses`, *"the same route the Biller and the
Employee already reach, the same component, the same rows, and no change to how
an expense is recorded."* That was the right call for a change whose brief was to
make expenses reachable. Its side effect is that the owner and the manager
inherited the staff surface's two-day window and the staff clamp, and nobody
noticed because two days is enough on the night you record them.

It stops being enough the moment somebody looks back. Measured on the tree: from
the Expenses tab there is **no route at all** to any business date older than
yesterday, at any outlet, for any role. The owner reported it directly
[owner, 2026-08-29].

**And the clamp makes a navigator alone useless.** The database has permitted
this all along — `manual_ledger_expenses_update` carries an owner branch and a
Franchise Admin branch with no date predicate, and `manual_ledger_guard()`
applies the current-day limit only to a reader who is *neither*. So a navigator
without the reach would page the owner back to 24 Aug, show them a ₹2,400 that
should read ₹1,400, and offer no way to change it. Reaching a day and being able
to fix it are one feature.

## What Changes

- **`StaffExpensesSurface` becomes `OutletExpensesSurface`.** The file name has
  been a lie since #11 mounted it for all four roles; the rename is the cheap
  half of telling the truth about it.

- **It asks the session the same two questions the policy asks**, once, at the
  top: `holdsRole(session, 'super_admin') || managed` from `useOutletScope`,
  which mirrors `app_is_owner() OR outlet_id in app_outlets_for('franchise_admin')`
  exactly. That single answer sets both the day window and `mayTouchAnyRow`.

  *Why this is not the role branching `manual-ledger` warns against.* That
  warning — *"A single surface rendering different amounts of financial truth
  depending on who is reading it puts a role check in front of every figure it
  draws, and each such check is a place a figure can later leak"* — is about
  **figures**. No figure changes here. Every reader sees expenses and only
  expenses, at every outlet they reach; what differs is how many days they can
  page through and whether a row offers its menu. There is no revenue, opening
  cash, drawer or monthly figure on this surface for a check to stand in front
  of, and this change adds none.

- **Full reach gets the shared day bar**, `PeriodBar` + `DayField` from
  `src/components/ui/period-bar.tsx` — the same control, the same test-id shape
  and the same refusals Bills and the Ledger carry. One day at a time, `Today`
  written as a word, the middle of the bar opening the platform calendar,
  forward stepping stopping at the outlet's own today because the guard refuses a
  future business date.

  *Why one day rather than two days plus a bar.* `outlet-expenses` says one
  business date, Bills and the Ledger say one business date, and the owner asked
  for the control those two carry. Yesterday is one tap back, and a two-day list
  under a one-day bar is a control that disagrees with what it is above.

- **The Add button records against the day on screen**, not against today. This
  is the guard's own rule read forward rather than discovered by refusal: an
  owner or a manager may insert against any past business date, and only a future
  one is refused.

- **Staff are untouched.** Two days, `showDates` on, `mayTouchAnyRow: false`,
  writes against today only. `manual-ledger` requires exactly that and the
  database enforces it either way.

- **A totals card under the list** on the full-reach view: spent this day, of
  which cash. A day view reached deliberately is reached to answer *what did that
  day cost*, and making the reader add a column of rupees by eye is the question
  going unanswered. The demo surface has carried these two lines since #7; this
  is the same pair, on the surface people use.

## Non-goals

- **No migration, and no policy change.** Every grant this needs exists.
  `manual_ledger_expenses_update`, `manual_ledger_expenses_insert` and
  `manual_ledger_guard()` already answer the owner and the manager the way this
  surface will now ask. Nothing in `supabase/` is touched.

- **No new component.** `PeriodBar`, `DayField` and `ExpenseList` all exist and
  all serve two callers already. This adds a third caller to two of them.

- **No revenue, drawer or monthly figure on this surface, for anybody.** The
  reason is unchanged and is recorded in `docs/LIMITATIONS.md`: a screen showing
  four kinds of financial truth is a screen nobody reads.

- **The demo-only `ExpensesSurface` and the `admin-expenses` gate are left
  alone.** `src/features/expenses/expenses-surface.tsx` is `demo`-gated and its
  production adapter returns an empty array; it is the walkthrough's screen and
  #12 removes it with the rest of the stopgap. Touching it here would mean
  maintaining a second answer to the same question for one release.

- **No drawer work.** The two figure breakdowns the owner asked for in the same
  conversation — cash from bills by day, and expenses by day, both since the last
  count — belong to `the-drawer-explains-its-figures`, which also deletes Only
  Collect and Other Spend and repairs the count edit sheet. They share a
  migration with each other and none with this.

- **No search, no category filter, no month view.** A day at a time is what the
  spec asks for and what the reader asked for.
