# Make Recent Counts scan like Billing history

> **Model**: GPT-5.6 Sol · **Wave**: E · **Depends on**: #11 · **Gate**: each
> recent-count row makes the counted, collected and left amounts immediately
> scannable at Billing-history scale, keeps the existing over/short/matched or
> first-count chip beside the counted amount, and opens into a compact contextual
> panel that preserves attribution and both correction paths.

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
- Make the shared operational date-time rule omit the year when it matches the
  current calendar year and retain it for older years. Recent counts, Billing
  history, My shift and the other existing callers now use that same compact
  rule deliberately rather than as an incidental formatter side effect.
- Show `Collected ₹…` and `Left ₹…` as two compact, prominent secondary figures
  beside the disclosure chevron. “Left” is the existing carry-forward formula,
  counted total less the observation's own signed cash movement; no new
  arithmetic or data source is introduced.
- Redesign the accessible disclosure body as a compact contextual fact panel.
  It preserves expected-at-count, location, delayed-save, note, movement and
  correction facts and the existing edit or adjust action without repeating
  the closed summary.
- Seed demo mode with both correction paths: an in-place fix that names the last
  fixing account and an anchored adjustment whose adjusted-to amount, reason,
  account and date remain readable.
- Reshape the drawer loading placeholder to reserve the taller, metric-bearing
  recent-count row silhouette.

## Non-goals

- No migration, adapter, RLS, gate, billing workflow, drawer arithmetic or
  offline behavior change. Billing timestamps only adopt the shared compact
  current-year presentation.
- No change to the verdict meanings, collection sign rules, count paging,
  expansion behavior, or edit/adjust permissions.
- No change to the larger `the-drawer-explains-its-figures` change already in
  progress; that change owns grouped interval readers and count editing.

## Documentation

Before this change is archived, update `docs/SCREENS.md` to describe the
three-number Recent counts summary, its Billing-style hierarchy, its contextual
detail and the shared current-year timestamp rule. No data-model documentation
changes are required.
