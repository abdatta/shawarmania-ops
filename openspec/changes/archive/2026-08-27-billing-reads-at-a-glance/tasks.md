# Tasks

- [x] 1.1 Move `owner-billing-history` to `nav.order` 3 in
      `src/gates/registry.ts` and renumber `owner-cash-drawer` through
      `owner-alerts` by one, leaving `role`, `path` and `state` untouched.
- [x] 1.2 Add a `dense` four-column presentation to
      `src/features/billing/payment-total-cards.tsx`, with the card otherwise
      unchanged: same uniform padding, same label size, same height.
- [x] 1.3 Fit the figure to its own card rather than fixing or ramping its size:
      full display face until the figure would outgrow the content box, then
      shrunk exactly as far as it must, floored at the label's size, still left
      aligned. Measured rather than computed from a character count, because the
      display face is proportional.
- [x] 1.4 Render the cards under the day bar in
      `src/features/billing/manager-billing-history.tsx`, with a silhouette of
      the same height while the day loads so the tab strip does not move, and
      remove them from the Status branch.
- [x] 1.5 Rename the fourth card to `AOV`.
- [x] 1.6 Update `manager-billing-history.test.tsx` and `e2e/counter.spec.ts` to
      assert the figures on every tab rather than behind Status.
- [x] 1.7 Correct the two stale passages in `docs/SCREENS.md`: the `Totals`
      view that is now a row above the tabs, and the filter grid that is now two
      controls.
- [x] 1.8 Gate: `npm run typecheck`, `npm run lint`, `npm run format:check`,
      `npm run contrast`, `npm test`, and the browser check at 360/375/431/768/
      1280 in both themes, with the new assertions proved to fail on the tree
      before the fix.
