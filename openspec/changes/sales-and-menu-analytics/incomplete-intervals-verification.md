# Incomplete intervals and visible points — verification

The owner-approved follow-up uses the selected outlet's Kolkata clock and cutover to distinguish completed, ongoing and future intervals. Filled/hollow dots are always visible with equal outer bounds. An ongoing zero/null or future interval has no dot or connecting segment. Completed zeros remain; one-day Hour axes retain unfinished hours in business-day order. Tables qualify ongoing/future values, while numeric totals and CSV stay unchanged.

## Regression and consistency evidence

The new clock-state marker regression was run against the original `HEAD` chart, with the implementation temporarily replaced and then restored. It failed: expected 7 eligible points but received 9 (`logs/analytics-clock-before.log`). The completed focused run passed 64 tests in 8 files, including all measures, midnight/exact/fractional cutovers, Day/Week selected boundaries, empty ongoing intervals, null AOV, comparison periods, equal-size no-hover dots, exact exports and read reuse.

Both outlets' partial demo snapshots reconcile to their shared captured bills: bill revenue/orders, item quantities/line revenue, categories, daily and hourly series. A deterministic 18:30 clock shows nonzero ongoing data; advancing the clock to 19:00 without changing those bills shows an ongoing zero hour. No fixture, adapter, schema, RLS, money arithmetic, offline or role-index changes were needed. No production aggregates were imported into demo or committed.

## Browser review

The focused browser regression passed all 4 phone/tablet × light/dark cases on an owned production-build preview, with no console errors or backend requests. Manual inspection on owned port 7414 covered Items and Sales daily/hourly charts, 390×844 and 1024×900 viewports, in both themes. Screenshots are local review artifacts under `analytics-release` in the task's visualization directory. Viewport overrides were reset.

The broader run exposed two superseded browser assertions: midnight hours were expected to disappear, and the current hour count assumed the day was already advanced. The assertions now verify the retained cutoff tail and use a deterministic demo clock. Final full-suite results and deployment evidence follow below once observed.

## Initial analytics verification before rebase

- Format before gates: passed.
- TypeScript, Edge Function contract types and format check: passed.
- Lint and all repository invariants: passed.
- Contrast: 78 pairs pass AA across both themes.
- Build: passed as the browser suite's production-build prerequisite.
- Full unit/component suite: 191 files / 2,431 tests pass on Windows, one worker, 1,460.53 seconds. An isolated Node 22 Linux container was prepared while the host was slow; the host finished before a second run began, so no container test result is claimed.
- Demo browser suite: 338/338 pass, one worker, no retries, 12.6 minutes. Own production-build server on 7415; offline/reconnect and update-adoption cases also pass.
- Live Analytics against local Supabase: 3/3 pass, covering owner/manager pages, bounded reads, metric/group reuse and outage recovery. An isolated build/output directory and owned port 7416 preserved the demo suite and other previews.
- The initial analytics run did not repeat the unchanged backend suite. After rebasing onto local main's delivery-settlement fix, the complete fresh database/RLS/auth/generated-type suite was run; its combined-release results are below.
- Roadmap reconciliation: 0 rows changed, already in sync.
- The final combined release is recorded below.

## Combined release after rebasing onto local main

Local main had three unpublished commits, including `an-accepted-week-is-written` and its forward migration. The owner explicitly approved releasing both changes now, including the migration's cleanup of weeks recorded before an outlet's sync start. The analytics branch rebased cleanly onto `509c5938`; local main then fast-forwarded to `f084c6b2` and pushed without a merge commit or force push. All analytics commits carry the resolved `Codex GPT-6.1 Sol` attribution. The existing delivery fix's attribution is preserved.

Fresh combined-source verification before push:

- Full Node 22 Linux unit/component suite: 191 files / 2,436 tests pass, two workers, 308.76 seconds. The isolated container used the exact tracked rebased source; it was removed after the checks.
- Format check, lint/invariants, application and Edge Function types, build, and 78 contrast pairs in both themes: pass.
- Rebased Analytics browser suite: 20/20 pass, both pages and phone/tablet in both themes, no retries, owned port 7415. The complete 338-test demo suite and 3-test live Analytics suite above preceded the rebase; the release workflow repeats the full combined browser suite.
- Fresh local database reset: pass, including `20261015000000_an_accepted_week_is_written.sql`; its cleanup removes zero weeks in local fixtures.
- pgTAP: 85 files / 3,438 tests pass.
- All six REST/RLS phases: 11 + 223 + 12 + 43 + 3 + 4 = 296 tests pass.
- Full authentication/billing browser suite: 39/39 pass, no retries, 7.1 minutes, isolated build and owned port 7416. This includes live four-role flows, offline settlement and multi-tablet isolation.
- Generated database types: regenerated; `git diff --exit-code src/data-access/database.types.ts` is clean.

## Published release

Deployment workflow [38101389058](https://github.com/abdatta/shawarmania-ops/actions/runs/38101389058) completed successfully at 2026-10-11 01:29 UTC against `f084c6b2720b7f789403000c9e24fe45c29e06fc`. All seven jobs passed: production build, the three verification jobs, forward production migration, every Edge Function and Pages publication.

CI repeated 2,436 unit/component tests, 3,438 pgTAP checks, all six REST/RLS suites and 39 authentication browser tests, with generated types clean and 78 contrast pairs passing. The full demo browser job succeeded: 336 passed first time and two unchanged manager billing-history layout cases passed on retry. Their initial vertical-shift assertions measured about 21px against an 8px limit; they are recorded as flaky, not as a retry-free run. The earlier local 338-test run passed without retries, and all Analytics browser cases passed in CI.

The production migration reported removing five weeks and zero accepted differences recorded before their outlet's sync start. The delivery fix's owner-only acceptance walkthrough remains a separate pending step in its change; publication does not claim that financial action was performed.

A fresh public fetch returned HTTP 200 and `/assets/index-DhlDgquI.js`, containing build `f084c6b` and the new interval-status code, with the old build stamp absent. After refreshing the browser's cached app, the production demo shows always-visible filled dots with radius 3.5 and an ongoing hollow dot with radius 3 plus a 1px stroke: equal outer bounds. Live Items reads successfully and its current zero day has no dot or segment; its line ends at the previous completed day. The one-day live view also omits empty ongoing/future markers. Live Sales reads successfully and ends at the previous completed day too; both live pages and the production demo have no console warnings or errors. Production screenshots are local review artifacts (`production-items-published.png` and `production-items-zero-ongoing.png`); no production dump or screenshot is committed.

Release evidence and the completed Analytics phase gate are committed separately as prose, so the served build continues to identify the application release above. The change stays unarchived.
