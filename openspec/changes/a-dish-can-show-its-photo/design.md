# Design: A Dish Can Show Its Photo

## Shape of the change

```
 Manager's phone (ops, Menu → dish editor)
   pick photo → keep a 2560 px original
   → crop step 1: large photo, 4:3 | 1:1 | 4:5   → encode, 1600 px long side
   → crop step 2: square thumbnail                → encode, 400 × 400
   → upload to Storage, bucket menu-photos, folder <outlet_id>/:
        <key>.<ext>  <key>-sm.<ext>  <source_key>-src.<ext>
   → set_menu_item_photo(...)                    (refuses while DP off)
                                │
                     public.menu_item_photos  (one row per photographed dish)
                                │
 Brand-site Worker (shawarmania repo)
   GET /menu/<slug>/  → public_menu_v2(slug)  → items carry "photo": {key, format, aspect} | null
   GET /menu/<slug>/photo/<key>[-sm].<ext>
        edge cache hit → serve
        miss → public_menu_photo(slug, key) → object base name | null
             → fetch from Storage with the service-role key → cache 1 year → serve
```

Two repos, one switch: everything the customer sees depends on what
`public_menu_v2` sends, and it sends no photo while `dish-photos` is off.

## Decisions

### D1. Supabase Storage behind the Worker's cache

The bucket is `menu-photos`, **private**, with `file_size_limit` 4 MB (room for
the kept original as JPEG; the large photo is typically 300 to 400 KB) and
`allowed_mime_types` `image/webp, image/jpeg`. A customer never fetches from
Supabase: the Worker already holds `OPS_SERVICE_ROLE_KEY` for `public_menu`, so
on an edge-cache miss it reads the object with that key and caches the response
with `Cache-Control: public, max-age=31536000, immutable`. Photos are addressed
by content hash (D3), so a cached copy never goes stale; a changed photo is a
new address.

**Budget.** About 1.5 MB per photographed dish across its three files (large
≈350 KB, thumbnail ≈30 KB, original ≈1 MB); ~80 dishes ≈ 120 MB, against the
Free plan's 1 GB. Egress is one fetch of the large photo and the thumbnail per
Cloudflare location that serves a customer; the original is never served to a
customer and is read only when a manager re-crops. Even a few hundred
locations-times-photos a month sit well inside the Free plan's 5 GB. This sits
beside #54's receipt decision, which kept Supabase out of serving bytes for the
same reason.

**Rejected:**

- **Imgur.** Not a host for a business's website images: the owner would hold
  no contract, anonymous uploads have been purged before (2023), and it has
  blocked whole countries (the UK, 2025). Upload from the app would also put an
  Imgur client ID in the browser. The failure mode is a menu of broken images
  that nobody notices until a customer does.
- **Cloudflare R2.** Free to 10 GB with no egress charge, and the Worker could
  bind it directly. Rejected for now because uploads would need a new Worker
  endpoint that authenticates ops users, a second storage credential, and the
  outlet rule enforced in Worker code instead of by Postgres policy, against a
  saving that does not exist at this size. It is the move if Supabase storage
  ever becomes a cost.
- **A public bucket.** Simpler (no Worker fetch with a key), but the photo URLs
  would be direct Supabase URLs that any visitor or scraper could hit, which
  puts egress outside the cache's control, it would expose the outlet's id in
  every image address, and it would make the kept originals public too.
- **Supabase image transformations** (resize on the fly). A Pro-plan feature,
  and resizing once on the manager's phone is cheaper than resizing on every
  cache miss.

### D2. Photos are their own table, not a column on `menu_items`

```
public.menu_item_photos (
  item_id        uuid primary key references menu_items,
  outlet_id      uuid not null references outlets,
  photo_key      text not null,   -- 64 lowercase hex (D3)
  photo_format   text not null,   -- 'webp' | 'jpeg'
  aspect         text not null,   -- '4:3' | '1:1' | '4:5', the large photo's shape
  source_key     text not null,   -- 64 lowercase hex, the kept original
  source_format  text not null,   -- 'webp' | 'jpeg'
  large_crop     jsonb not null,  -- {x, y, w, h} as fractions of the original
  thumb_crop     jsonb not null,  -- the same, for the square thumbnail
  updated_at     timestamptz not null default now(),
  updated_by     uuid
)
```

Check constraints hold the formats, the aspect set and each crop's four numbers
within 0..1 (this is a new table, so a constraint here is allowed). A trigger
refuses a row whose `outlet_id` is not its item's outlet, the same way
`menu_items` checks its category. The crops are stored so **Adjust** reopens
the cropper at the framing last saved.

**Why not a column.** The counter subscribes to changes on `menu_items` and
re-reads its whole menu on each one (menu-management, *The live counter prefers
the latest reachable menu*), and caches that menu in IndexedDB for offline
shifts. A photo column would make every upload ripple into every counter tablet
and change the shape of what the tablets cache, which is exactly the "reaches
the counter" condition the gate rules exist for. A separate table is invisible
to the counter.

### D3. A photo is named by the hash of what customers see

`photo_key` is SHA-256 over the encoded large photo's bytes followed by the
encoded thumbnail's bytes, so re-framing **either** of them gives a new key.
`source_key` is SHA-256 over the kept original's bytes. Objects:

- `<outlet_id>/<photo_key>.<ext>`, the large photo
- `<outlet_id>/<photo_key>-sm.<ext>`, the thumbnail
- `<outlet_id>/<source_key>-src.<ext>`, the kept original

Content addressing makes the Worker's year-long cache safe: the bytes behind an
address never change. The public page shows `/menu/<slug>/photo/<photo_key>.<ext>`,
which reveals no id (the public menu has promised "no ids" since #61). A
re-crop with **Adjust** reuses the original, so only the two small files are
uploaded again.

### D4. The phone does the image work, at high quality

The owner wants a photo that "feels high quality to the customer", so these are
set for quality first; the files stay small only because no phone screen can
show more than this.

1. **Pick** with `<input type="file" accept="image/*">`, which offers camera and
   gallery. Decode with `createImageBitmap(file, { imageOrientation:
   'from-image' })` so a portrait phone photo is upright.
2. **Keep the original**: scale so the long side is at most 2560 px (never up),
   encode WebP at quality 0.92. This is what the cropper shows and what every
   crop is cut from, now and on any later **Adjust**.
3. **Large photo**: cut `large_crop` from the original at the chosen aspect;
   output 1600 px on the long side (1600×1200, 1600×1600 or 1280×1600), or the
   crop's own pixel size if smaller (never scaled up); WebP at 0.92.
4. **Thumbnail**: cut `thumb_crop` (square) from the original; output 400×400
   (88 CSS px at up to 4.5× density, so sharp on the best phone screens); WebP
   at 0.90.
5. **WebP fallback**: if `canvas.toBlob(..., 'image/webp', q)` hands back
   anything other than WebP (older Safari), encode `image/jpeg` at the same
   quality and record the format.
6. Draw with `imageSmoothingQuality = 'high'`; when shrinking by more than
   half, halve in steps so fine detail (crumbs, char marks, herbs) does not
   alias.
7. **A small photo** (its crop under 800 px on the long side) is allowed, and
   the editor says plainly that it may look soft when opened large.

A 400 px thumbnail at ~30 KB is what keeps a 30-photo menu light on a
customer's mobile data; the large photo loads only when it is opened.

**Rejected: uploading the camera file untouched.** 3 to 6 MB per photo, sent
over the manager's mobile data, stored at four times the size, and shrunk by
the customer's phone anyway; no visible gain.

### D5. The cropper

```
 Step 1 · Large photo          [ 4:3 ]  1:1   4:5
 ┌──────────────────────────────┐
 │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
 │ ░░┌────────────────────┐░░░░ │   the frame stays put and keeps its shape;
 │ ░░│                    │░░░░ │   the photo moves and zooms under it
 │ ░░│                    │░░░░ │
 │ ░░└────────────────────┘░░░░ │
 └──────────────────────────────┘
   zoom  ─────●──────────
   [ Back ]                 [ Next ]

 Step 2 · Menu thumbnail                (square)
   the same, with a square frame, starting centred on step 1's frame
   [ Back ]                 [ Done ]
```

- It opens in a full-screen sheet over the dish editor, on a dark backdrop, so
  the photo is judged as the customer will see it.
- **Shapes**: a three-way choice for step 1, 4:3 by default, or 4:5 when the
  original is portrait. Changing shape keeps the centre of the current frame.
- **Moving and zooming**: drag (one finger or mouse) to move; pinch, the
  slider, or the mouse wheel to zoom; arrow keys move and `+`/`-` zoom for a
  keyboard. The photo always covers the frame: it cannot be dragged or zoomed
  out so far that an edge shows. Zoom stops at the point where the crop would
  be under 400 px, so the large photo cannot be zoomed into mush.
- A rule-of-thirds grid shows while a finger is down, and hides after.
- **Done** returns to the dish editor, which shows the result as the customer
  will: the square thumbnail and the large photo side by side.
- **Adjust** (in the dish editor, for a saved photo) reopens the cropper on the
  kept original at the saved crops and shape.

**Use `react-easy-crop`** (MIT, small, touch pinch, fixed aspect, keeps the
photo covering the frame) unless its bundle size or its styling fights the
design system, in which case an in-house pointer-events cropper with the same
behaviour. Record which in this file at apply time. The output crop is taken as
fractions of the original so it survives the original being re-scaled.

**Chosen at apply time (2026-11-16): the in-house cropper**, in
`src/features/menu/photo/` (`crop-geometry.ts` for the rules,
`photo-cropper.tsx` for the screen). `react-easy-crop` (6.2.5) was the first
choice and lost on three counts:

- **Its styling fights the design system.** It injects its own stylesheet at
  run time, with its own colours for the dimmed area, the frame and the grid.
  Here those are semantic tokens (`--photo-stage`, `--on-photo-stage`,
  `--photo-stage-dim`), the same in both themes and gated by the contrast
  check; overriding an injected sheet would be a second set of colours to keep
  in step.
- **The test that matters could not be written against it.** "The output crop
  matches what the frame showed" needs the frame's and the photo's positions;
  `react-easy-crop` measures both from layout and image load, which jsdom has
  neither of, so the test would assert against mocks of its internals. The
  in-house cropper keeps the framing itself as its state (a rectangle in the
  original's pixels), draws the photo from it, and its tests read the positions
  it gives the frame and the photo straight off the page.
- **It covers less of D5 than it seems.** Zooming by key, the
  grid-while-a-finger-is-down, the zoom stop at 400 px and
  the thumbnail starting inside step 1's frame are ours to write either way.

The in-house cropper is about 680 lines with comments (geometry and screen) and no
dependency: pointer events for
one-finger drag and two-finger pinch (iOS Safari 13+ and every Android Chrome
have them), a non-passive wheel listener, arrow keys and `+`/`-`, and a range
input for the slider. Every rule (covering the frame, the zoom stop, zoom about
the fingers, a new shape keeping the centre and zoom, the thumbnail's starting
square) is a pure function with its own unit test.

**Two details settled while building it.**

- **The cropper does not wait for the encoder.** Picking a photo decodes it
  upright and knows the kept original's size at once (`fitWithin(…, 2560)`), so
  the cropper opens on the picked file itself while the 2560 px original
  encodes behind it; Save waits for that encoding if it has not finished. The
  framings are in the kept original's pixels throughout, so the zoom stop is
  measured where it matters.
- **A failed photo in the demo is an offline one.** The mock refuses an upload
  while the browser is offline, which is how the browser suite and a walkthrough
  show **Photo not saved** and **Retry** without a test-only switch.

**Rejected:**

- **Centre crop with no choice** (the first write-up). The owner asked for the
  manager to choose the framing.
- **One crop for both uses** (the thumbnail as the middle of the large photo).
  The thumbnail is small; the best square is often a close-up the large frame
  should not be.
- **Free-form crop shapes.** The menu's rows need a square, and three
  named shapes keep the large view looking deliberate across the menu.

### D6. Writes go through two functions, gated

- `set_menu_item_photo(p_item_id uuid, p_key text, p_format text, p_aspect
  text, p_source_key text, p_source_format text, p_large_crop jsonb,
  p_thumb_crop jsonb)`: security definer; refuses unless
  `app_change_gate('dish-photos')`; refuses a caller who may not edit that
  item's outlet's menu (the same entitlement as editing the item); refuses a
  removed item; refuses unless all three objects exist in `storage.objects`
  under that outlet; upserts the row; returns the previous `photo_key`,
  `photo_format`, `source_key` and `source_format` so the client can delete the
  old files.
- `clear_menu_item_photo(p_item_id uuid)`: same checks, deletes the row,
  returns the same previous values.

The client deletes the replaced or removed files after the function succeeds
(the original only when its key changed). If that delete fails, a stray file
remains, which nothing links (non-goal: sweep).

**RLS.** `menu_item_photos`: select for anyone who may read that outlet's menu
(billers included, harmlessly), no direct insert, update or delete for
`authenticated`; writes only through the two functions. Storage policies on
`storage.objects` for bucket `menu-photos`, modelled on
`20260819000006_operator_statements_bucket.sql`: the first path folder is the
outlet; insert, update, select and delete are granted to the owner everywhere
and to a manager at an outlet they are assigned to; a malformed path is granted
to nobody. Isolation tests cover both the table and the bucket (tasks 3.x).

### D7. The public read is new functions, never an edited one

- `public_menu_v2(p_slug text)`: `public_menu`'s exact body with one added item
  field, `photo`, which is `{ key, format, aspect }` when
  `app_change_gate('dish-photos')` is on and the item has a photo, and `null`
  otherwise. Same null answer for an unknown address, a closed outlet and an
  empty menu; same service-role-only grant. Highlights items carry the same
  field. The original's key and the crops are never sent.
- `public_menu_photo(p_slug text, p_key text)` returns the object base name
  (`<outlet_id>/<photo_key>`) and format only when the gate is on, the outlet
  trades, and the key is the current `photo_key` of an active item in an active
  category there. A `source_key` never matches, so the kept original cannot be
  fetched through the Worker. Anything else, including a key that was replaced
  or belongs to another outlet, is null. Service role only.

`public_menu` itself is not touched; the published Worker keeps calling it.

### D8. The ops editor

```
 Edit dish                                   ×
 ┌──────────┐  ┌──────────────────────┐
 │  thumb   │  │     large photo      │   Photo
 │  (1:1)   │  │   (its own shape)    │   [ Adjust ] [ Change ] [ Remove ]
 └──────────┘  └──────────────────────┘
 Name   [ Fat Chicken Burrito         ]
 ...the existing fields, unchanged...
```

With no photo, the field is a dashed tile with one verb button, **Add** (owner
UI conventions: verb-only buttons, no subtitle). **Add** and **Change** pick a
photo and open the cropper; **Adjust** reopens it on the saved original.

Nothing uploads until **Save**. Save writes the dish's existing fields first,
by the path it uses today, then uploads the photo files and calls the function,
with progress on the button. If the photo step fails, the dish's other edits
are already saved and the sheet says **Photo not saved** with **Retry**; it
does not roll the dish back. Remove marks the photo for removal and Save clears
it. Cancel discards a picked or re-cropped photo that was never uploaded. The
photo needs a connection; the Menu editor is already online-only.

Menu's item rows show a 32 px rounded thumbnail before the name for a dish with
a photo, and nothing for one without (no placeholder, so the rows read as today
where nothing is set).

All of this renders only when `useChangeGate('dish-photos')` is on.

### D9. The customer page (the child change implements it)

From the approved mock-up, `mockup/index.html` (which predates the cropper, so
its thumbnails are centre crops of one 4:3 photo and its large view is always
4:3):

- `.dish.has-photo` is `display: flow-root`; the thumbnail button floats left
  (5.5 rem square, 0.875 rem radius, a 1 px cream hairline and a soft shadow)
  and shows the `-sm` file; the existing `.line` (a flex container, so it stays
  beside the float) keeps name and price on one line; `.desc` wraps around the
  float and on beneath it.
- The expand mark: a 1.375 rem circle at the photo's bottom-right, background
  `rgb(20 16 11 / 0.55)` with a 4 px backdrop blur, a cream hairline, and a
  stroked two-arrow glyph. `:active` scales the photo to 0.95.
- The large view shows the large file at its `aspect`, full width up to 34 rem,
  with its height capped (about 62% of the screen) so a 4:5 photo still leaves
  the name and price in view. It grows from the thumbnail: the large image is
  laid out in place, then animated from the thumbnail's rectangle with a
  uniform scale plus a `clip-path: inset(...)` cropping it to the thumbnail's
  square, to `transform: none` and the full rounded rectangle, over ≈460 ms on
  `cubic-bezier(0.22, 1, 0.36, 1)`. Because the thumbnail is now its own crop,
  the thumbnail image is laid over the growing photo and fades out over the
  first ~150 ms, so the change of framing reads as a dissolve, not a jump.
  Closing runs it backwards. The backdrop is `rgb(10 8 5 / 0.86)` with a 14 px
  blur; name, price and description fade up 140 ms after it starts. Back closes
  it (the view pushes a history entry). `prefers-reduced-motion` skips every
  animation.
- Thumbnails are `loading="lazy"` with width and height set so nothing shifts;
  the large image loads on open, with the thumbnail shown in its place until it
  arrives.
- The viewer's markup and script are emitted only when the page has at least
  one photo, so a menu with none is the page it is today.

## Release and version skew

Every object here is new; nothing a published build calls is replaced.

- **`menu_item_photos`, the bucket and its policies**: new. Published ops builds
  never read them. The new policies are on `storage.objects` for the new bucket
  only, so the existing statements bucket is unaffected.
- **`set_menu_item_photo`, `clear_menu_item_photo`**: new, refuse while the gate
  is off.
- **`public_menu_v2`, `public_menu_photo`**: new. The published Worker keeps
  calling `public_menu`, which this change does not edit. The child change's
  Worker calls `public_menu_v2` and falls back to `public_menu` when PostgREST
  reports the function missing, so the two repos can land in either order and
  the "Worker must accept new fields first" ordering trap does not arise.
- **Gate off** leaves every row and file in place; the off path reads none of
  them; on brings them all back. Nothing is queued, nothing touches the outbox
  or the tablets' storage: round trip `none:`.

**Not money, not offline.** No price or arithmetic changes. The photo editor
needs a connection; the counter's offline paths are untouched.

## Risks

- **Large camera files on a low-end phone.** Decoding a 12 MP photo and
  encoding three files can take a few seconds. Preparing the original starts
  as soon as the photo is picked, behind the cropper; Save shows progress;
  nothing blocks the rest of the form.
- **A Cloudflare edge serving a removed photo for a while.** Only by its old
  address, which no page links after the menu's cache minute.
- **Supabase plan changes.** If prod moves to Pro on 31 Dec the budget only
  grows; if storage ever matters, D1's R2 alternative is the exit and only the
  upload and the Worker's fetch change.
