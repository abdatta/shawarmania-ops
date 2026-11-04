# Tasks: retire-tablet-health

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`). No gate of
its own, and no migration in the code half.

## 0. Preconditions

- [x] 0.1 The change is archived: `2026-10-31-a-release-can-be-switched-off`.
- [x] 0.2 The gate is on in production and has stayed on since its pull.
  *(Read from `change_gate_events`, read-only, on 30 October: on at 04:00 UTC on
  14 October, off at 03:53 and on at 06:15 UTC on 15 October, nothing since.)*
- [x] 0.3 Nothing depends on it in `gates.ts` or `change_gate_dependencies`.
  The fewer-requests path read it: a tablet's minute gate answers rode on the
  health report only while Tablet health was on. That reading goes with it.

## 1. The retirement change — code

- [x] 1.1 Every toggle point keeps its on branch: the Supabase client always
  counts its requests; `useDeviceHealthReport` always reports; the counter and
  kitchen roots take their minute answers from the report (`minuteRead: false`).
- [x] 1.2 The off path's code goes: `src/change-gates/use-gates-on-report.ts`.
- [x] 1.3 `tablet-health` moves from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`,
  and out of the demo's gate words and history.
- [x] 1.4 Tests: `use-device-health-report.test.tsx` becomes a plain test;
  the snapshot, build-stamp and demo-gate unit tests take `pro-rata-pnl` as their
  example second gate; `scripts/check-change-gates.test.mjs` finds it retired.
  In the browser suites the gates-off health test goes, the gates-on one is
  tagged `@cg-on:probe`, `fewer-requests.spec.ts` runs in both states, and the
  demo's probe tests read the stamp without `TH`.
- [x] 1.5 The `change-gates` and `project-scaffold` deltas (the latter on top of
  `retire-fewer-requests`' delta of the same requirement: archive that first);
  `docs/` (OPERATIONS, RELEASES) and both trees' `release` skill no longer call
  health reporting gated.
- [x] 1.6 `npm run lint`, `format:check`, `typecheck`, `functions:typecheck`,
  `contrast`, `test`, `build`, `lint:change-gates`; `test:db` on a fresh reset and
  `test:rls`; the browser suites on Staging.
  *(31 October: every quick gate clean locally; on a fresh reset `test:db` 99
  files, 4127 tests, and the REST suites but the Edge-Function ones the shared
  stack cannot serve. Staging 41162301437 passed every job on `01f82d0a`.)*
- [x] 1.7 Release: push to `stage`, Staging green, the owner promotes. The gate's
  row is left on.
  *(Promote 41164326539 and Deploy 41164443637 on `01f82d0a`, 31 October at
  03:27 UTC.)*

## 2. Wait for every tablet

- [x] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, and three services on it. No person's screen carried
  a toggle point. Record the date and the evidence.
  - 2 November 11:17 IST, production read-only: both registered devices (Cafe
    Laptop, Shawarma Kitchen) report `3648a1fc`, which contains `01f82d0a`.
    Services since Deploy 41164443637: 31 October (69 bills) and 1 November (58);
    the third is 2 November's. Nothing in production reads the key.
  - 3 November 01:31 IST, production read-only: three registered devices
    (Cafe Laptop, Conti Kitchen, Shawarma Kitchen), all reporting `c83ec673`
    (Deploy 41404706038, 2 November 07:11 UTC), which contains `01f82d0a`, as
    `git merge-base --is-ancestor` against `origin/main` confirms. Three services
    since Deploy 41164443637: 31 October (69 bills), 1 November (58) and 2 November
    (47, the last at 22:33 IST). Still nothing reads the key, in production or
    on a fresh reset.

## 3. The contract migration

- [x] 3.1 A migration headed `-- release: contract tablet-health` that, after
  confirming in production and on a fresh reset what reads the key, rewrites any
  reader to its on branch, drops what only the off path used, and retires the
  row; pgTAP updated; every database gate on a fresh reset; release it.
  *(`20261113010000_contract_tablet_health.sql` retires the row: nothing read
  the key and nothing was the off path's alone. Every database gate on a fresh
  reset on 3 November, as `retire-fewer-requests` 3.2 records. Promoted with
  `731fc8a0` above it; Deploy 41595619417 on `0fe6beed`, 3 November at 07:20
  UTC. Read in production on 4 November: the row retired at 07:21 UTC and
  off.)*

## 4. Archive

- [x] 4.1 Report what was retired and when, then archive.
  *(4 November: `tablet-health` (`TH`) retired in code on 31 October (Deploy
  41164443637) and in the database on 3 November (Deploy 41595619417). Every
  build since counts its requests and reports each minute through
  `report_device_health_v2` without asking a gate. Archived on the owner's
  word.)*
