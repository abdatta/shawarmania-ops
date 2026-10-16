# Proposal: retire-instant-saves

> **Kind**: gate retirement, no roadmap row. Seeded 2026-10-16 when
> `the-counter-shows-what-it-saved` was archived. Expand it with the `retire-gate`
> workflow when its turn comes. `retireBy` is 2027-01-15.

## Why

The `instant-saves` gate (code `IS`) was turned on in production on 15 October 2026
before trading, pulled once that day (off with `dish-ticks` at 09:23 IST, on at
11:48), and ran through a full service on `da92417` with 64 bills and no failed
requests. The owner then tried it on *Cafe Staging* with the network throttled.

## What changes

The `retire-gate` workflow. It depends on `dish-ticks` and `kitchen-ready`, so it
retires first, or in the same change as either of them.

- **Code.** The counter's own saves keep their on branch: the rail and Bills draw
  `peekOpenOrders` and `peekShiftHistory` before the server read, the own-save keys
  replace the refresh bumps in `BillingCounter`, `DishOpenOrdersSurface`,
  `MyShiftSurface` (records mode), `CounterRecords` and `CounterShell`, the Bills
  panel keeps D5's messages, and the table picker opens on the peek. The off
  branches go, the key moves to `RETIRED_CHANGE_GATES`, and the
  `describeChangeGate('instant-saves', …)` off cases and any `@cg-off:instant-saves`
  tests go; `e2e-auth/instant-saves.spec.ts` loses its tag.
- **Database, a week after every tablet runs the retirement build.** A contract
  migration (`-- release: contract instant-saves`) setting the gate's `retired_at`.

## Change gate

No gate: a retirement keeps the behaviour already on.
