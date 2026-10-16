# Proposal: retire-dish-ticks

> **Kind**: gate retirement, no roadmap row. Seeded 2026-10-15 when
> `each-dish-is-ticked-off` (#74) was archived. Expand it with the `retire-gate`
> workflow when its turn comes.

## Why

The `dish-ticks` gate (code `DT`) was turned on in production on 14 October 2026,
pulled once on 15 October (off 09:23 IST, on 11:47), and ran through two services.
Its off path, the pre-#74 counter and kitchen, is now dead code with a switch on it.

## What changes

The `retire-gate` workflow. **It waits on two others**: `kitchen-ready` and
`instant-saves` depend on `dish-ticks`, and `lint:change-gates` fails a declared gate
depending on a retired one. Retire `instant-saves` and `kitchen-ready` first, or in
this same change.

- **Code.** Every `dish-ticks` toggle point keeps its on branch. The three-column
  counter and the one-tick-per-order kitchen go. The key moves to
  `RETIRED_CHANGE_GATES`, and its `@cg-off:` tests go with it.
- **Database, a week after every tablet runs the retirement build.** A contract
  migration for what only the off path used, including the pre-#74 RPCs restored by
  `20261017000000_restore_counter_before_dish_ticks`, once nothing calls them.

## Change gate

No gate: a retirement keeps the behaviour already on.
