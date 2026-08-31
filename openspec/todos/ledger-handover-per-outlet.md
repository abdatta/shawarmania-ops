# The Ledger Handover Still Has To Be Done, Outlet By Outlet

**Area:** Billing / Ledger · **Raised:** 12 Aug 2026 · **Closed:** 31 Aug 2026,
as unnecessary · **Type:** Operational rollout, not a code change

## What is outstanding

Each outlet's ledger has to stop taking hand-typed Cash and UPI revenue and
start reading it from the bills its tablet rings. That switch is one date per
outlet — `billing_live_from`, set from **Super Admin → Outlets → Edit → Counter
billing starts on** — and it has not been set for either outlet.

Nothing is missing in the app. The control exists, the behaviour on both sides
of the date is built and tested, and the runbook says how to do it. What is
outstanding is the decision to do it, per outlet, on a day somebody chooses.

## Why it is here and not in a change

`billing-live` (#10) delivered every line of this and closed without it, by the
owner's decision on 12 Aug 2026. The act waits on confidence built over days of
real trading, and at Kanchrapara on hardware that has not arrived; a change held
open for either would have sat active for weeks with all its work done. Issues
the rollout turns up get their own changes, which is the ordinary path.

**The consequence to be honest about: no automated gate asserts this happened
correctly.** Three things carry it instead — this page, step 12 of *Bringing an
outlet's counter online* in [`docs/OPERATIONS.md`](../../docs/OPERATIONS.md),
and `retire-the-manual-ledger` (#12), which owns migrating the manual ledger's
rows and cannot finish while an outlet is still writing them by hand. (That
change used to be called `daily-cash-live`; `cash-is-counted-not-closed` (#11)
replaced it entirely.)

## Where each outlet stands

- **Kalyani** — the tablet has been taking real customer money since 12 Aug
  2026, with **every bill also written down by hand**. That parallel run is the
  shakedown, and it continues until the two records agree over enough trading
  for the owner to trust the system. Not promoted.
- **Kanchrapara** — no tablet yet. Nothing to hand over until its hardware
  arrives and it repeats the same setup and parallel run.

  **Out of date as of 26 Aug 2026**: Kanchrapara has been ringing real bills
  since 14 Aug 2026, 320 settled bills by 26 Aug. Both outlets have working
  tablets, which is part of why the act this page tracks is dissolving rather
  than waiting.

## Before setting the date, at either outlet

- The hand-written bills and the tablet's bills agree for the days traded.
- Nothing on the tablet is unsent or needing attention.
- The date chosen is a business date that **has not started**. The app refuses
  one that has, deliberately: a day that begins hand-typed and ends sourced from
  bills is the double-count #10's own test exists to catch.

## The one-way part

**Setting the date is the only irreversible step.** From it, the ledger stops
accepting those two typed figures for that outlet and reads settled bills
instead. An outlet whose bills turn out to be wrong *after* its ledger has
handed over has no second record left to compare against — which is the entire
reason the parallel run exists, and the reason not to set the date early to get
past a bug.

Zomato and Swiggy revenue stay hand-entered at every outlet on every date where
no sync covers them, before and after. **Cash in and out and the counted drawer no
longer do:** `cash-is-counted-not-closed` (#11) gives them a live record, and the
notebook keeps its own rows only as history for #12 to carry across.

**Closed 31 Aug 2026. The act became unnecessary; it was never performed.**

`retire-the-manual-ledger` (#12) landed and dropped `outlets.billing_live_from`,
its guard function and both its triggers. Nothing above was done at either
outlet, and nothing above will be.

The reason is worth stating plainly so a future reader is not left wondering
whether a rollout was quietly skipped. **A handover moves an outlet from one of
two records to the other. #12 removed the second record, so there is no longer
anything to hand over from.** `billing_live_from` controlled exactly one thing —
whether the manual ledger form asked for typed Cash and UPI at that outlet.
Bills were rung and stored either way, at both outlets, from 12 Aug (Kalyani) and
14 Aug (Kanchrapara). The derived statement built by `cash-is-counted-not-closed`
(#11) read `bills` directly and consulted the flag nowhere. So the flag's only
reader retired with the form it served, and the date it would have carried no
longer means anything.

What this page was really protecting is still protected, by something better than
a date: the parallel run. Both outlets rang bills alongside a hand-written record
for the whole of August, the two were compared before #12 was drafted, and the
carry-over preserved the hand-written figures rather than discarding them — the
notebook's own receipts are what a carried day's expected cash is built from,
precisely because the counter was not billing for the first half of the month.
The disagreements between the two records were not reconciled away; they are on
screen, beside the day's bills.

The consequence this page was honest about — that no automated gate asserted the
handover happened — is discharged rather than inherited. There is nothing left to
assert.
