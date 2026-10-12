## RENAMED Requirements

- FROM: `### Requirement: The counter is one three-column workspace at every width`
- TO: `### Requirement: The counter is the menu and a two-column rail, with the composer laid over the rail`

- FROM: `### Requirement: A counter learns only which kitchens have answered`
- TO: `### Requirement: A counter learns only which kitchens have answered and which dishes are ready`

## MODIFIED Requirements

### Requirement: The counter is the menu and a two-column rail, with the composer laid over the rail

The counter SHALL render two touch-safe columns at **every** width: the tappable
menu, and the activity rail holding the preparation pipeline as a single list laid
out in **two columns**, newest first in reading order. Each column SHALL scroll
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

Below the workspace, reached by scrolling the page down, SHALL be two tabs:
**Bills**, holding Bills this shift and everything it offers today, and
**Expenses**, holding the counter's expenses. The tablet SHALL remember which tab
was last chosen. This shift's per-method totals SHALL keep their current tiles,
placed where the owner chose from the demo (recorded in this change's design).

#### Scenario: Two columns of orders

- **WHEN** a biller uses the counter at landscape-tablet width with six orders on the rail
- **THEN** the rail shows them in two columns, newest at the top left, then top right, then down

#### Scenario: Composing covers half the rail

- **WHEN** the biller taps a menu item with nothing being composed
- **THEN** the composer appears over the rail's left half, and the cards in the right half stay exactly where they were

#### Scenario: Composing ends

- **WHEN** the biller saves, settles or abandons the order
- **THEN** the composer goes and every card under it is where it was before

#### Scenario: Bills are below

- **WHEN** the biller scrolls the counter down and chooses Bills
- **THEN** Bills this shift is shown with its totals, and taking a payment back or opening a receipt works as before

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
complete quantity-and-item lines and total. A card SHALL NOT print the
customer's name or the order's age: the list is ordered newest first, and the
customer is one control away (see *A pipeline card states both of its answers in
two fixed controls*). Items SHALL
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
- **THEN** every item and quantity is readable without expansion, the total is prominent, the card labels its reference as Order # followed by the number, and the customer's name is not printed on the card but opens from its customer control

#### Scenario: A locked line in the composer

- **WHEN** an order with a ticked line is opened for edit
- **THEN** that line shows as locked, its + adds a new line beside it, its note cannot be changed, and its − still lowers it

### Requirement: A pipeline card states both of its answers in two fixed controls

A pipeline card SHALL show its reference with the number part in the brand's
bright primary colour, followed by one place tag — its table, or its order type
when it has no table — drawn in a single style for both, with an icon and small
capitals that do not read as an item line. When the order has a **label**, it
SHALL be the card's headline beside the reference, in full. Then one meta line —
creator when another operator took the order, till when another till did — the
total prominent at the right, and complete untruncated item lines with bold
quantity prefixes, each line's note beneath it. The card SHALL NOT print the
customer's name or the order's age.

Beside the total, a card SHALL carry one customer control whenever the order has
a customer or one can be set from this tablet. With a customer, it SHALL open
what the order recorded — name, phone and membership — and, while the order can
be edited here, offer to change it. A gold member's star SHALL sit on that
control rather than beside the reference, because it describes the customer. Without one, or when the biller changes it, it SHALL open the order in the
composer with the customer dialog already open: the ordinary edit and its
ordinary revision, with no new write. Because the customer is the whole of that
edit, choosing in the dialog SHALL save it at once — Use attaches the customer,
Skip saves the order with no customer, as Skip means everywhere else — and
closing the dialog without choosing SHALL abandon the edit and leave the order
unchanged [owner, 2026-10-05]. Per-line prices SHALL NOT appear on a pipeline card. A
one-item card SHALL stand no taller than about 120px so at least six fit the rail
at landscape tablet height without scrolling. Item names SHALL never truncate.

Each item line SHALL be ticked off on its own by a tap on the line, which SHALL
fill its quantity tile and draw a check; a tap on a ticked line SHALL untick it.
Packaging SHALL carry no tick. Ticking SHALL be available on this tablet's orders
and drawn as a statement on another till's.

Beneath that, every card SHALL carry exactly two state controls, **Prepared**
then **Paid**, in that order and at equal width, on every card in every state.
Neither control SHALL be reordered, resized, renamed or withheld because of the
order's state: the words **Prepared** and **Paid** SHALL be the only words those
controls ever read, and the interface SHALL contain no Reprepare and no Un-pay.

Each control SHALL draw a checkbox stating whether that fact is recorded. An
unrecorded fact SHALL draw an unchecked box in its own colour — preparation in the
brand primary, payment in the success colour. A recorded fact SHALL fill its
control with that colour and draw the checked box and its mark in that control's
own foreground token, so the mark stays legible on the fill in both themes.
Recorded and unrecorded SHALL differ in **shape** as well as colour. No separate
paid badge SHALL be drawn, because the checked payment control already says it.

**Prepared SHALL follow the dishes**: it SHALL be checked exactly when every item
line is ticked, SHALL uncheck itself when an edit adds a line or quantity not
ticked, and SHALL be drawn **without control chrome**, as a statement, on every
card. Activating an unchecked payment control SHALL open the tender dialog, and
the control SHALL become checked only once payment is recorded. Activating a
checked payment control SHALL open the reasoned take-back confirmation.

Where payment cannot be changed from this tablet — which in the pipeline means
another till's order, since a payment on a card still in the list is always
reversible — its control SHALL be drawn **without control chrome**, as a
statement of what is true, and SHALL NOT be drawn as a dimmed or disabled
control.

All uncommon actions SHALL sit behind one overflow control presenting touch-safe
labelled rows: Edit and Cancel on an unpaid card, and Cancel after paid on a paid
card. Edit SHALL be unavailable once an order is paid.

#### Scenario: Two cards in different states read the same way

- **WHEN** a biller reads an unprepared card and a prepared card side by side
- **THEN** both carry Prepared then Paid in the same places with the same words, and only the boxes and the fills differ

#### Scenario: Ticking the last dish prepares the order

- **WHEN** the operator ticks the last unticked dish of an order
- **THEN** Prepared fills and shows a checked box, the payment control is untouched in place and wording, and no badge appears

#### Scenario: An edit unprepares it

- **WHEN** a prepared, unpaid order is edited to add a Fries
- **THEN** Fries is unticked, Prepared is unchecked, and the ticked dishes stay ticked

#### Scenario: Prepared cannot be tapped

- **WHEN** the operator taps Prepared
- **THEN** nothing is recorded; it states what the dishes say

#### Scenario: The label is the headline

- **WHEN** an order labelled *Red shirt* is on the rail
- **THEN** its card reads *Red shirt* beside its number, without opening anything

#### Scenario: Payment is recorded through the tender dialog

- **WHEN** the operator activates an unchecked Paid control
- **THEN** the tender dialog opens and the control becomes checked only after an exact allocation is recorded

#### Scenario: A recorded payment is taken back from its own control

- **WHEN** the operator activates a checked Paid control on a card in the list
- **THEN** the reasoned take-back confirmation opens, naming the amount and tender, and no control has renamed itself to offer it

#### Scenario: Every ticked payment in the list can be unticked

- **WHEN** any card in the pipeline list shows a checked Paid control on this till's order
- **THEN** activating it opens the take-back rather than refusing, because a card leaves the list as soon as its ticket is finished

#### Scenario: What cannot be changed is not drawn as a broken control

- **WHEN** a card belongs to another till
- **THEN** its dishes and both controls are drawn as statements without control chrome rather than as dimmed controls, and the card names the till

#### Scenario: State survives without colour

- **WHEN** the two controls, or a ticked and an unticked dish, are compared without relying on hue
- **THEN** checked and unchecked differ by shape

#### Scenario: Rare actions keep their safety

- **WHEN** the operator opens a card's overflow menu
- **THEN** each action is a labelled row at least 40px tall, and cancellation still requires its reasoned confirmation

#### Scenario: A paid order cannot be edited

- **WHEN** the operator opens the overflow of a paid card
- **THEN** Edit is absent or refused with guidance to take the payment back first, and the composer cannot load a paid order's lines for revision

#### Scenario: The customer is one tap away

- **WHEN** a biller taps the customer control on a card whose order has a customer
- **THEN** the order's customer name, phone and membership open over the counter, and nothing about the order changes

#### Scenario: A customer is added from the card

- **WHEN** a biller taps the customer control on this tablet's open order that has no customer
- **THEN** the order opens in the composer with the customer dialog open, and choosing Use saves the order with that customer at once, with no Save changes

#### Scenario: Skip from the card removes the customer

- **WHEN** a biller changes an order's customer from its card and chooses Skip
- **THEN** the order is saved at once with no customer's number, and leaves edit mode

#### Scenario: Closing the dialog from the card changes nothing

- **WHEN** a biller opens the customer dialog from a card and closes it without choosing
- **THEN** the edit is abandoned, the order is unchanged, and nothing is written

### Requirement: Only a finished ticket travels

A card SHALL NOT be animated from one place to another within the pipeline list,
because recording preparation or payment does not move it. When an order becomes
both prepared and paid, its card SHALL fade where it stands, within about 300ms,
while the space it left collapses and its siblings settle without jumping; the
shift's totals and the Bills tab SHALL update. The fade SHALL be driven by the
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
Ready. It SHALL return no dish name, no acknowledgement or Ready time, no person,
and not which kitchen marked a dish Ready. It SHALL refuse a kitchen shift, a
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

## ADDED Requirements

### Requirement: An order carries a label from the composer to the card

The composer SHALL offer a **label** field at its top: optional, free text of up to
24 characters, needing no phone number, saved with the order and changeable while
the order can be edited. The label SHALL be shown as the rail card's headline and
on the kitchen's card. When the label matches another order's on the rail, the
composer SHALL say so quietly and SHALL save it anyway.

At payment, when the number entered has no saved name, the customer dialog SHALL
offer the label as the name, editable; a saved name SHALL always be used instead.

The label SHALL appear on no receipt, bill, report or export, and SHALL be gone
from the order once it leaves the rail.

#### Scenario: Taking an order in a rush

- **WHEN** a biller types *Rahul* in the label field and saves the order with no customer
- **THEN** the card reads *Rahul* beside its number, and the kitchen's card shows *Rahul*

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

Each item line in the composer SHALL carry a note control beside its − and +,
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

### Requirement: A dish the kitchen marks Ready shakes on the counter until ticked

When a kitchen marks dishes Ready, those dish lines on the counter's rail card
SHALL take a highlighted border and shake briefly, then shake again about every 30
seconds, until the counter ticks them. The card SHALL carry a mark saying how many
of its dishes are ready and not ticked. While such a card is scrolled out of view,
the rail's scroll pointer in its direction SHALL name it as ready. The counter
SHALL make **no sound** for any of this. Under reduced motion, the shake SHALL be a
fade and return. Ticking a ready dish SHALL stop its shaking at once.

The bell SHALL be unaffected by Ready, except that a dish a kitchen has marked
Ready or the counter has ticked SHALL count as answered by every kitchen.

#### Scenario: The kitchen says it is ready

- **WHEN** the kitchen marks Ready an order's two Chicken Shawarmas
- **THEN** within seconds that line on the counter's card is bordered and shakes, the card reads *2 ready*, and no sound plays

#### Scenario: Handed over

- **WHEN** the biller taps that line after the food is handed over
- **THEN** it is ticked, stops shaking, and the card's ready mark goes

#### Scenario: Ready but out of sight

- **WHEN** a ready order is scrolled below the rail's view
- **THEN** the bottom pointer names it as ready, and tapping it brings the card into view

#### Scenario: The kitchen takes it back

- **WHEN** the kitchen undoes its Ready
- **THEN** the counter's dishes stop shaking and lose their border
