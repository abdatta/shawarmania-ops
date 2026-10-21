# Proposal: retire-one-revenue

> **Kind**: gate retirement, no roadmap row. Seeded 2026-10-21 when
> `revenue-reads-the-same-everywhere` (#76) was archived. Expand it with the
> `retire-gate` workflow when its turn comes.

## Why

The `one-revenue` gate (code `RV`, `retireBy` 2027-01-31) has done its job. It
was turned on in production at 12:42 IST on 16 October 2026 and has stayed on,
through every service since, on every device expected to operate. **It was never
pulled**: the owner waived the off-and-on on 21 October, because turning revenue
off mid-trade buys nothing and its on path writes nothing (round trip
`none:` in `gates.ts`). Its off path is now dead code with a switch on it, and
every live gate doubles what the browser suites must run.

## What changes

The `retire-gate` workflow, in its two halves:

- **Code.** Every `useChangeGate('one-revenue')` toggle point keeps its on
  branch: Overview, the Ledger's day and month, Analytics' presets and
  comparison, and the live adapter's reads. The off path's screens and reads go
  where nothing else uses them. `one-revenue` moves to `RETIRED_CHANGE_GATES`,
  `@cg-off:one-revenue` tests are deleted and `@cg-on:` tags are dropped.
- **The dependant first.** `pro-rata-pnl` (#79) depends on `one-revenue`. It
  must be retired before or with this gate, or have its dependency removed in
  the same change, since a gate cannot depend on a tombstoned key. Check its state
  before expanding this one.
- **Spec and docs.** Requirements that say "with `one-revenue` on" (for example
  `outlets-overview`'s *Today's revenue names the sale in progress*) lose the
  condition; `docs/` stops calling the behaviour gated.
- **Database, after three services on the retirement build.** A contract
  migration (`-- release: contract one-revenue`) rewrites any database reader
  of the key to its on branch, drops what only the off path used, and sets the
  gate's `retired_at`. Search production and a fresh reset for readers first.

## Change gate

No gate: a retirement keeps the behaviour already on.
