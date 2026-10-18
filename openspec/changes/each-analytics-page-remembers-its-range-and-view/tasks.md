# Tasks

## Build

- [x] 1. `remembered-choices.ts` in `src/features/analytics`: read and write a page's shortcut under `shawarmania.analytics-range.<mode>.<userId>.<page>`, silent when storage throws or there is no session; `shortcutOf` (the shortcut a range is, or null) and `shortcutRange` (a shortcut's range, grouping and alignment for a business date, with the Month and 30d fallback). Unit tests for each, including namespacing by person, mode and page.
- [x] 2. `OutletAnalytics` opens on the remembered shortcut when the address names no `from`, and remembers the shortcut in its change handler when a range change lands on one (design D1, D2).
- [x] 3. Surface tests: Items and Sales open on their own remembered shortcuts, a 1d opening reads one day grouped by hour, an address with dates wins, a hand-picked range remembers nothing, and Month and 30d fall back to each other.
- [x] 4. The view (design D4): `readRememberedView` and `rememberView` beside the range under `shawarmania.analytics-view.*`; `TrendCard` takes `page`, opens on the remembered view when the address names none, and writes it on every tap, Chart included. Tests: each page reopens as it was last read, for that person only; an address naming a view wins.
- [x] 5. Demo browser test: 1d and Table on Items, and 7d and Cumulative on Sales, survive reopening each page from the navigation and a reload, independently.

## Close

- [x] 6. Gates: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, `npm run test:e2e:on`, and a browser check of both pages.
- [x] 7. PHASE GATE (no roadmap row, so no wave checkpoint): each Analytics page reopens on its own last shortcut and view, for that person and mode only, and a link with dates or a view still opens on them.
