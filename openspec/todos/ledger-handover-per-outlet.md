# The Ledger Handover Still Has To Be Done, Outlet By Outlet

**Area:** Billing / Ledger · **Raised:** 12 Aug 2026 · **Type:** Operational
rollout, not a code change

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
and `daily-cash-live` (#12), which owns migrating the manual ledger's rows and
cannot finish while an outlet is still writing them by hand.

## Where each outlet stands

- **Kalyani** — the tablet has been taking real customer money since 12 Aug
  2026, with **every bill also written down by hand**. That parallel run is the
  shakedown, and it continues until the two records agree over enough trading
  for the owner to trust the system. Not promoted.
- **Kanchrapara** — no tablet yet. Nothing to hand over until its hardware
  arrives and it repeats the same setup and parallel run.

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

Zomato and Swiggy revenue, both commission rates, cash in and out, expenses and
the counted drawer stay hand-entered at every outlet on every date, before and
after. #12 and #13 own their retirement.
