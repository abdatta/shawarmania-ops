# Tasks: a-menu-opens-where-it-can-be-read

## 1. The placement rule

- [x] 1.1 `placeAnchoredPanel` in `src/components/ui/anchored-panel.ts` (design D1), with unit tests for: the preferred side fitting, flipping to the other side, neither fitting, and horizontal clamping at both edges.
- [x] 1.2 `useAnchoredPanel` in the same file (design D2): placed before paint, re-placed each frame while open, corrected for a transformed ancestor, listeners where there is no animation frame.

## 2. The two menus

- [x] 2.1 `PipelineCard`'s menu uses it, preferring above.
- [x] 2.2 `RowActionsMenu` uses it, preferring below, keeping its `align`.
- [x] 2.3 A component test per menu with its trigger at the window's edge, asserting the menu is inside the window; proved to fail on the tree before 2.1 and 2.2.
  - With both menus at `b296ff70` and the new tests kept: the top card's menu at `top` −104 (expected 40), the foot row's menu ending at 814 in a 768 px window (expected 724), the mid-slide menu ending at 456 (expected 396). Three failed, the five unchanged cases passed. The two placement tests that pinned the old `bottom`/`right` styles (`billing-counter.test.tsx`, `row-actions-menu.test.tsx`) now pin the same intent — above and right-aligned, below and left-aligned — in the new coordinates.

- [x] 2.4 Chrome over an edge counts as the edge (design D3): `usableArea()`, with `data-window-edge` on the phone's navigation bar and the demo counter's banner. Caught by the owner in the first build's screenshot: measured to the window, a row just above the bar opened its menu over the bar. Pinned by a pure case and a `RowActionsMenu` case with a bar; the component case fails with the edges ignored (menu bottom 674, over the bar, expected 584).

## 3. Docs

- [x] 3.1 `docs/DESIGN_SYSTEM.md`, component conventions: where a menu opens, and that it goes through the one rule.

## 4. Verification

- [x] 4.1 In a real build, phone and tablet, light and dark: the top card's menu with the page scrolled down opens below and is usable; a row menu at the foot of a list opens above; a menu opened while a card slides ends beside its trigger. No console errors.
  - Production build on 7414, headless Chromium (the app's pane was hidden, which stops animation frames there). Counter at 1280 × 720, light and dark: the top card's trigger scrolled to y 2, its menu opened below at 38, wholly on screen, and a real click on *Cancel order* opened its confirmation. A 1.5 s slide of a card under its open menu (the `useFlip` transform, slowed): the menu stayed 4 px above its trigger in every sample, the page did not scroll. Tablet portrait and phone, both themes: the top card's menu opens above as before, on screen. Row menus on Team and Menu at 390 × 844, both themes: a row just above the bar opens upward clear of it (Team: menu bottom 649, bar top 704), a row mid-screen opens downward; on a tablet the bar is not drawn and moves no edge; the demo counter's top card scrolled under the banner opens below it, clear of it. An idle open menu wrote its style 0 times in a second. No console errors anywhere.
- [x] 4.2 `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`, `npm run test:e2e`, and `e2e-auth/billing-served.spec.ts` against the local stack.
  - 2026-10-08, on a quiet machine after the bar edge (2.4): lint, typecheck, format:check, build and contrast clean; `npm test` 175 files / 2276 tests; `npm run test:e2e` 312 passed; the whole `test:e2e:auth` from a fresh reset, 35 passed. Earlier runs under load lost `billing.test.ts` › *uses missing-response evidence…* (a 1 s `vi.waitFor`, imports nothing touched here; 45 of 45 alone, three times) and two tablet counter cases (6 of 6 alone); each passed in the next quiet run.
- [x] 4.3 PHASE GATE: a correction with no ROADMAP.md checkpoint; the gate is the proposal's Gate line, met clause by clause, and CI green on the commit. The owner picks the push.
  - Every Gate clause is met by tasks 2.3, 2.4 and 4.1. Pushed 2026-10-08 as `1c239e73`, with the owner's go-ahead: `Deploy` 37728135493 green in every job, through migrate and publish, and again in 37751306829 and 37899217523. In production use from 2026-10-08; archived 2026-10-09 at the owner's call.
