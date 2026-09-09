# Verification: Overview reads the business

Verified locally on 2026-09-08. This report covers the demo and real-adapter paths against the local Supabase stack. It does not claim a production deployment or production-scale timing.

## User paths checked

- Inspected Overview at 390 × 844 and 1080 × 810 in light and dark, for demo and a signed-in owner. Checked density, overflow, Open/Closed dots, financial explanations and attention rows. A signed-in manager sees only their assigned outlet.
- Followed sales to Billing, cash to Drawer, status to Tablets, and monthly figures to the scoped Ledger. Reload preserves the selected Ledger month. October 1 opens full September, while today's sales remain October 1.
- Delayed monthly responses deliberately: sales and Drawer arrive while monthly cells keep their shimmers. Component tests also delay expenses and comparison independently and retry one failed cell without replacing successful cells.
- Compared attendance and delivery summary rows with navigation counts. Three blocked integrations produce one row and badge count of 3, even when the same integration affects multiple outlets. Demo keeps its permanent banner and makes no external requests.

- Iterated the layout in the browser before the final test runs: compact inset cards, larger text and icon tiles, fixed neutral tender icons, and directional green/red revenue and P&L icons. Inspected synthetic six-digit totals including -₹9,99,999.99 displayed as -₹9,99,999 in both phone themes; amounts cleared their icons and all eight captions stayed on one line. Restored normal demo data afterwards. Overview alone omits paise at the display edge; source values are unchanged. Browser assertions also prove both outlet cards and the two attention rows stay above the phone navigation.

## Completed implementation

Both Overview modes use the same four-cell outlet cards and typed adapter contract. Read-only SQL aggregates use settled bills, effective tender allocations, effective expenses, daily delivery figures and the existing drawer interval readers. Each function checks owner or assigned-manager authority before reading; no table or RLS policy was added or widened. The existing one-minute tablet heartbeat remains; Overview presence uses a separate three-minute window.

Monthly periods end on yesterday's explicit outlet business date. The first business day shows the previous full month; comparisons clamp shorter months and omit misleading zero/missing/provisional baselines. Drawer explanations preserve Last Left and spent since the last count. Attention summaries reuse navigation sources and permissions, including Hyperpure and one issue per blocked integration.

## Issues found and fixes

- Old landing tests still expected “All outlets”; updated them for the agreed Overview contract.
- A range-based demo test depended on the current date to contain historical fixtures. Gave that test an explicit clock, preserving its substantive assertion.
- The new live test initially assumed the seed contained a counted drawer. It now asserts an independently loaded Drawer link, including the valid “Not counted yet” case.
- Strengthened SQL coverage with explicit nonzero delivery amounts, both outlets, an excluded following day, unknown commission and missing expected channel-days. The fixture obeys the database's requirement that unknown commission also has unknown net.
- Matched demo financial permissions to live owner/manager permissions and tested rejection for Biller and Employee.
- Existing receipt and two-tablet test fixtures confuse UTC dates with outlet business dates near cutover. An expired seeded shift also affected a run after a long pause. Recorded these separate harness issues in `openspec/todos/database-tests-cross-the-business-cutover.md`; retained production validation and restored the local database timezone to UTC.
- Raw `npm run lint` reads pre-existing Git-ignored diagnostic scripts under `logs/` and fails on those files. They were preserved. ESLint excluding only that scratch directory and all six repository invariant scripts pass.
- Production showed one Delivery issue while Zomato, Hyperpure and Swiggy were all quiet. The shared badge predicate treated Hyperpure's elapsed `session_expires_at` estimate as a proven lapse, contradicting the reader contract that deliberately tries elapsed sessions until the provider rejects one. Removed that inference and pinned the exact expired-but-healthy state at the Overview/navigation boundary.

## Reverification

Repeated unit/component tests, browser tests, formatting, TypeScript/build, Edge Function typechecking, contrast and the database suites after the relevant fixes. Ran a fresh reset before pgTAP and REST/RLS in their required order. Generated types matched the reset schema byte-for-byte. OpenSpec strict validation and roadmap reconciliation pass.

## Gate results

| Gate | Result |
| --- | --- |
| ESLint | PASS for repository/change files with only `logs/**` excluded; raw command caveat above |
| Six lint invariants | PASS: tokens, backlog index, spec index, function declarations, bill totals, discount rows |
| `format:check` | PASS |
| `typecheck` | PASS |
| `functions:typecheck` | PASS |
| `npm test` | PASS: 142 files, 1,741 tests |
| `contrast` | PASS: 52 pairs across light/dark |
| `build` | PASS: production builds used by both browser suites; existing large-chunk warning |
| `test:e2e` | PASS: 264 tests |
| `db:reset` and `test:db` | PASS: fresh reset, 58 files and 2,300 pgTAP tests |
| `test:rls` | PASS: 250 probes across all six phases, after pgTAP |
| `test:e2e:auth` | PASS: 24 tests, including real offline settlement, simultaneous tablets and both new Overview tests |
| Generated schema | PASS: byte-for-byte regeneration match |
| OpenSpec and roadmap | PASS: strict validation; roadmap already reconciled |
| UI and demo isolation | PASS: both modes, both sizes/themes; no page errors or failed Overview RPCs in the focused live walk |

## Query cost and limits

On the small local seed, SQL execution measured approximately 8.9 ms for today's sales, 2.9 ms for monthly revenue, 1.4 ms for expenses and 2.1 ms for Drawer. A separate REST measurement returned the three financial aggregate reads together in 18–20 ms versus 221–404 ms for the existing full Ledger month reader. That August seed period is empty; these figures establish local overhead, not scaling under real trading volume. SQL tests separately prove nonzero financial behavior, and demo tests compare real scenario figures against Ledger and Drawer.

Monthly totals and comparison are bounded date-range aggregates, without loading a full day statement for every date. Drawer work grows with movements since its last physical count. Delivery attention retains the existing event/reconciliation readers, so it can arrive later; it never blocks financial cards. Production-volume load testing remains unperformed.

P&L is an operating estimate using the existing Ledger basis. Missing delivery days and unsettled commission remain visible qualifications. Activated registered spares count toward the expected tablet total; presence does not assert that a person has an active shift. The change remains unarchived. The owner requested a local commit after verification, with no push or deployment.

## Typography amendment

The owner requested extra emphasis after the initial commit: 22px headlines are extra-bold, smaller 18px headlines are bold, and supporting monetary values, percentages and metric headings are bold. Inspected phone and tablet in both themes, with all eight phone captions remaining one line. Re-ran the seven Overview component tests and 16 Overview browser cases, including the production build, scoped links and viewport fit. Focused ESLint and formatting pass. Earlier backend verification remains applicable because this amendment changes presentation only. Today’s sales continues to use the outlet’s configured business-day cutover and stored bill business dates.

## Regression coverage follow-up

The follow-up adds 25 unit/component cases, five pgTAP assertions and four live-adapter browser cases. The original coverage remains in place.

| Contract | Regression evidence |
| --- | --- |
| Business day and month rollover | Component reads at midnight, 03:59:59 and 04:00; an already-open page crosses 04:00; differing outlet cutovers; SQL fixtures with explicit nonzero midnight, 03:59 and 04:00 allocations and an excluded void |
| Independent asynchronous reads | Existing delayed financial readers and local retry; new superseded-outlet/request rejection and foreground refresh/unmount tests |
| Monthly qualification | Zero baseline, incomplete/provisional current or previous periods, comparison failure, neutral zero growth/break-even and no-sales P&L; existing leap-year and shorter-month tests |
| Tablets | All/some/none dots and source links, pending/failed status, one-minute visible polling and hidden-tab suppression; existing three-minute freshness boundary |
| Attention | Zero through three blocked integrations produce one row matching the badge, then disappear when resolved; OTP, advisory expiry and abandoned-run boundaries; existing attendance grouping and manager permissions |
| Density and typography | Four phone/theme browser combinations with six-digit positive/negative amounts, icon clearance, bold headers/headlines and one-line subtexts; existing demo/live phone/tablet walks and source navigation |

The new browser case first failed because the revenue comparison's inline flex baseline made its caption taller than one text line. Block flex restores the one-line height; zero growth also uses a neutral dash. The change does not alter money arithmetic or the placeholder shape. SQL fixtures include actual payment allocations rather than relying on an empty seed total.

The owner requested a commit before a complete CI rehearsal. That rehearsal uses the committed checkout and the commands in `verify.yml`, with `CI=true`, one initial fresh database and uninterrupted pgTAP → six REST phases → auth E2E → generated types. Its results are reported after the commit rather than claimed in advance here.

## Production badge regression

Reproduced before the fix with Hyperpure holding a session, a recent successful run and an elapsed advisory expiry: Overview rendered `1 delivery issue` while no actionable channel work existed. The focused test failed on that invented row before the predicate change and passed afterwards; the domain test now asserts that the timestamp alone is not intervention evidence. Re-ran all 1,741 unit/component tests, TypeScript, Edge Function typechecking, formatting, contrast, the production build, focused and repository source lint, all six invariant lint scripts, and all 264 E2E tests. Database/RLS/auth suites were not repeated because this correction changes no database, policy, schema, authentication, money or write path.

## Approved spacing and Hyperpure-family follow-up

The outlet identity/status header now gives the store tile, text and status control more room, with a larger tap target and a status shimmer that reserves the loaded pill's new shape. The owner approved the browser iteration. Re-inspected the phone layout directly in light and dark; the production-browser suite also covered Overview at phone and tablet sizes in both themes with no overflow or console failures.

Delivery attention now has one shared Hyperpure read. Hyperpure belongs to the Zomato family because that is where its repair control lives: a Hyperpure-only failure produces `1` on collapsed Setup, `1` on Delivery and Overview, `1` on the Zomato switch, and a reachable `1` on each outlet scope while Swiggy stays at zero. The repeated scoped badges are routes to the same account-level repair and are never added into the distinct top-level total. A focused regression proves that complete path, and the advisory-expiry regression remains at zero everywhere.

Re-ran 142 unit/component files with 1,743 passing tests, all 264 production-browser tests, formatting, TypeScript, Edge Function typechecking, contrast, production build, strict OpenSpec validation, source lint and all six lint invariants. Raw `npm run lint` continues to fail only on the same Git-ignored browser diagnostics under `logs/**`; repository/change source lint has zero errors. A fresh local auth run could not start because Windows currently reserves port 54322; this follow-up changes no backend/auth path, and the deploy workflow will run the fresh database, RLS and auth jobs before publication.
