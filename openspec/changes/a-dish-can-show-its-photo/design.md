# Design: A Dish Can Show Its Photo

## Shape of the change

```
 Manager's phone (ops, Menu → dish editor)
   pick photo → centre-crop 4:3 → encode large (1200×900) + small (360×360)
   → upload both to Storage: menu-photos/<outlet_id>/<key>.<ext>, <key>-sm.<ext>
   → set_menu_item_photo(item_id, key, format)          (refuses while DP off)
                                │
                     public.menu_item_photos  (one row per photographed dish)
                                │
 Brand-site Worker (shawarmania repo)
   GET /menu/<slug>/  → public_menu_v2(slug)  → items carry "photo": key | null
   GET /menu/<slug>/photo/<key>[-sm].<ext>
        edge cache hit → serve
        miss → public_menu_photo(slug, key) → object name | null
             → fetch from Storage with the service-role key → cache 1 year → serve
```

Two repos, one switch: everything the customer sees depends on what
`public_menu_v2` sends, and it sends no photo while `dish-photos` is off.

## Decisions

### D1. Supabase Storage behind the Worker's cache

The bucket is `menu-photos`, **private**, with `file_size_limit` 1 MB and
`allowed_mime_types` `image/webp, image/jpeg`. A customer never fetches from
Supabase: the Worker already holds `OPS_SERVICE_ROLE_KEY` for `public_menu`, so
on an edge-cache miss it reads the object with that key and caches the response
with `Cache-Control: public, max-age=31536000, immutable`. Photos are addressed
by content hash (D3), so a cached copy never goes stale; a changed photo is a
new address.

**Budget.** ~80 dishes × (≈120 KB large + ≈15 KB small) ≈ 11 MB of storage
against the Free plan's 1 GB. Egress is one fetch per photo per Cloudflare
location that serves a customer, a few hundred MB a year at worst, against the
Free plan's 5 GB a month. This sits beside #54's receipt decision, which kept
Supabase out of serving bytes for the same reason.

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
  puts egress outside the cache's control, and it would expose the outlet's id
  in every image address.
- **Supabase image transformations** (resize on the fly). A Pro-plan feature,
  and resizing once on the manager's phone is cheaper than resizing on every
  cache miss.

### D2. Photos are their own table, not a column on `menu_items`

`public.menu_item_photos (item_id uuid primary key references menu_items,
outlet_id uuid not null references outlets, photo_key text not null,
photo_format text not null, updated_at timestamptz, updated_by uuid)`.
`photo_key` is 64 lowercase hex characters; `photo_format` is `webp` or `jpeg`.
A trigger refuses a row whose `outlet_id` is not its item's outlet, the same way
`menu_items` checks its category.

**Why not a column.** The counter subscribes to changes on `menu_items` and
re-reads its whole menu on each one (menu-management, *The live counter prefers
the latest reachable menu*), and caches that menu in IndexedDB for offline
shifts. A photo column would make every upload ripple into every counter tablet
and change the shape of what the tablets cache, which is exactly the "reaches
the counter" condition the gate rules exist for. A separate table is invisible
to the counter.

### D3. A photo is named by the hash of its large image

The phone computes SHA-256 over the encoded large image; that hex string is the
key. Objects are `<outlet_id>/<key>.<ext>` and `<outlet_id>/<key>-sm.<ext>`.

- Content addressing makes the Worker's year-long cache safe: the bytes behind
  an address never change.
- The public page shows `/menu/<slug>/photo/<key>.<ext>`, which reveals no id.
  The public menu has promised "no ids" since #61, and this keeps it.
- Re-uploading the same photo is a no-op on storage (upsert to the same name).

### D4. The phone does the image work

On pick (`<input type="file" accept="image/*">`, which offers camera and
gallery):

1. Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })` so
   a portrait phone photo is not sideways.
2. Centre-crop to 4:3 and draw at 1200×900 (smaller sources are not scaled up;
   the crop is kept at its native size).
3. Encode with `canvas.toBlob(..., 'image/webp', 0.82)`. If the browser hands
   back anything other than WebP (older Safari), encode `image/jpeg` at 0.85
   instead and record the format.
4. The small image is the centre square of that 4:3 crop at 360×360 (88 CSS px
   × up to 4× density), same format, quality 0.8.
5. Refuse anything that still exceeds 1 MB, which should not happen, with a
   plain sentence.

A 360 px thumbnail is what keeps a 30-photo menu light on a customer's mobile
data; the large image loads only when a photo is opened.

### D5. Writes go through two functions, gated

- `set_menu_item_photo(p_item_id uuid, p_key text, p_format text)`:
  security definer; refuses unless `app_change_gate('dish-photos')`; refuses a
  caller who may not edit that item's outlet's menu (the same entitlement as
  editing the item); refuses a removed item; refuses unless both objects exist
  in `storage.objects` under that outlet; upserts the row; returns the previous
  key so the client can delete the old files.
- `clear_menu_item_photo(p_item_id uuid)`: same checks, deletes the row,
  returns the previous key.

The client deletes the replaced or removed files after the function succeeds.
If that delete fails, a stray file remains, which nothing links (non-goal:
sweep).

**RLS.** `menu_item_photos`: select for anyone who may read that outlet's menu
(billers included, harmlessly), no direct insert, update or delete for
`authenticated`; writes only through the two functions. Storage policies on
`storage.objects` for bucket `menu-photos`, modelled on
`20260819000006_operator_statements_bucket.sql`: the first path folder is the
outlet; insert, update, select and delete are granted to the owner everywhere
and to a manager at an outlet they are assigned to; a malformed path is granted
to nobody. Isolation tests cover both the table and the bucket (tasks 3.x).

### D6. The public read is new functions, never an edited one

- `public_menu_v2(p_slug text)`: `public_menu`'s exact body with one added item
  field, `photo`, which is `jsonb_build_object('key', key, 'format', format)`
  when `app_change_gate('dish-photos')` is on and the item has a photo, and
  `null` otherwise. Same null answer for an unknown address, a closed outlet and
  an empty menu; same service-role-only grant. Highlights items carry the same
  field.
- `public_menu_photo(p_slug text, p_key text)` returns the object's base name
  (`<outlet_id>/<key>`) and format only when the gate is on, the outlet trades,
  and the key is the current photo of an active item in an active category
  there. Anything else, including a key that was replaced or belongs to another
  outlet, is null. Service role only.

`public_menu` itself is not touched; the published Worker keeps calling it.

### D7. The ops editor

```
 Edit dish                                   ×
 ┌──────────────────────────┐
 │                          │   Photo
 │      [photo, 4:3]        │   [ Change ]  [ Remove ]
 │                          │
 └──────────────────────────┘
 Name   [ Fat Chicken Burrito         ]
 ...the existing fields, unchanged...
```

With no photo, the frame is a dashed 4:3 tile with one verb button, **Add**
(owner UI conventions: verb-only buttons, no subtitle). The preview is the 4:3
crop the customer's large view will show, with the square thumbnail's edges
marked faintly inside it, so the manager sees both framings.

Nothing uploads until **Save**. Save writes the dish's existing fields first,
by the path it uses today, then uploads the photo and calls the function. If
the photo step fails, the dish's other edits are already saved and the sheet
says **Photo not saved** with **Retry**; it does not roll the dish back. Remove
marks the photo for removal and Save clears it. Cancel discards a picked photo
that was never uploaded. The photo needs a connection; the Menu editor is
already online-only.

Menu's item rows show a 32 px rounded thumbnail before the name for a dish with
a photo, and nothing for one without (no placeholder, so the rows read as today
where nothing is set).

All of this renders only when `useChangeGate('dish-photos')` is on.

### D8. The customer page (the child change implements it)

From the approved mock-up, `mockup/index.html`:

- `.dish.has-photo` is `display: flow-root`; the thumbnail button floats left
  (5.5 rem square, 0.875 rem radius, a 1 px cream hairline and a soft shadow);
  the existing `.line` (a flex container, so it stays beside the float) keeps
  name and price on one line; `.desc` wraps around the float and on beneath it.
- The expand mark: a 1.375 rem circle at the photo's bottom-right, background
  `rgb(20 16 11 / 0.55)` with a 4 px backdrop blur, a cream hairline, and a
  stroked two-arrow glyph. `:active` scales the photo to 0.95.
- The large view grows from the thumbnail: the big image is laid out in place,
  then animated from the thumbnail's rectangle with a uniform scale plus a
  `clip-path: inset(...)` that crops it to the thumbnail's square, to
  `transform: none` and the full rounded rectangle, over ≈460 ms on
  `cubic-bezier(0.22, 1, 0.36, 1)`. Closing runs it backwards. The backdrop is
  `rgb(10 8 5 / 0.86)` with a 14 px blur; name, price and description fade up
  140 ms after it starts. Back closes it (the view pushes a history entry).
  `prefers-reduced-motion` skips every animation.
- Thumbnails are `loading="lazy"` with width and height set so nothing shifts;
  the large image loads on open.
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

- **Large camera files on a low-end phone.** Decoding a 12 MP photo can take a
  second or two. The Save button shows progress; nothing blocks the rest of the
  form.
- **A Cloudflare edge serving a removed photo for a while.** Only by its old
  address, which no page links after the menu's cache minute.
- **Supabase plan changes.** If prod moves to Pro on 31 Dec the budget only
  grows; if storage ever matters, D1's R2 alternative is the exit and only the
  upload and the Worker's fetch change.
