## Context

The manual ledger (#36) shipped owner-only and is in nightly use: twelve day rows
across six trading days at both outlets by 2026-08-07. Every one of its eight
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
eight policies. Splitting them would mean two migrations rewriting the same
policies a fortnight apart, with the second having to reason about what the first
did.

It depends on #37, which takes both expense tables off the category enum. #37
touches no policy on either table; this change touches nothing #37 added except
by reading the category list. The two migrations do not overlap by construction.

Owner decisions taken during the 2026-08-07 grilling are marked
**[owner, 2026-08-07]**. Two scope decisions taken on 2026-08-08 are marked
**[owner, 2026-08-08]** and are the reason D4 and D5 do not say what an earlier
draft of this document said.

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
- No staff account can alter a day's counted cash, opening cash or cash removed.
- An expense that goes away leaves a trace.

**Non-Goals:**

- **No pending expenses and no settlement** [owner, 2026-08-08]. See D4 for what
  that removed and why the case it served was not the one asked for.
- **No edit history for expense figures** [owner, 2026-08-07]. Void is traced; an
  amount corrected in place is not. The described failure is a row disappearing,
  not a row being quietly inflated. Its own change if ever wanted.
- No approval workflow, spend limit, or receipt attachment.
- **No offline queue.** `src/outbox/index.ts` is still `export {}` and the real
  one arrives with #9.
- No change to how the day's revenue, commission or drawer figures are entered.
  Only who may enter them.

## Decisions

### D1 — Authority is membership, resolved per outlet, exactly like every other table

All eight policies drop `app_is_owner()` as their sole predicate and become the
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

`manual_ledger_days` gets **no staff branch at all**, which is not a widening but
a refusal to widen: the table is owner-only today and this change opens it to
Franchise Admins and stops. What that costs is nothing, and what it protects is
set out in D5.

**Rejected: a `staff` role predicate.** There is no such role. Biller and
Employee are separate assignments and both need the same reach here, so the
branch is `app_has_role_at('biller', outlet_id) or app_has_role_at('employee', outlet_id)`.
Writing it as two clauses keeps it greppable when one of them changes.

### D2 — Staff correct their own rows on the current business day only

Two limits, both enforced in the database rather than by the form:

- **Recording**: today only. A purchase noticed the next morning belongs to the
  manager or owner, who can reach any date [owner, 2026-08-07]. Enforced against
  `app_business_date(now(), outlet.business_day_cutover)`, the same helper
  `manual_ledger_guard()` already uses for the no-future-date rule, so a purchase
  entered at 00:30 still belongs to the trading day that is running.
- **Correcting and voiding**: own rows (`recorded_by = auth.uid()`), and only
  while `business_date` is still the current business date. A row that survives
  its own day is frozen to its author.

**Reads carry no date limit.** The staff surface opens on the last two business
days, but that is where it opens rather than a boundary, and no policy carries a
date predicate on `select`. Enforcing the window would mean resolving each
outlet's cutover through `app_business_date` per row, and it would be protecting
an expense row, which is not a revenue figure. A rule that costs a correlated
subquery to enforce something nobody needs enforced is the wrong rule.

**A false cash entry is not caught by the drawer count.** It lowers expected
cash, so the count still matches. The drawer count catches a *missing* entry,
never an invented one. That is inherent to granting cash expenses at all, so no
further restriction on staff buys anything. **Attribution is the control**, and
the spec says so rather than implying the count is a check.

### D3 — Void replaces delete on `manual_ledger_expenses`

`voided_at`, `voided_by` and `voided_reason` on the row. A voided expense stays
visible, struck through, and stops counting toward the day's expected cash and
the month's totals. Visible to everyone who can read the row, including staff
[owner, 2026-08-07], so somebody can see their own mistake was caught rather than
wondering where the row went.

`DELETE` is revoked from `manual_ledger_expenses`. #36's migration granted it,
and stated the reason explicitly: these tables are "a notebook with exactly one
reader and one writer". That premise is what this change removes. The revoke is a
grant change as well as a policy change, and `20260726000010_grants_hygiene.sql`
is the precedent for how those are written.

`manual_ledger_days` keeps `DELETE`, because a day typed against the wrong date
is still a mistake with no story worth keeping, and only owners and managers can
reach it.

**Rejected: a soft-delete flag with no reason and no actor.** The whole value of
tracing a removal is knowing who removed it and why; a boolean is a tombstone
that answers neither.

### D4 — `is_cash` stays a boolean, because pending expenses are not in this change

An earlier draft replaced `is_cash boolean` with a three-valued
`payment public.ledger_payment` of `from_drawer`, `from_bank` and `pending`, and
built settlement on top of it: settling wrote a cash-out line on the settlement
day so that no already-counted day was rewritten. **Cut in full**
[owner, 2026-08-08].

The reasoning for the cut. Supplier credit is a real problem and it is not the
one the owner described, which was staff recording spends as they happen. It
arrived during design rather than from the shop. Carrying it here would have
meant a new enum, two settlement columns with three cross-column checks, a
`security definer` settlement function that mutates a *different* day's row than
the expense it settles, and an assertion that the original day stays byte-for-byte
unchanged. It would also have stopped the month being a cash basis, which
`profit-estimates` then requires the surface to rename, and the pending total
becomes its own figure beside the profit estimate. That is a second capability
wearing this one's clothes.

**Nothing regresses.** A credit purchase is unrecorded today and stays unrecorded
after this change. The month is exactly as truthful as it was, and its existing
cash-basis wording stays correct rather than needing to be rewritten.

So `is_cash` keeps its boolean type, its meaning and its column name, and the
drawer arithmetic keeps asking one question, now with one more clause:
`is_cash and voided_at is null`.

**What this defers, stated plainly.** An outlet buying on terms has no way to
record it, and the month will understate in the month the goods arrive and
overstate in the month they are paid for. That is today's behaviour. Revisit as
its own change when the owner starts buying on terms; the `payment_method` enum
mismatch that pushed toward a new enum is already logged as a backlog note for
#11 either way.

### D5 — What staff cannot read, and the exact size of that claim

The read side of the day-table boundary is real but narrower than an earlier
draft assumed, and the difference matters because it decides what the tests are
allowed to prove.

**Today's takings at the outlet a staff member is working in are not
confidential** [owner, 2026-08-08]. They stand where the sales happen. The
counter tablet is signed in and physically present, and anyone who wanted the
evening's figure could tally the orders themselves and reach it. No test, wording
or later feature may rest on the premise that a worked shift is a secret this app
is keeping.

**Everything else on that row is confidential and is in scope**: any past day,
any month's aggregate, the other outlet, and every figure net of commission. None
of it can be observed from behind a counter, and a running total across weeks is
not the same information as one evening's cash. This is the read-side claim the
gate makes and the read-side assertions prove.

**The mechanism is blunter than the principle, deliberately.** The policy refuses
staff every day row, including one from a shift they worked and watched. There is
no roster check and none is worth building: the narrow thing the owner conceded
is a statement about what the system may *claim*, not an instruction to open a
hole. Writing it down keeps a later reader from hunting for a roster predicate
that was never there.

**Why the boundary is worth having at all, given the concession.** The write side.
A staff account that could set `cash_counted_paise`, `opening_cash_paise` or
`cash_removed_paise` could make any drawer reconcile, and the nightly count is the
only control the owner has over cash. That alone justifies the policy; the read
protection is a free consequence of the same predicate.

`docs/LIMITATIONS.md` records the distinction so #11 and #13 inherit it rather
than re-arguing it, and so that a later change showing staff their own shift's
sales is a product question while one showing them the month is not.

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

### D7 — The expense list is lifted out of the day surface, and staff mount it alone

`src/features/manual-ledger/ledger-day.tsx` is 1,402 lines built around the day
row: the opening-cash chain, the live drawer difference, every figure card. The
expense list and its form are a self-contained region inside it, and they become
one component that both surfaces mount. The day surface renders it below its
figures. A new `staff-expenses` surface renders it alone, for the last two
business days at the chosen outlet, every row whoever recorded it.

**Rejected: the Ledger opened to staff with revenue and drawer stripped by role.**
This was the intuitive shape and it is more work, not less. The surface reads the
day row for almost everything it draws, and an account holding no day row means a
role check in front of every figure on a 1,400-line component, each one a place a
figure leaks later. Extraction is the honest version of the same instinct: real
reuse of the part both readers share, with no role branching in the large file.

Two gate registry entries, `staff-expenses` under `biller` and under `employee`,
state `live`, each with a `nav` block. **The gate registry is on the `/quickfix`
refusal list**, and so are RLS and money, so this change runs the full local gate
set including the Docker job.

**`test:e2e:auth` is inside the blast radius.** It asserts what each role lands on
and the chrome around it, and this change adds a tab to two shells.
`ui-owner-console-and-demo` broke that suite while every other gate stayed green.

### D8 — The row is lean, and the detail expands

Each expense row shows category, amount, a from-the-drawer marker, and the note.
Recorder, timestamps, and void state with its reason and actor live behind an
expandable card [owner, 2026-08-07]. An expandable card rather than an info icon:
the detail is more than a tooltip holds, and a tooltip is a hover idiom on a
surface used entirely with thumbs.

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
  everyone else", with four scenarios. → Its own title asserts the rule being
  removed, and a MODIFIED block cannot rename a requirement, so the delta uses
  REMOVED with a stated reason plus an ADDED replacement, the idiom this spec
  already uses for its authority requirement. Every one of the four scenarios is
  rewritten rather than dropped, so the archive keeps a readable record of what
  the boundary was.

- **A false cash entry is not caught by the drawer count.** → Stated in the spec
  as a limitation of the control model rather than papered over. The controls are
  attribution and the void trace, and the alternative (an approval step on every
  gas cylinder) is what the change exists to avoid.

- **Cutting pending leaves credit purchases unrecordable.** → Accepted
  [owner, 2026-08-08]. It is the current behaviour, so nothing regresses, and the
  month keeps the cash-basis wording that is already true of it. The risk is that
  the gap is forgotten rather than that it bites now; D4 states it and the
  non-goals repeat it.

- **#12's carry-over obligation grows, but by less than it would have.** → It
  currently owes amounts, dates and categories. After this it owes attribution and
  void state. It does **not** owe settlement state or payment states, which is the
  direct saving from D4. Updated in `daily-cash-live/proposal.md` in this change,
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
- **Does voiding require a reason?** D3 assumes yes, and the completeness check is
  written for it. A required reason is one more field on the fastest path a staff
  member takes; an absent one leaves the trace able to answer who and when but not
  why. Settle before writing the check, because it is a constraint either way.
- **What a Franchise Admin sees of the owner's remote entries, and the reverse.**
  `outlet-expenses` already requires an owner's remote expense to be visibly the
  owner's on the live surface. Whether the ledger adopts the same marking, or
  relies on the recorder name alone, is a surface decision this change should
  settle rather than inherit by accident.
