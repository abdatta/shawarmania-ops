# Design: Make Recent Counts scan like Billing history

## D1 — Three amounts, one scan line

The closed row uses the same visual priority as an owner Billing-history row:

```text
Counted ₹2,210   ₹1,940 over              Collected ₹1,940  Left ₹270  ˅
Today, 10:08 pm · by Abhishek Datta
```

The left block owns the count and verdict because that is the result being
qualified. The right block owns the two follow-on amounts and the disclosure
control. Labels stay small and the three money values use the Billing row's
bold, normal display size; they do not become a dashboard-sized figure that
would make this history denser than the list it is meant to resemble.

The right metrics remain a shrink-resistant group so money is never truncated.
On a narrow phone, the left summary may wrap naturally and the metrics may use
their compact two-column arrangement; the existing row still owns the complete
accessible name.

## D5 — The heading introduces cards; it is not part of one

`Recent counts` is a plain section with a standalone heading. Each
`ObservationRow` owns one card boundary, with `space-y-3` separating adjacent
records. Paging controls and the exhausted message remain outside the row cards
because they describe the list, not any one count. The loading silhouette uses
the same heading-plus-card stack.

## D6 — Current-year dates do not repeat the year

Count timestamps use the shared `formatDayTime` rule: today and yesterday keep
their relative labels, other dates in the current calendar year render as
`28 Aug, 10:00 pm`, and dates from older years retain the year. That shared rule
also serves Billing history, bill timelines, Open orders, sync status and My
shift; the compact current-year presentation is intentional on all of them.
The comparison uses the display timezone (`Asia/Kolkata`), not the browser's
local timezone.

## D7 — Expanded cards explain the count without echoing the summary

The expanded body is a compact fact panel, not a second summary. It may show
the expected amount when known, where the count was recorded, a delayed-save
timestamp when it differs from the count time, and conditional notes or
movement reasons. First-count and opening-break
explanations remain contextual links, while correction history shows the
adjusted-to amount, reason, editor and date. For a newest count fixed in place,
it may show the last fixing account; for an anchored count, the original
remains the closed Counted value and is not repeated. The body ends with the
existing edit or adjust action. It does not repeat Counted, Collected, Left,
the count timestamp or the recorder already visible in the closed row.

## D2 — Read existing facts, do not create a new calculation boundary

`collected` remains the signed sum of `observation.ownCashOut`, exactly as the
current expanded detail reads it. `left` is `countedTotalPaise - collected`,
the same `nextOpeningPaise` rule used by the drawer adapters and domain module.
The display change must not read current drawer state or derive a new balance
from bills and expenses. Historical spend records remain readable under the
existing movement semantics.

## D3 — Disclosure semantics remain unchanged

The whole row remains one button, with its existing `aria-expanded`, accessible
name, chevron and unmounted detail. The new metrics are inside that same button;
they do not become nested controls. Contextual explanation links, correction
actions, location facts and notes remain available in the expanded detail.

## D4 — Placeholder follows the arriving silhouette

The drawer's loading state reserves a metric-bearing recent-count row with two
content lines and a right-side pair of money blocks. This keeps the first loaded
Recent counts row from causing a second layout jump. It uses the existing
`Shimmer`/`LoadingRegion` primitives and semantic tokens.

## Rejected alternatives

- **Put Collected and Left in the expanded detail only.** Rejected because it
  leaves the two most useful operational facts hidden and does not satisfy the
  owner's request for a three-number scan.
- **Use a three-column `Counted / Collected / Left` strip across the full row.**
  Rejected because the verdict chip and accessible disclosure affordance would
  be displaced or wrapped away on a phone; the Billing-style left summary plus
  right metric group preserves the established hierarchy.
- **Replace labels with icons alone.** Rejected because icons can reduce width,
  but “Collected” and “Left” are meaningful financial labels and the row must
  remain clear without visual icon interpretation. Icons remain optional, not
  the only cue.
- **Change the stored adapter shape to add `leftPaise`.** Rejected because the
  value is already defined by the existing domain rule and adding a second
  stored/transported figure would create a needless drift point.
