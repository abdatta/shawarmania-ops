# Proposal: retire-role-includes

> **Kind**: gate retirement, no roadmap row. Seeded 2026-10-31 when
> `staff-roles-include-other-roles` was archived, on the owner's word.

## Why

The `role-includes` gate (code `RI`, `retireBy` 2026-11-18) has done its job.
It was turned on in production at 19:17 UTC on 22 October 2026 and has stayed
on: `change_gate_events` holds that one turn and nothing since, read on 30
October. Kalyani Cafe traded eight services on it by 31 October, with check-ins,
expenses and bills admitted as before. **It was never pulled**: on 31 October
the owner waived the pull under their rule of 30 October, and its round trip is
`none:` (on and off admit the same people to write the same rows).

Its off path, every check naming a staff role, is now dead code with a switch
on it. #80 needs it gone before the first Waiter is made: until the cleanup, a
new staff role is a row the off path does not know.

Nothing depends on it in `change_gate_dependencies`. The database reads the key
in the gated policy twins and the three objects of design D4, which the contract
half rewrites.

## What changes

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`), both halves,
as `staff-roles-include-other-roles` design D8 lays out.

- **Code.** Every toggle point keeps its on branch: the adapters' `onRoleIncludes()`
  calls (attendance, billing, expenses, the roles on offer), the session's role
  checks, the demo's role switcher, Team's role picker and the role home. The
  `roles-lint: allow the role-includes off path` exceptions go with the code
  they excused. The key moves to `RETIRED_CHANGE_GATES`; the `describeChangeGate`
  blocks become plain tests of the on behaviour; `e2e-auth/role-includes.spec.ts`
  loses its `@cg-on` tags; the demo's gate copy goes.
- **Database later.** After every registered device runs the retirement build
  and the counter has traded three services on it, a contract migration
  (`-- release: contract role-includes`) rewrites the ten old policies, the
  three objects of D4 and each old function to ask the includes rows only,
  drops the gated twins, removes the `%_includes` exclusions from pgTAP `01`,
  `21` and `24`, and retires the row. Then tell #80 the first Waiter may be made.

## Change gate

No gate: a retirement keeps the behaviour already on.
