# Proposal: Cash Is Counted, Not Closed

> **Model**: Opus · **Wave**: E · **Depends on**: #10 · **Gate**: the drawer is a
> running balance an outlet's admin or the owner observes at a moment of their
> choosing, mid-shift, days apart, or entered an hour later from home, and the
> Ledger fills itself for every day with nothing typed into it.

**This change replaces roadmap #12 `daily-cash-live` entirely, and absorbs what
was left of #11 `expenses-and-inventory-live`.** Both were written before
billing went live, before the aggregator syncs landed, before #28, and before
the owner described how cash is actually collected. Neither proposal survives.
The two things they owed that remain owed are named under *Inherited
obligations* below, and the second of them is discharged by #12
`retire-the-manual-ledger`, not here.

## Why

The app was commissioned to answer one question: **is the drawer right?** Every
design it has carried for that question assumed the answer is produced once a
day, at the end of a day, by a person signing a figure. That assumption is
wrong, and it has been wrong since before the first line of the cash schema was
written.

What actually happens, in the owner's own account of it:

> The admin comes to the shop once a day, at any point, it would be ten PM,
> eleven PM, not necessarily at the end of the shift, and collects cash. He'll
> check the billing amount and compare it with the UPI amount on his phone. Then
> he counts the cash on the drawer, decides how much he wants to withdraw, takes
> it away and leaves a small amount at the till. This may not be enforced every
> day: on some days the admin might skip and come back the next day or a couple
> of days later. And because this happens in the middle of the outlet's stay,
> the outlet continues earning new orders and bills after the collection is
> done. Sometimes the owner counts it on the spot and, because the outlet is in
> a rush, enters it later after going home, so the point at which they enter
> what they observed may not precisely match the point at which it was counted.

Four facts in that paragraph, and today's model contradicts all four:

1. **The count happens mid-shift.** `close_business_day()` compares a counted
   amount against a whole business date's cash sales. A count taken at 22:00 is
   measured against cash that arrives until 23:41. The difference it produces is
   fiction, and it is fiction on every ordinary night, not in an edge case.
2. **The count and the collection are one physical act.** The model stores the
   counted amount on a day record and the withdrawal in an unrelated table, with
   no arithmetic tying them and no way to express "I counted ₹8,950, took
   ₹7,500, left ₹1,450."
3. **A skipped day has no representation.** One record per date means a skipped
   date is a hole, and the day the collector returns reads as enormously over.
4. **A count entered later is measured at the wrong instant**, because the
   expected figure is computed from whatever the server knows at save time.

So the unit of cash truth is not the calendar day. **The drawer is a continuous
balance, and a count is a point-in-time observation of it.** Once that is the
model, all four facts stop being special cases: a mid-shift count is the normal
case, a collection is part of the observation, a skipped day is an interval that
happens to be longer, and a late entry is handled by asking when the count
happened rather than when it was typed.

The same shift removes the reason the Ledger is a form. Cash and UPI already
come from bills, Zomato and Swiggy already arrive from their syncs, expenses are
already recorded by the people who spend the money, and after this change the
drawer's opening, counted and withdrawn figures come from observations. Nothing
is left for a person to type into a day row. **The Ledger becomes a statement
that writes itself**, and the only two facts a human ever supplies are an
expense when it is spent and a count when the drawer is counted.

## What Changes

### A new Cash drawer surface

One outlet-scoped surface, opening on the question a collector actually has when
they walk in: **what should be in the drawer right now.** Not a date picker.

- The running balance, with the last observation, what was left, and the cash
  receipts and cash expenses since, each with its own count of contributing rows.
- **Count the drawer**, the primary action: when it was counted, what was in it,
  and how much is being collected. Three inputs, four taps on an ordinary night.
- **Collect cash**, for taking money without counting.
- **Record a cash spend**, rare, reason required, for drawer cash that buys
  something and must not enter the month's operating expenses.
- **Adjust a count**, for correcting an observation a later one has anchored on.
- Reconciliation exceptions for work that arrives after an observation was
  recorded.

### The Ledger becomes a derived statement

The per-day reading keeps both halves it has today and loses every input.

- **Revenue**: Cash and UPI from counter allocations, Zomato and Swiggy as
  sourced readings with gross, commission and net, each carrying its settlement
  state. A commission not yet stated still reads "not known yet", never nought.
- **Drawer**: only cash movements, ordered **by instant rather than grouped by
  category**, so an expense paid before the count sits above it and one paid
  after sits below. Opening at cutover, cash sales, cash expenses, then the
  observation block, then trade after the observation, then closing at cutover.
- Days with no observation render fully and mark opening and closing `carried`,
  naming when the drawer was last confirmed. Days with two visits show two
  observation blocks.
- **Zero editable fields.** The only controls are the day stepper, row
  expansion, and Verify.

### Day close disappears

`daily_cash_records` and `close_business_day()` stop being written to or called.
They are **not dropped here** (see *Deliberately additive* below). The
billing-readiness gate they carried does not move to a new home: it exists to
answer whether a day's billing is complete, which cannot be a precondition for
counting cash at 22:00 with orders open and tablets live, and which nobody has
ever performed. It retires with the function in #12.

### Verification replaces sign-off

There is no end-of-session signature, because there is no end-of-session. A day
may be verified at any time afterwards: an attributed acknowledgement with an
optional note, freezing nothing, required by nothing. A day whose figures move
after it was verified says so.

### Both ledgers are reachable during the overlap

The existing manual Ledger form keeps working, keeps its rows, and keeps its
route. It leaves the navigation and the new derived Ledger takes its place. The
fallback is a tab, not a flag: **no runtime toggle is introduced**, so
`docs/DEMO_MODE.md`'s build-time gate rule (D3) is upheld.

## Capabilities

### New Capabilities

- **`cash-drawer`** — the drawer as a continuous balance; observations,
  collections, spends and adjustments; the interval arithmetic and its
  constraints; approximate count times and what may be said about them;
  reconciliation exceptions; and who may reach a drawer.
- **`ledger-statement`** — the derived per-day and per-month reading, its two
  sections, the timeline ordering, the `carried` marker, and verification.

### Modified Capabilities

- **`manual-ledger`** — demoted from the navigation, retained at its route as
  the fallback and as the only reader of pre-tablet history. Explicitly **not**
  retired here.
- **`outlet-expenses`** — expenses gain an occurrence instant so they can be
  placed on one side of a mid-day boundary.
- **`identity-and-access`** — a Super Admin reaches every outlet's drawer
  without holding an assignment there; on-site evidence is recorded rather than
  required.

### Removed Capabilities

- **`daily-cash-reconciliation`** — every requirement in it describes closing a
  business day. The thing they describe ceases to exist.

## Impact

- **New tables**: `drawer_observations`, `drawer_cash_out`,
  `drawer_observation_adjustments`, `ledger_day_verifications`.
- **Altered tables, additively only**: nullable occurrence instants on
  `expenses` and `manual_ledger_expenses`. `cash_withdrawals` is not touched:
  nothing has ever written it and #12 drops it.
- **New RLS** on every new table, with the Super Admin reach settled above and
  Biller/Employee refused by the absence of a policy branch.
- **New domain module** for the interval arithmetic, in integer paise, throwing
  on non-integer input, mirroring the database constraints.
- **New surfaces** in `src/gates/registry.ts`, promoted `live` by this change.
- **No production data is moved, renamed or deleted.**

## Inherited obligations

Two survive from the proposals this replaces. Neither is discharged here.

- **Retire the manual-ledger stopgap (#36).** Carry pre-tablet history across,
  archive the tables, and drop the dead day-close code. This change makes that
  possible by giving the rows somewhere to land; **#12
  `retire-the-manual-ledger` performs it**, and cannot be archived without it.
  The obligation grew in `expense-categories-grow-from-use` (free-text
  categories on both sides) and again in `the-ledger-opens-to-the-outlet`
  (recorder, last corrector, withdrawn state, and the recorded-from-away
  marker). All of it must survive the carry-over.
- **Do not inherit the owner's cash-write permission by accident.** The owner may
  write cash figures in the manual ledger only because no real drawer record
  existed to corrupt. This change decides the boundary on its own merits, and
  the decision is recorded in `identity-and-access`: the reach is granted
  deliberately, and what it costs is that the record must say where the person
  was.

## Non-goals

- **No suggestion of a count time that shrinks a difference.** The surface
  reports an exact coincidence with a run of bills as a fact. It never proposes
  a nearby time, and never reveals where the balancing boundary is. The reason
  is recorded in `design.md` decision 7 and is the single most load-bearing
  refusal in this change.
- **No retirement of the manual ledger.** Nothing is dropped, renamed or
  migrated. That is #12, deliberately a separate release.
- **No runtime toggle.** The fallback is the old surface at its own route.
- **No inventory.** Stock is shelved; see `openspec/todos/inventory-is-shelved.md`.
- **No denomination counting and no bank deposit tracking.**
- **No re-homing of the billing-readiness gate.** It dies with the function that
  called it.
- **No payment states or supplier credit on expenses.** Cut in full on
  2026-08-09 and still cut.
- **No change to how a bill, a void or an aggregator figure is written.**

## Docs to update before archiving

`docs/SCREENS.md` (the Cash drawer surface, the Ledger's new shape, and the
Daily cash screen's removal), `docs/DATA_MODEL.md` (the new tables, and the
daily-cash section), `docs/GLOSSARY.md` ("Cash sales", "Expected closing cash"
and "Actual closing cash" all describe a close and must be rewritten; "Business
date" stays; the word "Kept" must not enter it), `docs/ROLES_AND_PERMISSIONS.md`
(the drawer rows of the capability matrix), `docs/OFFLINE_AND_SYNC.md` (the
late-arrival rule against an observation), `docs/LIMITATIONS.md` (the manual
ledger's exit now belongs to #12, and the `paid_at` skew note), `docs/DEMO_MODE.md`
(the new gates), `docs/OPERATIONS.md` (step 8 of bringing an outlet online no
longer sets an opening float), `docs/TESTING.md` (the interval arithmetic and
the August rehearsal).
