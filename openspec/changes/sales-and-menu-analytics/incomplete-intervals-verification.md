# Incomplete intervals and visible points — verification

The owner-approved follow-up uses the selected outlet's Kolkata clock and cutover to distinguish completed, ongoing and future intervals. Filled/hollow dots are always visible with equal outer bounds. An ongoing zero/null or future interval has no dot or connecting segment. Completed zeros remain; one-day Hour axes retain unfinished hours in business-day order. Tables qualify ongoing/future values, while numeric totals and CSV stay unchanged.

## Regression and consistency evidence

The new clock-state marker regression was run against the original `HEAD` chart, with the implementation temporarily replaced and then restored. It failed: expected 7 eligible points but received 9 (`logs/analytics-clock-before.log`). The completed focused run passed 64 tests in 8 files, including all measures, midnight/exact/fractional cutovers, Day/Week selected boundaries, empty ongoing intervals, null AOV, comparison periods, equal-size no-hover dots, exact exports and read reuse.

Both outlets' partial demo snapshots reconcile to their shared captured bills: bill revenue/orders, item quantities/line revenue, categories, daily and hourly series. A deterministic 18:30 clock shows nonzero ongoing data; advancing the clock to 19:00 without changing those bills shows an ongoing zero hour. No fixture, adapter, schema, RLS, money arithmetic, offline or role-index changes were needed. No production aggregates were imported into demo or committed.

## Browser review

The focused browser regression passed all 4 phone/tablet × light/dark cases on an owned production-build preview, with no console errors or backend requests. Manual inspection on owned port 7414 covered Items and Sales daily/hourly charts, 390×844 and 1024×900 viewports, in both themes. Screenshots are local review artifacts under `analytics-release` in the task's visualization directory. Viewport overrides were reset.

The broader run exposed two superseded browser assertions: midnight hours were expected to disappear, and the current hour count assumed the day was already advanced. The assertions now verify the retained cutoff tail and use a deterministic demo clock. Final full-suite results and deployment evidence follow below once observed.

## Release gates

- Format before gates: passed.
- TypeScript, Edge Function contract types and format check: passed.
- Lint and all repository invariants: passed.
- Contrast: 78 pairs pass AA across both themes.
- Build: passed as the browser suite's production-build prerequisite.
- Full unit/component suite: 191 files / 2,431 tests pass on Windows, one worker, 1,460.53 seconds. An isolated Node 22 Linux container was prepared while the host was slow; the host finished before a second run began, so no container test result is claimed.
- Demo browser suite: 338/338 pass, one worker, no retries, 12.6 minutes. Own production-build server on 7415; offline/reconnect and update-adoption cases also pass.
- Live Analytics against local Supabase: 3/3 pass, covering owner/manager pages, bounded reads, metric/group reuse and outage recovery. An isolated build/output directory and owned port 7416 preserved the demo suite and other previews.
- Fresh database/RLS/auth/generated-type suite: unchanged backend/demo seam; not rerun locally for this follow-up. The release workflow must pass its fresh database job before publication.
- Roadmap reconciliation: 0 rows changed, already in sync.
- Deployment: pending successful local verification and the gated fast-forward-only main push.
