# Proposal: retire-a-tablet-keeps-its-login

> **Kind**: gate retirement, no roadmap row. Seeded 2026-11-12 when
> `a-tablet-keeps-its-login` was archived.

## Why

The `a-tablet-keeps-its-login` gate (code `TK`, `retireBy` 2026-12-27) has done
its job. It was turned on in production at 07:15 IST on 1 November 2026 and has
stayed on: `change_gate_events` holds that one turn and nothing since, and every
registered device boots with it. **It was never pulled**; under the owner's rule
of 30 October that holds nothing, but the code half waits for the owner's "happy
to retire it". Its off path — `/sign-in` and `/activate` drawing their forms on a
tablet — is now dead code with a switch on it.

Nothing depends on it.

## What changes

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`), both halves.

- **Code.** The tablet boundary is always on, and `signIn` and `redeemInvite`
  always refuse while the browser holds a tablet's session. As the declaration
  says, the per-screen tablet redirects in `RealRoot`, `RootResolver`,
  `CounterRoot`, `KitchenRoot` and `CounterSetup` go, because the boundary makes
  them redundant. The key moves to `RETIRED_CHANGE_GATES`, its off tests go, and
  the demo's gate copy goes. `app-wide code` is touched (routing), so run the
  auth suite whole.
- **Database later.** Its migration added nothing the off path alone uses, so the
  contract migration (`-- release: contract a-tablet-keeps-its-login`) is
  expected to retire the row only, after the readiness check.

## Change gate

No gate: a retirement keeps the behaviour already on.
