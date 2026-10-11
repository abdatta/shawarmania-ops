# Design: The Counter Sees The Kitchen

## Context

#70 gave each kitchen tablet a board and an ACK. A kitchen's answer about an order
is derived, never stored as a flag: its card is *quiet* when the dishes it last
acknowledged equal the dishes it shows now, and *new*, *edited* or *cancelled*
otherwise (`src/domain/kitchen.ts`, `kitchenCardState`). Acknowledgements are rows
in `kitchen_acknowledgements`, readable only by the acknowledging tablet during its
kitchen shift and by the outlet's managers. Every order write bumps the outlet's
`kitchen_pulses` row, which kitchens subscribe to as a nudge.

The counter's rail (`PipelineCard` in `open-orders-surface.tsx`) re-reads on its
outlet billing channel (`subscribeToOutletBilling`: menu, orders, bills) and on
return to the foreground. It knows nothing of kitchens.

The look was settled with the owner on mockups on 2026-10-09: the bell in the empty
space beside the dishes (rejected there: ticks, a chef hat, an eye, and words such
as SEEN/UNSEEN), dots for a partial answer (rejected: a number on the bell, a bell
per kitchen, no partial at all), and the torn-edge ticket (rejected: a waiting strip
across the top, and today's card with only the mark added).

## Decisions

### D1. The server answers, per order and per kitchen

`public.counter_kitchen_marks()` — `security definer`, callable only with a live
**counter** shift (`app_counter_shift_outlet()`), scoped to that shift's outlet —
returns:

```json
{ "kitchens": [{ "id": "…", "label": "Kitchen 1" }, { "id": "…", "label": "Kitchen 2" }],
  "orders":   [{ "orderId": "…", "marks": ["waiting", null] }] }
```

- **`kitchens`**: every kitchen tablet at the outlet holding a live kitchen shift
  (kind `kitchen`, not removed, session proven, shift not ended and not expired),
  **ordered by label, case-insensitively, then id**. A kitchen tablet with no live
  shift is not listed: nobody there can press ACK, so counting it would swing the
  bell all day.
- **`orders`**: the rail's orders (`status = 'open' or (status = 'paid' and
  prepared_at is null)`, the rail's own predicate, so it rides
  `orders_pipeline_idx`) that at least one listed kitchen shows, each with one entry
  per listed kitchen, in the same order:
  - `null` — that kitchen's board does not carry the order;
  - `"seen"` — its card there is *quiet*;
  - `"waiting"` — its card there is *new*, *edited* or *cancelled*.
- A kitchen's card carries an order exactly when `kitchen_board()` would: a line
  visible under its filter, or an acknowledgement with lines and no `cancel`
  acknowledgement at the current version — both sides read through the filter in
  force now, as amended by D7. Its card is *quiet* exactly when
  `kitchenCardState` would say so: it has a `new` acknowledgement, its visible lines
  are not empty, and its latest acknowledgement's lines equal its visible lines **by
  dish totals** (`menu_item_id`, else the item name). A new SQL function,
  `kitchen_same_lines(jsonb, jsonb)`, is that comparison, mirroring `sameLines()`
  line for line; a unit test and a pgTAP case pin the same pairs on both sides.
- With no listed kitchen it returns `{"kitchens": [], "orders": []}` and the counter
  draws no bell.

Nothing else leaves the function: no dish, no quantity, no acknowledgement time, no
person. What a counter learns is which of its outlet's kitchen tablets has answered
which of its outlet's open orders — which the biller could learn by walking to the
kitchen.

**Rejected:**

- *The counter reads `kitchen_acknowledgements` and works the answer out itself.*
  It would need select on the acknowledgements (their line snapshots and who
  pressed), on every kitchen's filter, and on each line's category, and it would
  duplicate the kitchen's rules in a second place to drift. The server already has
  every fact and the rule.
- *A stored "acknowledged" flag on the order.* One flag cannot hold two kitchens'
  answers, and an edit re-arms a kitchen by **comparison** — an edit touching only
  another kitchen's dishes must not re-arm it — which a timestamp cannot express.
- *Counting a kitchen tablet whether or not it is on shift.* Swings forever on an
  outlet whose second kitchen is closed today.

**Prepared answers for the kitchen.** An order the counter has ticked Prepared is
off every kitchen's board but still on the rail until paid. Its answer is `"seen"`
for every kitchen whose filter shows a dish of it: the food is made, so the bell
goes, as for any answered order — rather than swinging for an answer no kitchen can
now give.

**The read also counts the outlet's kitchen tablets** (`kitchenTablets`: kind
`kitchen`, not removed, session proven), on shift or not. The counter says
*Kitchen offline* when that count is above nought and no kitchen is on shift
(D6), and says nothing at an outlet that has no kitchen screen.

### D2. Freshness: the counter listens to the kitchen pulse

The counter subscribes to its outlet's `kitchen_pulses` row and, on a nudge,
re-reads the marks **only** — not the rail, not the menu. It also re-reads them
with every rail load (so an order write, which already bumps the rail, refreshes
them too) and on return to the foreground.

So the pulse means "something a kitchen or a counter would redraw changed", and it
is now bumped by:

- every order write (already, #70);
- `kitchen_acknowledge()` — an ACK;
- `set_kitchen_filter()` — a kitchen now shows different dishes;
- a kitchen shift starting or ending — a trigger on `counter_shifts` for rows of
  kind `kitchen`, on insert and when `ended_at` is set.

Each is a trigger on the row it concerns, reusing `kitchen_pulse_bump()`, rather
than an edit to `kitchen_acknowledge()` or `set_kitchen_filter()`: a later writer of
the same rows nudges the counter without remembering to.

A kitchen shift that lapses at the cutover without being ended bumps nothing; the
counter learns at its next read. The cutover is 04:00, when nobody is at the
counter, and every trading morning starts with reads.

`kitchen_pulses_select` admits a live **counter** shift at the outlet, beside the
kitchen shift and the managers it admits today. The row carries an outlet id and a
time, nothing else.

The extra cost: one Realtime subscription per counter tablet, and one small read
per ACK, filter change and kitchen shift change. A kitchen's every ACK also nudges
the other kitchens to re-read their boards, which they already do on every order
write.

**Rejected:** subscribing the counter to `kitchen_acknowledgements` inserts — it
needs select on the rows (D1 says no), and a filter change or a kitchen shift
ending would not nudge it. Polling — latency of the interval, and egress on every
tick whether anything changed or not.

### D3. The bell, the dots, and where they sit

- **Where:** a 36px column on the right of the dish list — under the customer
  button, above the ⋮ button — added to the card only when the order has marks.
  A card with no marks lays out exactly as today. The docked card being edited
  (`showItems = false`) has no dish list and no bell.
- **The bell:** `Bell` from the icon set, 15px, and its dots' row under it, 3px
  apart, as one group centred between the customer button and the ⋮ button;
  the column keeps 3px of air above and below, so a one-dish card grows by about
  6px (98.25 → 104.5px). **Waiting:** filled, in `--primary`, swinging in bursts
  (`kitchen-bell`), fading instead under reduced motion. **Answered by every
  kitchen: nothing** — the column keeps its size, so the card does not move. The
  first build drew an outline in `--content-muted` there; the owner dropped it
  on trying it (2026-10-09): on most cards it said nothing, and the one thing it
  told apart — answered from nobody watching — is said once, in the header (D6).
- **The dots:** one per listed kitchen, in `kitchens` order, under the bell, **only
  while the bell is waiting** — with one kitchen, one dot (owner, 2026-10-09: first
  built with dots for several kitchens only, and changed on trying it). Orange
  (`--primary`) for `"waiting"`, grey (`--content-muted`) for `"seen"`, an empty
  place for `null` — so the left dot is always the first kitchen by name, and a
  biller who learns "left is Kitchen 1" is never wrong. They are absolutely
  positioned below the bell, so appearing and disappearing moves nothing.
- **No words** on the card. The bell is an image to assistive technology, named
  for what it says: *Kitchen 1 has not pressed ACK; Kitchen 2 has* — or *The kitchen
  has pressed ACK* with one kitchen.
- **Colours:** `--primary`, `--content-muted`, `--surface`. Nothing new.

### D4. The ticket look, at today's height

- **Torn top edge.** A `rail-ticket` utility draws the card's background and border
  in a `::before` layer with the kitchen ticket's mask, at the rail's scale (a bite
  every 13px, 4px deep, inside today's 6px top padding). **The mask is on the layer,
  not the card**: the ⋮ menu panel is the card's descendant, and a mask on the card
  would cut it off.
- **The number** in the display face (`font-display`) at today's line height.
- **Dish counts in small tiles**, 18px tall inside today's 20px line, replacing the
  `2×` text.
- **Height:** the ticket adds nothing; only the bell's room does, on a one-dish
  card. `e2e/counter.spec.ts` measures a one-dish card with a bell against
  today's 98.25px plus that room.

### D5. Demo

The demo mocks compute the marks from the demo kitchen's filter and
acknowledgements (`DemoKitchen`), with the demo kitchen tablet — *Kitchen 1* — on
shift, so the demo counter shows a bell on every order the kitchen shows. The tab
mirror (#70) carries the demo kitchen's acknowledgements and filter beside the
orders, so a kitchen tab's ACK reaches a counter tab; the mock's pulse is a one-second
poll of a signature, as the mock kitchen's subscription already is. The demo has
one kitchen, so it never shows dots; unit tests cover them.

### D6. The header says when the kitchen is offline

The counter's header carried its tablet's name, a sync indicator, a sentence about
the shift and two buttons; the sentence took most of the width on a tablet. Its
status is now **one segmented pill** — *Kitchen offline* (only when it applies), the
sync indicator, *since 10:30 pm* — and the buttons are one step smaller. "Ended from
the operator's own phone, or at this outlet's cutover" moves to the Hand over
screen. *Kitchen offline* (`BellOff` and the words, in `--primary`) shows while the
outlet has a kitchen tablet set up and none is on shift; the marks provider that the
rail reads (`kitchen-marks.tsx`) serves the header too, so both come from one read.

Rejected, on mockups (2026-10-09): a crossed-out bell with no words, on the rail's
top edge or in a strip above the orders (the owner wanted it said plainly); the
same row with only the sentence shortened; the buttons as quiet text; and folding
the search box into the header row, which saves height the owner had not asked for
— the concern was the width the sentence wasted.

### D7. A kitchen's filter is a view, not an event (added 2026-10-10)

**What the owner reported.** A kitchen showing only Shawarmas changed its filter to
Burgers. An order it had acknowledged turned red, read CANCELLED and rang; the cook
pressed ACK. Changed back to Shawarmas, the order — still open, its shawarmas
untouched — was gone from that kitchen, and stayed gone until the counter edited it
or ticked it Prepared. Reproduced on the local stack the same day against #70's
`kitchen_board()`, with two further cases the owner had not met.

**Why.** #70 compares a card's lines with the lines this tablet last acknowledged,
and each side is taken under the filter in force *when it was taken*: the snapshot
under the filter at ACK, the visible lines under today's. A filter change therefore
reads as something that happened to the order:

| The kitchen, with nobody touching the order… | #70 |
|---|---|
| hides every dish of an order it acknowledged | **Cancelled**, rings; once ACKed, the `cancel` at the current version keeps the order off the board for good |
| hides some dishes of an order it acknowledged | **Edited**, rings, the hidden dishes struck through as removed |
| shows dishes it did not show when it acknowledged | **Edited**, rings, the new dishes marked as added |
| shows orders it never acknowledged | **New**, rings |

`counter_kitchen_marks()` restates the rule (D1), so each row also swings the
counter's bell, and the hidden order's bell loses that kitchen.

**The rule.** A filter change changes what this tablet *shows*; nothing happened to
the order.

- **The acknowledged lines are read through today's filter.** A card is compared
  with the lines this tablet last acknowledged **that its filter shows now**, each
  judged by its dish's current category exactly as an order line is
  (`kitchen_line_visible`, joined through `menu_items` on the snapshot's
  `menuItemId`; a line without one is judged as an order line without one is). The
  snapshot itself is untouched and stays append-only. `kitchen_board()` returns
  `latestAck.lines` already narrowed, so `kitchenCardState`, the diff and the struck
  lines need no change; `counter_kitchen_marks()` narrows the same way.
- **Narrowing asks nothing.** A dish that leaves the filter leaves the comparison
  with it: it is not struck through, and an order with nothing on show here, before
  or after, leaves the board without a Cancelled card. *Cancelled* for lost dishes
  now means only what the counter did — the order lost every dish this kitchen shows
  and had acknowledged.
- **Widening asks for an ACK and does not ring** (owner, 2026-10-10). Dishes this
  tablet never acknowledged are new to this kitchen even when they are old to the
  order: an order it never acknowledged reads New, extra dishes on one it did are
  marked as added on an Edited card. A kitchen widens its filter mostly to take over
  from another — a tablet dead, a cook gone home — and a dish it shows but never
  acknowledged must keep the counter's bell swinging. The cook who pressed Save is
  looking at the board, so the cards glow and carry ACK, as on opening the screen,
  without shaking or ringing.
- **A `cancel` acknowledgement keeps an order off the board only while there is
  nothing here to show**: the order is cancelled, or nothing of it is on show here.
  An open order with a dish on show is on the board whatever was acknowledged before.
  So the acknowledgements #70 wrote for filter changes are harmless once this ships:
  such an order comes back, Edited against an empty snapshot, silently on the first
  read after the release. No data repair.

**Which reads ring.** The silence belongs to the person who pressed Save, not to every
change in what the board shows. The board returns `filterChangedAt`
(`counter_devices.kitchen_filter_changed_at`, already written by
`set_kitchen_filter()`). A card that starts alerting on a read rings as before
**unless** the filter changed since the previous read (`filterChangedAt` later than
the previous board's `readAt`) **and** the order has not changed since the filter did
(its `version` no later than `filterChangedAt`); then it glows silently. An order
saved or edited at the counter in the moment after Save is newer than the filter and
rings. Both times are the server's; the tablet's clock plays no part.

A dish moved to another category on the Menu screen changes what a kitchen shows
without anybody at the kitchen choosing it. Narrowing that way is silent, as any
narrowing is — there is nothing to act on. Widening that way **rings**, because the
kitchen did not ask for it.

**Considered and rejected:**

- *A pure view — widened dishes appear quiet.* The counter's bell would report as
  answered food nobody in this kitchen has acknowledged: a false all-clear, worse
  than the false alarm it replaces. The owner chose the silent ACK (2026-10-10).
- *Ringing for widened dishes, as #70 did.* The person who pressed Save is already
  looking at them.
- *Snapshotting every line of an order at ACK, not only the shown ones.* It fixes
  narrowing too, but makes widened dishes read as already acknowledged — the pure
  view above — and changes what a stored acknowledgement means.
- *Dropping the Cancelled alert for lost dishes.* It is the only thing that tells a
  cook to stop making a dish the counter removed. It stays, for events on the order
  (owner, 2026-10-10).
- *Fixing the kitchen screen alone.* The counter's bell reads the server's rule, not
  the screen's.
- *A change folder of its own.* The owner asked for the last open kitchen change to
  carry it (2026-10-10); this one already restates #70's rule for the counter, so the
  two must change together.

**Deferred: an alert for dishes no kitchen shows** (owner, 2026-10-10). A filter
change can leave a category that no kitchen on shift shows; its dishes then carry no
bell, as for any dish no kitchen shows (D1), and nothing warns. Worked through with
the owner and deliberately not built:

- *What was designed.* Each category marked *kitchen* (the default) or *counter*,
  set from the counter tablet behind a confirmation and recording who set it; a red
  **No kitchen: Desserts** in the counter's header pill while a kitchen category is
  shown by no kitchen on shift; a red dish tile and a still, crossed-out bell on the
  affected cards; and the pill, tappable whenever the outlet has a kitchen tablet,
  opening a *Who makes what* sheet — a row per category naming its kitchens,
  *Counter*, or a red *Nobody*. Rejected within it: keeping the bell swinging for an
  uncovered dish (no kitchen can ever stop it, so it trains billers to ignore the
  bell, and the swinging bell would mean two things); marking items rather than
  categories (too heavy in the screen and the build for a list of under ten items —
  a part-made category such as Desserts stays a kitchen category, and its ready
  items are ACKed like the rest); the setting on the owner's Menu screen.
- *Why not now.* The outlet launches with **one kitchen tablet across two kitchens**:
  one kitchen on the screen, the other told by the counter as before. "No screen
  shows Burgers" is then correct, not a fault, so the alert would be red all day,
  billers would mark the manual kitchen's categories *counter* to quiet it, and those
  marks would hide real gaps once the second kitchen gets its tablet — worse than no
  alert. Meanwhile the bell already draws the line the billers need: a dish with no
  bell is not on any kitchen screen, and the counter calls it out.
- *When to return.* Once every kitchen has a screen and they have run with them long
  enough to show whether a filter actually leaves food unmade. Design it then, for
  that setup; it may want a third state (*called out by the counter*) rather than
  *counter*. The same review should decide whether a kitchen tablet away for repair
  should keep the header reading *Kitchen offline* (one idea: count only kitchen
  tablets in touch within the last day).

## RLS, money and offline, called out

- **RLS:** one widened policy, `kitchen_pulses_select`, now admitting a live counter
  shift at the outlet; its isolation case is a counter at the other outlet seeing
  nothing. One new `security definer` function, refusing anything but a live counter
  shift and returning only D1's shape — pinned by a pgTAP case on the JSON keys and
  hand-crafted refusals for a kitchen shift, a person's session, and a counter at the
  other outlet. No new table. D7 changes the rule inside `kitchen_board()` and
  `counter_kitchen_marks()`, not who may call them; the board gains one field,
  `filterChangedAt`, the calling tablet's own, and still no customer or amount.
- **Money:** none.
- **Offline:** the bell needs the network. An offline counter keeps the last marks
  it read; an order not yet sent has no server row and so no bell — the kitchen
  cannot have seen what the server has not got.

## Rejected alternatives (look and behaviour)

Recorded with the owner, 2026-10-09, on mockups:

- **Two ticks, like a read message; a chef hat; an eye; the words SEEN / UNSEEN.**
  The owner chose the bell because it nudges the biller to remind the cooks.
- **A number on the bell for kitchens still to answer** — "1" reads as either one
  waiting or one done. **A bell per kitchen** — cramped in a 36px column. **No
  partial answer** — loses which kitchen to remind.
- **Dots always visible.** The owner asked that they hide once the bell stops.
- **An orange strip across the ticket while waiting**, and **today's card with only
  the mark**: the owner chose the torn-edge ticket.
- **A second header row or a dashed rule** (first mockups): each made the card
  taller, which the owner ruled out.
- **Anything for cancellations.** Deferred by the owner.
