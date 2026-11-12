# Proposal: retire-pro-rata-pnl

> **Kind**: gate retirement, no roadmap row. Seeded 2026-10-31 when
> `fixed-costs-are-spread-over-the-month` (#79) was archived, on the owner's word.

## Why

The `pro-rata-pnl` gate (code `PR`, `retireBy` 2027-02-28) has done its job. It
was turned on in production at 05:27 UTC on 21 October 2026 and has stayed on:
`change_gate_events` holds that one turn and nothing since. **It was never
pulled**: on 31 October the owner waived the pull, and the fake-outlet try,
because the on path had run ten days in production and they are happy to retire
it. Its off path — one P&L that counts every cost on the day it was recorded —
is now dead code with a switch on it.

Nothing depends on it since `retire-one-revenue` cut its own dependency.

## What changes

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`), both halves.

- **Code.** Every toggle point keeps its on branch: Overview's P&L tile, the
  Ledger's current month and the Fixed chip on a fixed-cost payment. The key
  moves to `RETIRED_CHANGE_GATES`, its off and round-trip tests go (its round
  trip is `tested`, so the round-trip specs are deleted, not untagged), and the
  demo's gate copy goes.
- **Order.** `part-months-cost-what-was-agreed` (gate `agreed-part-months`) is
  being built on the same screens. Do the code half after that change has
  landed on `stage`, so the two never edit the fixed-cost surfaces at once.
- **Database later.** After every registered device runs the retirement build
  and the counter has traded three services on it, a contract migration
  (`-- release: contract pro-rata-pnl`) rewrites any reader of the key to its on
  branch, drops what only the off path used, and retires the row.

## Change gate

No gate: a retirement keeps the behaviour already on.
