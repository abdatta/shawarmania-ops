## Context

`ui-billing-counter` built a fast pay-now cart. The real workflow also needs an
order that exists while the food is being made, a reference for that order,
payment on handover, customer recognition, shift history and manager correction.
The database and customer contracts from #32 and #33 land first, so new mocks stay
typed from generated schema types. This change makes no real read or write and
promotes no gate.

## Goals / Non-Goals

**Goals:**

- Preserve the fast direct-payment path exactly as it is.
- Make the full order lifecycle walkable on the tablet that took the order.
- Give counter and manager contexts only the history each needs.
- Define adapter shapes #10 can swap to real implementations unchanged.
- Keep the counter's whole working set in one touch-safe three-column workspace at
  every width, scrolling sideways rather than rearranging.

**Non-Goals:**

- Supabase calls, local durability, synchronisation or gate promotion.
- Order transfer, recovery surfaces, version-conflict screens.
- Several tablets, discounts, deposits or partially paid orders, profile editing, printing or GST.
- Manager-side billing, automatic re-ring handoff or prefill, and manager mutation
  of a tablet's local delivery queue.

## Decisions

### Order is the ordinary terminal action

The current cart stays the composition surface. Order is the primary action: the
ordinary sequence is record the order, prepare it, hand it over, then mark it
paid. Mark Paid opens exact tender capture and creates a paid result directly for
the rarer customer who pays upfront. The two paths remain siblings; making Order
visually primary does not require every sale to pass through saved state.

The direct-payment path also keeps its existing six-second Undo. A direct-payment command
is accepted into the demo queue and the composer clears, but delivery cannot begin
while Undo is visible. Undo removes that still-unsent command and restores the
composer. Once the window ends, only an attributed manager void can correct the
paid bill.

### V1 offers no discount

The schema and arithmetic retain `discount_paise`, but every command in this
change sends zero and no discount control appears. A discount is a pricing and
authority decision the business has not made; exposing the dormant column as a
form field would make that decision accidentally. Partial payment and tax breakup
remain absent for the same reason.

### The persistent card leads with the work, not its reference

The kitchen and counter first need to know every item to prepare, who the order is
for when a customer was captured, and the amount to tell that customer. Those
facts therefore form the card's visual hierarchy: complete quantity-and-item
lines, an optional customer heading, and a prominent total. The daily order
number remains visible only as a small reference; it does not compete with the
food or amount.

There is no separate latest-order confirmation card: several orders can be taken
back to back, and a one-slot card immediately becomes stale or repeats a reference
that may already have been handled. Edit, cancel and Mark Paid stay grouped below the
information rather than interrupting its reading order.

### Mark Paid records exact tender, including splits

The same modal serves direct bills and saved orders. With no amount keyed, tapping
a method allocates the whole remaining balance, keeping ordinary payment fast. A
touch keypad lets the biller key an amount before tapping a method; the remainder
can then go to another method. Allocations are positive integer paise, each method
appears at most once, and their sum must equal the bill total before Mark Paid enables.
This supports ₹100 Cash plus ₹39 UPI on a ₹139 bill without creating a partial or
deposit state.

`bill_payments` is the canonical append-only allocation ledger. A nullable
`bills.payment_method` remains only as a compatibility summary for single-tender
bills and is null for mixed bills. Drawer close sums Cash allocation rows, never
the whole value of a mixed bill. The shared command payload carries `payments`,
so the later live adapter does not have to reinterpret a UI-only split.

### Open orders are a tablet workspace, not outlet history

Open orders lists only orders this tablet owns, with number, age, customer label,
items and total. Anyone holding the tablet's live shift may reopen, edit, pay or
cancel. The creator stays visible separately from the current actor.

Open orders and My shift **carry no navigation entry**. They began as two Counter
tabs; the three-column workspace below made them permanently visible columns, and
a tab leading to a second copy of a column already on screen is a second door into
one room — the reason `counter-billing` has never had one either. Their routes and
standalone layouts remain, because the gate still decides whether the content
renders and a link into either has to resolve.

Showing every outlet order on the counter was rejected because a shared tablet
should not expose outlet-wide takings.

Open-order cards are intentionally compact but never truncate preparation lines.
Edit and cancel are touch-sized icon actions; Mark Paid is the only labelled primary
action. Cancellation always shows one editable reason field; common reason tiles
fill it, after which the operator may amend it or type a different reason from
scratch. This keeps ordinary use off the keyboard without inventing an Other
choice.

For today's orders, age is operationally more useful than a date, so the card
shows now, minutes ago or hours ago. Older orders keep their full outlet-local
date and time. The creator is shown only when it differs from the person holding
the current billing shift; repeating the current person's name adds no
information. Each preparation line carries its own captured line amount at the
right edge.

Editing does not grow a miniature counter inside the narrow activity card.
Instead, the edit icon hands the order to the familiar menu and current-bill
composer: tiles add items, line controls change or remove them, and customer name
and phone remain editable. If a new order was already being composed, its full
draft is suspended in memory and restored after Save changes or Cancel edit, so
editing existing work never destroys incoming work.

### Customer identification is a reversible UI trial

The composer enables Order and Mark Paid only after at least one of customer name
or phone is nonblank. Neither individual field is required, and the database
remains unchanged with both snapshots nullable. This is deliberately UI-only: it
tests the counter habit without manufacturing a schema promise while the owner is
still deciding the long-term rule.

### The counter is one three-column workspace, and it never rearranges

The Counter, Open orders and My shift stop behaving like three destinations. The
menu occupies the left column, the current bill is the stable middle column, and a
single activity rail at right places this tablet's open orders above this shift's
closed bills with one labelled divider. Each column scrolls internally, so the
page and payment controls do not jump.

**This holds at every width.** The current bill and activity columns are the same
width as each other, spare width goes to the menu, and below the width three
columns need, the workspace scrolls **horizontally**. Nothing folds into a tab, a
route or a disclosure.

Responsive rearrangement was tried and rejected: it moves controls while somebody
is reaching for them, and it hides the order being paid for behind a navigation
step at exactly the moment a queue is forming. A column is about a phone's width,
so the narrow case is three swipeable panels rather than a compromise. Only the
workspace scrolls sideways; the page never does. Menu tiles are consequently sized
by container query against their own column, not the viewport — a viewport-keyed
rule would put three tiles in a phone's width of space.

### The order under edit is one object that moves

Editing is a mode, and the workspace has to say so without a sentence. The
composer takes the accent outline and names the order. The order leaves the open
list and **its own card** — same body, same position, nothing restyled on
arrival — travels left out of the rail's margin to meet the composer's edge, flat
and borderless on that side, so the two read as one piece of work. The rail around
it stays neutral: outlining the whole column would sweep this shift's bills and
every other open order into a highlight that means "being edited".

The card keeps its place in the column's scroll and is `sticky`, not fixed: it pins
at an edge only while scrolling would take it out of view, and releases on the way
back. A fixed card was built first and rejected — it looked identical at rest and
lied about what scrolling would do. Arrival is a CSS entry animation rather than a
transition, so the resting state is the docked one; a transition needs a first
frame in the undocked position, and a tab that is not visible gets no animation
frame, which would leave the card a centimetre short with no way back.

**The composer's footer moves onto that card** for the duration of the edit — the
total, the customer fields, Save changes and Cancel edit — leaving the composer as
the items alone. Exactly one footer is mounted at a time; two would mean two Save
changes buttons and two fields sharing one id. The card shows no second copy of
anything the composer is editing: not the item list live beside it, and not a
second total. Duplicating them was tried and reads as a stale card the moment the
biller changes anything.

### An item's name is never truncated, and an unsellable price is never shown

A tile, a bill line and a closed bill's line show the full name. On this menu the
names share long prefixes — Mayonnaise Chicken Shawarma, Mozzarella Cheese Chicken
Shawarma — so an ellipsis removes exactly the part that tells them apart. Tiles
grow to fit and each grid row stretches to its tallest tile, so nothing has to
clip for the grid to stay even.

A tile's price sits at the top right, in the same place whatever the name above it
does, so a column of prices can be swept without the figure moving. An unavailable
item shows an Off marker **instead of** its price: the price of something nobody
can sell is the one figure on the screen that cannot be acted on, and beside a
column of prices that can be, it is a number a biller might quote before noticing
the tile is dashed.

### The Biller has no Menu page

There was one — the manager's surface without the editing — and the column above
retired it. Every item, price, veg marker and Off marker is now permanently on
screen beside the bill, so a second page carrying the same facts is a second place
to look. The always-true `canEdit` branch and the read-only rendering behind it go
with it: a branch that reads as a boundary while enforcing nothing is worse than no
branch. The boundary was never there — a Biller's menu write meets
`menu_items_write`, which is what the retained test asserts. The one loss is an
item's description, which no counter surface now shows; that is recorded in
`docs/LIMITATIONS.md` rather than solved by putting it on a tile, because tile
height is what keeps the whole menu on one screen.

### A phone is a phone or it is refused

The composer canonicalises a typed phone by the same `shared/phone` rule the
database uses, and refuses both terminal actions while the field holds something
that is not a complete Indian mobile number — reported under the field on blur, not
mid-typing, since every number is incomplete for the first nine digits of entering
it. An empty field stays acceptable; name or phone satisfies identity.

This closes a silent hole rather than adding a rule. Validation existed only to
decide whether to *look up* a customer, so a malformed number skipped
`createOrGet` entirely and still landed on the bill: PII written wrong, a customer
record that quietly failed to save, and nothing on screen saying so.

### An aggregator order is an ordinary order

Swiggy and Zomato work arrives on the aggregator's own device, gets rung into our
counter as an order so the kitchen has it, and is paid by that aggregator's
payment method when the rider collects. It needs no separate flow, no separate
list and no aggregator reference field, which the owner explicitly did not want.
The demo scenario carries one of these end to end so the path is walked, not
assumed.

### A cancelled order is reported as cancelled, not as a conflict

The only second writer an order can have is that outlet's manager cancelling it.
When a payment meets that, the counter says the order was cancelled and by whom,
and stops. The optimistic-version conflict screen from the original design is cut
along with the version contract behind it in #33.

### Counter history and manager history are different surfaces

My shift shows only paid bills from this tablet's current shift and totals by
payment method. All supported methods remain visible at zero so absence is not
mistaken for a missing category. The manager's history is a phone-oriented outlet surface with
revenue-business-date, status and payment filters, immutable detail, reasoned
void, and the outlet's open orders with a cancel action. Detail shows payment time
and payment business date when they differ from the order clock. Tablet context
never inherits the wider history just because a manager happens to be holding the
shift.

A closed bill is collapsed by default, but its row is a disclosure rather than a
dead summary. Expanding it shows the immutable item snapshots, quantities, unit
prices, line totals, payment time and method, total, and optional customer name.
The disclosure is shared by My shift and the tablet activity rail so one view
cannot become less auditable than the other.

### Payment methods are a finite supported set

Neither outlet owns a card reader, and Other is not a meaningful accounting
category. A read-only production audit found no bills or expenses using either.
New bills therefore accept only Cash, UPI, Swiggy or Zomato, and expenses accept
only Cash or UPI. The shared command type, mock fixtures, filters, forms,
documentation and later plans omit Card and Other; a future method is added by
name when the business actually adopts it.

PostgreSQL cannot drop one enum value in place. A guarded forward migration first
refuses to run if any Card or Other row exists, temporarily casts the two empty columns to
text, replaces the enum with the four supported methods, restores the typed columns and their
dependent expense policy, and then regenerates schema types. It never rewrites or
relabels historical money.

A manager never re-rings from this personal-device surface. After voiding, the
screen instructs that the corrected contents must be rung manually on the enrolled
counter tablet. There is no cross-device draft, automatic prefill or manager-side
payment command: each would create a new billing authority path that #9 and #33 do
not grant.

### Correction never mutates an accepted paid bill

A paid bill is voided with a reason and manually re-rung as a new bill at the
counter. A local command that will never succeed reads as needing attention on
the originating tablet. An operator holding that tablet's live shift may correct
it, producing a new client UUID linked to the original, or discard it with a
non-blank reason; both retain actor, time and the refused trace. A manager's phone
may show non-identifying diagnostic metadata, but cannot read the payload or
mutate the local queue. Open orders are cancelled, never deleted.

### Plain words for every delivery state

Not sent yet, retrying, needs attention, sent, void, cancelled. No screen in this
change uses the words quarantine, envelope, idempotency or provisional. A biller
at 9pm has to know what to do next, and the state name is where that starts.

### Expand the coherent demo day rather than add isolated fixtures

The shared demo store gains a repeat customer found by phone, a direct paid bill,
an order taken and paid on handover, an aggregator order collected by a rider, a
cancelled order with a reason, an unsent bill, and one command needing attention.
Revenue and drawer totals are updated so every owner, cash and history surface
still reconciles.

## Risks / Trade-offs

- **Tender capture slows the counter** → tapping one method assigns the whole
  remainder; the keypad is needed only for a split.
- **A reference distracts from preparation** → the order number is a small chip;
  complete items, optional customer and total own the card hierarchy.
- **Three columns become cramped on smaller screens** → they keep their width and
  the workspace scrolls sideways instead. A column is about a phone's width, so the
  narrow case degrades into three swipeable panels rather than into a rearrangement
  that moves controls under a reaching hand.
- **A biller loses a column off-screen and does not know it is there** → each is a
  full-height panel at a fixed width with a scrollbar on the workspace, and nothing
  is ever *only* off-screen: the composer is the middle column, so it is partly
  visible from either end.
- **Exception UI overwhelms ordinary billing** → correction and manager work stay
  out of the composer and appear only when relevant.
- **Demo types drift from later adapters** → row shapes derive from generated
  schema types and adapters remain the only screen dependency.
- **The customer prompt leaks a phone over a shoulder** → a match is revealed only
  after full phone entry, showing only billing-useful fields.

## Migration Plan

Add adapter contracts and fixtures first, then counter routes and components, then
manager history. Every gate stays demo-only. Rollback restores the old composer
and registry entries; no real or browser-persistent data migrates.

## Open Questions

None.
