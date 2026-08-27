# Billing reads at a glance

> **Model**: Claude Opus 5 · **Kind**: production usability correction, not a roadmap change · **Gate**: **the owner's Billing tab sits directly above Drawer, and the day's four money figures — Cash, UPI, Total, AOV — are on screen in one row on every Billing History tab**, not only behind Status.

## Why

The owner opens Billing History to answer one question — what did this outlet
take today — and the answer is two clicks away from where they land. The four
figures live inside the Status tab, which is the tab nobody opens because it is
named after tablet sync; the surface opens on Bills, which is a list of
individual bills, and the day's takings are nowhere on it. The tab itself is
last in the owner's navigation, at order 12, behind People, Compare and Alerts,
none of which is reached as often as the day's money.

Both are placement problems, and the figures are already derived on this screen
before any tab is chosen. Nothing new is read, and no arithmetic moves.

## What changes

- Move the owner's `Billing` navigation entry from order 12 to order 3, directly
  above `Drawer`, and shift the six entries it passes down by one. The edit is
  confined to `nav.order` on `super_admin` entries: no `role`, `path` or `state`
  changes, so no surface changes who reaches it or whether it is gated.
- Lift the total cards out of the Status branch of
  `manager-billing-history.tsx` and render them under the day bar, above the tab
  strip, so they are on screen whichever tab is open. Status keeps the tablet
  sync panel it is named for and loses the figures.
- Give `PaymentTotalCards` a `dense` presentation — four columns, tighter
  padding, a smaller display face — so all four fit one phone row. The shift
  rail keeps the two-column cards it has.
- Rename the fourth card from `Average bill` to `AOV`. The full name does not
  fit a quarter of a phone row, and average order value is what the owner calls
  it.
- Correct `docs/SCREENS.md`, which still described a fourth `Totals` view and a
  four-control filter grid. Neither has existed since the totals moved into
  Status and the status and payment pickers were removed; the page is the one
  this change is obliged to leave true.

## Non-goals

- **No change to the manager's navigation.** `franchise_admin` already carries
  `Billing` at order 2, above `Drawer` at 6. Reordering a nav the request did
  not describe would be a second change wearing this one's clothes.
- **No arithmetic change.** `day-totals.ts` is untouched: combined takings stay
  the sum of the two cards beside them, the average stays integer paise over
  paid bills, and cancelled bills still contribute to neither.
- **Not a new reading.** Nothing is fetched that the surface did not already
  hold; the cards move, they do not gain a source.
- **No change to the counter's My shift rail.** It shows Cash and UPI for one
  shift in two columns, and it stays that way — its scope is not a day and it
  has no fourth figure to condense.
