# Proposal: retire-kitchen-ready

> **Kind**: gate retirement, no roadmap row. Seeded 2026-10-15 when
> `each-dish-is-ticked-off` (#74) was archived. Expand it with the `retire-gate`
> workflow when its turn comes.

## Why

The `kitchen-ready` gate (code `KR`) was turned on in production on 14 October 2026,
pulled once on 15 October (off with `dish-ticks` at 09:23 IST, on at 11:47), and ran
through two services with the kitchen's Ready and the counter's handbell in use.

## What changes

The `retire-gate` workflow. `instant-saves` depends on it, so that gate retires first
or in this same change. `dish-ticks` retires after this one.

- **Code.** The kitchen's Ready and the counter's orange fill keep their on branch;
  the key moves to `RETIRED_CHANGE_GATES`; `@cg-off:kitchen-ready` tests go.
- **Database, a week after every tablet runs the retirement build.** A contract
  migration (`-- release: contract kitchen-ready`) setting the gate's `retired_at`.

## Change gate

No gate: a retirement keeps the behaviour already on.
