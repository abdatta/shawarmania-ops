# Inclusive dates and Items shares — roadmap 71

2026-10-10. Follow-up to the existing analytics change; tasks 32–36.

## Verification a person would otherwise perform

Open Items and Sales on a phone and tablet in both themes. Confirm default 7d and 1d/30d include the selected outlet's business today, and Previous/Next returns to a range ending today. Edit either endpoint repeatedly, then the opposite endpoint, apply/reload, cancel/reopen, and try a future or overlong draft. Switch Items/Revenue, search/filter/chart one dish and check dish/category shares still use all captured items or dish revenue in the outlet/range. Inspect terminology in controls, charts, details and CSV, and empty/zero-sales states. Check console, horizontal overflow and backend requests.

## Completed autonomously

Updated the proposal, design, delta specification and tasks inside `sales-and-menu-analytics`; no new change or archive. Defaults and presets now end today with exact inclusive spans; forward navigation can return to today. Date drafts link to the first edited endpoint until the opposite is explicitly edited, reset on reopening and commit once. Future/invalid/over-92-day drafts cannot apply. Cutover resolution and explicit links stay intact; manual dates retain grouping.

Quantity copy is Items/Items sold, including accessibility, tables and exports. Dishes' header shows the selected metric total. Dish and category shares use all snapshot item quantities or captured line revenue less line discounts, including retired captured sales, with stable denominators through search/filter/chart changes. Zero totals show dashes and zero sellers against positive totals show 0%. Orders are removed from this page's shares/header/export. The subject picker also follows the measure. Categories have a share line and a matching loading reserve. SCREENS and TESTING describe the behavior.

## Issues found and fixes

- The previous defaults, presets, fallback and forward bound explicitly excluded today; all four now admit it.
- Independent draft fields did not preserve span; first-endpoint linking now supports repeated edits and releases on opposite-endpoint edits in either direction.
- Order penetration remained visible with Revenue selected; shares now follow the selected metric, with category shares and full-range denominators rather than filtered-list denominators.
- A test used Testing Library's unsupported `exact` role option; removed before the final typecheck.
- The first isolated live-browser harness resolved its preview relative to `logs/`; set its working directory explicitly to the repository and retried. This is an ignored local verification configuration, with its own port 7414; the existing server on 7416 was preserved.
- The browser's previous service worker on `127.0.0.1:7414` served an older app without Analytics. Visual review used the fresh `localhost:7414` origin. The review tab was closed and its viewport override reset afterwards.

## Regression evidence and rechecks

The three new regression files ran against the original HEAD versions of the four affected application files: **16 failures, 1 pass**. The implementation was restored byte-for-byte in `finally`; no original-source version was retained. Focused final analytics tests: **5 files / 32 tests pass**, covering both cutover sides and a different outlet cutover, explicit links, inclusive preset sizes, both editing directions, cancellation/reset, leap/custom spans, bounds, metric shares, retired sales, filtered/charted subjects, zero totals and table/export copy. Existing analytics adapter/domain tests: **11 pass**.

The full demo browser suite passes **334/334**, including offline/demo invariants, analytics date flows and metric-derived shares on phone/tablet in both themes. Analytics browser walks record no page errors, backend requests or horizontal overflow. Separate visual review at 390×844 and 768×1024 covers both pages and themes, with no warning/error console entries.

## Final repository gates

- Lint: PASS, including all repository invariant checks.
- Formatting: PASS after implementation and the final artifact check.
- App TypeScript: PASS, including all new tests.
- Edge Function TypeScript: PASS.
- Unit/component suite: PASS, 189 files / 2,410 tests (`npm test -- --maxWorkers=2`); focused final analytics tests also pass.
- Contrast: PASS, 78 AA pairs across both themes.
- Production build: PASS; existing chunk-size warning.
- Demo E2E: PASS, 334/334, own production preview on 7415.
- Live Analytics browser checks: PASS, 3/3; owner and manager read both live pages, reuse reads for metric/group choices, request bounded comparison windows, and recover from a synthetic outage. Own production preview on 7414 against the existing local Supabase stack.
- Database/RLS/reset/schema regeneration/full Auth suite: not rerun for this follow-up; no schema, policy, adapter contract, auth/shell/role-index, billing arithmetic or offline change.
- Phone/tablet visual review: PASS in both themes.
- Change Gate: PASS for this follow-up; all five new tasks complete, both pages live/demo, inclusive business ranges, metric shares, bounded reads and empty/error states proved with theme/viewport review.

## Evidence and remaining limitations

Ignored logs: `logs/analytics-original-regression.log`, `analytics-inclusive-{lint-final,format-check-report,types-final,functions,contrast,build,unit,e2e,focused-final,live-final}.log`. Screenshots are saved under `C:/Users/iamro/.codex/visualizations/2026/10/10/01a12777-40d6-7fc0-893d-3f38c3dd92c5/analytics-followup/`: `items-phone-light.png`, `items-phone-dark.png`, `items-tablet-light.png`, `items-tablet-dark.png`.

Today remains qualified as incomplete; missing delivery detail is not invented, and revenue shares use dish revenue rather than overall Sales revenue. Internal `units` keys remain compatible. No production schema write, deployment, commit, push or automatic archive.
