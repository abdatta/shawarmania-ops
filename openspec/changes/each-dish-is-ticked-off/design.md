# Design: Each Dish Is Ticked Off

## Context

Today an order is prepared or not as a whole: `orders.prepared_at` and
`prepared_source`, set by `prepare_billing_order` from the owning tablet and by
the day change (#69). The kitchen (#70) reads unprepared orders through
`kitchen_board()`, compares each card's visible lines against its latest
acknowledgement snapshot (`kitchen_acknowledgements.lines`, read through today's
filter since #72 D7), and rings New, Edited or Cancelled until ACK. The counter's
bell (#72) reads `counter_kitchen_marks()`, which applies the same comparison per
kitchen and returns waiting, seen or not shown.

Line identity is already stable across revisions: `revise_billing_order` upserts
`order_items` by id and deletes lines that are gone, and the counter sends each
captured line under its stored id (`an-edit-keeps-its-captured-lines`). A line
can therefore carry facts across edits.

The counter workspace is three columns (`billing-counter.tsx`): the menu, a
middle column showing `MyShiftSurface` (method totals and Bills this shift) that
the composer replaces while composing, and the activity rail. Expenses sit below
the workspace in `counter-shell.tsx`.

## Goals

- The counter knows, without asking, who an order is for, what was asked for
  beyond the menu, which dishes are made and which are handed over.
- The kitchen sees food it still owes and collapsed Done tickets awaiting counter handover.
- Nothing about money, bill numbering, payment or the day change moves.

## Decisions

### D1. The workspace is the menu and a two-column rail; the composer is laid over the rail

The middle column goes. The rail takes its width and lays its single list out in
two free-flowing columns. The single list remains newest first; each next card
goes in the shorter column, leaving only the normal gap beneath the previous
ticket instead of waiting for a taller neighbour. Composing or editing
opens the composer as a panel laid over the **left half** of the rail, the width
the middle column had; the rail beneath keeps its layout and is covered, never
reflowed. The editing pin that today sits atop the rail stays visible in the
uncovered right half.

Below the workspace, **Bills** (today's `MyShiftSurface`) and **Expenses** (today's
counter expenses list) remain visible together. Expenses sit on the left at the
menu's width; Bills sit on the right at the two-column rail's width. Both rows use
the same track widths and gap, including after resizing. Narrow screens scroll
sideways at these widths instead of stacking or squeezing either panel. Their
horizontal scroll positions stay linked. There is no tab switch. Each panel's
loading shape occupies the same column as its loaded content. The owner chose
the existing Cash/UPI tiles atop the Bills panel only. The final approval removes
the trial total from the header pill: that pill describes counter status, not
money. Search keeps its full menu-column width. The payment split sits
below the initial viewport and is reached with a short downward scroll.

The records row fills another viewport, less the persistent demo banner and outer
padding. Scrolling to the bottom leaves only Bills and Expenses on screen; neither
is capped at 28rem. Each panel scrolls its own long list. The menu scroller contains
its layout and paint, and the demo shell clips escaped overflow, so hidden menu
content cannot create empty document scroll space below records. Flex gaps exclude
closed dialogs from the outer spacing, preserving the panel's viewport alignment.


Below the width two columns need, the workspace still scrolls sideways rather
than rearranging. The single resize handle sits between the menu and the rail.

The finished-ticket flight (*Only a finished ticket travels*) lost its
destination; a finished card now fades where it stood while its space collapses,
and the Bills panel's totals update.

**Rejected**: keeping the middle column narrower (the owner rarely uses it, and
any width there is taken from the rail); the composer as a full-screen dialog
(hides the menu the biller is tapping); squeezing the rail to one column while
composing (every card would jump on every first tap).

### D2. The label is a nullable column on the order, cleared as the order leaves the rail

`orders.label text`, trimmed, 1–24 characters or null, carried as an optional
`label` key by the create and revise order commands and the pay-now path's order
payload. It is not a customer field and does not touch `customer_*` or the
global customer identity: "the phone is the customer" stands.

A `BEFORE UPDATE` trigger on `orders` sets `label` to null whenever the row
becomes **off the rail** — cancelled, or paid with `prepared_at` set (by the
counter or the day change) — so every path that finishes an order clears it with
no path able to forget. The existing paid-row immutability guard learns that
`label` may change to null and to nothing else after payment. Rows written before
this change have no label.

At payment, the customer dialog's name field, when the looked-up number has no
saved name (or no customer), is pre-filled with the label; a saved name always
wins. This is client behaviour only; what is saved is what the biller confirms.

The label may hold a person's name, so it is treated as PII-adjacent: never
logged, never in analytics, exports or receipts, and absent from `bills`.

**Rejected**: a name without a phone in `customer_name` (breaks the
phone-identifies-the-customer rule and would leave unattached names in history);
keeping the label after payment (the owner wants it thrown away, and keeping less
is the privacy default); clearing it by a nightly sweep (an order would keep it
for hours after leaving the rail).

### D3. A note is a nullable column on the dish line

`order_items.note text`, trimmed, 1–60 characters or null, allowed only on
`kind = 'item'` lines (check constraint), carried as an optional `note` key on each
line of the create and revise commands. It is copied to no bill line and printed
on no receipt. It carries no amount, so bill arithmetic is unchanged.

In the composer, a pencil at the right of the line opens a sheet with a text box and chips. The chips start as a
fixed handful (*No sauce*, *Extra spicy*, *Less spicy*, *No onion*, *No mayo*) and
are replaced, most-used first, by the notes this tablet has saved — kept in the
tablet's local storage as a convenience, losing nothing if cleared. On a line of
two or more, the sheet asks **All** or **Only 1**; *Only 1* lowers the line by one
and adds a new line of one with the note.

The database keeps a locked line's note (D4): a revision that changes it is accepted
with the note unchanged, so a queued edit never becomes needs-attention work.

**Rejected**: an order-level note (the owner: a note belongs to the dish, and only
the kitchen making that dish needs it); manager-configured presets (a settings
screen for five words); priced modifiers (money; a separate change).

### D4. The composer's line key is the dish, its note and whether it is locked

Tapping a menu tile adds to the newest line of that item that has **no note and is
not locked**; with none, it adds a new line. + on a line raises that line unless
it is locked, in which case it adds a new line of one beside it. A **locked** line
is one the kitchen has marked Ready or the counter has ticked (D6). − always
works. A note can be changed only on an unlocked line. The menu tile's count
shows the item's total across its lines.

A new line takes the menu's **current** price, as every new line does today
(`revise_billing_order` checks new lines against the menu). A split or a locked
line's follow-on is a new line, so after a mid-order price change it carries the
new price. This is the existing rule applied, not a new one.

### D5. Ready is an append-only kitchen record; a dish's ready quantity is derived

```
kitchen_readies
  id uuid pk                 -- client-generated, idempotent
  outlet_id, device_id, shift_id, person_id
  order_id uuid
  lines jsonb                -- [{ id, quantity }] as the kitchen saw them
  undoes uuid null           -- an Undo row points at the Ready it reverses
  at timestamptz default clock_timestamp()
```

`kitchen_ready(p_id, p_order_id, p_lines)` records the lines and quantities the
cook was shown. It is **not** refused for a stale version: what the kitchen saw is
what it made. A dish's **ready quantity** is the sum of its quantities over Ready
rows that no Undo row reverses, capped at the line's current quantity. So a
quantity lowered meanwhile is simply capped, and a quantity raised meanwhile
leaves the extra still owed — which arrives as the next ticket (D7).

`kitchen_ready_undo(p_id, p_ready_id)` appends an Undo row. Done remains
undoable whenever its ticket is visible, with no time window. Undo changes only
kitchen readiness, preserving any counter handover already recorded. Consequently
only food not handed over becomes owed again. A failed command preserves the
prior state and reports the error. Ready is sent on the first click.

Ready refuses a cancelled or finished order, a line that is not this tablet's to
see, and a tablet without a live kitchen shift. It is online-only, like ACK.

**Rejected**: a mutable `ready_quantity` column on `order_items` (a kitchen
writing to a bill-integrity table, and no history for prep times); refusing a
stale Ready like ACK (it would make the cook press Ready twice for food already
made, and a raised quantity is handled better by the next ticket).

### D6. A dish tick is a counter command over a per-dish record; Prepared is derived

```
order_line_preparations
  order_item_id uuid pk references order_items on delete cascade
  outlet_id, order_id
  quantity int               -- the line's quantity when it was ticked
  prepared_at timestamptz    -- the command's time
  shift_id, person_id
```

A new outbox command, `prepare_order_lines` (payload `{ orderId, lines: [{ id,
prepared }] }`), idempotent by command id and attributed like every counter
command, ticks or unticks dishes on the owning tablet's order. A tick records the
line's current quantity; a line is **ticked** while that recorded quantity is at
least its current quantity, so a quantity raised later (only possible on a line
ticked after the edit was queued — the composer locks ticked lines) shows the
extra unticked. An untick deletes the row. A line removed later takes its row
with it.

After applying the lines, the command sets the order's `prepared_at` to its own
time and `prepared_source` to `counter` when every item line is ticked, and clears
both when one is not and the order is open, with the existing rules intact: no
untick that would reprepare a finished (paid and prepared) order, and a tick
landing on an order the day change finished replaces the cutover with its earlier
time (#69). `revise_billing_order` clears an open order's counter-set
`prepared_at` when the revision leaves an item line unticked.

`prepare_billing_order` remains for commands already queued on tablets: prepared
true ticks every item line, false unticks every one. The day change still writes
only the order.

The order-level **Prepared** control is omitted: the item ticks state handover.
Its footer space carries Table N or Takeaway. Without a service, Paid spans the
available footer width. Service details leave the header, which holds number,
label, total and an age ring no larger than the former customer control. The
member badge sits on the order number. Customer entry remains in payment and edit.
The composer uses an accessible, visually hidden Order Label caption and an
Order Label placeholder, a compact quantity pill, a right-aligned pencil, and Save.

**Rejected**: ticks inside `order_items` (a counter tick is not part of the sale and
must not trip the bill-integrity guard on a paid order); the counter's tick setting
the kitchen's Ready (the counter would erase the kitchen's record of when it was
done); keeping the order-level control as a tap-to-tick-all (the owner: it reads as
information now).

### D7. A kitchen card is its ticket: food still owed, judged since this kitchen's last Ready

For each line a kitchen shows, **owed** = quantity − max(ready quantity, ticked
quantity). The kitchen card shows only owed food, with owed quantities. A cooking card with nothing owed leaves the active part of the board. Each
unreversed Ready retains a separate Done receipt until all its captured food is
handed over at the counter. Handover consumes older receipts before later ones.
Lowered or removed quantities cap those receipts. Unticking restores the gray
Done receipt; later food still arrives as its own active ticket.

The New / Edited / Cancelled comparison (#70, #72 D7) is made between today's
owed lines and the lines of this kitchen's latest acknowledgement **made after its
latest unreversed Ready** of the order; with no Ready, as today. Consequently:

- After Ready, any food newly owed is a **new ticket**: no acknowledgement since
  that Ready, so the card is **New**, numbered *#42 · n* where n is one more than
  this kitchen's unreversed Readies of the order.
- Food removed, or the order cancelled, after Ready leaves nothing owed and no
  acknowledgement since to compare with — no card, no Cancelled.
- Before Ready, everything is as today, compared on owed quantities, so a dish the
  counter ticks leaves the comparison silently.
- An Undo restores the earlier acknowledgements' standing: the card returns as it
  was before Ready, quiet if it had been acknowledged.

Two kitchens whose filters overlap share a dish's ready quantity: the first Ready
makes it ready for both.

Each carrying kitchen has its own fixed indicator slot: a gray single tick for
sent, an orange double tick for ACK, an orange bell for food that kitchen marked
Ready but the counter has not handed over, then an empty slot once all its food
is ticked. A kitchen's transition never replaces another kitchen's indicator.
If later food is still owed after a Ready receipt is handed over, its slot returns
to sent/ACK. Undo and counter unticking restore the corresponding earlier state.

### D8. The counter learns readiness through its kitchen read

`counter_kitchen_marks()` gains, per open order, the ready quantity of each of its
item lines (line id → quantity), plus a per-kitchen aggregate `dishStates` array
in the existing kitchen order: sent, acknowledged, ready or handed_over, with null
for a kitchen not carrying that order. No dish-to-kitchen mapping, person or time. The
counter already reads its own order lines. A line shows its Ready checkbox cue while its ready quantity
exceeds its ticked quantity. Ready reaches the counter by the kitchen pulse the
bell already uses.

The ticked state is read with the rail's own order read (the counter shift selects
its outlet's `order_line_preparations` rows under RLS, as it selects
`order_items`), so a tick queued offline shows at once from the outbox's optimistic
state.

### D9. Ready is a third checkbox state

Ready uses a localized checkbox cue while item names and notes stay still.
The demo offers three candidates: A, a soft orange halo around the orange-outlined
checkbox; B, one orange light that starts circular, expands to fill the rounded
checkbox, and fades away;
C, the same steady dot without animation. The owner chose B, now the default.
The shade stays uniform without a fixed bright center; the orange checkbox border
stays visible throughout the fade. The light only expands and fades to nothing, pauses briefly, then
restarts as a dot; it never visibly shrinks. Animated cues share one
2.4-second clock on the pipeline, including newly arriving
ready lines, so they pulse together. Reduced motion keeps the cues steady.
Ready adds no outline around the quantity or item and does not change their text
colour. Only the Ready checkbox's outline becomes orange, retaining an indicator
when the pulse is invisible. An empty gray box means waiting, the cue
means kitchen-ready, and the orange checked box means handed over.
A tick colours the dish text orange and fills only its checkbox, removing the
heavy filled-row treatment. The 15px dish checkbox is smaller than Prepared's
17px box, stays fixed when notes or wrapping make a line taller, and the quantity
is always separate and visible. Rows have a 6px gap and vertically centered
contents. Clickable rows have a hand cursor and subtle shadow on mouse hover;
touch appearance stays the same. The kitchen status sits midway between the compact age ring and action icon.
Sent/ACK marks are 18px with a slightly heavier stroke: a neutral single tick means
sent, and an orange double tick matching Prepared means acknowledged. The compact
counter timer uses total minutes even above 60 within its existing footprint. SVG
text is centered on the ring's center; its full age remains accessible. Ages turn
warning at 10, red at 20, and a darker, contrast-validated red at 40 minutes.
The gold badge overlays the order number without occupying headline width, and
Table/Takeaway is centered in the space beside Paid.
A 0.25rem left inset comes from the existing 0.375rem gap beside
the checkbox, leaving 0.125rem there; row width and quantity/text geometry stay the same.
There is no per-card *n ready* mark; the rail's existing scroll
pointer gains *Ready #n* while a ready order is out of view. Under reduced motion
the checkbox cue stays steady. No sound. Tokens for the checkbox and ticked text are
semantic, contrast-validated in both themes.

The owner chose Done beside the timer. Unchecked, it has a thicker gray border,
a light gray interior and a gray tick, inside a timer-sized touch target.
Checked and unchecked circles have the same outer diameter as the timer, with a
fixed 21-unit radius and 5-unit stroke in the shared 56-unit view box.
Checking sends Ready immediately, fills the circle green, and collapses the
muted gray ticket to its header. An expand arrow replaces the timer. Clicking
anywhere on the Done receipt toggles expansion both ways, except its explicit
Done/Undo control; the arrow is also keyboard-accessible. Undo Done remains available with no countdown.
Kitchen labels are omitted: the order number identifies the food.
Only counter handover removes a Done ticket: it fades and shrinks by 4% over
320ms in its original slot, then holds a blank slot for 180ms before packing
again; reduced motion uses only the fade. The kitchen board packs into the
shortest of N responsive columns, without matching a neighbour's height.

### D10. The demo is built and approved first; nothing merges before the live half

The counter is live in production and has no gate to hide a half-built screen
behind. Phase 1 builds every screen against the demo adapter on this change's
branch; the owner approves from screenshots and the branch's `/demo` preview. The
branch merges only when the live half is complete and verified. Within the
branch, the demo adapter's types are the contract the live adapter must meet.

The owner approved Phase 1 on 11 October 2026: "rest looks good," requested that
the header total be dropped, and explicitly asked to record confirmation and
commit. Task 1.9 is complete. The database/live half is authorized by that gate,
but the owner will continue it in a separate chat; this session stops after the
demo commit. See [handoff.md](handoff.md) for the remaining work and contracts.

## Data Protection, RLS and Isolation

### D11. Durable feedback precedes background reconciliation

Dish ticks update the rail from the adapter's locally persisted result and release
their order immediately after local acceptance. They do not await pipeline or
shift-history reads. Pending projections serialize per order; other orders remain
usable. Invalidating an older pipeline read prevents it restoring a pre-tick view.
Payment and other accepted rail actions also release their controls before
background reconciliation; payment projects the accepted paid order immediately.

Live label validation reuses the rail's orders. Pipeline and bill fallbacks run
every ten seconds while visible; kitchen marks have a five-second fallback plus
Realtime and foreground nudges. Each reader runs one request at a time and retains
one trailing read when another nudge arrives. Post-Done callers await that trailing
read. Each caller resolves after its own batch, so subsequent polling cannot keep
an earlier action waiting indefinitely. Responses from a superseded outlet, shift
or adapter cannot update the UI.
No command, outbox, migration, policy or money contract changes.

- `kitchen_readies`: RLS on; select for the writing kitchen shift's own outlet and
  managers of it (as `kitchen_acknowledgements`); no direct insert, update or
  delete for any client role; append-only trigger. Isolation test.
- `order_line_preparations`: RLS on; select for a live counter shift at its own
  outlet and managers of it; no kitchen select (it reads through the board); no
  direct write for any client role. Isolation test.
- `orders.label` and `order_items.note`: covered by the existing order policies;
  the kitchen's read gains notes only through `kitchen_board()`, which still returns
  no customer column, price or payment fact.

## Offline Semantics

- Label and notes ride the existing order commands; queued offline, idempotent,
  unchanged in kind.
- Dish ticks are a new idempotent command in the outbox, drained in order with the
  rest; a tick for a line removed meanwhile is accepted and changes nothing.
- Ready and Undo are kitchen actions and online-only, like ACK. The counter shows the Ready cue
  only from a read it has made; offline it shows the last readiness it read.

## Money

No amount is added, removed or computed. A note carries none. A split line is an
ordinary new line at the menu's current price (D4).

## Risks

Phase 1 approval (11 October 2026): the owner chose Cash/UPI in Bills only,
removed the trial header total, and chose D9's pulsating dot. The existing demo menu's
Main Course category supplies Kitchen 2. Proposed dish records live in a typed
mock sidecar until the database phase, keeping current schema-generated fixtures
valid. Counter snapshots own labels, notes and ticks; kitchen snapshots own Ready
and ACK. Ready records merge by command ID with Undo preserved, so delayed demo
snapshots cannot erase another tab's Ready. See `review.md` and `review/`.

- **A card in two columns is narrower** than today's rail card at the same
  viewport; the demo checks a four-dish order with notes still reads at the
  counter's tablet width, and the one-dish height rule is re-measured.
- **Overlapping kitchen filters** share readiness (D7); the outlets run disjoint
  filters today.
