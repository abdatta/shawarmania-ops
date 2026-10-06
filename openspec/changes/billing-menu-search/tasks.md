## 1. Build

- [x] 1.1 `filterMenu` in `src/features/billing/menu-search.ts`: every word in the item's or category's name, empty categories dropped, unavailable items kept.
- [x] 1.2 `MenuSearch` in `menu-grid.tsx`: sticky field with a search icon and a × once typed; an empty-result line; the filter persists across taps.
- [x] 1.3 × and Escape clear and blur; Escape stands down for an open dialog, `details` or `role="menu"`, a modifier, a handled event, or focus in another text field.
- [x] 1.4 The sticky bar carries the focus ring's 3px as padding, so the column's scroll does not clip the ring (found in review of the first screenshots).
- [x] 1.5 Screenshots on tablet and phone, light and dark; approved by the owner [owner, 2026-10-06].

## 2. Pin

- [x] 2.1 `menu-search.test.ts`: words in any order and case, category match, empty categories dropped, unavailable kept, blank query returns the menu unchanged.
- [x] 2.2 `menu-grid.test.tsx`: typing narrows; a tap keeps the search; × clears and blurs; Escape clears and blurs from a tile; Escape with an open dialog, an open `details`, or focus in another input leaves it; the no-match line.
- [x] 2.3 `e2e/counter.spec.ts`: the whole-menu-fits test is replaced by a search test in a real browser, desktop and tablet: type, a tap keeps the search, Escape closes an open dialog first and then clears and drops the cursor, the no-match line, × clears. The pinned-bar check needs a menu that overflows a tablet's column, which the seven-item demo cannot; it lands with the demo's real menu, the next change on this branch.

## 3. Docs

- [x] 3.1 `docs/SCREENS.md`, `docs/BUSINESS_CONTEXT.md`, `docs/LIMITATIONS.md`, and the `MenuGrid` doc comment, no longer promise a menu that fits one screen.

## 4. Gate

- [x] 4.1 **Gate**: the proposal's gate, each clause pinned by a test above. Run locally on 2026-10-06: `lint`, `format:check`, `typecheck`, `contrast`, `build` and `test:e2e` (300 passed) green. `npm test` green but for `scripts/check-encoding.test.mjs`, whose two Windows-1252 cases fail identically on the tree before this change in this container (its Node decodes `windows-1252` differently); untouched here, and CI's runner decides it. `functions:typecheck` not run: no Deno on this machine, and no Edge Function is touched. No migration or policy, so the database job is not run.
