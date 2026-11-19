# Tasks: a-dish-can-show-its-photo

Read `proposal.md` and `design.md` first; the layout and the large view are
already settled with the owner, and `mockup/index.html` is the reference for
every visual question on the customer page.

## 1. The gate, off

- [x] 1.1 Declare `dish-photos` (*DP*) in `src/change-gates/gates.ts`: change
  `a-dish-can-show-its-photo`, `retireBy` 2027-02-15, `roundTrip` `none: the off
  path never reads menu_item_photos or the menu-photos bucket; photos wait
  untouched for the gate to return`.
- [x] 1.2 Migration: the `change_gates` row, off, with the proposal's On and Off
  sentences, change number 84. Run `npm run lint:migrations` and
  `npm run lint:change-gates`.

## 2. The editor against the mock (demo first)

- [x] 2.1 Extend the menu adapter type with a photo per item (key, format,
  aspect, source key and format, both crops, display URLs) and set/clear
  operations; implement them in the mock adapter, holding images as object URLs
  in memory and never writing anywhere. Mock tests, including read-only refusal
  for a biller.
- [x] 2.2 The image preparation module (design D4): orientation; the 2560 px
  original; the large photo at 1600 px for each of 4:3, 1:1 and 4:5 and the
  400×400 thumbnail, each cut from crop fractions, never scaled up; stepped
  downscaling; quality 0.92 / 0.90; WebP with a JPEG fallback; the two SHA-256
  keys; the small-crop warning. Unit-test it with a portrait, a landscape, a
  small and a square source, crops at the edges, and a canvas that cannot
  encode WebP.
- [x] 2.3 The cropper (design D5): choose `react-easy-crop` or the in-house
  fallback and record the choice and why in `design.md`; the two steps, the
  shape choice and its portrait default, drag, pinch, slider, wheel and
  keyboard, the photo always covering the frame, the zoom stop, the
  rule-of-thirds grid, Back/Next/Done, and reopening at saved crops for
  **Adjust**. Component tests for each, including that the output crop matches
  what the frame showed.
- [x] 2.4 The Photo field in the dish editor (design D8): dashed tile with
  **Add**; the thumbnail and large photo side by side; **Adjust**, **Change**,
  **Remove**; save order with progress, and **Photo not saved** with **Retry**;
  Cancel discards. Row thumbnails in Menu. All behind
  `useChangeGate('dish-photos')`; `describeChangeGate` unit tests in both
  states.
- [x] 2.5 Browser tests in demo: add with each shape, adjust, change, remove,
  cancel, a failed upload keeping the other edits. Tag them
  `@cg-on:dish-photos`. Check phone and tablet in both themes, the cropper by
  touch emulation; run `npm run contrast`.
- [x] 2.7 Owner revision, 2026-11-17 (design D5): one framing by default, the
  thumbnail the dashed square inside it; **Frame the thumbnail separately**
  and **Match the photo**; a separately framed thumbnail kept when the large
  frame moves; shape tabs reading **Wide**, **Square**, **Tall** with a drawn
  outline. Its component and browser tests, then new screenshots for 2.6.
- [x] 2.8 Owner request, 2026-11-18 (design D8): a row's thumbnail opens the
  saved photo enlarged, with **Large photo** and **Thumbnail** tabs. Component
  tests in both gate states, the browser spec, and screenshots.
- [x] 2.6 **Owner checkpoint**: show the owner the editor and cropper in demo
  with the gate on (screenshots or the staging site), and record their approval
  or requested changes in `design.md` before live work starts.

## 3. Storage, table and functions

- [x] 3.1 Write failing pgTAP and RLS tests first for everything below:
  isolation for `menu_item_photos` (another outlet's manager cannot select,
  and nobody can write it directly) and for the `menu-photos` bucket (another
  outlet's manager cannot upload, read or delete; a biller cannot write; a
  malformed path is refused); the same-outlet trigger; both set/clear functions
  refusing while the gate is off, for a biller, for another outlet, for a
  removed dish, and for a key whose three files are not all present under
  that outlet; the table's checks refusing a bad format, aspect or crop.
- [x] 3.2 Migration: the private `menu-photos` bucket (4 MB, `image/webp`,
  `image/jpeg`), its four storage policies modelled on
  `20260819000006_operator_statements_bucket.sql`, the table (design D2) with
  its checks, trigger and RLS, and `set_menu_item_photo` /
  `clear_menu_item_photo` (design D6). `npm run lint:migrations`.
- [x] 3.3 Migration: `public_menu_v2` (design D7: `public_menu`'s body plus the
  `photo` field `{key, format, aspect}`, null while the gate is off) and
  `public_menu_photo`, both service role only. Tests: exact field projection
  including highlights and that no source key or crop is sent, null for
  unknown, closed and empty alike, refusal for `anon` and `authenticated`,
  `public_menu` unchanged byte for byte, and every null case of
  `public_menu_photo` from the spec, a kept original's key included.
- [x] 3.4 Regenerate `src/data-access/database.types.ts` from a fresh reset and
  read the diff: a stray CLI telemetry line can land in the file, and is not
  the migration's fault.

## 4. The live editor

- [x] 4.1 The live adapter: upload the three files with the user's session
  (upsert; on **Adjust** only the two new ones), call the set/clear function,
  delete the previous files after success (the original only when its key
  changed); display URLs and the original for **Adjust** from short-lived
  signed URLs. Keep the approved UI unchanged.
- [x] 4.2 Auth e2e against a real backend: a manager round-trips add, adjust,
  replace and remove; the files exist and the old ones are gone; the counter's
  menu query and its realtime subscription see no change. Tag
  `@cg-on:dish-photos`.

## 5. The brand site (child change, repo `shawarmania`)

- [ ] 5.1 *(built 2026-11-18 on the brand repo's branch
  `claude/the-table-menu-shows-photos`, commit 7ce5e5d, Worker tests 220
  passed; not released: its push to `main` is live at once and waits for the
  owner's word)* In `shawarmania`, apply its change `the-table-menu-shows-photos`:
  the Worker calls `public_menu_v2` with fallback to `public_menu`, accepts the
  `photo` field, serves `/menu/<slug>/photo/<key>[-sm].<format>` through
  `public_menu_photo` and the edge cache, and renders design D9. Its own tests
  and checks. Its release is a push to that repo's `main`, which is live at
  once, so it waits for the owner's word.
- [ ] 5.2 Against local ops: render a menu with mixed photos in all three
  shapes, a sold-out photographed dish and photographed highlights, and compare
  with `mockup/index.html` at phone width (the mock-up's large view is always
  4:3 and its thumbnails are centre crops; the shapes and separate thumbnails
  are this change's); confirm a menu with no photos is byte for byte today's
  page.

## 6. Docs and verification

- [x] 6.1 Update `docs/DATA_MODEL.md`, `docs/SCREENS.md`,
  `docs/SECURITY_AND_PRIVACY.md`, `docs/OPERATIONS.md` (storage budget, the
  cache path, how to look at the bucket), `docs/DEMO_MODE.md`,
  `docs/TESTING.md`.
- [x] 6.2 `npm run format`, then every local gate in AGENTS.md, including the
  database job up to the types diff; push to `stage` and read the run for the
  browser suites, both gate states.
- [ ] 6.3 On staging: with the gate off the editor and the customer menu are as
  today; on, add photos to a few dishes on the fake outlet and read its menu;
  off again, they disappear; on again, they return.

## 7. PHASE GATE

- [ ] 7.1 The checkpoint in ROADMAP.md row #84 holds, every item checked
  against the running app: the owner approved the editor and cropper from the
  demo; a manager frames, adjusts, changes and removes a photo with no SQL; another outlet is
  refused by the database for the row and the file; the customer menu shows
  the approved layout and large view, leaves unphotographed dishes as they
  were, and reflects a change within the cache minute without a website
  deploy; Supabase serves each photo once per edge; the gate turns photos off
  and on for both surfaces; the counter, kitchen and receipt are unchanged;
  the demo still walks. Release, the pull, and archive follow the owner's word.
