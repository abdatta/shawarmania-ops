# Phone-first verification — roadmap 71

Historical iteration. Current scope/evidence are in [metrics-verification.md](./metrics-verification.md).

Historical evidence for the initial phone layout. The later owner-directed ranking and mature-demo follow-up is recorded in scroll-verification.md and supersedes the separate boards described below.

This follow-up implements the owner's Items/Sales redesign. The original database, RLS, aggregate adapters and public-menu collector are unchanged; their evidence remains in `verification.md`. No production write, deployment, commit, push or archive was performed.

## Manual work replaced

Reviewed the app's overview, billing, attendance, menu, team, outlets, customers, delivery, drawer, expenses and Ledger patterns. Reused PeriodBar/DayField, FormSheet, Chip, Explain, cards and split summaries. Inspected both Analytics pages on a 390 × 844 phone and a 1138 × 712 tablet in both themes, with console and overflow checks. Browser tests also cover the repository's phone and tablet projects.

## Completed

Items shows Best and Worst together before the phone's bottom navigation, with full dish names and a shared unit scale. Searchable All/Rising/Slow/Unsold rows expose every dish. A searchable two-choice sheet opens paired unit, order and prior-period bars. Category bars, browsing rings and compact Ideas follow; explanations, exact revenue details and CSV expand on demand. Outlet revenue and average bill appear on Sales only.

Sales uses a capped comparison chart, compact order/bill summaries, period bars, weekday columns and an hourly histogram. Date shortcuts and a calendar sheet replace large date inputs; source/group choice sheets replace native dropdowns. Both pages open at the top through navigation, and loading placeholders reserve the revised shapes.

## Issues and fixes

- Removed the text-heavy introductory blocks and unrelated summary cards from Items.
- Capped the chart after tablet inspection exposed excessive scaling on wide screens.
- Reset page scroll when entering either Analytics page; regression checks navigate from scrolled content and assert the page starts at zero.
- Normalised malformed date-link drafts before opening DayField; invalid URLs recover through Apply dates without a browser exception.
- Kept error/retry controls independent of grouping and source selection. Authenticated outage recovery is checked against local Supabase.
- Preserved full names, zero sellers, current availability/retirement signals, equal-period comparisons and sparse-data guidance.
- The first full auth rerun found four bills under the two-tablet test's fixed customer names: two retained from the earlier verified run and two newly created. Its exact-two assertion correctly refused the reused fixture. On the fresh local fixture, the unchanged two-tablet check passed. No billing code or test assertion was changed; the local rerun requirement is now recorded in `docs/TESTING.md`.
- The first local reset failed during Supabase's internal-schema bootstrap with a duplicate migration version. The normal stop/start restored service health but retained that incomplete schema, so the repo-scoped CLI `db:stop -- --project-id shawarmania-ops --no-backup` recreated the disposable fixture before a clean `db:start`. Production was untouched. A composed command to selectively stop schema-writing containers was rejected by automatic approval review and was not executed; recovery used the supported whole-stack CLI workflow instead.

## Repeated checks

The focused eight-case Analytics browser suite passes after the final navigation fix. It changes the selected pair, proves the two-choice limit, checks exact demo units, filters unsold rows, changes dates/source/grouping, reloads, downloads CSV, recovers invalid links, denies staff routes and asserts no demo backend requests or page errors. The phone test uses 390 × 844 and bounds both boards within the first viewport; inspected captures confirm all entries are clear of the bottom navigation.

## Final gates

| Gate | Result |
|---|---|
| Lint and nine invariants | PASS |
| Format check | PASS |
| App typecheck | PASS |
| Edge Function typecheck | PASS |
| Contrast | PASS: 64 pairs across both themes |
| Production build and PWA | PASS |
| Focused Analytics browser checks | PASS: 8/8 |
| Full unit/component suite | PASS: 174 files, 2,274 tests in isolated Node 22 Linux/Docker |
| Full demo browser suite | PASS: 320 tests, no retries |
| Authenticated local-Supabase browser suite | PASS: 38 tests on a freshly seeded local stack, no retries |
| Responsive/theme/console inspection | PASS: phone/tablet, light/dark, no page overflow or browser errors |
| Database/RLS/schema/website gates | Prior PASS retained: no related source change in this follow-up |

Ignored evidence logs use the `analytics-phone-verified-*`, `analytics-phone-unit-verified.log`, `analytics-phone-navigation-e2e.log`, `analytics-phone-demo-verified.log` and `analytics-phone-auth-*` names. The unit container's 491 source/script files match the workspace byte for byte; the temporary container and source archive were removed after verification. Fresh Items/Sales/comparison screenshots replace the initial UI captures in the chat's `analytics-71` artifact directory.

The final auth result is `analytics-phone-auth-fresh.log`: 38/38 in 6.7 minutes, including owner/manager Analytics reads, outage retry, offline settlement, concurrent tablets and existing role surfaces. The fresh fixture had zero bills under the concurrent-tablet test names before the run. All ordinary local services are healthy after completion; the owned test previews ended and the review preview remains on 7413.

## Limits and next actions

The result remains local and unarchived. Roadmap 71 stays active until the separate archive step. Browsing collection begins after publication, has no historical backfill and measures sampled activity rather than purchase conversion. Suggestions propose tests using current menu controls; they do not infer recipe profit or automatically change dishes. Recording stockouts and experiment dates would improve future advice.

Possible subsequent actions are `$openspec-archive-change sales-and-menu-analytics`, commit/push on request, and `$next-change`; none is automatic.
