# Tasks: retire-owner-access-in-the-database

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`). No gate of
its own, and no migration in the code half. Retired together with
`retire-deactivate-then-leave`, in one commit.

## 0. Preconditions

- [x] 0.1 The change is archived: `a-deactivated-person-leaves-in-two-steps`
  (#82), on 12 November, the pull waived under the owner's rule of 30 October
  and staging standing in for production use (the owner, 12 November).
- [x] 0.2 The gate is on in production and has stayed on.
  _(`change_gate_events`: on at 13:05 IST on 3 November, nothing since; read on
  12 November.)_
- [x] 0.3 Nothing depends on it.
- [x] 0.4 The owner's "happy to retire it": 12 November, "Yes, retire both".

## 1. The retirement change — code

- [x] 1.1 Every toggle point keeps its on branch:
  - Add person never offers Owner, and Edit has no *Owner access* section.
  - Save carries an owner's own row unchanged.
  - An owner's row offers no Deactivate, Reactivate or Remove.
  - The `admin-accounts` function always refuses, with
    `owner_access_in_database`, a request that would provision, assign, end,
    switch off or mark as left owner access.

  The Owner role no longer flashes in Add person before the page has read its
  gates.
- [x] 1.2 The off path's code goes:
  - Edit's *Grant owner access* and *Remove owner access*, with the private
    email field and the confirmation.
  - The function's `gateOn` helper, which nothing else used.
- [x] 1.3 The key moves from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`, and out of
  the demo's gate words.
- [x] 1.4 Tests:
  - The `describeChangeGate` blocks in the Team and demo adapter suites become
    plain tests.
  - The off-path unit test of the owner-access subflow goes.
  - So does the `@cg-off` browser test *owner access is granted and removed only
    through the guarded editor flow*.
  - The `@cg-on` tag drops from `e2e/deactivate-then-leave.spec.ts`.
  - The pgTAP file and the REST probe still turn the row.
- [x] 1.5 `docs/` (OPERATIONS, ROLES_AND_PERMISSIONS, SCREENS) no longer calls the
  behaviour gated. No spec named the gate.
- [ ] 1.6 `npm run lint`, `format:check`, `typecheck`, `contrast`, `test`,
  `build`, `lint:change-gates`, `functions:typecheck`; the database and browser
  suites on Staging.
- [ ] 1.7 Release: push to `stage`, Staging green, the owner promotes.

## 2. Wait for every tablet

- [ ] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, and three services on it.

## 3. The contract migration

- [ ] 3.1 A migration headed `-- release: contract owner-access-in-the-database`.
  - Re-run the reader query first.
  - `mark_account_as_left_v2`'s owner check reads the key; rewrite it to its on
    branch.
  - Then retire the row, and update the pgTAP file and the REST probe that turn
    it.
- [ ] 3.2 Every database gate on a fresh reset; release it through the normal
  path.
