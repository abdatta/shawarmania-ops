# Tasks: The Billing Day at a Glance

No change gate (proposal → *Change gate*: a revert is enough). The order below
puts the reads first, then each screen, so every screen is built on a read that
already exists in both adapters.

## 1. The reads

- [x] 1.1 Migration `billing_day_at_a_glance`: `overview_today_v2(uuid)` (today's
  three figures plus `openPaise`) and `billing_day_stats(uuid, date)` (design
  D3's twelve figures), both `security definer`, `search_path = ''`, granted to
  `authenticated` only. Run `npm run lint:migrations`.
- [x] 1.2 pgTAP: each figure against seeded rows (an order split between two
  kitchens, an undone ready, a day-change-finished order, a legacy void, a
  correction counted once per bill, a revision counted once per order, an
  earlier day's open order left out of `openPaise`); a franchise admin of another
  outlet and an anonymous caller refused by both.
- [x] 1.3 Adapters: `OverviewToday.openPaise`; `today()` calls the v2 function;
  `BillingAdapter.readDayStats(outletId, businessDate)` and an optional
  `businessDate` on `countManagerOpenOrders`; demo implementations folded from
  the store with design D3's definitions (D7). Regenerate database types.

## 2. Billing history

- [x] 2.1 Open orders keep the selected day only; the unpaid total above the
  list; the tab's count is the day's (D2).
- [x] 2.2 Stats replaces Status: the sync chip and its problems, the three
  stacked 2 × 2 groups, their shimmer, the red count on the tab; technical
  details and grouped counts removed (D3).
- [x] 2.3 The Bills Filter button and sheet: sort, order words, the six filter
  groups, the summary label, Clear, `Bills (shown/total)`, No bills match (D4).
- [x] 2.3a The filter rides the tab row where it fits and wraps right-aligned
  where it does not; a bare icon with nothing in force (D4, amended
  2026-10-18). A unit test pins the shared row and the icon-only label.
- [x] 2.4 Unit tests: every sort key and direction over bills of every state;
  each filter group, OR within and AND across; Customer's name-only bill as
  Without; the Tablet group hidden on a one-tablet day; figures unchanged by a
  filter; the open orders day rule; the stats rendering, the dash for a null
  average, and the chip in both states. Update the tests the Status rename and
  the removed disclosure contradict.

## 3. Overview

- [x] 3.1 On the `one-revenue` card, the `· ₹X` beside Today's revenue (D1),
  absent at zero, exact rupees; its shimmer unchanged in height.
- [x] 3.2 A unit test of the figure, its absence at zero and its exact format.

## 4. Verify

- [x] 4.1 Browser: the demo walk of Overview → Billing history (Bills filter,
  Open orders on today and a past day, Stats) at phone and tablet widths, light
  and dark, no console errors and no unexpected requests.
- [ ] 4.2 The quick gates (`format`, `lint`, `format:check`, both typechecks,
  `npm test`, `contrast`, `build`) and the DB job (`test:db`, `test:rls`, the
  types diff); then push to `stage` and read the Staging run for the browser
  suites.

## 5. Close

- [x] 5.1 Update `docs/SCREENS.md`, `docs/GLOSSARY.md` and `docs/DATA_MODEL.md`
  as the proposal lists.
- [ ] 5.2 PHASE GATE: roadmap #78's checkpoint. Overview's Today's revenue shows
  the unpaid open orders beside it and opens Billing history; Open orders lists
  only the chosen day's and names their unpaid total; Stats reads the whole chosen
  day, matching a count of that day's rows in production, with a sync chip that
  speaks for now; the Bills filter's every combination gives a sensible list and
  leaves the day's figures alone; both new reads refuse another outlet's manager;
  the four-role demo walkthrough still walks; and the owner has used it through a
  service.
