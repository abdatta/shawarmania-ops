# Tasks: retire-deactivate-then-leave

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`). No gate of
its own, and no migration in the code half. Retired together with
`retire-owner-access-in-the-database`, in one commit.

## 0. Preconditions

- [x] 0.1 The change is archived: `a-deactivated-person-leaves-in-two-steps`
  (#82), on 12 November, the pull waived under the owner's rule of 30 October
  and staging standing in for production use (the owner, 12 November).
- [x] 0.2 The gate is on in production and has stayed on.
  _(`change_gate_events`: on at 13:06 IST on 3 November, nothing since; read on
  12 November.)_
- [x] 0.3 Nothing depends on it.
- [x] 0.4 The owner's "happy to retire it": 12 November, "Yes, retire both".

## 1. The retirement change — code

- [x] 1.1 Every toggle point keeps its on branch:
  - Team lists the people who may sign in, under it *Deactivated · N*, where
    the menu is Reactivate and Remove.
  - Deactivate's words say they move to Deactivated, and it says so with Undo.
  - By day lists a deactivated person only through their day, and By staff's
    month stops there.
  - The `admin-accounts` function no longer asks before `mark-as-left-v2`.
- [x] 1.2 The off path's code goes:
  - *Show people who have left*.
  - Edit's *Leaving the business* with the one-step Mark as left dialog.
  - The old Deactivate words.
  - The adapter's `markAsLeft`, live and demo. The function keeps its
    `mark-as-left` action for a build from before #82, which no build since
    calls.
  - The demo's `accountGates` option.
- [x] 1.3 The key moves from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`, and out of
  the demo's gate words.
- [x] 1.4 Tests:
  - The `describeChangeGate` blocks in the Team, attendance and demo adapter
    suites become plain tests of the on behaviour.
  - The `@cg-off` browser tests are deleted:
    - *the people states* in `e2e/setup.spec.ts`;
    - the departure end of *promotes, expands* in `e2e-auth/auth.spec.ts`,
      whose remainder stays untagged;
    - and *deactivation ends an open session*, which now runs untagged with
      today's words.
  - The `@cg-on` tags drop from `e2e/deactivate-then-leave.spec.ts`.
  - The snapshot, build stamp and demo switchboard tests use `probe`, the one
    gate left.
  - `supabase/tests/99_a_deactivated_person_leaves_in_two_steps.sql` and the
    REST probe still turn the row, which the database reads until the contract
    migration.
- [x] 1.5 `docs/` (DATA_MODEL, OPERATIONS, ROLES_AND_PERMISSIONS, SCREENS) no
  longer calls the behaviour gated. No spec named the gate.
- [ ] 1.6 `npm run lint`, `format:check`, `typecheck`, `contrast`, `test`,
  `build`, `lint:change-gates`, `functions:typecheck`; the database and browser
  suites on Staging.
- [ ] 1.7 Release: push to `stage`, Staging green, the owner promotes. The row is
  left on, so a page on an older build keeps the behaviour it has.

## 2. Wait for every tablet

- [ ] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, and three services on it. Team and Attendance are
  the owner's and managers' screens, so their phones reload the app before the
  contract Promote.

## 3. The contract migration

- [ ] 3.1 A migration headed `-- release: contract deactivate-then-leave`.
  - Re-run the reader query in production and on a fresh reset first.
  - `mark_account_as_left_v2` refuses while the gate is off; it keeps its on
    branch.
  - Then retire the row, and update the pgTAP file and the REST probe that turn
    it.
- [ ] 3.2 Every database gate on a fresh reset; release it through the normal
  path.
