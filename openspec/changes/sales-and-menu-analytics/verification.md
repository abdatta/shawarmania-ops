# Verification — roadmap 71

Historical iteration. Current scope/evidence are in [metrics-verification.md](./metrics-verification.md); collectors and recommendations below were removed before publication.

Verified locally on 2026-10-08. Production data access was a read-only capability probe; no production migrations, publication, account setup or analytics writes were performed.

This report records the initial implementation. The subsequent phone-first Items/Sales redesign, replacement screenshots and repeated UI gates are recorded in `phone-verification.md`; the database, RLS, schema and website integration are unchanged by that follow-up.

## Manual work replaced

Inspected the live public outlet menu, then walked Item performance and Sales trends on phone (412 × 915) and tablet (1138 × 712) in light and dark themes. Checked the fifth navigation group, date ranges, source filters, daily/weekly/monthly grouping, reloads, CSV export, empty periods, loading/error/retry states, console errors and unexpected backend requests in demo mode. Authenticated browser tests exercise both owner and outlet-manager adapters against local Supabase.

## Completed surfaces

Both owner and outlet-manager Analytics surfaces are gated live and have typed live/demo adapters. They read one selected outlet and compare equal adjacent periods. Bill totals use explicit business dates and settled snapshots; item revenue excludes packaging and remains distinct from bill-level adjustments. Current zero-selling dishes and retired snapshots remain visible. Recorded delivery gross revenue can be included in Sales trends, with unknown/provisional imports labelled and counter-only order metrics preserved.

Recommendations use existing Highlights, dish/category ordering, descriptions, availability and menu changes. Basket-pairing and bundle recommendations are absent. Sales by category means revenue grouped by captured category names, with old missing snapshots explicitly Uncategorised. Recommendations require a baseline and describe experiments rather than claiming causation or profit.

The website Worker validates same-origin, bounded, rate-limited anonymous samples before a privileged RPC. Page-lifetime UUIDs, cumulative visible active time and maximum scroll depth are retained for 30 days; DNT/GPC opt-outs are honoured. Idle, hidden, offscreen landing-section and review-popup time are excluded. Outlet menus and owner-only brand landing samples remain separate. Rendering does not depend on ingestion succeeding.

## Issues found and fixes

- Group/source changes invalidated data without triggering another read, leaving a permanent shimmer. They now reuse the valid snapshot; week/month chart points match the table buckets.
- Group changes after an outage could hide the retry state, and selecting the same date preset did not retry. Error state is preserved and date presets explicitly retry; the authenticated outage test pins recovery.
- Demo engagement appeared in historical empty ranges. Samples now carry the demo business date and only appear when selected.
- Initial ingestion fixtures attempted a direct service-role table write that is intentionally ungranted. Tests now use the privileged ingestion RPC and remove only their own samples via the local test database.
- Windows Supabase CLI discovery exceeded the test hook deadline. Analytics discovery now occurs before the hook. CLI connection errors were retried after confirming the local database was healthy.
- Concurrent Windows test jobs caused memory pressure and unreliable timings. The full unit suite ran in an isolated Node 22 Linux container using the lockfile and standard isolated Vitest pool with one worker. No assertions were relaxed.
- The existing Ledger timing assertions failed under the loaded Windows host and near the threshold while unit tests occupied Docker. The final direct-container run passed all four unchanged assertions: day reads 476/446 ms against 500 ms; month reads 293/290 ms against 750 ms. No Ledger production code changed.
- The local authenticated-browser invocation initially extended the server build/start deadline from three to ten minutes via an ignored config. That config's directory made its preview look for `logs/dist`; the corrected invocation sets the repository working directory and serves the freshly completed real-backend production build. Test timeouts, assertions, fresh browser contexts and refusal to reuse an existing server remain unchanged.

## Checks repeated and final gates

Final relevant production changes were followed by a fresh build and the full 318-test demo browser suite. The final financial oracle was followed by all eight analytics adapter tests, typecheck and lint. The strengthened SQL oracle was followed by the full fresh-reset database suite. All six REST/RLS phases and all 38 authenticated browser tests passed. The change uses the spec-driven schema and all seven tasks are complete.

| Gate | Final evidence |
| --- | --- |
| Format before verification / format check | PASS; repository Prettier, plus final added files |
| Lint and nine repository invariants | PASS; existing React-refresh warnings only; added tests checked again |
| Typecheck | PASS, including the final financial oracle |
| Edge Function generated-schema typecheck | PASS |
| Full unit/component suite | PASS: 174 files, 2,273 tests; subsequent updated analytics file: 8/8 |
| Contrast | PASS: 64 token pairs, both themes |
| Production build | PASS: TypeScript, Vite and PWA generation |
| Demo browser suite | PASS: 318 tests, phone/tablet coverage, no retries |
| Local Supabase start and fresh reset | PASS: all migrations and seed applied |
| Database policy/contract suite | PASS: 80 files, 3,123 assertions; analytics includes 21 assertions |
| REST/RLS phases | PASS: 293 tests across all six phases (11 realtime, 220 REST, 12 billing races, 43 drawer writes, 3 counter telemetry, 4 Ledger timing/parity) |
| Authenticated browser suite | PASS: 38 tests against local Supabase, including both live Analytics roles and outage recovery; also offline billing, two tablets, provisioning and menu persistence |
| Generated schema parity | PASS: regenerated from the fresh local schema; only line endings/trailing newline normalized for comparison |
| Website Worker typecheck/tests | PASS: 5 files, 199 tests |
| Website production build/weight/secrets | PASS: 701.1 KiB first load, 1,787.3 KiB total; within budgets |
| Manual responsive/theme/console inspection | PASS: both pages, both themes, phone and tablet; no console errors or horizontal page overflow |

Ignored local evidence logs use the `analytics-*.log` prefix. UI captures are saved in the chat artifact directory under `analytics-71`, with item-performance/sales-trends × phone/tablet × light/dark PNGs. CI uses its existing verification workflow unchanged.

## Gate clauses

Navigation, deep-link reload, live/demo separation, honest empty and zero-baseline comparisons, grouped charts/tables and exports are covered by unit and browser suites. Snapshot arithmetic, void/packaging exclusions, aggregate daily totals, bounded date ranges, unsold dishes, role denial, manager foreign-outlet denial, owner-only landing access and cumulative idempotent ingestion are covered by pgTAP and real-session REST tests. Worker tests prove strict payload rejection, secret-side RPC projection, bounded requests, failed ingestion independence and collector timing exclusions.

## Limits and release

This implementation is local and unarchived, with all seven tasks checked. Roadmap sync intentionally calls unarchived work active, even when its checklist is complete. Apply the ops migration/frontend before publishing the website Worker/landing build, as documented in `docs/OPERATIONS.md`. Engagement starts accumulating after that release and has no historical backfill. It is sampled browsing activity, not unique people or purchase conversion. Server analytics excludes counter bills still waiting in an offline outbox. Delivery imports provide gross revenue, not item or order counts. Sparse samples produce baseline guidance; recipe costs and controlled experiment history are not inferred. No Google Analytics account is required.

Possible subsequent actions are `$openspec-archive-change sales-and-menu-analytics`, commit/push on request, and `$next-change`. None was performed automatically.
