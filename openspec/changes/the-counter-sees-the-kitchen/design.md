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
  acknowledgement at the current version. Its card is *quiet* exactly when
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

## RLS, money and offline, called out

- **RLS:** one widened policy, `kitchen_pulses_select`, now admitting a live counter
  shift at the outlet; its isolation case is a counter at the other outlet seeing
  nothing. One new `security definer` function, refusing anything but a live counter
  shift and returning only D1's shape — pinned by a pgTAP case on the JSON keys and
  hand-crafted refusals for a kitchen shift, a person's session, and a counter at the
  other outlet. No new table.
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
