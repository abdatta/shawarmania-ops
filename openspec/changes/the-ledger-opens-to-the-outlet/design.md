## Context

The manual ledger (#36) shipped owner-only and is in nightly use: twelve day rows
across six trading days at both outlets by 2026-08-07. Every one of its six
policies reads `public.app_is_owner() and public.app_account_active()`, and the
migration comment says the absence of an outlet-role predicate is deliberate,
because "no outlet role has any access to grant". `supabase/tests/21_manual_ledger.sql`
asserts that boundary longhand rather than inheriting it from the generic sweep
in `02_isolation_matrix.sql`, precisely because the claim is stronger than
ordinary outlet isolation: an outlet role is refused its **own** outlet's rows.

Two things have changed since.

**The expenses being recorded are not the owner's.** Something runs out, a staff
member goes and buys it, and the figure reaches the app by memory at closing
time. Seven of the nine recorded expenses are `Hyperpure` deliveries, which the
owner books; the other two are exactly the kind somebody at the counter makes.

**The owner-only rule was a description of production, not a decision.** Both
Super Admins currently hold no Franchise Admin assignment at either outlet
(recorded in #12's proposal: the four assignments that existed were deleted
rather than ended on 2026-08-01), so the owners *are* the managers. Once real
managers are appointed, a manager who counts the drawer nightly but cannot read
whether the month covered its costs is running half a shop.

This change does both halves together because they are the same edit to the same
six policies. Splitting them would mean two migrations rewriting the same
policies a fortnight apart, with the second having to reason about what the first
did.

It depends on #37, which takes both expense tables off the category enum. #37
touches no policy on either table; this change touches nothing #37 added except
by reading the category list. The two migrations do not overlap by construction.

Owner decisions taken during the 2026-08-07 grilling are marked
**[owner, 2026-08-07]**.

## Goals / Non-Goals

**Goals:**

- A Biller or Employee records an expense at their own outlet, from their own
  phone, at the moment they spend the money.
- Everyone at an outlet reads that outlet's expenses; nobody reads another
  outlet's anything.
- A Franchise Admin reads and writes the full ledger, day and month, at outlets
  they are assigned to.
- Staff read expenses and nothing else. No revenue, no drawer, no commission, no
  month.
- An expense that goes away leaves a trace.
- An expense not yet paid counts in the month when it is incurred and moves the
  drawer only on the day it is settled.

**Non-Goals:**

- **No edit history for expense figures** [owner, 2026-08-07]. Void is traced; an
  amount corrected in place is not. The described failure is a row disappearing,
  not a row being quietly inflated. Its own change if ever wanted.
- **No structured "owed to" field** [owner, 2026-08-07]. Who is owed goes in the
  note. Revisit if the pending list routinely runs past ten rows.
- No approval workflow, spend limit, or receipt attachment.
- **No offline queue.** `src/outbox/index.ts` is still `export {}` and the real
  one arrives with #9.
- No change to how the day's revenue, commission or drawer figures are entered.
  Only who may enter them.

## Decisions

### D1 — Authority is membership, resolved per outlet, exactly like every other table

All six policies drop `app_is_owner()` as their sole predicate and become the
shape #22 established:

```
public.app_account_active()
and (
  (select public.app_is_owner())
  or outlet_id in (select public.app_outlets_for('franchise_admin'))
  ...
)
```

with a staff branch on `manual_ledger_expenses` only. `app_outlets_for` is
set-returning and used as a non-correlated subquery; `app_is_owner()` is scalar
and wrapped in `(select ...)`. Both conventions are documented in
`20260729000004_multi_outlet_people.sql` and exist so the planner evaluates them
once per query rather than once per row.

`manual_ledger_days` gets **no staff branch at all**. Revenue by channel,
commission rates, opening cash and the drawer count are on that row, and a staff
member has no business reading any of them. This is enforced by the absence of a
policy branch, not by a screen.

**Rejected: a `staff` role predicate.** There is no such role. Biller and
Employee are separate assignments and both need the same reach here, so the
branch is `app_has_role_at('biller', outlet_id) or app_has_role_at('employee', outlet_id)`.
Writing it as two clauses keeps it greppable when one of them changes.

### D2 — Staff correct their own rows on the current business day only

Three separate limits, each enforced in the database rather than by the form:

- **Recording**: today only. A purchase noticed the next morning belongs to the
  manager or owner, who can reach any date [owner, 2026-08-07]. Enforced against
  `app_business_date(now(), outlet.business_day_cutover)`, the same helper
  `manual_ledger_guard()` already uses for the no-future-date rule, so a purchase
  entered at 00:30 still belongs to the trading day that is running.
- **Correcting and voiding**: own rows (`recorded_by = auth.uid()`), and only
  while `business_date` is still the current business date. A row that survives
  its own day is frozen to its author.
- **Settling a pending expense**: any row at their outlet, any age.

The settling asymmetry is deliberate and was reversed during design. The first
rule drafted was owner-and-manager-only, reasoning that the person owed should
not record that they were paid. That fails the common case outright: a supplier
turns up, a staff member pays them from the drawer, and refusing it sends them to
find the owner, which is the friction this change exists to remove
[owner, 2026-08-07].

**The control it appears to give up was never there.** A fabricated cash entry
lowers expected cash, so the nightly count still matches. The drawer count
catches a *missing* entry, never an invented one. That is already true of the
ordinary cash expenses being granted here, so restricting settlement buys nothing
and costs the main scenario. **Attribution is the control**, and the spec says so
rather than implying the count is a check.

### D3 — Void replaces delete on `manual_ledger_expenses`

`voided_at`, `voided_by` and `voided_reason` on the row. A voided expense stays
visible, struck through, and stops counting toward the day's expected cash and
the month's totals. Visible to everyone who can read the row, including staff
[owner, 2026-08-07], so somebody can see their own mistake was caught rather than
wondering where the row went.

`DELETE` is revoked from `manual_ledger_expenses`. #36's migration granted it,
and stated the reason explicitly: these tables are "a notebook with exactly one
reader and one writer". That premise is what this change removes.

`manual_ledger_days` keeps `DELETE`, because a day typed against the wrong date
is still a mistake with no story worth keeping, and only owners and managers can
reach it.

**Rejected: a soft-delete flag with no reason and no actor.** The whole value of
tracing a removal is knowing who removed it and why; a boolean is a tombstone
that answers neither.

### D4 — Three payment states, named by where the money came from

`is_cash boolean` becomes `payment public.ledger_payment` with values
`from_drawer`, `from_bank`, `pending`. Named by source rather than by
instrument, because the labels are what stop a staff member marking their own
out-of-pocket purchase as cash and reading the drawer short by money that never
left it.

The enum stays deliberately three-valued. The bill `payment_method` enum is not
reused: it carries `swiggy` and `zomato`, which are revenue channels and cannot
be ways an expense was paid, and `card` versus `upi` changes no figure this app
computes. That mismatch is logged as a backlog note for #11 rather than fixed
here.

The drawer arithmetic keeps asking exactly one question:
`payment = 'from_drawer' and voided_at is null`.

### D5 — Pending counts in the month when incurred, and moves the drawer only when settled

A pending expense enters the month's expenses on its own `business_date`. A
supplier postponing ₹40,000 of chicken must not make this month look excellent
and next month terrible [owner, 2026-08-07].

**This makes the month no longer a pure cash basis**, and the wording beside the
profit figure changes to say so. `profit-estimates` requires any profit figure to
name its basis, and the current words claim one it no longer has. The pending
total is shown separately beside it, because "we owe ₹40,000" is its own useful
figure.

**Settling in cash writes a cash-out line on the settlement day.** The expense
row is marked settled (`settled_on`, `settled_by`) and its `payment` stays
`pending`, so it never enters any day's drawer arithmetic itself. The drawer
moves once, on the day the money actually left, through
`manual_ledger_days.cash_removed_paise` with a reason.

This reuses machinery whose semantics are already correct: cash out is explicitly
not an expense in this capability, so nothing double-counts, and **no day the
owner has already counted is rewritten.** Flipping `payment` from `pending` to
`from_drawer` would have subtracted the amount from the *original* business
date's expected cash, silently changing a reconciled day. #12 calls that the
subtlest rule in the system.

**Rejected: a separate settlement date with the drawer summing cash expenses by
settlement date and the month summing by business date.** Two date axes on one
row, and every read has to state which one it means. Correct, and more
machinery than a notebook with a scheduled retirement should carry.

**Accepted limitation** [owner, 2026-08-07]: the day row holds a single
`cash_removed_paise` and a single `cash_removed_reason`, so two settlements on
one day merge into one line with a combined reason. Stated in the spec so it is
not discovered as a bug. The app writes the line rather than making the user do
it twice, and appends to the reason when one is already present.

### D6 — `updated_by` beside the frozen `recorded_by`

`manual_ledger_guard()` freezes `recorded_by` on update, and #36's policy comment
explains why: the business's other owner may correct a day without either forging
the attribution or being refused by it. With managers added, the same row now has
more plausible correctors, and a day the owner recorded and a manager later fixed
still reads as the owner's.

`updated_by` is added to both tables, set from `auth.uid()` by the guard on every
update, and **not** freezable. The reading says "recorded by X, last corrected by
Y" when they differ. Last write wins on the figures, which is right for a
notebook; the reading just has to say whose figures are on screen.

**Rejected: optimistic concurrency with a version column.** Two people editing
one day row simultaneously is not a real scenario at this scale, and a conflict
dialog on a notebook is ceremony.

### D7 — Staff get their own surface, not the Ledger with sections removed

A new `staff-expenses` surface, its own tab in the Biller and Employee shells.
It renders that outlet's expenses for the last two business days, every row
whoever recorded it, plus every unsettled pending item **regardless of age** so
the supplier bill somebody is standing there to settle is reachable.

**Rejected: the Ledger with revenue and drawer stripped by role.** One screen
rendering four different amounts of financial truth is the shape that leaks
eventually, and it would put a role check in front of every figure on a 1,400-line
component.

Two gate registry entries, `staff-expenses` under `biller` and under `employee`,
state `live`, each with a `nav` block. **The gate registry is on the `/quickfix`
refusal list**, and so are RLS and money, so this change runs the full local gate
set including the Docker job.

**`test:e2e:auth` is inside the blast radius.** It asserts what each role lands on
and the chrome around it, and this change adds a tab to two shells.
`ui-owner-console-and-demo` broke that suite while every other gate stayed green.

### D8 — The row is lean, and the detail expands

Each expense row shows category, amount, a from-the-drawer marker, and the note.
Recorder, timestamps, void state with its reason and actor, and settlement
history live behind an expandable card [owner, 2026-08-07]. An expandable card
rather than an info icon: the detail is more than a tooltip holds, and a tooltip
is a hover idiom on a surface used entirely with thumbs.

Naming the recorder on the collapsed row is what makes "your own rows" legible.
A staff member sees at a glance which rows they can still fix.

## Risks / Trade-offs

- **Silent over-permission passes every functional test in this repo.** → This is
  what `test:db` and `test:rls` exist for, and why `/quickfix` refuses policy
  changes. Every one of the four roles is asserted at its own outlet and at the
  other, for every verb, on both tables. The existing `21_manual_ledger.sql`
  asserts the *opposite* of the new rule in several places and is rewritten, not
  extended.

- **The `manual-ledger` spec's first requirement is being replaced, not
  amended.** "Reachable only by an owner, and the database is what refuses
  everyone else", with four scenarios. → The spec delta uses MODIFIED with the
  full replacement text, and every one of the four scenarios is rewritten rather
  than dropped, so the archive keeps a readable record of what the boundary was.

- **A pending expense that is never settled inflates the month forever.** →
  Accepted: it is a genuine liability and the month should show it. The pending
  total shown beside the profit figure is what stops it being invisible, and
  the surface lists unsettled items without an age limit so nothing rots
  unnoticed.

- **A false cash entry is not caught by the drawer count.** → Stated in the spec
  as a limitation of the control model rather than papered over. The controls are
  attribution and the void trace, and the alternative (an approval step on every
  gas cylinder) is what the change exists to avoid.

- **#12's carry-over obligation grows.** → It currently owes amounts, dates and
  categories. After this it owes attribution, void state, settlement state and
  three payment states. Updated in `daily-cash-live/proposal.md` in this change,
  not later.

- **The counter tablet will stop having personal logins.** → #9 replaces the
  Biller's login with an enrolled device plus a shift PIN, which `AGENTS.md` says
  selects attribution and is not the security boundary. "Own rows" then degrades
  to "this shift's rows" and RLS cannot enforce it. Deferred by the owner
  [owner, 2026-08-07]; what this change owes is that the degradation is written
  into the spec and `docs/LIMITATIONS.md` now.

- **Two migrations touch these tables in consecutive changes.** → #37 changes
  column types and adds a table and touches no policy; this one rewrites policies
  and adds columns. Neither repeats the other's work, and this one must be
  written against the post-#37 schema rather than against `main` as it stands.

## Open Questions

- **Does an Employee need this tab, or only a Biller?** The owner asked for "all
  staff". Whether an Employee who is not at the counter ever spends outlet money
  is worth one question before building two tabs, and the answer is cheap to act
  on either way since the policy branch already names both roles.
- **What a Franchise Admin sees of the owner's remote entries, and the reverse.**
  `outlet-expenses` already requires an owner's remote expense to be visibly the
  owner's on the live surface. Whether the ledger adopts the same marking, or
  relies on the recorder name alone, is a surface decision this change should
  settle rather than inherit by accident.
- **The exact replacement wording for "cash-basis operating estimate".** It must
  be truthful about counting unpaid expenses and still short enough to sit beside
  a figure on a phone.
