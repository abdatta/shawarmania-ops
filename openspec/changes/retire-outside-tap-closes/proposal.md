# Proposal: retire-outside-tap-closes

> **Kind**: gate retirement, no roadmap row. Seeded 2026-10-15 when
> `a-popup-closes-when-you-tap-outside-it` was archived. Expand it with the
> `retire-gate` workflow when its turn comes.

## Why

The `outside-tap-closes` gate (code `OT`, `retireBy` 2026-12-15) has done its job.
It was turned on in production on 15 October 2026, pulled once (off at 09:24 IST,
on again at 11:48), and ran through that evening's service on build `da92417`. Its
off path is now dead code with a switch on it, and every live gate doubles what
the browser suites must run.

## What changes

The `retire-gate` workflow, in its two halves:

- **Code.** `Modal` and the iOS install hint keep their outside-tap handling and
  lose the gate check. The `dismissOnOutsideTap` prop stays. `outside-tap-closes`
  moves to `RETIRED_CHANGE_GATES`. `@cg-off:outside-tap-closes` tests are deleted,
  and the `@cg-on:` tags are dropped so the rest run in both states.
- **Spec and docs.** `design-system`'s *A pop-up closes when the space outside it
  is tapped* loses its gate sentence and its *The gate is off* scenario;
  `docs/DESIGN_SYSTEM.md` stops calling the behaviour gated.
- **Database, a week after every tablet runs the retirement build.** A contract
  migration (`-- release: contract outside-tap-closes`) sets the gate's
  `retired_at`. Nothing else in the schema belongs to this gate.

## Change gate

No gate: a retirement keeps the behaviour already on.
