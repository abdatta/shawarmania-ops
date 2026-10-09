# Interactive metrics and compact comparisons — roadmap 71

2026-10-09. Historical verification of tasks 14–18, before the pattern-heading follow-up in [headers-verification.md](headers-verification.md). This supersedes the earlier implementation, phone and scroll reports. Collector/recommendation claims in historical reports describe removed unpublished work. All applicable gates passed on that iteration's implementation.

## Verification a person would otherwise perform

Walk Items/Sales on phone and portrait tablet in both themes: full dish names, All/Worst/Rising/Slow, fixed-height scrolling, two-dish comparison, default 7d and 1d/30d/custom dates. Switch Revenue/Orders/AOV and Hour/Day/Week; select four actual ranges; hover, click, tap and keyboard-inspect points/columns; check weighted AOV, empty hours, reload and CSV. Check console, overflow, demo isolation, live authority and request counts.

## Completed autonomously

Implemented Analytics as the fifth group and both typed live/demo pages with SQL aggregates. Items excludes Ideas/Browsing and collectors. Sales has a compact comparison icon pill, Current only or 2/3/4-period choices with actual ranges, Hour/Day/Week and grouped hourly columns. Portrait tablet charts retain full width. Revenue headlines include recorded counter/delivery gross; Orders/AOV/hour graphs use counter bills only. The existing public tunnel is refreshed.

SQL bounds each window to 1–92 days and count to 1–4. Sales skips bill-line reads and omits dish/category payloads; Items omits delivery/hours and collapses days into period summaries. Hours are bounded to 24 × count. Metric/group changes reuse the snapshot. Mature fabricated history has 8,634 bills / 18,658 lines; measured JSON is 14,182 bytes for Items/30d/2 and 29,343 for Sales/30d/4, without raw bills, lines or identities.

## Issues found

Ambiguous comparison wording, unnecessary Month grouping, hourly lines and narrow portrait-tablet charts did not match the latest direction. SVG letterboxing affected pointer mapping. A browser test targeted a zero-value circle covered by overlapping prior circles. Windows worker startup, transient CLI failure and repeated Auth rate limiting disrupted initial checks. Earlier Ledger timing runs exceeded 500 ms, including direct Docker access. The initial implementation also left unpublished website collectors; the earlier claim that the website was unchanged was wrong.

## Fixes

Implemented dated comparison choices, Hour/Day/Week and patterned hourly columns using the same bounded payload. Widened tablet cards and used SVG screen transforms for pointer coordinates. Browser tests inspect rendered graph coordinates, retaining exact hour/value and real touch assertions. Used an official Node 22 Linux test container and fresh local schema/Auth state for reliable checks. Removed website and database collectors; the website checkout is clean. Menu measurement/advice is deferred in the indexed backlog. No Ledger assertions or production code were weakened.

## Rechecks after fixes

Focused units 14/14; phone/tablet flows 8/8 in both themes, including real touch, four series, table/export and zero demo backend requests. Full units: 175 files / 2,280 tests. Full demo browsers: 320/320; authenticated browsers: 38/38, including real offline settlement exactly once and analytics error recovery. The owner and manager tests prove no extra analytics reads for Orders/AOV or Hour/Week, and one bounded read when increasing comparison count. Empty local 7d/2 JSON responses measured 1,940 bytes for Items and 1,176 for Sales.

Fresh pgTAP: 80 files / 3,116 assertions. REST authority/write phases: 289 passing tests plus the four unchanged Ledger checks. After all other suites finished, the final direct-container timing run passed at 407/452 ms for days (limit 500) and 298/271 ms for months (limit 750). No Ledger code, assertions or timing budgets changed. Direct CLI schema output matches the saved types byte-for-byte; the earlier temporary PowerShell capture differed only in CRLF line endings.

## Final repository gates

- Lint: PASS; nine invariant checks and clean UTF-8.
- Format check: PASS; full recheck after the browser-test fix.
- Typecheck: PASS.
- Edge Function typecheck: PASS.
- Unit/component suite: PASS; 175 files / 2,280 tests in official Node 22 Linux. Host/container source manifests match across 504 files before and after the run (SHA-256 44ef28383dd5c704f0ed0aaafffc18a83177230429d7b961b4224d1d230dc9fc).
- Contrast: PASS; 64 AA pairs in both themes.
- Production build: PASS; dummy backend, existing chunk-size warning.
- Demo browser suite: PASS; 320/320, including offline/demo isolation and five-group phone navigation.
- Fresh local database / pgTAP: PASS; 80 files / 3,116 assertions.
- REST/RLS: PASS; all six phases, 293 tests. Final Ledger timing/parity 4/4.
- Authenticated browser suite: PASS; 38/38 against local Supabase.
- Generated schema parity: PASS; direct CLI stdout matches saved bytes exactly.
- Phone/tablet visual checks: PASS; both themes, exact hourly values, no overflow.
- Change Gate: PASS; both live/local and demo pages, navigation/reloads, captured totals, empty/no-baseline cases, weighted AOV, interactive charts, bounded payloads, no metric/group RPCs and outlet isolation proved.

## Remaining limitations

No production migration, deployment, commit, push or archive. Google Analytics/public-menu measurement is deferred. Hour grouping shows clock-hour totals across a range, not per-date/hour records. Delivery order counts/timestamps are unavailable. The public tunnel serves fabricated data with an invalid backend configuration.

Phone captures are saved under C:/Users/iamro/.codex/visualizations/2026/10/08/01a11d5f-1c0e-77d2-949a-4e068571e19c/analytics-71-v3: items-phone.jpg, sales-phone.jpg, sales-hourly-columns.jpg and sales-full.jpg. Phone (390 × 844) and portrait tablet (768 × 1024) checks passed in both themes with no browser warnings/errors or horizontal overflow. The preview tab remains open; temporary viewport overrides are cleared. The global reusable tunnel skill is C:/Users/iamro/.codex/skills/localhost-tunnel/SKILL.md.

Evidence is in ignored logs/analytics-hours-{unit-full,demo-full,auth-full,timing-final,lint-final,format-check-last,types-final,functions,contrast,build,schema-parity}.log and logs/analytics-metrics-{db-final,realtime-final,rest-final,races-final,drawer-final,telemetry-final}.log. Browser suites used their unchanged project/test settings with one worker and own previews on 7415/7416, reusing separately verified production artifacts rather than rebuilding them between suites. User dev server 7412 and remote preview/tunnel 7417 were preserved.

Temporary Linux test container and source/support archives were removed after verification. Local and public preview health checks returned HTTP 200. The initial combined cleanup command was automatically rejected; separate verified stop/removal commands completed cleanup safely.

Ready for review. Archive via $openspec-archive-change sales-and-menu-analytics, commit/push on request, or $next-change are possible subsequent actions; none is automatic.
