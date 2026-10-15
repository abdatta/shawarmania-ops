# Pattern headings and redundancy review

## Manual checks replaced

Check the Revenue/Orders/AOV picker changes both visible pattern headings and chart accessibility labels; inspect weekday and clock-hour point values, zero-sales dates and weighted AOV; check phone/tablet light and dark layouts; reload the existing public demo.

## Completed autonomously

Updated the Sales pattern cards without removing any chart. Revenue/Orders now name daily averages by weekday and per-day hourly averages. AOV names Average bill by weekday/hour and remains weighted counter revenue/orders. Main Hour grouping, period rows and CSV retain counter totals. The hourly derivation reuses the bounded RPC snapshot and adds no reads or transferred bytes. No database, auth, adapter, menu website or production changes in this follow-up.

The owner's additional visual direction replaces hatch patterns with solid orange/slate/blue/violet series, rounded spaced bars, numbered legends/details and a selected-hour highlight. The lower chart focuses on trading hours across all periods plus one neighboring hour on each side; internal zeros remain and empty data keeps the full axis. Main Hour totals/table remain complete. Updated lower-card shimmer heights and added all four legend-badge pairs to the theme contrast gate.

## Issues found and fixes

Weekdays/Hours hid the measure and aggregation. Hourly totals could not honestly carry an average title. Headings and accessible names now follow the metric; bottom hourly Revenue/Orders divide by the inclusive range day count, including zero-sales dates. AOV stays weighted and null without orders. No averaging of averages.

The focused test initially used the wrong Testing Library query name; corrected it and repeated the tests/build. Review of the 1d edge case also found duplicate end/start ticks and a React key warning when the axis had one date. It now renders one centered tick, pinned by an inspection test. Earlier broad runs were stopped for the incoming visual direction and these fixes; final runs use the same final source manifest in the host and Linux test container.

The first completed broad unit run exposed two support files omitted from the Linux copy (Supabase config and the brand PNG), plus four existing menu test timeouts under parallel host load. Corrected the copy and repeated all affected suites with one worker: 60/60 passed. The demo run passed 319/320; its offline demonstrator test lost the seeded bill to the 400 ms send before the offline control finished. Both offline queue setups now pause the browser clock before mounting the counter and resume after going offline. All original six-bill and exactly-once assertions remain; all four tablet/desktop rechecks pass. Application billing behavior, assertions and timeouts are unchanged.

## Redundancy assessment (no removal)

- Main Day trend answers whether sales rise/fall over actual dates; retain it.
- Daily average by weekday answers recurring day-of-week patterns, useful over 30d. On 7d each weekday occurs once, so this largely reorders the main Day chart. Consider a secondary Patterns view or shorter collapsed presentation later.
- Hourly columns identify the daily clock-hour pattern and are worth retaining. Main Hour grouping shows the same underlying distribution as totals rather than averages. Consider having Hour select the column chart in the main card rather than rendering two versions; preserve the requested Hour option.
- Period bars and Table & export repeat the main chart figures. The bars are the clearest candidate to fold into the existing expandable table, keeping precise values and export available.

## Rechecks

Focused Analytics component tests pass: nine tests, including a 15-day range with three Thursdays and a zero-sale Thursday, unequal order counts, absent-order AOV, two historical hourly windows, solid four-period columns, a centered single-day point, and unchanged total export. The combined menu/support-file/chart recheck passes 60/60; offline browser rechecks pass 4/4. Full suites are repeated with one worker each after these corrections.

## Gates

- Lint: PASS; ESLint warnings are pre-existing non-blocking Fast Refresh warnings, with zero errors, and all nine repository invariant checks pass.
- Format: PASS; `prettier --check .` passes.
- Typecheck and Edge Function types: PASS.
- Unit/component suite: PASS; 175 files / 2,285 tests in the isolated official Node 22 Linux container. Host/container application manifests match across 504 files at SHA-256 `dbeedf895cc9bf12f50301132b7afc0b255878eb3de5010d07c79d20808d414e`.
- Contrast: PASS; 72 light/dark semantic data-series pairs.
- Production build/PWA: PASS; dummy backend configuration, with the existing chunk-size advisory only.
- Full demo browser suite: PASS; 320/320 with one worker, including phone navigation, four-period Analytics, demo isolation and offline queue regression coverage.
- Focused Analytics/counter rechecks: PASS; 60/60 unit/support/chart checks and 4/4 tablet/desktop offline queue checks.
- Database, RLS, auth and schema contracts: RETAINED PASS from the unchanged baseline evidence above.

The application source, SQL, authority checks and adapter contract are unchanged by the final test determinism fix. The test fix only pauses Playwright's browser clock before the seeded 400 ms demo send, then resumes after the offline state is established; original queue counts, exactly-once and reconnect assertions remain intact.

The unchanged database/auth contract retains the completed evidence in metrics-verification.md: fresh local reset; 80 pgTAP files / 3,116 assertions; 293 checks across six REST/RLS phases; 38 authenticated browser cases; and byte-exact generated schema parity. This follow-up changes chart presentation and display derivation, not the SQL, authority, adapter, generated types or authenticated routes, so those suites are not repeated here.

## Review artifacts

Phone (390 × 844) and portrait tablet (768 × 1024) checks pass in both themes with two and four comparison periods, all three metrics and no horizontal overflow or browser warnings/errors. The single-day final build displays one centered date tick and inspectable current/prior values. Averages include zero-sales dates; absent-order AOV remains a gap.

Captures are saved in C:/Users/iamro/.codex/visualizations/2026/10/08/01a11d5f-1c0e-77d2-949a-4e068571e19c/analytics-71-v4. Files include sales-two-periods-dark.jpg, sales-four-periods-dark.jpg, sales-four-periods-light.jpg, sales-tablet-aov-dark.jpg, sales-tablet-aov-light.jpg and sales-single-day-light.jpg. The two phone four-period captures show selected 19:00 averages and all four numbered range/value details.

The existing public preview is https://wizard-robots-gossip-period.trycloudflare.com/shawarmania-ops/demo/owner/analytics/sales. It serves fabricated data with unusable backend credentials and keeps its URL. User dev server 7412 and owned public preview/tunnel 7417 are preserved. Temporary test previews use 7415. The user-facing browser tab is retained and temporary viewport overrides are reset.

## Limitations

Hourly timing is counter-only because delivery imports have no order timestamps. Revenue by weekday includes recorded delivery gross; missing imports remain unknown. No chart removal, production deployment or archive. The user requests committing and pushing the verified change on `feat/analytics-71`.
