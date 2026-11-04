# Proposal: retire-tablet-health

> **Kind**: gate retirement, no roadmap row. Seeded 2026-10-31 when
> `a-release-can-be-switched-off` was archived.

## Why

The `tablet-health` gate (code `TH`, `retireBy` 2026-11-30) has done its job.
It was turned on in production at 04:00 UTC on 14 October 2026, pulled once
(off at 03:53 and on again at 06:15 UTC on 15 October), and has stayed on
since: read from `change_gate_events` on 30 October. Its change was archived
on 31 October, on the owner's word. Tablets count their requests and report
their health each minute; the off path that skips this is now dead code with a
switch on it.

## What changes

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`), both halves.

- **Code first.** Every toggle point keeps its on branch, the key moves to
  `RETIRED_CHANGE_GATES`, the off and round-trip tests go, the demo's gate copy
  goes, and the spec and docs stop calling health reporting gated. Check first
  what reads the gate besides health reporting: `fewer-requests`' minute gate
  answers ride on the health report while Tablet health is on.
- **Database later.** After every registered device runs the retirement build
  and the counter has traded three services on it, a contract migration
  (`-- release: contract tablet-health`) rewrites any database reader of the key
  to its on branch, drops what only the off path used, and retires the row.

## Change gate

No gate: a retirement keeps the behaviour already on.
