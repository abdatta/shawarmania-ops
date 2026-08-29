# Make Recent Counts scan like Billing history

> **Model**: GPT-5.6 · **Kind**: product usability correction, not a sequenced roadmap change · **Gate**: each recent-count row makes the counted, collected and left amounts immediately scannable at Billing-history scale, keeps the existing over/short/matched or first-count chip beside the counted amount, and preserves the time, attribution, disclosure and correction behavior.

## Why

The drawer's Recent counts currently puts the time and verdict first and leaves
the counted total as a small figure at the far edge. That is unlike the owner's
Billing history, where the primary fact and its state are together, with useful
context beneath them. A drawer count has three facts worth scanning: what was
counted, what was collected from it, and what was left behind. The current row
only makes the first one prominent, while collected and left are hidden inside
the disclosure detail.

## What changes

- Reuse the Billing-history summary hierarchy for each Recent counts row:
  `Counted ₹…` and its existing verdict chip form the primary line, while the
  count time and recorder remain the muted subtext.
- Keep `Recent counts` as a plain section heading and give each observation its
  own card boundary, so individual count events scan as separate records rather
  than one continuous panel.
- Omit the year from count dates when it matches the current calendar year;
  retain it for older years.
- Show `Collected ₹…` and `Left ₹…` as two compact, prominent secondary figures
  beside the disclosure chevron. “Left” is the existing carry-forward formula,
  counted total less the observation's own signed cash movement; no new
  arithmetic or data source is introduced.
- Keep the row an accessible disclosure and preserve all expanded detail and
  correction actions. The new prominent figures are a summary, not a second
  editing surface.
- Reshape the drawer loading placeholder to reserve the taller, metric-bearing
  recent-count row silhouette.

## Non-goals

- No migration, adapter, RLS, gate, billing, drawer arithmetic or offline
  behavior change.
- No change to the verdict meanings, collection sign rules, count paging,
  expansion behavior, or edit/adjust permissions.
- No change to the larger `the-drawer-explains-its-figures` change already in
  progress; that change owns grouped interval readers and count editing.

## Documentation

Before this change is archived, update `docs/SCREENS.md` to describe the
three-number Recent counts summary and its Billing-style hierarchy. No data-model
documentation changes are required.
