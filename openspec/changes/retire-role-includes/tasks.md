# Tasks: retire-role-includes

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`), with the
cleanup `staff-roles-include-other-roles` design D8 describes. No gate of its
own, and no migration in the code half.

## 0. Preconditions

- [x] 0.1 The change is archived: `2026-10-31-staff-roles-include-other-roles`.
  *(Its fake-outlet try and its pull were waived by the owner on 31 October;
  round trip `none:`.)*
- [x] 0.2 The gate is on in production and has stayed on.
  *(Read from `change_gate_events`, read-only, on 30 October: on at 19:17 UTC on
  22 October, nothing since.)*
- [x] 0.3 Nothing depends on it: no `dependsOn` in `gates.ts` and no
  `change_gate_dependencies` row. The database reads the key in the gated
  policy twins and the three objects of design D4, which the contract rewrites.

## 1. The retirement change — code

- [x] 1.1 Every toggle point keeps its on branch: `highestRole` and
  `isStaffRole` in the adapters; `reachableRoles`, `personalHeldRoles` and the
  role order in the session; the demo's role switcher; Team's roles on offer and
  editable roles; the role home; and the live adapters' calls, which now go to
  `attendance_elsewhere_v2`, `attendance_submit_attempt_v2` (or `_v3` under
  `auto-approve-at-the-shop`), `attendance_record_manual_v2`,
  `review_billing_attribution_v2` and `expense_people_v2`.
- [x] 1.2 The off path's code goes: `src/change-gates/role-includes.ts`,
  `STAFF_ROLES` and `ROLE_SENIORITY` in the adapters, and every
  `roles-lint: allow the role-includes off path` exception with the code it
  excused.
- [x] 1.3 `role-includes` moves from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`,
  and out of the demo's gate words.
- [x] 1.4 Tests: the `describeChangeGate` blocks in
  `src/data-access/role-includes.test.ts` and
  `src/data-access/supabase-adapters/role-includes.test.ts` become plain tests of
  the on behaviour, still held to the frozen answers;
  `e2e-auth/role-includes.spec.ts` loses its `@cg-on` tags.
- [x] 1.5 The `identity-and-access` delta; `docs/ROLES_AND_PERMISSIONS.md` no
  longer calls the app's checks gated.
- [x] 1.6 `npm run lint`, `format:check`, `typecheck`, `functions:typecheck`,
  `contrast`, `test`, `build`, `lint:change-gates`, `lint:roles`; `test:db` on a
  fresh reset and `test:rls`; the browser suites on Staging.
  *(31 October: every quick gate clean locally; on a fresh reset `test:db` 99
  files, 4127 tests, and the REST suites but the Edge-Function ones the shared
  stack cannot serve. Staging 41162301437 passed every job on `01f82d0a`.)*
- [ ] 1.7 Release: push to `stage`, Staging green, the owner promotes. The gate's
  row is left on.

## 2. Wait for every tablet

- [ ] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, three services on it, and the owner's and
  managers' phones reloaded (Team is their screen). Record the date and the
  evidence.

## 3. The contract migration

- [ ] 3.1 A migration headed `-- release: contract role-includes` that, after
  confirming in production and on a fresh reset what reads the key, rewrites the
  ten old policies, the three objects of design D4 and each old function to ask
  the includes rows only, drops the gated twins, and retires the row.
- [ ] 3.2 pgTAP: the `%_includes` exclusions leave `01`, `21` and `24`; `98`
  stops turning the gate; every database gate on a fresh reset; release it.
- [ ] 3.3 Tell #80 (`waiters-take-orders-on-their-phones`) the first Waiter may
  now be made.

## 4. Archive

- [ ] 4.1 Report what was retired and when, then archive.
