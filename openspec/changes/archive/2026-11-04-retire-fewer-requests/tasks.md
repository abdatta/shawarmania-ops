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

- [x] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, and three services on it. No person's screen
  carried a toggle point the owner's phone runs, except the shared counts and the
  aggregator sync page: the owner and managers reload the app before the
  contract Promote.
  - 2 November 11:17 IST, production read-only: both registered devices (Cafe
    Laptop, Shawarma Kitchen) report `3648a1fc`, which contains `0488b74c`.
    Services since Deploy 41154842156: 31 October (69 bills) and 1 November (58);
    the third is 2 November's. The owner's browser runs `51952434`. Nothing in
    production reads the key (functions, policies, triggers, views).
  - 3 November 01:31 IST, production read-only: three registered devices
    (Cafe Laptop, Conti Kitchen, Shawarma Kitchen), all reporting `c83ec673`
    (Deploy 41404706038, 2 November 07:11 UTC), which contains `0488b74c`, as
    `git merge-base --is-ancestor` against `origin/main` confirms. Three services
    since Deploy 41154842156: 31 October (69 bills), 1 November (58) and 2 November
    (47, the last at 22:33 IST). Still nothing reads the key, in production or
    on a fresh reset. Whether every manager's phone reloaded before the
    Promote was not confirmed; any that had not picks the build up on its next
    load.

## 3. The contract migration

- [x] 3.1 A migration headed `-- release: contract fewer-requests` that sets the
  gate's `retired_at` and turns it off, after confirming in production and on a
  fresh reset that nothing reads the key. It may revoke `authenticated`'s execute
  on `report_device_health` (v1), which only builds before the change called;
  `report_device_health_v2` still calls it, so it is not dropped.
  *(`20261113000000_contract_fewer_requests.sql`: revokes v1 from
  `authenticated` and retires the row.)*
- [x] 3.2 The pgTAP and REST tests that call v1 as a tablet
  (`86_a_release_can_be_switched_off.sql`, `rest/zz-change-gates.test.ts`) call
  v2, if 3.1 revokes; every database gate on a fresh reset.
  *(Both call v2, and `86` adds that a tablet can no longer call v1;
  `92`'s off-gate example is a test gate now that `fewer-requests` is
  retired. 3 November, fresh reset: `test:db` 101 files, 4333 tests, pass;
  every REST suite passes but `account-flows`, whose four failures come from
  another worktree's unfinished `admin-accounts` that the shared Edge runtime
  serves, read from Staging instead.)*
- [x] 3.3 Release it through the normal path.
  *(Promoted with `731fc8a0` above it; Deploy 41595619417 on `0fe6beed`, 3
  November at 07:20 UTC. Read in production on 4 November: the row retired at
  07:21 UTC and off.)*
