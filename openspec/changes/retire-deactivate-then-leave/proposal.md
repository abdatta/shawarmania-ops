# Proposal: retire-deactivate-then-leave

> **Kind**: gate retirement, no roadmap row. Seeded 2026-11-12 when
> `a-deactivated-person-leaves-in-two-steps` (#82) was archived.

## Why

The `deactivate-then-leave` gate (code `DL`, `retireBy` 2027-03-31) has done
its job. It was turned on in production at 13:06 IST on 3 November 2026 and has
stayed on: `change_gate_events` holds that one turn and nothing since. **It was
never pulled**, which under the owner's rule of 30 October holds nothing. Nobody
was deactivated in production after it went on, and the owner had no reason to
deactivate anyone. So on 12 November they ruled that staging stands in for real
use. That walk is recorded in the archived change's task 14.4.

Its off path is now dead code with a switch on it: no Deactivated section,
departure as a single step, and By day and By staff ignoring the deactivation
day.

Nothing depends on it. `owner-access-in-the-database` belongs to the same
change, and its retirement is independent of this one.

## What changes

This follows the `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`),
in two halves.

- **Code.** Every toggle point keeps its on branch: Team's *Deactivated · N*
  section with Reactivate and Remove, and the attendance reads that stop on the
  deactivation day. The `admin-accounts` function keeps the on branch of its
  `gateOn(service, 'deactivate-then-leave')` check. Its round trip is `none:`,
  so the `@cg-on` tags drop and the off tests go. The key moves to
  `RETIRED_CHANGE_GATES`. The function deploys with the build.
- **Database later.** This waits until every registered device runs the
  retirement build and the counter has traded three services on it. Then a
  contract migration (`-- release: contract deactivate-then-leave`) rewrites
  the departure function's `app_change_gate('deactivate-then-leave')` guard to
  its on branch and retires the row. Re-run the reader query first.

## Change gate

No gate: a retirement keeps the behaviour already on.
