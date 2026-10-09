# Scrollable rankings and mature demo — roadmap 71

Historical iteration. Current scope/evidence are in [metrics-verification.md](./metrics-verification.md); collectors below were removed before publication.

Verified locally on 2026-10-09. This owner-directed follow-up replaces the earlier separate boards. The database, RLS, live aggregate adapter and public-menu collector are unchanged; their verified evidence remains in verification.md and phone-verification.md. No production write, deployment, commit, push or archive was performed.

## Manual verification replaced

Inspected Items and Sales on a 390 × 844 phone and 1138 × 712 tablet in both themes through the public tunnel. Confirmed full dish names, compact controls, current/prior charts, All/Worst ordering, three-month dish history and no browser errors or horizontal overflow. Browser tests reach every dish through the internal scroller, keep its height and the document height unchanged, reset on filters/search, compare two dishes, switch dates/source/grouping, reload deep links and export CSV. Demo tests assert no backend requests; local authenticated tests exercise both roles and read-error recovery.

## Implemented

- Dishes replaces the duplicate boards. All ranks most sold first; Worst beside it ranks least sold first including zeros. Rising/Slow require nonzero prior units and order percentage growth/decline. Existing availability/status limitations remain accessible.
- Items and Sales use fixed 320px internal lists, initially rendering 12 rows and appending batches of 12. The observer and re-arming pattern comes from Customers' bill history, with the list itself as its root. No Show All button is required.
- Presets are 7d, 1 month and 3 months: exactly 7/30/90 completed business days. Default is 30.
- The web walkthrough generates a bounded 182-day older window plus the existing recent operational scenario. The verified seed holds 8,634 bills and 18,658 lines. Older weekly zero-sale dates, changing dish demand, category/hour/weekend variation, both delivery channels and retained browsing samples make comparisons useful. All totals derive from shared schema-typed snapshots; prices cannot rewrite them. Raw browsing samples mirror 30-day retention, and brand landing sessions remain owner-only.
- Added global localhost-tunnel skill outside the repository at C:/Users/iamro/.codex/skills/localhost-tunnel/SKILL.md. The skill passes quick_validate.py and records the verified config override, hidden process launch, host-header forwarding, URL reuse, browser checks and owned-process cleanup.

## Issues found and fixed

The app's font scale made h-80 resolve to 280px, so the list now specifies 320px explicitly. Adding history exposed an open-ticket fixture that selected the first bill: it now resolves the original counter sample once and preserves the rehearsed ticket contents. Weekly zero-sale dates restore the existing Ledger no-sales scenario. Delivery generation preserves unique outlet/date/channel keys and the existing source-day rows. Set/map lookups and a reused hour formatter eliminate repeated history scans; constructing the fixture and checking all presets took 2.23 seconds in the isolated focused run without raising timeouts.

A Windows full-unit attempt hit an unrelated menu test's existing 20-second timeout under resource contention. Tests were moved to official Node 22 in an isolated Docker container with fresh npm ci; assertions and timeouts were preserved. The container's 502 source/config/verification files match the workspace SHA-256 cb7763f1e4eff976395f6724f5102e1f7cd3f7e7076c2e7d0c986401d49e6765.

The complete browser run initially passed 318/320: two existing unreachable-sign-in cases require the standard demo-only.supabase.co host so their explicit abort interceptor runs. The public preview intentionally uses demo.invalid, which instead produced Chromium's DNS-error entry. The test build was regenerated with the suite's standard dummy host; neither application code nor the existing exact console assertion changed. The public tunnel retains its separate isolated build.

The repeat passed 319/320, exposing a wall-clock race in the existing counter enrollment test: the 400ms seeded send completed before its initial pending assertion under parallel browser load. That test now pauses Playwright's browser clock immediately before opening the counter, preserves every original initial-state assertion, then advances 500ms and additionally requires synced. The application and demo send timing are unchanged.

## Checks repeated

The focused data suite passed 9/9. After correcting the shared fixture, all 12 responsive Analytics and existing counter/Ledger regression cases passed without retries. Owner/admin live reads and failed-read recovery passed 3/3 against local Supabase. Both full suites were restarted on the corrected source.

The complete unit run passed on the matching snapshot; its temporary container and source archive were removed. The installed official Node image remains cached. The two sign-in regressions passed unchanged on the standard test build (2/2 in 23.4 seconds). The clock-controlled enrollment check passed six consecutive tablet/desktop cases with two workers (6/6 in 29 seconds), before repeating the full suite with zero retries. Ignored final evidence logs are analytics-scroll-{functions,contrast,build,unit}-complete.log, analytics-scroll-{lint,format}-verified.log, analytics-scroll-e2e-build.log, analytics-scroll-demo-final.log, analytics-scroll-initial-sync.log, analytics-scroll-sign-in.log, analytics-scroll-regression.log and analytics-scroll-auth.log. analytics-scroll-demo-complete.log and analytics-scroll-demo-verified.log record earlier 318/320 and 319/320 runs, not passing gates.

## Gate results

| Gate | Result |
| --- | --- |
| Lint | PASS, including all repository helper checks |
| Format | PASS after counter test fix; Markdown hand-reviewed per repository policy |
| App typecheck | PASS, current source |
| Production build/PWA | PASS, both isolated public-demo and standard test builds |
| Edge Function types | PASS |
| Unit/component suite | PASS, 174 files and 2,275 tests in 1,370.26s; isolated Node 22 Docker, fresh dependencies |
| Contrast | PASS, 64 pairs |
| Full demo browser suite | PASS, 320/320 in 13.1 minutes, two workers, zero retries; analytics-scroll-demo-final.log |
| Focused responsive/regression browser suite | PASS, 12/12 without retries |
| Authenticated Analytics reads/recovery | PASS, 3/3 |
| Local Supabase and migration/seed reset | Retained PASS from original verification; unchanged migration |
| Database policies/contracts | Retained PASS, 80 files / 3,123 assertions; unchanged database source |
| REST/RLS phases | Retained PASS, 293 tests across six phases; unchanged database source |
| Full authenticated browser suite | Retained PASS, 38/38 on fresh local fixtures in analytics-phone-auth-fresh.log; no shell/auth changes in this follow-up |
| Generated schema parity | Retained PASS; unchanged generated schema |
| Website Worker types/tests | Retained PASS, 199 tests; unchanged website source |
| Website build/weight/secrets | Retained PASS, within budgets; unchanged website source |
| Phone/tablet light/dark UI, console, demo isolation | PASS |
| Global skill validation | PASS |

## Review artifacts and limits

The isolated demo remains available at https://wizard-robots-gossip-period.trycloudflare.com/shawarmania-ops/demo/owner/analytics/items and /sales. It uses a dummy unusable backend and fabricated data. The preview and tunnel were kept running; hashed assets were copied before the entry HTML, preserving old assets and the URL. An existing PWA tab needed reloads to receive the new build. The temporary address requires this machine and its processes to remain online.

Phone/tablet captures for both pages and themes, plus Worst and three-month views, are saved in C:/Users/iamro/.codex/visualizations/2026/10/08/01a11d5f-1c0e-77d2-949a-4e068571e19c/analytics-71-v2. Final phone screenshots with navigation closed are items-phone-final.jpg and sales-phone-final.jpg; the same folder includes full-page Items/Sales captures. Their public browser had no warning/error entries. Production publication and collector-secret setup were not performed in this follow-up; no Google Analytics account is needed for these first-party measurements.

The change is verified and remains unarchived. Possible next actions are $openspec-archive-change sales-and-menu-analytics, commit/push on request, or $next-change; none is automatic.
