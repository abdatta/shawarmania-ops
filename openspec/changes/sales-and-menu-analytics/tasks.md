# Tasks

Tasks 1–13 record the earlier verified iterations. The owner's latest scope in tasks 14–20 supersedes their tracking, recommendations and older preset wording; those features are removed from the final implementation.

- [x] 1. Seed roadmap #71, proposal, design and testable deltas; preserve skipped numbers.
- [x] 2. Implement aggregate RPC, engagement schema and ingestion, authority checks and database/isolation tests; regenerate types.
- [x] 3. Implement typed live/demo adapters and honest comparison/recommendation domain functions with tests.
- [x] 4. Build both pages, fifth navigation entry, charts/tables/CSV, empty/error/loading states and responsive themed layouts.
- [x] 5. Integrate anonymous public/landing menu recording through the existing website Worker; verify payload bounds, privacy and failure independence.
- [x] 6. Update durable docs and run format before lint/typecheck/functions/unit/contrast/build/e2e/database/RLS/auth/schema checks; inspect UI and console/network in both themes and viewport sizes.
- [x] 7. PHASE GATE: Both pages live and demo; fifth navigation reloads; snapshot totals and empty/partial/zero-baseline cases proved; outlet isolation and bounded idempotent engagement proved; all applicable gates recorded in verification.md.

## Phone-first follow-up

- [x] 8. Review app widgets and revise the design for the owner's phone-first direction: Items/Sales, simultaneous best/worst boards, compact controls and progressive disclosure.
- [x] 9. Implement visual dish rows, two-dish comparison, compact date/source/group pickers, charts and matching shimmers; preserve full names and honest metrics.
- [x] 10. Verify both themes on phone/tablet, comparison and date flows, live/demo error recovery and applicable repository gates; deliver screenshots of both pages.

## Scrollable rankings and mature demo

- [x] 11. Replace separate boards with Dishes and All/Worst/Rising/Slow ordering, bounded infinite scroll, and 7d/1 month/3 months presets (7/30/90 days).
- [x] 12. Generate bounded shared demo bill history spanning both 90-day comparison periods, with category, hour, delivery and browsing variation; preserve snapshot arithmetic and demo isolation.
- [x] 13. Verify ordering, internal scrolling, 30/90-day comparisons, rich demo consistency, themes and applicable gates; refresh the tunneled demo and captures.

## Interactive metrics and low egress follow-up

- [x] 14. Revise artifacts and defer Ideas/Browsing/collectors; restore the website checkout and remove the unpublished database collector.
- [x] 15. Implement 1d/7d/30d (default 7d), page-wide metrics, up to four periods, actual range labels and pointer/touch/keyboard chart details with weighted counter AOV.
- [x] 16. Bound SQL and adapter reads by view/count, skip Sales bill-line reads, compress Items periods and cap hourly records; prove reconciliation, isolation and reuse without metric/group RPCs.
- [x] 17. Run all applicable gates against the revised migration and UI, inspect phone/tablet themes, refresh the existing tunnel and deliver both screenshots with an evidence report.

- [x] 18. Replace month grouping with Hour/Day/Week using bounded clock-hour aggregates; restore interactive hourly columns and distinguish the compact comparison pill with actual-range choices. Verify metrics, table/export, no extra RPCs and phone/tablet layouts.

- [x] 19. Name pattern cards by the selected metric and aggregation; normalize lower hourly Revenue/Orders per selected day while preserving weighted AOV and main Hour totals. Verify zero-sale days, comparison windows, metric-dependent titles, themes and applicable gates. Assess redundancy without removing charts; refresh the existing preview.

- [x] 20. Replace hatched hourly comparisons with solid semantic colors, rounded spaced columns, numbered legends/details and focused active-hour axes. Verify two/four periods, empty hours, pointer/touch/keyboard interaction, theme contrast and phone/tablet appearance.

## Review and owner follow-up (2026-10-09)

- [x] 21. Review the branch after rebasing on main: date the migration after main's newest (`20261012000000`) and move its pgTAP file to the free `82_`; require an active account in the RPC; pre-aggregate daily item units; attribute the commits.
- [x] 22. Cut demo history build time with indexed lookups, run the history to yesterday, and capture every demo line's category; keep the rehearsed drawer and delivery days unchanged.
- [x] 23. Items: remove two-dish comparison; add the item/category trend card (Units/Revenue, Day/Week, one to four periods) backed by `sales_analytics_series`, tappable dish and category rows, category change against the previous period.
- [x] 24. Sales: merge the trend chart and Days list into one Chart / Table card that drops no figure; remove the weekday-average card and the separate table/export.
- [x] 25. Verify with pgTAP, HTTP, unit and demo/live browser tests in both themes on phone and tablet, and update SCREENS, DATA_MODEL, SECURITY_AND_PRIVACY, OPERATIONS, TESTING and DEMO_MODE.

- [x] 26. Items: group by Hour as well as Day and Week, from 24 order-hour totals per window carried in the same series read; Day stays the default.
- [x] 27. Charts show the focus ring only when reached by keyboard, not after a tap or click.
- [x] 28. Move Customers from Setup to Analytics for owner and manager, keeping its address; record customer analytics in the backlog (`customer-analytics`).

- [x] 29. With three or four compared periods, read the trend headline, dish and category rows and the table as a direction (fitted rate per period, flat within the periods' wobble), the usual range and the current period against it; per-period bars on rows from `periodUnits`; Rising and Slow by direction.
- [x] 30. Flat trend chips read `→ steady` in the unit's style, so chips are one size; Items wears a ranked-bars icon instead of Menu's utensils (the name stays, since it covers drinks); Analytics sits between Attendance and Setup, Setup rightmost.

- [x] 31. Items' Dishes and Categories follow the measure (revenue shown, ranked, compared and filtered), via `20261013000000_items_follow_their_measure.sql`; hour charts and their tables trim to the trading hours; 1d groups by Hour and 7d/30d by Day on both pages.
