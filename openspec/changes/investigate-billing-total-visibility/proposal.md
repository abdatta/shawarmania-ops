# Proposal: Billing Total First-Viewport Visibility

> **Investigation only · Relates to #3 · Status: preliminary, requires engineer review before implementation**

## Problem

When the billing page opens, the current order total is not reliably visible in
that first viewport. Issue #3 reports that the total appears to be pushed down
or obscured by the billing actions and asks for investigation before a fix is
implemented. The desired counter behavior is that the current total is readable
without scrolling or an extra interaction, while the order/customer actions
remain usable.

This proposal deliberately does not implement the fix. It records the evidence
from `main`, a root-cause hypothesis, and a validation plan for an engineer to
confirm before changing the application.

## Investigation findings

### Confirmed from the current tree

1. **The current bill panel is not mounted on the initial empty state.** In
   `src/features/billing/billing-counter.tsx`, the middle-column branch at lines
   654–717 mounts `BillPanel` only when `lines.length > 0 || editingOrder`.
   Otherwise it mounts `MyShiftSurface`. This means the `bill-total` element
   cannot exist on a newly opened billing route with no draft, even though the
   issue's expected behavior describes the current total as immediately visible.

2. **The total is rendered inside the footer, not in a persistent panel header.**
   `BillComposerFooter` calculates the total with `billTotals` and renders the
   `Total` row at lines 82–87 of
   `src/features/billing/bill-composer-footer.tsx`. The same footer then renders
   two customer inputs (lines 89–128), validation guidance (lines 130–144), and
   the terminal action row (lines 146–178).

3. **The footer is attached after the line-list scroller.**
   `src/features/billing/bill-panel.tsx` makes the panel a column flex container
   (`flex min-h-0 flex-1`) and makes the line list the flexible `overflow-y-auto`
   region at lines 53–69. The footer wrapper at line 129 has a border and padding
   but no explicit `shrink-0` or separate visibility boundary. The comments say
   the footer is pinned, but the DOM/CSS contract does not independently assert
   that its full contents remain in the available viewport.

4. **Additional content is a sibling below the bill panel.** When the phone
   lookup finds a customer, `billing-counter.tsx` renders the `customer-match`
   card, including `Use saved details` and `Keep this order` buttons, after the
   `BillPanel` at lines 667–709. The bill column itself is a vertical flex
   container with a gap at lines 628–628 and does not own a vertical scroll
   container. Under a short available height, this sibling competes with the
   footer for space.

5. **The page-level workspace clips vertical overflow.** The workspace at
   `billing-counter.tsx` lines 576–585 is a fixed-height grid with
   `overflow-x-auto overflow-y-hidden`; the right columns are also constrained
   by `min-h-0`. This preserves the product's horizontal three-column contract,
   but it means content that escapes a column vertically can be clipped instead
   of making the whole page scroll.

6. **The repository already states the intended contract.**
   `openspec/specs/counter-billing/spec.md` requires each counter column to
   scroll internally and says the current bill's controls must not move off
   screen (lines 737–750). Its editing requirement also names the total,
   customer fields, and terminal actions as the composer's footer (lines 807–809).
   The current implementation has tests for total arithmetic and text (for
   example `billing-counter.test.tsx` lines 201–218 and `e2e/counter.spec.ts`
   lines 61–79), but they do not assert first-viewport geometry or clipping when
   all footer controls and lookup actions are present.

7. **Recent history points at the layout transition.** Commit `4247753`
   ("Preparing orders: pipeline and counter share settlement state") moved the
   middle column between `BillPanel` and `MyShiftSurface`, removed the temporary
   settlement confirmation, and made the activity/pipeline refreshes
   independent. The change is directly related to the current conditional
   composition branch and is the most relevant regression boundary to review.

The existing billing component test file passes on current `main` (30 tests).
A browser-level reproduction was attempted, but the environment did not have
Playwright's Chromium executable installed, so this run did not establish a
pixel-level reproduction. That limitation is why the layout cause below is
explicitly a hypothesis rather than a confirmed rendering diagnosis.

## Root-cause hypothesis (not yet confirmed)

There are likely two cooperating problems:

1. **Empty-state absence:** the route initially shows the shift/history surface
   instead of a current-bill shell, so there is no immediate total to read until
   the operator taps a menu item. This is a confirmed code path and may alone
   explain the issue if “on opening” means the untouched billing route.

2. **Footer height competition:** after an item is selected, the total is placed
   at the top of a footer whose remaining vertical content includes customer
   fields, validation copy, and two or three touch-sized actions. A customer-match
   card is then rendered outside the panel. Because the bill column has no
   vertical overflow owner and the workspace hides vertical overflow, a short
   tablet/phone-height layout may shrink or clip the footer/panel boundary. The
   total can therefore look missing or be pushed below the first viewport even
   though the `bill-total` node is present.

The source does **not** support claiming that the action buttons literally
paint over the total: normal-flow markup places them after it. Geometry in the
supported browser/viewport matrix is needed to determine whether the observed
symptom is absence, clipping, flex shrink, or a perception problem caused by the
history surface appearing in the same column.

## Proposed approach for engineer review

1. **Settle the visible contract first.** Decide whether the empty billing route
   should show a zero-valued current-bill summary, a persistent composer shell
   that becomes actionable on the first menu tap, or a clearly separated
   history-only empty state. The issue's wording favors a persistent current
   total, but the existing OpenSpec says composition begins on the first item
   tap; the proposal should not silently choose between those product contracts.
2. **Keep the total in a non-competing, first-viewport region.** Once the contract
   is chosen, place the current total in a stable summary/header region or make
   the footer's summary/action groups explicit non-shrinking regions. The item
   list should remain the only region that scrolls inside the bill panel. The
   implementation must preserve the existing single-footer rule and must not
   duplicate the total in the editing pin, where the order card already carries
   the total.
3. **Contain optional lookup/actions deliberately.** Customer-match guidance and
   its two buttons must either live inside the bill panel's owned scroll region
   or be measured as part of the layout so they cannot push the total or terminal
   actions outside the visible column. At narrow widths, actions may wrap/stack,
   but each touch target must stay reachable and the horizontal three-column
   counter contract must remain unchanged.
4. **Document the clarified contract.** If behavior changes from the current
   empty-state branch or modifies the existing counter requirement, update the
   relevant OpenSpec delta and `docs/SCREENS.md`; no data, adapter, payment, or
   source-domain change should be needed.

## Affected components

- `src/features/billing/billing-counter.tsx` — initial middle-column branch,
  bill-column sizing, and customer-match placement.
- `src/features/billing/bill-panel.tsx` — line-list versus footer containment and
  non-shrinking/pinned layout contract.
- `src/features/billing/bill-composer-footer.tsx` — total summary, customer fields,
  validation copy, and terminal actions.
- `src/features/billing/billing-counter.test.tsx` — constrained-height and
  optional-content regression coverage.
- `e2e/counter.spec.ts` — tablet/desktop first-viewport and scroll assertions.
- `openspec/specs/counter-billing/spec.md` and, if needed,
  `docs/SCREENS.md` — durable visibility contract.

No application/source code is included in this investigation branch.

## Risks and edge cases

- A zero total on an untouched composer could be mistaken for a billable order;
  the visual state and action disabled state must make “no items yet” obvious.
- Preserving the history surface while adding a total summary could create two
  competing primary areas in the middle column; one surface should own the
  current-bill summary and one should own shift history.
- Customer-match prompts, phone validation errors, and long customer names can
  add height after the initial render. The layout must remain stable in both
  light and dark themes and at the smallest supported tablet height.
- Editing an existing order must keep exactly one total, one set of customer
  fields, and one action footer; the pinned editing card must not regain a second
  total.
- The bill total must continue to derive from integer-paise line snapshots via
  the existing domain calculation. This investigation does not propose changing
  billing arithmetic, payment allocation, offline delivery, or RLS boundaries.
- The three-column workspace intentionally scrolls horizontally on narrow
  screens. A fix must not move horizontal scrolling to the page or collapse a
  column into a tab.

## Testing and validation plan

Before implementation is approved, an engineer should:

1. Add a component regression test that renders the untouched billing route and
   states the chosen empty-state contract (including whether a zero total is
   visible), then renders a non-empty order with both customer fields and all
   action states.
2. Use a constrained-height DOM fixture to assert the total's bounding rectangle
   is within the bill column's visible rectangle before any scroll, and that the
   terminal actions remain reachable. Repeat with a customer-match card and a
   phone-validation error.
3. Add browser coverage at the smallest supported tablet viewport and a narrow
   viewport for the exact reported flow: open billing, verify the total without
   scrolling or clicking an extra control, add an item, enter a complete phone,
   and verify total/actions remain visible. Check both light and dark themes and
   reduced-motion mode.
4. Preserve existing assertions for exact integer-paise totals, payment dialog
   behavior, order editing, horizontal workspace scrolling, and the single-footer
   invariant.
5. Run the repository's normal validation (`npm run lint`, `npm run typecheck`,
   `npm test`, `npm run contrast`, `npm run build`, and the relevant Playwright
   counter suites) and perform a manual light/dark tablet check. The current
   component suite is green; the missing Playwright executable must be resolved
   before relying on browser geometry results.

## Open questions for `/opsx:propose`

- Does “on opening” require a visible zero-total empty composer, or does it mean
  immediately after the first menu selection?
- Should shift history remain in the middle column when no current order exists,
  with a persistent summary above it, or should the composer always occupy the
  column and history move below/behind it?
- On the smallest supported height, should lookup guidance be inside the line
  scroller, below the action row, or collapsed after the operator chooses a
  customer action?
- Which viewport is the reported failure: the 1024×768 tablet path, a phone
  viewport, a browser zoom level, or a device with a wrapped shell header?
