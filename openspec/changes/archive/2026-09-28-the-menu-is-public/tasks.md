# Tasks: the-menu-is-public

## 1. The database (design D1–D4)

- [x] 1.1 Migration: `menu_slug_from`, `free_menu_slug`, `outlets.menu_slug`
  backfilled, unique and shape-checked, the derive-or-keep trigger.
- [x] 1.2 Migration: `public_menu(slug)`, service role only.
- [x] 1.3 `64_the_menu_is_public.sql`: derivation, next-free address, trimming
  and lowercasing, blank keeps, rename keeps, both refusals, who may call the
  reader, what it answers, and the one null.
- [x] 1.4 Regenerate `database.types.ts`.

## 2. The app (design D1, D5, D6)

- [x] 2.1 `lib/public-menu-link.ts`: the link, the host, the derivation and the
  shape check, mirroring the database's; tested against the same case the pgTAP
  file uses.
- [x] 2.2 Adapters: `NewOutlet.menuSlug`; `OutletMenu.publicMenuSlug` on the read
  the Menu screen already makes; both refusals as sentences.
- [x] 2.3 Mock: fixture addresses derived as the database derives them; create,
  edit, derive, keep and refuse as the database does.
- [x] 2.4 Outlets page: the Public menu tile and the optional form field with
  the derived address as its placeholder.
- [x] 2.5 Menu screen: sharing the public menu. First a link under the chips;
  then, on the owner's word [2026-09-29], an icon beside the title
  (`PageHeader.titleAccessory`) that **shares** the address as a bill's receipt is
  shared — the three cases lifted into `lib/use-share-link.ts`, which
  `BillReceiptShare` now uses too (its 8 tests unchanged). Pinned by three
  failing-first tests: share sheet, clipboard, selectable text. Then a labelled
  **Share** button left of **Add** in secondary colours, sharing the link alone
  [owner, 2026-09-29]; the title slot added for the icon removed again.
- [x] 2.8 Share and Add at the right edge. `PageHeader`'s controls row wrapped
  under the title and started at the left, so on Menu — the one page with both
  outlet chips and an action — Add sat beside the chips instead of at the right
  as on every other page. With both present the row now grows to full width and
  the actions take `ml-auto`; a header with only chips or only an action is
  unchanged (checked on Attendance and Drawer).
- [x] 2.6 The Outlets page's details shimmer reshaped for the added row: Details
  measured 317 px at 375 px wide before and 369.5 px after (a 45.5 px tile and a
  7 px gap), so 19.75rem became 23.125rem; then 387 px once the tile carried its
  Copy button, so 24.1875rem.
- [x] 2.7 A **Copy** button on the Public menu tile [owner, 2026-09-29]: copies the
  whole address with a tick and "Copied"; where the device cannot copy it
  selects the address instead and claims nothing. Pinned by two failing-first
  tests.

## 3. Docs and specs

- [x] 3.1 `docs/DATA_MODEL.md`, `docs/SCREENS.md`, `docs/OPERATIONS.md`,
  `docs/SECURITY_AND_PRIVACY.md`, `docs/DEMO_MODE.md`.
- [x] 3.2 Roadmap row (#61).

## 4. Gate

- [x] 4.1 `format`, `lint`, `typecheck`, `test`, `build`, `test:e2e`, `test:db`.
  *Done 2026-09-28 in the worktree, on an isolated local stack (project
  `shawarmania-ops-publicmenu`, ports 553xx) so the shared one was never reset:
  `test:db` 2774/2774 across 71 files; unit 2040/2040; `test:e2e` 284/284; lint 0
  errors (the 15 warnings predate this change and none is in a touched file);
  contrast 60 pairs AA in both themes; types regenerated from that stack.
  `test:rls` and `test:e2e:auth` are left to CI.*
- [x] 4.2 Browser: the Outlets page and the Menu link in demo mode, phone, light
  and dark. *Done: the Public menu tile, the form field with its warning, View
  public menu, in both themes at 390 px.*
- [x] 4.3 The brand site's half, change 13 `the-table-menu-reads-ops`, verified
  against this stack with `wrangler dev`: a real menu, Unavailable one cache
  minute after it was set, the outage fallback, a closed outlet not found.
- [x] 4.4 After deploy, with the brand site's Worker live: the owner marks an item
  unavailable and sees it greyed out on the table's QR menu within a minute.
  *Done 2026-09-29 in production, at the owner's request, from the owner's Edge
  session on Kalyani Cafe: Mayonnaise marked unavailable, Peri Peri repriced
  ₹145 → ₹149 with a test description and the veg flag, Burgers moved above
  Shawarmas — all four showed on both `/menu/kalyani-cafe/` and `/menu/` (the
  302 to it). Then every edit reverted in the app, and a database snapshot of all
  9 sections and 55 items matched the one taken before the test exactly, bar
  `updated_at`. Remove and adding an item were deliberately not exercised,
  because neither can be undone without leaving rows behind.*
