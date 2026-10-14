## RENAMED Requirements

- FROM: `### Requirement: The counter is one three-column workspace at every width`
- TO: `### Requirement: The counter is the menu and a two-column rail, with the composer laid over the rail`

- FROM: `### Requirement: A counter learns only which kitchens have answered`
- TO: `### Requirement: A counter learns only which kitchens have answered and which dishes are ready`

- FROM: `### Requirement: A pipeline card states both of its answers in two fixed controls`
- TO: `### Requirement: A pipeline card states handover per item and payment in its footer`

- FROM: `### Requirement: A rail card shows whether its kitchens have pressed ACK`
- TO: `### Requirement: Each kitchen has its own sent, acknowledged, ready and handed-over indicator`

## MODIFIED Requirements

### Requirement: The counter is the menu and a two-column rail, with the composer laid over the rail

The counter SHALL render two touch-safe columns at **every** width: the tappable
menu, and the activity rail holding the preparation pipeline as a single list laid
out in **two free-flowing columns**, processing the newest-first list into the
shorter column at each step. A shorter ticket SHALL NOT leave blank space beneath
it because its neighbour is taller. Each workspace column SHALL scroll
internally and SHALL NOT move the composer's controls off screen.

While an order is being composed or edited, the composer SHALL be laid over the
**left half** of the rail, at the width of one rail column or wider, and the
rail's cards SHALL keep their places beneath it: covered, never reflowed or
narrowed. When the order is saved, paid or abandoned the composer SHALL go and the
rail SHALL be uncovered as it was.

Spare width SHALL go to the menu up to the rail's two-column width and to the rail
beyond it. Below the width the two columns need, the workspace SHALL **scroll
horizontally** rather than rearrange: no column SHALL fold into a tab, a route or a
disclosure. The page itself SHALL NOT scroll horizontally — only the workspace.
Menu tiles SHALL be laid out against the width of their own column rather than the
viewport's.

Below the workspace, reached by scrolling the page down, SHALL be two panels:
**Bills**, holding Bills this shift and everything it offers today, and
**Expenses**, holding the counter's expenses. Expenses SHALL sit on the left at
the menu's width and Bills on the right at the two-column order rail's width,
using the workspace's gap. Narrow screens SHALL scroll these panels sideways
without stacking or narrowing them. Their horizontal scroll positions SHALL stay
linked to the workspace, including after column resizing, without a tab switch.
Their loading placeholders SHALL use the same panel layout.
The records panels SHALL fill a second viewport, allowing for persistent chrome
and outer padding. At the bottom of the page the workspace SHALL be above the
screen and records SHALL fill its usable height without trailing blank scroll.
This shift's per-method totals SHALL retain their existing tiles atop the Bills
panel only. The header pill SHALL describe counter status without a monetary
total. Search SHALL
keep its full menu-column width.

#### Scenario: Two columns of orders

- **WHEN** a biller uses the counter at landscape-tablet width with six orders on the rail
- **THEN** the rail shows them in two columns, newest at the top left, next at the top right, and subsequent tickets packed into the shorter column with only the standard gap

#### Scenario: Composing covers half the rail

- **WHEN** the biller taps a menu item with nothing being composed
- **THEN** the composer appears over the rail's left half, and the cards in the right half stay exactly where they were

#### Scenario: Composing ends

- **WHEN** the biller saves, settles or abandons the order
- **THEN** the composer goes and every card under it is where it was before

#### Scenario: Bills are below

- **WHEN** the biller scrolls the counter down
- **THEN** Bills this shift and Expenses are visible together with their existing actions, and taking a payment back or opening a receipt works as before

#### Scenario: The header states status

- **WHEN** the counter is scrolled to the top
- **THEN** its header pill shows synchronization, shift time and applicable kitchen-offline status, without a money total; Cash/UPI totals remain in Bills below

#### Scenario: The workspace is wider than the screen

- **WHEN** the viewport is narrower than the two columns and their gap
- **THEN** both columns keep their width and the workspace scrolls sideways, with the composer's controls reachable by scrolling rather than by navigating

### Requirement: Tapping an item adds it, tapping again increases its quantity

Tapping a menu item SHALL add one of it to the current bill. Tapping it again SHALL
increase by one the newest line of that item that has **no note and is not
locked**, and SHALL add a new line of one when there is none. A line is
**locked** once a kitchen has marked it Ready or the counter has ticked it. The
item's tile SHALL show the total quantity of that item across its lines.

#### Scenario: Adding the same item twice

- **WHEN** a biller taps an item twice
- **THEN** the bill contains one line for that item with a quantity of two

#### Scenario: The tile reflects the bill

- **WHEN** an item is on the current bill on two lines of one and two
- **THEN** its tile shows three

#### Scenario: A noted line is left alone

- **WHEN** an order holds one Chicken Shawarma noted *No sauce* and the biller taps Chicken Shawarma
- **THEN** a new line of one Chicken Shawarma without a note is added

#### Scenario: A ready dish takes no more

- **WHEN** the biller edits an order whose two Chicken Shawarmas the kitchen has marked Ready, and taps Chicken Shawarma
- **THEN** the two stay as they are, locked, and a new line of one Chicken Shawarma is added

### Requirement: Pipeline orders remain editable until they are paid

The pipeline SHALL list this outlet's unpaid orders, each with its reference,
complete quantity-and-item lines and total. A card SHALL show its temporary label and how long ago it was ordered. Customer entry remains in payment and composer edit. Items SHALL
NOT be truncated or collapsed because these lists are preparation work. Any
operator holding the owning tablet's live shift SHALL reopen and change lines,
quantities, notes, label and customer form values until payment or cancellation,
except that a locked line SHALL take no more and keep its note. No discount
control SHALL appear. The original order time and business date SHALL remain
unchanged, and visible on the order while it is edited. On the combined tablet workspace, edit SHALL use the
same menu and composer used for a new order, laid over the rail's left half. Any
in-progress new-order draft SHALL be restored exactly after the edit is saved
or cancelled. Once an order is paid, revision SHALL close for it everywhere.

#### Scenario: Staff scans work to prepare

- **WHEN** a pipeline order contains several different items and has a customer name
- **THEN** every item and quantity is readable without expansion, the total is prominent, the card labels its reference as Order # followed by the number, and customer details remain in payment and edit, while a small line under the label says how long ago it was ordered

#### Scenario: A locked line in the composer

- **WHEN** an order with a ticked line is opened for edit
- **THEN** that line shows as locked, its + adds a new line beside it, its note cannot be changed, and its − still lowers it

### Requirement: A pipeline card states handover per item and payment in its footer

A card SHALL show its orange order number, full label when present, and total. Under
the label, or alone where there is none, the card SHALL say how long ago the order
was placed in small muted text (*21m ago*, *1h 5m ago*), and the order number and
total SHALL each be as tall as the label and that line together. The card SHALL NOT
carry a timer or age ring: an order's age measures neither the kitchen, which hands
food over dish by dish and again as a table orders more, nor payment, which comes
last (owner, 2026-10-14). A gold member star SHALL overlap
the order number without moving it. Table N, Dine-in or Takeaway SHALL be centered in its footer space beside
Paid, leaving the label header uncluttered. Without service, Paid SHALL take the
full available footer width. The aggregate Prepared control SHALL be omitted.

Each item SHALL remain fully readable with quantity separate from its fixed-size
checkbox and its note underneath. Tapping SHALL tick or untick that line. A tick
SHALL color its text orange and fill the checkbox. Packaging SHALL have no tick.
Another till's lines SHALL remain read-only statements.

Paid SHALL retain its existing tender and reasoned take-back flows, with a
checked box only after money is recorded. A foreign till's payment SHALL be a
statement without control chrome. Customer entry SHALL remain available through
payment and the composer edit. Uncommon actions SHALL retain the touch-safe
Edit/Cancel overflow and their existing safety rules.

Each carrying kitchen SHALL retain a fixed indicator slot: a gray single tick
for sent, orange double tick for ACK, orange bell for its Ready food awaiting
handover, and no icon after all its food is ticked at the counter. Its state SHALL
NOT replace another kitchen's slot. Unticking or Undo SHALL restore the relevant
state; later food still owed SHALL restore sent/ACK after older Ready food is
handed over. Ready item rows SHALL keep their orange fill until ticked.

#### Scenario: Service leaves room for the label

- **WHEN** a labelled Table 4 order appears beside an order without service
- **THEN** Table 4 sits beside Paid in the first footer, and the second has one wide Paid control

#### Scenario: Ready is actionable

- **WHEN** kitchen Done arrives, then the counter ticks its last ready item
- **THEN** the bell appears immediately alongside the filled items and clears after handover

#### Scenario: Every item is handed over

- **WHEN** the last unticked item of an unpaid order is ticked
- **THEN** preparation is recorded without displaying an aggregate Prepared button; Paid keeps its state

### Requirement: Only a finished ticket travels

A card SHALL NOT be animated from one place to another within the pipeline list,
because recording preparation or payment does not move it. When an order becomes
both prepared and paid, its card SHALL fade where it stands, within about 300ms,
while the space it left collapses and its siblings settle without jumping; the
shift's totals and the Bills panel SHALL update. The fade SHALL be driven by the
same state change however it originated — local tap, another tablet, the day
change or a manager's action — and SHALL coalesce rapid successive departures
rather than queuing them. Under a reduced-motion preference the card SHALL simply
disappear, and no position SHALL depend on the animation having run. Loading
shimmers SHALL reserve the shape of the two-column rail and its cards.

#### Scenario: Recording one fact animates nothing

- **WHEN** the operator ticks a dish or records payment and the order is not yet both prepared and paid
- **THEN** no card moves and the list does not reflow

#### Scenario: A finished order leaves

- **WHEN** the second of preparation and payment is recorded
- **THEN** the card fades where it stood, the cards after it settle into its place, and the shift totals update

#### Scenario: Reduced motion

- **WHEN** the system requests reduced motion
- **THEN** the card disappears without fading and the rest land in the identical final positions

### Requirement: A counter learns only which kitchens have answered and which dishes are ready

The counter SHALL learn a kitchen's answers only through a read that requires a
live counter shift and returns, for its own outlet, the live kitchen tablets' ids
and labels; per open order, each kitchen's answer as waiting, seen or not shown;
and per item line of each order on the rail, the quantity a kitchen has marked
Ready, plus each carrying kitchen's aggregate sent/ACK/Ready/handed-over state.
It SHALL return no dish name, no acknowledgement or Ready time, no person,
and no dish-to-kitchen mapping. It SHALL refuse a kitchen shift, a
person's own session and anything without a live counter shift. A counter shift
SHALL be able to read its own outlet's kitchen pulse and no other outlet's.

#### Scenario: A kitchen shift asks

- **WHEN** a kitchen tablet with a live kitchen shift calls the counter's kitchen read
- **THEN** it is refused

#### Scenario: Another outlet's pulse

- **WHEN** a counter tablet with a live counter shift hand-crafts a read of another outlet's kitchen pulse
- **THEN** it receives nothing

#### Scenario: Ready arrives as a quantity

- **WHEN** a kitchen marks Ready an order's two Chicken Shawarmas
- **THEN** the counter's read carries that line's id with two, and nothing naming the kitchen or the time

### Requirement: Each kitchen has its own sent, acknowledged, ready and handed-over indicator

Each live kitchen carrying an order SHALL have one stable slot, ordered by kitchen
label, midway between the total and overflow control. The slot SHALL show a
neutral single tick when sent, orange double tick when the kitchen's current
visible food is acknowledged, orange bell while that kitchen has Ready food
awaiting counter handover, and no icon after all its food is handed over. The
empty handed-over slot SHALL retain its dimensions. There SHALL be no ACK bell
or kitchen-dot cluster. Accessible names SHALL identify the kitchen and state.

Each kitchen SHALL change independently. An edit affecting its owed food SHALL
restore sent until ACK; an edit only for another kitchen SHALL preserve its
state. Filter changes SHALL compare acknowledgements through the current filter,
preserving ACK for food already answered for. A kitchen not carrying the order
SHALL have no visible icon. With no live kitchen shift there SHALL be no kitchen
icons. ACK, Ready, Undo, filter and shift changes SHALL reach the counter within
seconds. Later food still owed SHALL restore sent/ACK after earlier Ready food
is handed over. Undo SHALL preserve counter handover.

#### Scenario: Two independent kitchens

- **WHEN** Kitchen 1 acknowledges then marks its food Done while Kitchen 2 has only received its food
- **THEN** Kitchen 1's slot changes single tick to orange double tick to bell, while Kitchen 2's single tick stays in its own slot

#### Scenario: Handover clears only its kitchen

- **WHEN** the counter ticks all Kitchen 1 food while Kitchen 2 still has food owed
- **THEN** Kitchen 1's icon clears without moving Kitchen 2's indicator

#### Scenario: A filter hides acknowledged food

- **WHEN** a kitchen hides some already-acknowledged food through its filter
- **THEN** it remains acknowledged for visible food already answered for, or carries no icon when it shows none

### Requirement: Editing a saved order is unmistakable, and it is one object

Edit SHALL use the composer over the rail's left half and an accent-outlined
editing pin in the uncovered right half, visually joined to the composer. The
underlying ordinary card SHALL retain its masonry position beneath the overlay,
without reflowing the rail. The rail itself SHALL NOT take the edit outline.
The pin SHALL show the edited order's identity and one footer with total,
customer action, Save and Cancel edit. The composer SHALL show the editable items
without a duplicate footer. Save SHALL remain one unwrapped word. Ending edit
SHALL remove the overlay and pin, revealing the rail, and restore any waiting
new-order draft exactly. Reduced motion SHALL not change the final geometry.

#### Scenario: The edit keeps the rail in place

- **WHEN** an unpaid saved order is opened for editing
- **THEN** the composer and editing pin appear as one accent-outlined object, while ordinary cards retain their underlying positions

#### Scenario: One footer during edit

- **WHEN** a saved order is being edited
- **THEN** its total, customer action, Save and Cancel edit appear once in the editing pin, without another composer footer

### Requirement: The right rail is the preparation pipeline

The rail SHALL contain one newest-first list of this outlet's orders that are not
both prepared and paid, packed into two independent columns. There SHALL be no
state sections. Recording dish handover or payment SHALL not reorder a ticket.
It SHALL name another operator or till when applicable. Paid food still owed
SHALL remain; an order SHALL leave only when prepared and paid.

The rail SHALL scroll as one, with directional controls only when orders are
clipped. Each control SHALL announce the hidden count and scroll to that end;
Ready orders SHALL be named with priority, and the bottom control SHALL retain
its non-textual marker for hidden prepared-but-unpaid orders. Saving SHALL scroll
to the newest end. Unticking an unfinished order SHALL clear its dish handover
without moving the card.

#### Scenario: Prepared food awaits payment

- **WHEN** a prepared unpaid order is hidden below the rail
- **THEN** the bottom scroll control retains its money marker

#### Scenario: Ready food awaits pickup

- **WHEN** kitchen Ready food is hidden outside the rail viewport
- **THEN** the control in that direction names its ready order and scrolls to it on activation

### Requirement: The rail's cards are tickets

Cards SHALL retain the torn ticket edge and prominent display-face order number.
Dish quantities SHALL remain visible separately from fixed checkboxes. A one-dish
card SHALL remain compact at approximately nine rem or less, without stretching
to a taller neighbour. Independent kitchen slots SHALL fit between the total
and overflow control without enlarging the card or adding an ACK-dot cluster.

#### Scenario: Compact independent cards

- **WHEN** a short one-dish ticket sits beside a noted multi-dish ticket
- **THEN** it keeps its own compact height, and the next card fills the space below it

## ADDED Requirements

### Requirement: An order carries a label from the composer to the card

The composer SHALL offer a **label** field at its top: optional, free text of up to
24 characters, with Order Label as its placeholder and a visually hidden caption, needing no phone number, saved with the order and changeable while
the order can be edited. The label SHALL be shown as the rail card's headline and SHALL NOT be shown on the kitchen's card. When the label matches another order's on the rail, the
composer SHALL say so quietly and SHALL save it anyway.

At payment, when the number entered has no saved name, the customer dialog SHALL
offer the label as the name, editable; a saved name SHALL always be used instead.

The label SHALL appear on no receipt, bill, report or export, and SHALL be gone
from the order once it leaves the rail.

#### Scenario: Taking an order in a rush

- **WHEN** a biller types *Rahul* in the label field and saves the order with no customer
- **THEN** the card reads *Rahul* beside its number, and the kitchen identifies it by order number

#### Scenario: A new number takes the label as its name

- **WHEN** the biller pays that order and enters a number that has no saved name
- **THEN** the name field reads *Rahul*, and the biller may change it before Use

#### Scenario: A known customer keeps their name

- **WHEN** the biller enters a number whose customer is saved as *Rahul Das*
- **THEN** the name is *Rahul Das*, not the label

#### Scenario: Two Rahuls

- **WHEN** the biller labels a new order *Rahul* while another order labelled *Rahul* is on the rail
- **THEN** the composer says another order is labelled Rahul, and the order saves with the label

#### Scenario: The label is thrown away

- **WHEN** the order is paid and every dish is ticked
- **THEN** it leaves the rail and its label is no longer stored, and its bill and receipt never showed it

### Requirement: A dish carries a note

Each item line in the composer SHALL carry a rightmost pencil note control after its compact quantity pill and amount,
opening a sheet with a text box of up to 60 characters and a row of quick notes —
a fixed few at first, then the notes this tablet has used most. On a line of two
or more the sheet SHALL ask **All** or **Only 1**; *Only 1* SHALL split one off into
its own line carrying the note. A note SHALL be shown under its dish on the rail
card and in the composer. A note SHALL carry no amount and SHALL appear on no
receipt. A locked line's note SHALL NOT change. Packaging SHALL carry no note.

#### Scenario: No sauce on one of two

- **WHEN** a biller opens the note on a line of two Chicken Shawarmas, types *No sauce* and chooses Only 1
- **THEN** the order holds one Chicken Shawarma and one Chicken Shawarma noted *No sauce*, and the total is unchanged

#### Scenario: A quick note

- **WHEN** the biller opens a note and taps *Extra spicy*
- **THEN** the line is noted *Extra spicy* without typing

#### Scenario: The receipt stays plain

- **WHEN** an order with a noted dish is paid
- **THEN** its receipt lists the dish without the note

### Requirement: A dish the kitchen marks Ready fills orange and rings once until ticked

When a kitchen marks dishes Ready, each of those dish lines on the counter's rail
card SHALL fill its whole row with the theme's orange accent, its text and quantity
drawn in the inverse foreground, legible in light and dark, until the counter ticks
it. The dish's checkbox SHALL remain, gray on the fill as it is on a waiting dish. A light band SHALL cross
the filled row periodically, like the landing page's offer banner, until the dish is
ticked. Ticking SHALL clear the fill and the shine, colour the dish text orange and
fill the checkbox with a contrasting check. The counter SHALL offer no Ready button
or other Ready control.

When a Ready **arrives** — the kitchen's ready quantity for a dish rises above what
the counter last read and exceeds what the counter has ticked — the counter SHALL
play one burst of the Handbell the owner chose (option 3: a figure of four
alternating strikes, two high-low rings, played twice, about three seconds), and that
order's Ready bell SHALL swing about three times as long and then stop. The sound
and the swing SHALL NOT repeat for the same Ready. A change the counter makes
itself — ticking or unticking a dish — SHALL NOT ring. When an order has no Ready
food left untaken, its bell SHALL stop swinging at once, and the sound SHALL stop
when no order it plays for is still owed. Readies arriving
together SHALL share one burst; a Ready arriving during a burst SHALL get at most one
further burst. A counter that loads and finds Readies already present SHALL ring
nothing and swing nothing. The handbell SHALL be the counter's only sound. Under
reduced motion the fill SHALL stay and the shine and swing SHALL NOT move.

Rows SHALL have space between them and vertically centered contents. The kitchen
status slots SHALL be centered between the total and bottom action icon.
Clickable dish rows SHALL show a hand cursor and subtle shadow on mouse hover,
without adding that hover treatment on touchscreens.
The dish checkbox SHALL be fixed at 15px, smaller than the former 17px Prepared
checkbox, and SHALL remain separate from the visible quantity. The card SHALL NOT
carry a ready-count label. While such a card is scrolled out of view, the rail's
scroll pointer in its direction SHALL name it as ready.

Each kitchen's bell SHALL appear only for its Ready food needing handover and
clear when that food is ticked, while other kitchens' indicators retain their states.

#### Scenario: The kitchen says it is ready

- **WHEN** the kitchen marks Ready an order's two Chicken Shawarmas
- **THEN** within seconds that line's row fills orange with its text inverted and its checkbox still gray, its quantity stays visible, the handbell rings once, and that order's bell swings for about three times as long as the sound

#### Scenario: Handed over

- **WHEN** the biller taps that line after the food is handed over
- **THEN** the fill and shine clear, its text becomes orange and its checkbox is filled and ticked, its quantity stays visible beside the check, and if nothing else on the order is Ready, the sound and the bell's swing stop

#### Scenario: Unticking does not ring

- **WHEN** the biller unticks a dish the kitchen had marked Ready
- **THEN** the row fills orange again, and no sound plays and no bell swings

#### Scenario: A counter that reloads does not ring again

- **WHEN** the counter reloads while an order has Ready dishes not yet ticked
- **THEN** those dishes are filled orange, and no sound plays and no bell swings

#### Scenario: Ready but out of sight

- **WHEN** a ready order is scrolled below the rail's view
- **THEN** the bottom pointer names it as ready, and tapping it brings the card into view

#### Scenario: The kitchen takes it back

- **WHEN** the kitchen undoes its Ready
- **THEN** the counter's dishes lose their fill and keep their normal unticked appearance

### Requirement: The composer gives names room

The quantity changer SHALL use one compact pill, and the note action SHALL be a
pencil at the right of the item row. Save SHALL be a single unwrapped word.
Demo orders SHALL mostly have service choices consistent with the demo settings,
including dine-in/table and takeaway, with at most two legacy no-service examples.

### Requirement: The owner's Orders tab says what the counter's card says

With `dish-ticks` on, each open order on the billing history's Orders tab SHALL
show, compactly: its number, label and total; when it was ordered and how long
ago, who rang it, and its table or takeaway; whether it is paid; each kitchen's
answer in words (sent, seen, ready, served); each dish with its quantity, note and
price in one of four states — placed, acknowledged, Done, handed over — in the
counter's marks (✓, ✓✓, the bell, a ticked box), each named on hover and to a
screen reader; and the customer on one line beside Cancel order. A dish SHALL read
acknowledged only when every kitchen still owing it has acknowledged at least what
it owes. With `kitchen-ready` off, nothing SHALL read Done. The kitchens' answers
SHALL come from a read that only the owner and that outlet's franchise admins may
make, made with the page's other reads when it opens and never on a timer; if it
fails the orders SHALL still list. With `dish-ticks` off the tab SHALL be as it was.

#### Scenario: The owner checks an order from away

- **WHEN** the owner opens the Orders tab while Kitchen 1 has acknowledged one dish of an unpaid order, marked another Done and the counter has handed over a third
- **THEN** the card says Not paid and Kitchen 1 · ready, and the three dishes show ✓✓, the bell and a ticked box

#### Scenario: Another outlet's manager cannot read these kitchens

- **WHEN** a franchise admin of another outlet asks for this outlet's kitchens
- **THEN** the read is refused, as reading its orders is
