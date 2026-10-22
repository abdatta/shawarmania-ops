# Tasks: retire-one-revenue

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`), with
`pro-rata-pnl`'s dependency cut rather than retired. No gate of its own; one
migration in the code half, for the dependency only.

## 0. Preconditions

- [x] 0.1 The change is archived: `2026-10-21-revenue-reads-the-same-everywhere`.
  *(Its pull was waived by the owner on 21 October; round trip `none:`.)*
- [x] 0.2 The gate is on in production and has stayed on.
  *(Read from `change_gate_events`, read-only, on 21 October: on at 07:12 UTC on
  16 October, nothing since.)*
- [x] 0.3 Every gate that depends on it is retired, or stops depending on it in
  this change: `pro-rata-pnl` stops (owner, 2026-10-22). Nothing else depends on it.

## 1. The retirement change — code

- [x] 1.1 Every toggle point keeps its on branch: `OutletsOverview`, the Ledger's
  day and month readings, `AnalyticsSurface`. The old Overview card goes, with
  `overviewPeriod`; a month's `figures` becomes required.
- [x] 1.2 The off path's reads go: `OverviewAdapter.sales`, `revenue` and
  `expenses` (live and demo); the live Analytics adapter's calls to
  `sales_analytics` and `sales_analytics_series`.
- [x] 1.3 `one-revenue` moves from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`, and out
  of the demo's gate words.
- [x] 1.4 `pro-rata-pnl` loses its `dependsOn`; `20261101010000_pro_rata_pnl_stands_alone.sql`
  deletes the dependency row; `scripts/check-change-gates.mjs` reads a deleted
  dependency.
- [x] 1.5 Tests: the unit tests' off cases go and their `describeChangeGate`
  blocks become plain tests; `outlets-overview.test.tsx` is rewritten against the
  one card; `mock/overview.test.ts` reads `today` and `month`; the Ledger month
  fixture carries `figures`; the timing REST test stops comparing the old
  Overview reads (`revenue-parity.test.ts` compares the new ones). In the browser
  suites every `one-revenue` tag goes; the signed-in Analytics, Overview and
  Overview boundaries specs are deleted; the demo's day-one test is deleted and
  its Overview links test reads the one card.
- [x] 1.6 The `outlets-overview` delta; `docs/` (SCREENS, DATA_MODEL, GLOSSARY,
  LIMITATIONS, SECURITY_AND_PRIVACY, TESTING) no longer calls the behaviour gated.
- [ ] 1.7 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`,
  `npm run build`, the database gates on a fresh reset; the browser suites on
  Staging.
  *(Locally on 22 October: lint, format, typecheck, 3067 unit tests, build; on a
  fresh reset pgTAP 96 files / 4004 tests, the change-gates and ledger-timing REST
  suites; the demo browser specs `analytics`, `owner-console` and `one-revenue`
  on tablet and phone, every formerly off-tagged test included. The signed-in
  suites run on the `stage` push.)*
- [ ] 1.8 Release: push to `stage`, Staging green, the owner promotes. The gate's
  row is left on, so a tablet on an older build keeps the behaviour it has.

## 2. Wait for every tablet

- [ ] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, three services on it, and the owner's and managers'
  phones reloaded (Overview, the Ledger and Analytics are their screens). Record
  the date and the evidence.

## 3. The contract migration

- [ ] 3.1 A migration headed `-- release: contract one-revenue` that drops
  `overview_sales`, `overview_revenue`, `overview_expenses`, `sales_analytics` and
  `sales_analytics_series`, after confirming in production and on a fresh reset
  that nothing else calls them and nothing reads the key; then sets the gate's
  `retired_at` and turns it off.
- [ ] 3.2 The pgTAP tests that name the dropped functions
  (`53_overview_reads_the_business.sql`, `93_revenue_reads_the_same_everywhere.sql`
  and any other), every database gate on a fresh reset; release it.

## 4. Archive

- [ ] 4.1 Report what was retired and when, then archive.
