# Tasks: retire-pro-rata-pnl

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`). No gate of
its own, and no migration in the code half.

## 0. Preconditions

- [x] 0.1 The change is archived: `2026-10-31-fixed-costs-are-spread-over-the-month`.
  *(Its pull and the fake-outlet try were waived by the owner on 31 October;
  round trip `tested`.)*
- [x] 0.2 The gate is on in production and has stayed on.
  *(`change_gate_events`, read-only: on at 05:27 UTC on 21 October, nothing
  since.)*
- [x] 0.3 Nothing depends on it: no `dependsOn` in `gates.ts` names it, and its
  one dependency row went with `20261101010000_pro_rata_pnl_stands_alone.sql`. No
  function, policy, trigger or view in production reads the key.
  *(Read-only on 2 November.)*
- [x] 0.4 `part-months-cost-what-was-agreed` (gate `agreed-part-months`) has
  landed first, so the two never edit the fixed-cost surfaces at once.
  *(Deploy 41248326810 on `3a4ff1d8`; its gate on since 23:59 IST on 31 October.)*

## 1. The retirement change — code

- [x] 1.1 Every toggle point keeps its on branch: Overview's P&L tile
  (`OutletsOverview`), and `useOutletFixedCosts`, which feeds the Ledger's
  current month and the Fixed chip on Expenses and now asks only whether the
  reader may see fixed costs.
- [x] 1.2 The off path's code goes: `OverviewAdapter.month`'s `fixedCosts`
  option (live and demo). The month's read always carries the outlet's fixed
  costs.
- [x] 1.3 `pro-rata-pnl` moves from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`, and
  out of the demo's gate words.
- [x] 1.4 Tests: the `describeChangeGate` block in `fixed-costs.test.tsx` becomes
  plain tests of the on behaviour; the adapter test asking `overview_month` alone
  goes; the demo spec's `@cg-off` test goes and its `@cg-on` test is untagged; the
  signed-in round trip goes, its on half kept as a plain test that Overview asks
  the fixed costs beside its month and a payment carries the chip. The snapshot,
  build-stamp and demo-gate unit tests take `delivery-orders` as their
  example gate.
- [x] 1.5 The `outlets-overview` delta; `docs/` (DATA_MODEL, SCREENS) no longer
  calls the behaviour gated.
- [x] 1.6 `npm run lint`, `format:check`, `typecheck`, `functions:typecheck`,
  `contrast`, `test`, `build`, `lint:change-gates`; the database and browser
  suites on Staging.
  *(Locally on 2 November, rebased on `081dca99`: lint, format, typecheck,
  functions:typecheck, contrast, build and lint:change-gates clean; `npm test`
  265 files, 3324 tests, with two timing tests elsewhere failing under load and
  passing alone. Staging run 41399171206 on `c6ab7749` failed only the Overview
  link tests that `dc5570d1` had already broken (run 41397209076 on `bc752e2e`
  failed the same five). Staging run 41399222489 on `b085e587`, which fixes them
  above the three commits from `347ad72a`, passed every job: unit, database, all
  four browser suites in both states, then migrate, functions, publish and
  smoke.)*
- [x] 1.7 Release: push to `stage`, Staging green, the owner promotes. The gate's
  row is left on, so a tablet on an older build keeps the behaviour it has.
  *(Promote 41404617514 and Deploy 41404706038 on `c83ec673`, 2 November at
  07:13 UTC: the four commits from `347ad72a` are on `main` as they were on
  `stage`, beside #83's.)*

## 2. Wait for every tablet

- [ ] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, and three services on it. Overview, the Ledger and
  Expenses' Fixed chip are the owner's and managers' screens: their phones reload
  the app before the contract Promote.

## 3. The contract migration

- [ ] 3.1 A migration headed `-- release: contract pro-rata-pnl` that sets the
  gate's `retired_at` and turns it off, after re-confirming in production and on
  a fresh reset that nothing in the database reads the key. Nothing in the
  database served only the off path, so nothing is dropped.
- [ ] 3.2 Every database gate on a fresh reset; release it through the normal
  path.
