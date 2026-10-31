# Tasks: retire-fewer-requests

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`). No gate of
its own, and no migration in the code half.

## 0. Preconditions

- [x] 0.1 The change is archived: `2026-10-30-the-app-asks-the-server-less`.
  *(Its pull and the full log cycle's reading were waived by the owner on 30
  October; round trip `none:`.)*
- [x] 0.2 The gate is on in production and has stayed on.
  *(Read from `change_gate_events`, read-only, on 30 October: on at 07:11 UTC on
  16 October, nothing since.)*
- [x] 0.3 Nothing depends on it: no `dependsOn` in `gates.ts`, no
  `change_gate_dependencies` row, and no function, policy, trigger or view in
  production reads the key.

## 1. The retirement change — code

- [x] 1.1 Every toggle point keeps its on branch: `DishKitchenBoardScreen`,
  `BillingCounter`, `ExpenseList`, `useSharedRead`, the aggregator sync surface,
  and `useGatesOnHealthReport`, which now answers Tablet health alone.
- [x] 1.2 The off path's code goes: `subscribeToOutletBilling` and
  `ChangeGatesAdapter.reportHealth` (live and demo), and
  `useDeviceHealthReport`'s `carriesGates`.
- [x] 1.3 `fewer-requests` moves from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`,
  and out of the demo's gate words.
- [x] 1.4 Tests: the `describeChangeGate` blocks become plain tests; the counter's
  nudge tests use the table-naming channel; `e2e-auth/fewer-requests.spec.ts` is
  retagged `@cg-on:tablet-health`.
- [x] 1.5 The `project-scaffold` delta; `docs/` (ARCHITECTURE, RELEASES, TESTING)
  no longer calls the behaviour gated.
- [x] 1.6 `npm run lint`, `format:check`, `typecheck`, `functions:typecheck`,
  `contrast`, `test`, `build`, `lint:change-gates`; `test:db` on a fresh reset and
  `test:rls`; the browser and Edge-Function REST suites on Staging.
  *(Locally on 30–31 October: lint, format, typecheck, functions:typecheck,
  contrast, build and lint:change-gates clean; `npm test` 262 files, 3159 tests.
  On a fresh reset `test:db` 99 files, 4127 tests, one failure that is not this
  change: `93_revenue_reads_the_same_everywhere.sql` test 12 expects a month
  comparison cut, and on the 31st, after a 30-day month, the comparison clamps
  and has none. `test:rls` green but for the three Edge-Function suites, which
  503 on the shared local stack; they are read from Staging. Staging run 41151093769 on
  `0488b74c`, above the three commits from `1b04f8d0`, passed every job on 31
  October: unit, database, all four browser suites in both states, then migrate,
  functions, publish and smoke.)*
- [x] 1.7 Release: push to `stage`, Staging green, the owner promotes. The gate's
  row is left on, so a tablet on an older build keeps the behaviour it has.
  *(Promote 41154746076 and Deploy 41154842156 on `0488b74c`, 31 October at
  01:20 UTC.)*

## 2. Wait for every tablet

- [ ] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, and three services on it. No person's screen
  carried a toggle point the owner's phone runs, except the shared counts and the
  aggregator sync page: the owner and managers reload the app before the
  contract Promote.

## 3. The contract migration

- [ ] 3.1 A migration headed `-- release: contract fewer-requests` that sets the
  gate's `retired_at` and turns it off, after confirming in production and on a
  fresh reset that nothing reads the key. It may revoke `authenticated`'s execute
  on `report_device_health` (v1), which only builds before the change called;
  `report_device_health_v2` still calls it, so it is not dropped.
- [ ] 3.2 The pgTAP and REST tests that call v1 as a tablet
  (`86_a_release_can_be_switched_off.sql`, `rest/zz-change-gates.test.ts`) call
  v2, if 3.1 revokes; every database gate on a fresh reset.
- [ ] 3.3 Release it through the normal path.
