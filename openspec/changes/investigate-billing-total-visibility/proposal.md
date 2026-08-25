# Proposal: Billing Total First-Viewport Visibility

> **Investigation only · Relates to #5 · Preliminary and requires engineer review before implementation**

## Problem

When the billing page opens, the current order total is not immediately
visible. Issue #5 reports that the total appears to be pushed down or hidden
behind additional billing controls and asks for investigation before any fix is
implemented. The desired behavior is for the current total to be readable in
the first viewport without scrolling or an extra interaction, while the
customer fields and terminal actions remain usable.

This change contains only a preliminary investigation and proposal. It does
not implement a layout or billing fix.

## Investigation findings

### Confirmed evidence from current `main`

1. **The bill panel is absent on the untouched billing route.** The middle
   column in `src/features/billing/billing-counter.tsx` branches at lines
   654–717: it mounts `BillPanel` only when `lines.length > 0 || editingOrder`;
   otherwise it mounts `MyShiftSurface`. Therefore a newly opened route with no
   draft has no `bill-total` element at all. The current total cannot be visible
   until the operator selects an item or opens an order for editing.

2. **The total is inside the composer footer.**
   `src/features/billing/bill-composer-footer.tsx` computes the total with
   `billTotals` and renders the `Total` row at lines 51–87. The footer then
   renders two customer inputs at lines 89–128, phone validation or customer
   guidance at lines 130–144, and the Order/Paid action row at lines 146–178.
   The source establishes normal-flow ordering, but not a guarantee that the
   total and the full footer remain within the visible column at every height.

3. **The line list is the only explicitly scrolling region inside
   `BillPanel`, while the footer has no explicit non-shrink contract.**
   `src/features/billing/bill-panel.tsx` defines a `flex min-h-0 flex-1
   flex-col` panel at lines 47–57. Its line list is `flex-1
   overflow-y-auto` at lines 69–127; the footer wrapper is appended at line
   129 with border and padding but no `shrink-0` or separate visibility
   boundary. The component comments describe the footer as pinned, but the
   class contract does not independently prove that its full height is
   preserved.

4. **Optional lookup content is a sibling below the panel.** When a complete
   phone finds a saved customer, `billing-counter.tsx` renders the
   `customer-match` card, including `Use saved details` and `Keep this order`,
   at lines 667–709 after `BillPanel`. The bill column is a vertical flex
   container at lines 628–718 and has no vertical overflow owner. That optional
   card can compete with the panel and its footer for short available heights.

5. **The workspace intentionally clips vertical overflow.**
   `billing-counter.tsx` creates the three-column workspace at lines 576–585
   with `h-full`, `min-h-0`, `overflow-x-auto`, and `overflow-y-hidden`.
   `src/features/counter/counter-shell.tsx` supplies the billing region with
   `h-[calc(100dvh-8rem)] min-h-[36rem]` at lines 154–161. These constraints
   preserve the counter's no-page-scroll and horizontal-three-column contract,
   but content that escapes a column vertically can be clipped rather than
   making the page scroll.

6. **The durable specification already requires reachable controls.**
   `openspec/specs/counter-billing/spec.md` requires the current bill and
   activity columns to scroll internally without moving current-bill controls
   off screen (lines 737–750). It also requires the editing footer to carry the
   total, customer fields, and terminal actions exactly once (lines 807–811).
   Existing tests cover total arithmetic and text, but do not assert first-
   viewport geometry with all footer and optional lookup content present.

7. **The relevant implementation boundary is recent.** Commit `4247753`
   (`Preparing orders: pipeline and counter share settlement state`) modified
   the billing counter branch, bill panel/footer, and activity layout while
   making the middle column switch between shift history and the composer.
   This commit should be reviewed as the likely regression boundary, but its
   presence does not by itself establish causality.

The current billing component suite was run against the same `main` source:
30 tests passed. The tablet Playwright suite was attempted but could not launch
because this environment does not have the Chromium executable installed; no
browser geometry conclusion was drawn from that attempt.

## Root-cause hypothesis — not confirmed

There are likely two cooperating causes:

1. **Empty-state absence.** The initial branch shows shift history rather than a
   current-bill shell, so the expected total does not exist until the first
   menu selection. This is confirmed code-path evidence and may fully explain
   the report if “on opening” means the untouched billing route.

2. **Footer height competition after an item is selected.** The total sits at
   the top of a footer whose remaining content includes two inputs, validation
   guidance, and two terminal actions. A customer-match card is then rendered
   outside the panel. At a short viewport, the bill column has no vertical
   overflow owner while the workspace hides vertical overflow, so flex sizing
   or clipping may make the total or controls appear pushed away or hidden.

The source does **not** prove that buttons literally paint over the total:
the markup places them after the total in normal flow. A supported-browser
geometry check is required to distinguish absence, clipping, flex shrink,
insufficient viewport height, or a perception problem caused by the history
surface occupying the middle column.

## Proposed approach for engineer review

1. **Resolve the product contract first.** Decide whether an untouched billing
   route should show a zero-valued current-bill summary, a persistent but
   disabled composer shell, or a clearly separated history-only state. The issue
   favors a persistent current total, while the existing implementation and
   OpenSpec describe composition as beginning on the first item tap. This choice
   must be explicit rather than hidden in a layout change.

2. **Give the total a stable first-viewport region.** Once the empty-state
   contract is chosen, keep the current total in a summary/header region or
   make the footer summary and terminal action groups explicit non-shrinking
   regions. The item list should remain the only internal scroller. Preserve
   the single-footer invariant and do not duplicate the total in the editing
   pin, which already carries the editing order's total.

3. **Contain optional lookup content deliberately.** Customer-match guidance
   and its actions should either be inside the bill panel's owned scroll region
   or be accounted for by the column layout so they cannot push the total or
   terminal controls outside the visible region. At narrow widths, controls may
   wrap or stack, but all touch targets must remain reachable and the
   three-column horizontal-scroll behavior must remain unchanged.

4. **Update durable requirements only after the behavior is chosen.** If the
   empty-state behavior or control visibility contract changes, update
   `openspec/specs/counter-billing/spec.md` and `docs/SCREENS.md` before the
   change is archived. No change to billing arithmetic, adapters, payment
   commands, offline delivery, database policy, or tenancy is indicated.

## Affected components

- `src/features/billing/billing-counter.tsx` — initial middle-column branch,
  bill-column sizing, and customer-match placement.
- `src/features/billing/bill-panel.tsx` — line-list versus footer containment
  and visible-height ownership.
- `src/features/billing/bill-composer-footer.tsx` — total summary, customer
  fields, validation copy, and terminal actions.
- `src/features/billing/billing-counter.test.tsx` — constrained-height and
  optional-content regression coverage.
- `e2e/counter.spec.ts` — tablet and narrow-viewport first-viewport assertions.
- `openspec/specs/counter-billing/spec.md` and, if behavior changes,
  `docs/SCREENS.md` — durable visibility contract.

This investigation branch contains no application or source-code changes.

## Risks and edge cases

- A zero total on an untouched composer could be mistaken for a billable order;
  disabled actions and an explicit empty state must make “no items yet” clear.
- Keeping shift history while adding a persistent total could create two
  competing primary areas in the middle column; one surface should own the
  current-bill summary and one should own shift history.
- Customer-match prompts, phone errors, long customer names, and wrapped action
  labels add height after the initial render. The layout must remain usable at
  the smallest supported tablet height in both themes.
- Editing a saved order must retain exactly one total, one set of customer
  fields, and one action footer; the editing pin must not regain a duplicate.
- The total must continue to derive from integer-paise line snapshots through
  the existing domain calculation. This proposal does not alter money
  arithmetic, tender allocation, offline acceptance, or RLS.
- The three-column workspace intentionally scrolls horizontally below its
  minimum width. The fix must not move horizontal scrolling to the page or
  collapse a column into a tab.

## Testing and validation plan

Before implementation is approved, an engineer should:

1. Add a component regression test for the untouched route that asserts the
   chosen empty-state contract, then render a non-empty order with customer
   fields, phone validation, and all terminal-action states.
2. Use a constrained-height DOM fixture to assert that the total's bounding
   rectangle is within the bill column's visible rectangle before scrolling,
   and that Order/Paid remain reachable. Repeat with a customer-match card and
   a phone-validation error.
3. Add browser coverage at the smallest supported tablet viewport and a narrow
   viewport for the reported flow: open billing, verify the total without
   scrolling or an extra click, add an item, enter a complete phone, and verify
   total/actions remain visible. Check light, dark, and reduced-motion modes.
4. Preserve existing exact-paise total, payment-dialog, order-editing,
   horizontal-workspace, and single-footer assertions.
5. Run the normal repository validation (`npm run lint`, `npm run typecheck`,
   `npm test`, `npm run contrast`, `npm run build`, and relevant Playwright
   suites) plus a manual tablet check. The component suite is green in this
   investigation; the browser suite requires the missing Chromium executable
   before geometry results can be trusted.

## Non-goals

- Implementing the layout or visibility fix.
- Changing bill arithmetic, payment methods, settlement commands, or offline
  delivery semantics.
- Changing customer identity persistence or its database nullability.
- Replacing the counter's three-column workspace with responsive tabs,
  navigation, or page-level horizontal scrolling.
- Adding a new billing data source, database migration, RLS policy, or adapter.

## Open questions for the implementation proposal

- Does “on opening” require a visible zero-total empty composer, or does it
  mean immediately after the first menu selection?
- Should shift history remain in the middle column with a persistent summary
  above it, or should the composer always occupy that column and history move
  below/behind it?
- Should customer-match guidance be in the line-list scroller, below the action
  row, or collapsed after the operator chooses a customer action?
- Which viewport reproduces the report: the 1024×768 tablet path, a phone
  viewport, browser zoom, or a device with a wrapped shell header?
