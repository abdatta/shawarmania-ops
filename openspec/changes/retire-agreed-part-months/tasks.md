# Tasks: retire-agreed-part-months

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`). No gate of
its own, and no migration in the code half.

## 0. Preconditions

- [x] 0.1 The change is archived: `part-months-cost-what-was-agreed`, on 12
  November, the pull waived under the owner's rule of 30 October.
- [x] 0.2 The gate is on in production and has stayed on.
  *(`change_gate_events`: on at 23:59 IST on 31 October, nothing since; read on
  12 November.)*
- [x] 0.3 Nothing depends on it.
- [x] 0.4 The owner's "happy to retire it": 12 November, "go ahead" to retiring
  AM, TK and DO.

## 1. The retirement change — code

- [x] 1.1 Every toggle point keeps its on branch: the Fixed list keeps a stopped
  cost in its place and puts the rest behind *Stopped · N · Show*; a row says
  *Stopped*, never a day count, and greys once done; Stop is the closing sheet;
  Add and Edit ask what a mid-month first month comes to; a cost's months read
  *closing* or *first month* with **Change**.
- [x] 1.2 The off path's code goes: the old Stop sheet and the adapter's `stop`
  (live and demo, which called `stop_fixed_cost`), the *Stopped* section, the
  day counts and *we pay only for the days from*.
- [x] 1.3 The key moves from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`, and out of
  the demo's gate words.
- [x] 1.4 Tests: the `describeChangeGate` block in `fixed-costs.test.tsx` becomes
  plain tests of the on behaviour, its off branches gone; the one test of a cost
  stopped before the change sets the stop on the demo row, as the old Stop
  left it. The `@cg-on` tag drops from `e2e/fixed-costs.spec.ts`.
- [x] 1.5 The `fixed-costs` delta; `docs/` (DATA_MODEL, SCREENS) no longer calls
  the behaviour gated.
- [x] 1.6 `npm run lint`, `format:check`, `typecheck`, `contrast`, `test`,
  `build`, `lint:change-gates`; the database and browser suites on Staging.
  *(12 November: every local gate green, 3,374 unit tests; Staging run
  43178344123 green on `aa102720`, every database, demo and auth browser job.)*
- [x] 1.7 Release: push to `stage`, Staging green, the owner promotes. The row is
  left on, so a page on an older build keeps the behaviour it has.
  *(Promote run 43190557656 moved `main` to `f632cc42`; Deploy run 43190699464
  green at 22:52 IST on 12 November, migrate included.)*

## 2. Wait for every tablet

- [ ] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, and three services on it. Fixed costs are the
  owner's and managers' screens, so their phones reload the app before the
  contract Promote.

## 3. The contract migration

- [ ] 3.1 A migration headed `-- release: contract agreed-part-months`. Re-run the
  reader query in production and on a fresh reset first; rewrite any reader to
  its on branch, then retire the row. `stop_fixed_cost` and `stop_fixed_cost_v2`
  are called by no build from this one on, so the migration may drop them once
  no older build is left; `fixed_cost_month_cost` keeps its day-share fallback.
- [ ] 3.2 Every database gate on a fresh reset; release it through the normal
  path.
