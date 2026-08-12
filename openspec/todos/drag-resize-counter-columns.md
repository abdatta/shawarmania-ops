# Let Me Drag to Resize the Last Two Counter Columns

**Area:** Counter / Design · **Reported:** 12 Aug 2026, Kalyani outlet

## What's wrong

The billing counter screen has three side-by-side columns (menu, current
bill, activity). The owner would like to drag and resize the last two columns
to whatever width they prefer.

## Why this happens

- Right now, the last two columns are **locked to always be the same width as
  each other**, on purpose. This was a deliberate design choice, not
  something nobody thought about.
- The whole menu column is supposed to always stay fully visible without
  needing to scroll. If the other two columns could be dragged wider, that
  could push menu items out of view.
- There's even an automated test that checks the last two columns stay equal
  width, so changing this would need that rule (and test) to be updated too.

## What a fix could look like

- Allow dragging, but keep some safe minimum width for the menu column so it
  never gets pushed below "fully visible."
- Needs a decision either way — this touches a rule that was intentionally
  built and tested, so it should be reviewed and possibly updated rather than
  quietly overridden.

## Code hint (for whoever builds this)

- Column widths: `src/features/billing/billing-counter.tsx:474`
- The rule that says why they're locked equal: `openspec/changes/archive/2026-08-10-ui-billing-lifecycle/design.md:136-141`
- The test that checks this: `e2e/counter.spec.ts:358,367-368`
