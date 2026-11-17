# Tasks: a-dish-can-show-its-photo

Read `proposal.md` and `design.md` first; the layout and the large view are
already settled with the owner, and `mockup/index.html` is the reference for
every visual question on the customer page.

## 1. The gate, off

- [ ] 1.1 Declare `dish-photos` (*DP*) in `src/change-gates/gates.ts`: change
  `a-dish-can-show-its-photo`, `retireBy` 2027-02-15, `roundTrip` `none: the off
  path never reads menu_item_photos or the menu-photos bucket; photos wait
  untouched for the gate to return`.
- [ ] 1.2 Migration: the `change_gates` row, off, with the proposal's On and Off
  sentences, change number 84. Run `npm run lint:migrations` and
  `npm run lint:change-gates`.

## 2. The editor against the mock (demo first)

- [ ] 2.1 Extend the menu adapter type with a photo per item (key, format, a
  display URL) and set/clear operations; implement them in the mock adapter,
  holding picked images as object URLs in memory and never writing anywhere.
  Mock tests, including read-only refusal for a biller.
- [ ] 2.2 The image preparation module (design D4): orientation, 4:3 centre
  crop, 1200×900 large and 360×360 small, WebP with a JPEG fallback, SHA-256
  key, 1 MB refusal. Unit-test it with a portrait, a landscape, a small and a
  square source, and with a canvas that cannot encode WebP.
- [ ] 2.3 The Photo field in the dish editor (design D7): dashed tile with
  **Add**; preview with the thumbnail square marked; **Change**, **Remove**;
  save order and **Photo not saved** with **Retry**; Cancel discards. Row
  thumbnails in Menu. All behind `useChangeGate('dish-photos')`;
  `describeChangeGate` unit tests in both states.
- [ ] 2.4 Browser tests in demo: add, change, remove, cancel, a failed upload
  keeping the other edits. Tag them `@cg-on:dish-photos`. Check phone and
  tablet in both themes; run `npm run contrast`.
- [ ] 2.5 **Owner checkpoint**: show the owner the editor in demo with the gate
  on (screenshots or the staging site), and record their approval or requested
  changes in `design.md` before live work starts.

## 3. Storage, table and functions

- [ ] 3.1 Write failing pgTAP and RLS tests first for everything below:
  isolation for `menu_item_photos` (another outlet's manager cannot select,
  and nobody can write it directly) and for the `menu-photos` bucket (another
  outlet's manager cannot upload, read or delete; a biller cannot write; a
  malformed path is refused); the same-outlet trigger; both set/clear functions
  refusing while the gate is off, for a biller, for another outlet, for a
  removed dish, and for a key whose files are missing or under another outlet.
- [ ] 3.2 Migration: the private `menu-photos` bucket (1 MB, `image/webp`,
  `image/jpeg`), its four storage policies modelled on
  `20260819000006_operator_statements_bucket.sql`, the table with its trigger
  and RLS, and `set_menu_item_photo` / `clear_menu_item_photo`.
  `npm run lint:migrations`.
- [ ] 3.3 Migration: `public_menu_v2` (design D6: `public_menu`'s body plus the
  `photo` field, null while the gate is off) and `public_menu_photo`, both
  service role only. Tests: exact field projection including highlights, null
  for unknown, closed and empty alike, refusal for `anon` and `authenticated`,
  `public_menu` unchanged byte for byte, and every null case of
  `public_menu_photo` from the spec.
- [ ] 3.4 Regenerate `src/data-access/database.types.ts` from a fresh reset and
  read the diff: a stray CLI telemetry line can land in the file, and is not
  the migration's fault.

## 4. The live editor

- [ ] 4.1 The live adapter: upload both files with the user's session (upsert),
  call the set/clear function, delete the previous key's files after success;
  display URLs from short-lived signed URLs. Keep the approved UI unchanged.
- [ ] 4.2 Auth e2e against a real backend: a manager round-trips add, replace
  and remove; the files exist and the old ones are gone; the counter's menu
  query and its realtime subscription see no change. Tag `@cg-on:dish-photos`.

## 5. The brand site (child change, repo `shawarmania`)

- [ ] 5.1 In `shawarmania`, apply its change `the-table-menu-shows-photos`:
  the Worker calls `public_menu_v2` with fallback to `public_menu`, accepts the
  `photo` field, serves `/menu/<slug>/photo/<key>[-sm].<format>` through
  `public_menu_photo` and the edge cache, and renders design D8. Its own tests
  and checks; release per its own AGENTS.md (push to `main`).
- [ ] 5.2 Against local ops: render a menu with mixed photos, a sold-out
  photographed dish and photographed highlights, and compare with
  `mockup/index.html` at phone width; confirm a menu with no photos is byte
  for byte today's page.

## 6. Docs and verification

- [ ] 6.1 Update `docs/DATA_MODEL.md`, `docs/SCREENS.md`,
  `docs/SECURITY_AND_PRIVACY.md`, `docs/OPERATIONS.md` (storage budget, the
  cache path, how to look at the bucket), `docs/DEMO_MODE.md`,
  `docs/TESTING.md`.
- [ ] 6.2 `npm run format`, then every local gate in AGENTS.md, including the
  database job up to the types diff; push to `stage` and read the run for the
  browser suites, both gate states.
- [ ] 6.3 On staging: with the gate off the editor and the customer menu are as
  today; on, add photos to a few dishes on the fake outlet and read its menu;
  off again, they disappear; on again, they return.

## 7. PHASE GATE

- [ ] 7.1 The checkpoint in ROADMAP.md row #84 holds, every item checked
  against the running app: the owner approved the editor from the demo; a
  manager adds, changes and removes a photo with no SQL; another outlet is
  refused by the database for the row and the file; the customer menu shows
  the approved layout and large view, leaves unphotographed dishes as they
  were, and reflects a change within the cache minute without a website
  deploy; Supabase serves each photo once per edge; the gate turns photos off
  and on for both surfaces; the counter, kitchen and receipt are unchanged;
  the demo still walks. Release, the pull, and archive follow the owner's word.
