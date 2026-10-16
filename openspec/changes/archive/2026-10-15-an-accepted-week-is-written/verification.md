# Verification

Run locally on 2026-10-11 (IST), before any push.

## The defect, reproduced from production

- `aggregator_sync_runs`: the owner's Accept presses at 2026-10-10 20:52 UTC appear as two `started_by = owner` Swiggy reads, each `reconciliation_failed`; the Swiggy 1–3 Oct week stayed `disputed`, `accepted_at` null.
- The adapter sent `mode: 'accept'`; `request-aggregator-sync` read every mode but `reconnect` as `sync`; no reader in `abdatta/shawarmania-sync` sends `accepted_by`.

## The fix proved to fail without it

`85_an_accepted_week_is_written.sql` was run against the previous `ingest_aggregator_cycle` (restored from `20260831030001`, identical to production's live body): 13 checks failed — the read after acceptance, settled days, the recorded difference and its attribution, the lapse on moved figures — and the re-check of an accepted week that now reconciles aborted on `aggregator_cycle_reconciliations_acceptance_together`, the same class of refusal the old upsert would hit on `accepted_only_when_disputed`. With the new body: 43 ok.

## The clean-up, rehearsed against production

The migration's `do` block ran against production inside a transaction that was rolled back: it would remove **five** Kalyani Cafe weeks recorded before the Cafe's 1 Oct start (Zomato 14–20 Sep and 21–27 Sep, Swiggy 13–19 Sep, 20–26 Sep and 27–30 Sep), leaving the Cafe's one real week (Swiggy 1–3 Oct, disputed) and all 18 of Kalyani's own. It reported, rather than asserted, the count: two weeks became five between the first look and the rehearsal, as later reads re-recorded more.

## Gates

| Gate | Result |
|---|---|
| `npm run lint` | pass |
| `npm run format:check` | pass |
| `npm run typecheck` | pass |
| `npm run functions:typecheck` (Deno on PATH) | pass |
| `deno check` of `request-aggregator-sync` (not in the typecheck list) | 4 errors, all pre-existing and identical without this change |
| `npm test` | 189 files, 2415 tests pass |
| `npm run contrast` | pass |
| `npm run build` | pass |
| `npm run test:e2e` | 334 passed |
| `npm run db:reset` | pass; notice: removed 0 weeks (local) |
| `npm run test:db` | 85 files, 3438 tests pass, including 33, 35 and 45 unchanged |
| `npm run test:rls` | all six phases pass |
| `npm run test:e2e:auth` | 39 passed |
| `npm run db:types` + diff | regenerated output identical to the committed file |

## Release in the owner's chosen window

The owner explicitly approved releasing this fix together with the Analytics follow-up now. [Deploy 38101389058](https://github.com/abdatta/shawarmania-ops/actions/runs/38101389058) completed successfully at 2026-10-11 01:29 UTC on `f084c6b2720b7f789403000c9e24fe45c29e06fc`, after a fast-forward-only main update. All verification, production migration, Edge Function deployment and Pages jobs passed. The production migration reported removing five pre-boundary weeks and zero accepted differences. A fresh public fetch confirms the published application build `f084c6b`.

The combined source was also checked locally after rebasing: 2,436 unit/component tests, 3,438 pgTAP checks, all six RLS phases and 39 auth/billing browser tests passed, with generated types unchanged. See the [Analytics release evidence](../sales-and-menu-analytics/incomplete-intervals-verification.md) for the exact combined CI results and browser retry qualification.

## Production acceptance still pending

The release portion of task 11 is complete. The per-outlet production check and the owner's one Accept remain pending, as does the PHASE GATE that depends on them. Publication does not assert that the owner accepted the disputed week or that its resulting read settled the days.
