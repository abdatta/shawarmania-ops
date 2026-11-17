# Proposal: A Dish Can Show Its Photo

> **Model**: Opus · **Roadmap**: #84 · **Wave**: F · **Depends on**: #10
> `billing-live`, #61 `the-menu-is-public`, #68 `the-menu-orders-and-highlights`,
> #75 `a-release-can-be-switched-off` · **Child**: the brand site's
> `the-table-menu-shows-photos` (repo `shawarmania`) · **Gate**: the owner
> approved the Menu editor's photo field from the demo before it was wired
> live; a manager adds, changes and removes a dish's photo from the dish's own
> editor with no SQL, and another outlet's manager is refused by the database,
> by hand-crafted request, for both the photo row and the stored file; the
> customer menu at `shawarmania.in/menu/<slug>/` shows each photographed dish
> with its photo on the left, its name and price on one line beside it and its
> description wrapping on under the photo, leaves every other dish exactly as
> it reads today, and opens a photo large with the dish's name, price and
> description when it is tapped; a photo reaches the customer within the
> menu's cache minute without a website deploy; Supabase serves each photo
> once per Cloudflare edge, not once per customer; turning `dish-photos` off
> takes every photo off the customer menu and the field out of the editor
> within a minute, and back on brings them all back; the counter, the kitchen
> and the receipt are unchanged; the demo still walks

## Why

The customer menu on `shawarmania.in/menu/<slug>/` is text only. A customer at
a table reading "Fat Chicken Burrito" or "Scotch Chicken & Egg" has to imagine
it, and the dishes that sell on sight (the burgers, the burrito, the platters)
read exactly like a bottle of water. Every aggregator app the same customer uses
shows food photos, and the menu is now the first thing a table sees after
scanning its QR code (#61).

The owner wants photos on that menu, uploaded by the outlet from the app, with
two constraints said out loud: **storage must stay free or close to it**, and
**not every dish will have a photo**, so a menu with a few photos must look as
finished as one with many.

## What changes

**In ops, a dish's editor gets a Photo field.** The manager opens a dish in
Menu, picks a photo from the phone's camera or gallery, sees it framed the way
the customer will, and saves. The photo can be changed or removed the same way.
The app shrinks the photo on the phone before it is sent (about 120 KB for the
large view and 15 KB for the thumbnail), so a manager on mobile data is not
uploading a 4 MB camera file and storage stays tiny. Menu's item rows show a
small thumbnail beside a dish that has a photo, so a manager can see at a glance
which dishes still need one. Billers cannot add or change photos; they cannot
edit the menu today either.

**On the customer menu, a photographed dish reads like this** (approved by the
owner on 2026-11-16 from a mock-up of the real Kalyani Cafe page):

```
 ┌────────┐  ▲ Fat Chicken            ₹300
 │ photo  │    Burrito
 │      ⤢ │  fire-grilled shredded chicken
 └────────┘  wrapped in a warm flour tortilla
 with seasoned rice, savory rajma beans, mild
 roasted-tomato salsa
 ─────────────────────────────────────────────
 ▲ Taco Chicken Shawarma                ₹220
 A bold meeting of Mexican taco flavours and
 our signature shawarma.
```

- The photo sits on the **left**, a rounded square about 88 px wide.
- The **name and price keep their one line**. A long name wraps; the price stays
  at the right edge, in the same column as every other price on the page.
- The **description starts beside the photo and continues underneath it**, so
  no empty column is left under the photo.
- A dish **without a photo reads exactly as it does today**.
- **Highlights looks like every other section**: same list, same rows, photos
  where the dishes have them. No sideways-scrolling cards.
- A small **expand mark** (two diagonal arrows in a dark glass circle) sits in
  the photo's bottom-right corner, and the photo dips slightly when pressed, so
  the customer knows it opens.
- **Tapping the photo opens it large**: it grows out of its thumbnail to nearly
  the full width, the menu blurs and darkens behind it, and the dish's name (in
  the brand display face), price and full description rise in underneath. A
  round × above the photo, a tap anywhere else, Escape, or the phone's Back
  button closes it, and it shrinks back into its thumbnail. With reduced motion
  it opens and closes without the animation.
- A **sold-out dish** keeps its photo, greyed, beside the existing
  *Unavailable* pill.

**Storage stays free.** Photos are kept in Supabase Storage in a private,
per-outlet bucket. Customers never fetch them from Supabase: the brand site's
Worker fetches a photo once, and Cloudflare's edge cache serves it to every
customer after that. About 80 dishes at roughly 135 KB each is about 11 MB,
against the Free plan's 1 GB; Supabase egress is one fetch per photo per
Cloudflare location.

## Non-goals

- Photos on the **counter's** menu grid, the kitchen screen, receipts or bills.
  The counter reads its menu on a money-critical path (#10, #34) and this change
  does not touch it.
- More than one photo per dish, video, or a gallery.
- Choosing the crop by dragging or zooming. The photo is centre-cropped to 4:3,
  and the preview shows exactly what the customer will see; a manager who
  dislikes the framing picks another photo. Revisit if managers ask.
- Cleaning up files left behind by an interrupted upload. They are a few
  hundred KB at worst; a sweep is a later chore if the bucket ever grows.
- Purging Cloudflare's copy of a replaced photo. A replaced photo gets a new
  address, so the old copy is simply never linked again.
- The brand site's homepage menu section (`src/sections/Menu`), which reads a
  static file, not ops.
- A shared photo library across outlets (that waits for the shared catalogue,
  `openspec/todos/shared-menu-catalogue.md`).

## Change gate

- **`dish-photos`** (*DP*)
  - **On:** Managers add, change and remove a dish's photo in Menu, and the
    customer menu shows each photographed dish's photo and opens it large when
    tapped.
  - **Off:** Menu has no photo field and the customer menu shows no photos, as
    today.

**Off is today, on both surfaces.** With the gate off, the Menu editor runs its
current code path untouched, the new database functions that set or clear a
photo refuse, and `public_menu_v2` answers every dish with no photo, so the
Worker renders the page byte for byte as it does now. The Worker's photo route
answers 404 for a photo it has not already cached, and no page links one.

**What the on path persists, and Off living with it.** A photo is a row in a new
table and two files in a new bucket. Nothing the old path reads changes: not
`menu_items` (so no counter re-reads its menu when a photo changes), not the
outbox, not the tablets' browser storage. Turned off, photos sit untouched;
turned back on, they all return. Round trip `none:`.

**The brand site needs no gate of its own.** Its renderer shows a photo only
where `public_menu_v2` sends one, and sends none while `dish-photos` is off, so
the ops gate is the switch for both repos. The child change's Worker also falls
back to today's `public_menu` if `public_menu_v2` is not yet published, so the
two repos may land in either order.

## Durable documentation

Before archive: `docs/DATA_MODEL.md` (the photo table and bucket),
`docs/SCREENS.md` (the Photo field and row thumbnails),
`docs/SECURITY_AND_PRIVACY.md` (photos are public by design, the bucket is not),
`docs/OPERATIONS.md` (storage budget, how a photo reaches the customer and the
cache), `docs/DEMO_MODE.md` and `docs/TESTING.md`. The brand site's child change
updates `worker/README.md`.

## Decisions taken with the owner, 2026-11-16

Recorded here because the implementing session will not have the conversation.
The reasons and the rejected alternatives are in `design.md`.

- Storage: Supabase Storage behind the Worker's cache, not Imgur and not
  Cloudflare R2.
- Layout: photo on the left, price kept on the name's line, description wrapping
  under the photo. The owner rejected photo-on-the-right (it pushed the price
  under the name) and a separate card style for Highlights (sideways scrolling
  inside a page that scrolls down).
- A subtle, clearly tappable hint on the photo, and a large view that "looks
  gorgeous".
- The mock-up the owner approved is kept at `mockup/index.html` in this folder.
