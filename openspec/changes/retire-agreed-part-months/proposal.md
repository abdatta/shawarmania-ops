# Proposal: retire-agreed-part-months

> **Kind**: gate retirement, no roadmap row. Seeded 2026-11-12 when
> `part-months-cost-what-was-agreed` (a #79 follow-up) was archived.

## Why

The `agreed-part-months` gate (code `AM`, `retireBy` 2027-02-28) has done its
job. It was turned on in production at 23:59 IST on 31 October 2026 and has
stayed on: `change_gate_events` holds that one turn and nothing since. **It was
never pulled**; under the owner's rule of 30 October that holds nothing, but the
code half waits for the owner's "happy to retire it". Its off path — a part
month costing its share by days, stopped costs under *Stopped* at the foot — is
now dead code with a switch on it.

Nothing depends on it.

## What changes

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`), both halves.

- **Code.** Every toggle point keeps its on branch: the Stop, Add and Edit
  sheets, a cost's months (*closing*, *first month*, **Change**), the stopped
  row and the *Stopped · N · Show* line. The key moves to
  `RETIRED_CHANGE_GATES`, its off tests go, and the demo's gate copy goes.
- **Database later.** After every registered device runs the retirement build
  and the counter has traded three services on it, a contract migration
  (`-- release: contract agreed-part-months`) rewrites any reader of the key to
  its on branch, drops what only the off path used (`stop_fixed_cost_v2`, which
  reached staging only, and `stop_fixed_cost` once no build calls it), and
  retires the row. `fixed_cost_month_cost` keeps its day-share fallback: it is
  not the gate's, it is the answer every build agrees on for a month with no
  settlement.

## Change gate

No gate: a retirement keeps the behaviour already on.
