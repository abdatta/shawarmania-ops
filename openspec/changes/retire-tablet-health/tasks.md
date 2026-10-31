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
- [ ] 1.6 `npm run lint`, `format:check`, `typecheck`, `functions:typecheck`,
  `contrast`, `test`, `build`, `lint:change-gates`; `test:db` on a fresh reset and
  `test:rls`; the browser suites on Staging.
- [ ] 1.7 Release: push to `stage`, Staging green, the owner promotes. The gate's
  row is left on.

## 2. Wait for every tablet

- [ ] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, and three services on it. No person's screen carried
  a toggle point. Record the date and the evidence.

## 3. The contract migration

- [ ] 3.1 A migration headed `-- release: contract tablet-health` that, after
  confirming in production and on a fresh reset what reads the key, rewrites any
  reader to its on branch, drops what only the off path used, and retires the
  row; pgTAP updated; every database gate on a fresh reset; release it.

## 4. Archive

- [ ] 4.1 Report what was retired and when, then archive.
