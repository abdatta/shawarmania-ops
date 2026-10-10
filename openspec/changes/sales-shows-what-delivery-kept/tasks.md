# Tasks

## The owner sees it first

- [ ] 1. Extend the demo delivery history and the typed snapshot (`AnalyticsSnapshot.delivery` gains `commission` and `state`; a new `deliveryCharges` list) in the mock adapter only, so the demo carries every encoding in `design.md`: a stacked final day, a charge-only day below zero, a cut-unknown day, a not-final run, a disputed day and one weekly ads charge.
- [ ] 2. Build the section against that demo data: the heading, one card per channel with the three tiles, the filled-column chart with its legend, outline and marker, inspection, the weekly charges list, and the empty-range line. Add the series and outline tokens to the brand and semantic token layers for both themes; no hex in a component.
- [ ] 3. **STOP for the owner.** Capture the demo Sales page with the section on a phone and a portrait tablet, light and dark, with a 7-day and a 30-day range and one inspected day each, and send them. Apply what the owner changes; record the approved colours, heading and legend wording, and the long-range (30–92 day) behaviour in `design.md`. Nothing below starts until the owner approves.

## Live

- [ ] 4. Migration (dated after the newest on main): replace `sales_analytics` with the same signature; each sales-view delivery entry adds `commission` and `state`; the sales view adds `deliveryCharges` for `aggregator_cycle_deductions` overlapping the current window; the items view carries neither. Regenerate `database.types.ts` and check its diff.
- [ ] 5. pgTAP: the new fields for a settled, a provisional, a disputed, a cut-unknown and a charge-only day; a weekly charge inside, overlapping and outside the window; the items view omits both; **isolation** — a manager's crafted request for another outlet is refused and returns none of its delivery days or weekly charges.
- [ ] 6. Live adapter maps the new fields; unit tests for the mapping and for the section's domain helpers (column parts per row kind, card tiles summed in integer paise, legend entries present, no-row days distinct from zero).
- [ ] 7. Component tests: measure and grouping changes leave the section unchanged and make no request; a no-figures range shows the line and no cards; inspection reads each status in words; keyboard inspection and the keyboard-only focus ring.

## Close

- [ ] 8. Update `docs/SCREENS.md`, `docs/DESIGN_SYSTEM.md`, `docs/DEMO_MODE.md`, `docs/DATA_MODEL.md` and `docs/TESTING.md`.
- [ ] 9. Run every gate CI runs, including contrast, the database and RLS suites and both e2e suites; inspect the live-built page in both themes on phone and tablet with console and network clean.
- [ ] 10. PHASE GATE: roadmap #73's checkpoint — the owner approved the section from demo screenshots before it was built; on Analytics → Sales a heading separates a delivery-revenue-by-day section that ignores the measure, grouping and comparison; each channel's card shows what customers paid, what the platform kept and what the outlet gets, in filled columns, a charge-only day below zero, a cut-unknown day in its own fill, a not-final day outlined and a disputed day marked, and a day with no figures never reading as zero; weekly charges are listed, not spread, and Hyperpure is not among them; the figures arrive in the one Sales read, with no read on measure or grouping changes; a manager's crafted request for another outlet is refused; and the four-role demo walkthrough still walks.
