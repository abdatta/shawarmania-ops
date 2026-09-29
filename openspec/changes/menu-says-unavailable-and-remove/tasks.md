# Tasks: menu-says-unavailable-and-remove

## 1. Pin it

- [x] 1.1 Tests that fail today: the Menu screen's row actions read Mark
  unavailable / Mark available and Remove, the badge reads Unavailable, and Remove
  confirms with "Remove item" (`menu-surface.test.tsx`); the counter tile reads
  Unavailable and is named "— unavailable" (`billing-counter.test.tsx`,
  `e2e/counter.spec.ts`, `e2e/operations.spec.ts`).

## 2. The database (design D2)

- [x] 2.1 Migration: rename `retire_menu_item` to `remove_menu_item`; recreate
  `retire_menu_item` as a forwarding wrapper with the same grants.
- [x] 2.2 `27_live_menu.sql`: removal through `remove_menu_item`; the wrapper
  still removes.
- [x] 2.3 `database.types.ts` carries `remove_menu_item` (entered by hand in the
  generator's order, because the local stack is shared; CI's regeneration diff
  proves it).
- [x] 2.4 `openspec/todos/drop-retire-menu-item.md`.

## 3. The app (design D1, D3, D4)

- [x] 3.1 `menu-surface.tsx`: action labels, the Unavailable badge, the Remove
  dialog, `removing` state, `remove-<id>` test ids.
- [x] 3.2 `menu-grid.tsx`: the Unavailable label in the price slot, the
  accessible name, the comment that describes it.
- [x] 3.3 `adapters.ts`, `mock/menu.ts`, `supabase-adapters/menu.ts`:
  `retireItem` becomes `removeItem`, calling `remove_menu_item`.
- [x] 3.4 Comments and fixture notes that describe a menu item as off or retired
  (`gates/registry.ts`, `mock/fixtures/menu.ts`).

## 4. Docs and specs

- [x] 4.1 `docs/SCREENS.md`, `docs/DEMO_MODE.md` and the onboarding runbook in
  `docs/OPERATIONS.md`, occurrence by occurrence. `DATA_MODEL`, `GLOSSARY` and
  `LIMITATIONS` turned out to use *retire* only for other things.

## 5. Gate

- [x] 5.1 `format`, `lint`, `typecheck`, `test`, `build`, `test:e2e`; `test:db`.
  *Done 2026-09-28 together with `the-menu-is-public`, on an isolated local
  stack: `test:db` 2774/2774, unit 2040/2040, `test:e2e` 284/284; the regenerated
  types matched the hand-entered `remove_menu_item` exactly.*
- [x] 5.2 Browser: the Menu screen and the counter in demo mode, phone and
  tablet, light and dark. *Done: Mark unavailable / Edit / Remove on the row; the
  counter tile's Unavailable fits the price slot without narrowing the name.*
- [x] 5.3 Final search for menu uses of *retire*, *Turn off*, *OFF* and *off the
  menu* outside archives: only history and the wrapper. *Done: `src`, `e2e` and
  `docs` carry none; the living specs keep the old words until this folder's
  deltas merge at archive; `27_live_menu.sql` names `retire_menu_item` on purpose,
  to prove the wrapper.*
