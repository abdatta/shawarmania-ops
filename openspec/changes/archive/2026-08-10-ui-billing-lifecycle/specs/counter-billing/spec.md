## ADDED Requirements

### Requirement: The composer supports immediate payment and saving an order

The billing composer SHALL offer primary Order and secondary Mark Paid once at
least one line exists and either customer name or phone is nonblank. Order SHALL
create a tablet-owned order without assigning a bill number and SHALL clear the
composer only after the adapter accepts it. Mark Paid SHALL open the tender
dialog and create a paid result after exact payment allocation. This
identification requirement SHALL exist only in the UI; the database SHALL keep
both snapshots nullable. V1 SHALL offer no discount control, and both paths SHALL
carry `discount_paise` as zero.

#### Scenario: Customer pays upfront
- **WHEN** an operator opens Mark Paid, allocates the exact total and confirms Mark Paid
- **THEN** a paid result is created directly, with no order saved first

#### Scenario: No discount is offered
- **WHEN** an operator composes, saves, reopens or pays an order
- **THEN** no discount control appears and the accepted command carries a zero discount

#### Scenario: Food has to be made first
- **WHEN** an operator chooses Order
- **THEN** the order appears in Open orders with its order number and no bill number

#### Scenario: Customer identification is missing
- **WHEN** the current bill has items but both customer name and phone are blank
- **THEN** Order and Mark Paid remain disabled with guidance to add either field, while no database constraint is added

### Requirement: Direct payment retains a guaranteed unsent Undo

After local acceptance, a direct-payment confirmation SHALL offer Undo for the existing
six-second window and SHALL NOT begin delivery while that action is visible. Undo
SHALL remove the still-unsent command and restore the composer exactly. Once the
window ends or delivery begins, no Undo SHALL appear and correction SHALL require
an attributed manager void plus a new bill.

#### Scenario: Operator undoes Mark Paid
- **WHEN** the operator uses Undo during the confirmation window
- **THEN** the command is removed before delivery and its lines, customer form and payment method return to the composer

#### Scenario: The Undo window has ended
- **WHEN** the direct-payment command becomes eligible for delivery
- **THEN** Undo is absent and the accepted sale cannot be edited in place

### Requirement: A saved order enters the persistent open-order rail

On saving, the surface SHALL put the order directly into Open orders, where its
complete quantity-and-item lines SHALL be the primary information, followed by
the customer name when one exists and the prominent total. Its order number SHALL
remain visible as a secondary reference until payment or cancellation. The
surface SHALL NOT add a separate latest-order card that can represent only one of
several rapid orders. The order number SHALL be visually distinct from a bill
number wherever both could be seen.

#### Scenario: The order is saved
- **WHEN** an order is accepted
- **THEN** its preparation items and total appear immediately, its customer is shown when known, and its order number remains available as a small reference

#### Scenario: The order is paid
- **WHEN** an order becomes a paid bill
- **THEN** the bill number identifies it from that point and the two numbers are never presented as interchangeable

### Requirement: Open orders remain editable on the tablet that took them

Open orders SHALL list only orders owned by this tablet, each with its order
number, age, optional customer, complete quantity-and-item lines and total. Items
SHALL NOT be truncated or collapsed because this list is preparation work. Any
operator holding the tablet's live shift SHALL reopen and change lines,
quantities and customer form values until payment or cancellation. No discount
control SHALL appear. The original order time and business date SHALL remain
visible and unchanged. On the combined tablet workspace, edit SHALL use the same
menu and current-bill composer used for a new order. Any in-progress new-order
draft SHALL be restored exactly after the edit is saved or cancelled.

#### Scenario: Staff scans work to prepare
- **WHEN** an open order contains several different items and has a customer name
- **THEN** every item, quantity and line amount is readable without expansion, the customer and total are prominent, and the card labels its reference as Order # followed by the number

#### Scenario: Current operator created the order today
- **WHEN** the order was created today by the person holding the current billing shift
- **THEN** the card shows a relative age such as now or 12 mins ago and does not repeat that person's name

#### Scenario: Another operator created the order
- **WHEN** the order creator differs from the person holding the current billing shift
- **THEN** the creator's name remains visible beside the age or date

#### Scenario: Incoming operator edits an order
- **WHEN** a different operator's shift begins on the same tablet and they edit its open order
- **THEN** the order keeps its creator and original date while recording the new acting operator

#### Scenario: Operator changes the whole order
- **WHEN** the operator edits an open order
- **THEN** they can add any available menu item, change or remove existing quantities, and edit customer name or phone from the familiar composer

#### Scenario: A new-order draft already exists
- **WHEN** the operator starts editing an open order while another bill is being composed
- **THEN** the new-order lines, customer fields and payment preset are suspended and restored exactly after Save changes or Cancel edit

#### Scenario: A manager cancelled it first
- **WHEN** an operator tries to pay an order that the outlet's manager cancelled moments earlier
- **THEN** the attempt stops, states that the order was cancelled and by whom, and creates no bill

### Requirement: Payment finalises the displayed bill with exact tender allocations

A direct bill or open order SHALL be payable through one or more exact tender
allocations from Cash, UPI, Swiggy or Zomato. The allocations SHALL each
be positive integer paise, SHALL use a method at most once, and SHALL sum exactly
to the bill total. Card and Other SHALL NOT be offered or accepted by an application
command because the outlets have no card reader. Successful payment SHALL show
the bill number once known, or state plainly that it is not sent yet while
delivery is pending. Split tender SHALL NOT create a partial-payment state: the
bill becomes paid only after the full total is allocated.

#### Scenario: A rider collects an aggregator order
- **WHEN** an operator opens an aggregator order and pays it by that aggregator's method
- **THEN** the order becomes a paid bill with that method and leaves Open orders

#### Scenario: An order is paid after cutover
- **WHEN** an operator pays an order taken before the outlet's cutover
- **THEN** the paid view keeps the order's original business date and shows the payment time separately

#### Scenario: Available tender methods
- **WHEN** an operator chooses how a direct bill or saved order was paid
- **THEN** Cash, UPI, Swiggy and Zomato are available while Card and Other are absent

#### Scenario: Customer splits cash and UPI
- **WHEN** a ₹139 bill is allocated as ₹100 Cash and ₹39 UPI
- **THEN** both allocations are retained, their sum is validated as ₹139, and only ₹100 contributes to drawer cash

#### Scenario: Allocations do not cover the bill
- **WHEN** the tender allocations are short, over, duplicated by method or non-positive
- **THEN** Mark Paid remains unconfirmed and no bill is created

### Requirement: Open orders are cancelled with attribution, never deleted

An operator holding the live shift SHALL cancel an open order only through a
confirmation dialog with a non-empty reason. The dialog SHALL offer common
tap-selectable reasons that fill one always-visible editable text field. An
operator SHALL also be able to type a different reason from scratch. A cancelled order SHALL leave the actionable list
but remain reviewable with actor, tablet, time and reason.

#### Scenario: Operator cancels an order
- **WHEN** an operator confirms cancellation with a reason
- **THEN** the order becomes cancelled and can no longer be edited or paid

### Requirement: Exact phone lookup offers form-local autofill

After a complete valid phone is entered, the surface SHALL request an exact
customer match. A match SHALL prompt before replacing current form details and
SHALL say when values conflict. Accepting SHALL affect only this order's form;
declining SHALL change nothing. A new phone SHALL be saved automatically when the
order or paid bill is accepted.

#### Scenario: Saved customer matches an empty form
- **WHEN** a complete phone matches and the remaining customer fields are empty
- **THEN** the surface offers to fill in the saved details

#### Scenario: Saved name conflicts
- **WHEN** a complete phone matches but the form holds a different name
- **THEN** the prompt states that accepting replaces the form name, and the saved profile is not updated

#### Scenario: No customer matches
- **WHEN** a complete phone has no match and the order is accepted
- **THEN** a global customer is saved automatically from the supplied details

### Requirement: Counter history is limited to the current shift

My shift SHALL show paid bills belonging to this tablet's current shift and
running totals by payment method. Each bill SHALL be collapsed by default and
expand to immutable item names, quantities, captured unit prices, line totals,
payment facts, total and optional customer snapshot. It SHALL NOT show other
shifts, outlet-wide totals, or another outlet.

Every supported method SHALL remain present in the summary when its total is
zero, so a missing category cannot be confused with zero takings.

#### Scenario: Operator opens My shift
- **WHEN** this tablet has bills from its shift and older outlet bills exist
- **THEN** only the current shift's bills and their method totals appear

#### Scenario: A supported method has no bills
- **WHEN** this shift has no allocation for one or more supported methods
- **THEN** Cash, UPI, Swiggy and Zomato still appear and the unused methods show ₹0

#### Scenario: Operator inspects a closed bill
- **WHEN** the operator expands a bill in My shift or the combined tablet rail
- **THEN** its item snapshots, quantities, prices, line totals, payment facts and total appear without exposing another shift

### Requirement: The counter is one three-column workspace at every width

The counter SHALL render three touch-safe columns at **every** width: the
tappable menu, the current bill, and one continuous activity column. The activity
column SHALL show this tablet's Open orders first, then a labelled divider, then
this shift's closed bills. Each column SHALL scroll internally and SHALL NOT move
the current bill's controls off screen.

The current bill and activity columns SHALL be the same width as each other, and
spare width SHALL go to the menu. Below the width three columns need, the
workspace SHALL **scroll horizontally** rather than rearrange: no column SHALL
fold into a tab, a route or a disclosure. The page itself SHALL NOT scroll
horizontally — only the workspace. Menu tiles SHALL be laid out against the width
of their own column rather than the viewport's.

#### Scenario: Open and closed work share one rail
- **WHEN** a biller uses the counter at landscape-tablet width
- **THEN** open orders are above closed bills in one continuous right column, separated by a labelled divider

#### Scenario: The workspace is wider than the screen
- **WHEN** the viewport is narrower than three columns and their gaps
- **THEN** all three columns keep their width and the workspace scrolls sideways, with the current bill's controls reachable by scrolling to that column rather than by navigating

#### Scenario: Spare width
- **WHEN** the viewport is wider than three columns need
- **THEN** the extra width goes to the menu, and the current bill and activity columns stay equal to one another

### Requirement: Item names and prices are read, not decoded

A menu tile, a bill line and a closed bill's line SHALL show the item's full name,
never truncated with an ellipsis, because the end of the name is what
distinguishes items on this menu from each other. A menu tile SHALL carry its
price at the top right, in the same place whatever the name above it does, and an
unavailable item SHALL show that it is off **instead of** its price. Bills in a
list SHALL name today as today rather than repeating the date on every row.

#### Scenario: Two items with a long shared prefix
- **WHEN** a category holds items whose names differ only near the end
- **THEN** both names are shown in full, the tile growing to fit rather than clipping, and every tile in that row keeps the same height

#### Scenario: An item the kitchen has run out of
- **WHEN** an item is unavailable
- **THEN** its tile shows an Off marker where its price would be, and shows no price at all, so a figure that cannot be sold cannot be quoted

#### Scenario: A shift's bills, all from today
- **WHEN** the biller reads this shift's closed bills
- **THEN** each row says Today with the time, saying Yesterday instead for a shift that has crossed midnight, and the full date only once it is neither

### Requirement: Editing a saved order is unmistakable, and it is one object

While the composer holds a saved order, that mode SHALL be legible without reading
a label, and the order under edit SHALL be a single object on screen rather than
two representations of one.

The composer SHALL carry the accent outline and name the order it is editing. The
order SHALL leave the ordinary Open orders list, and its card SHALL travel left
out of the activity column's own margin to meet the composer's edge — flat on that
side, accent-outlined — so the two read as one piece of work. **The activity
column itself SHALL NOT take the accent outline**: the accent marks what is being
edited, and outlining the whole column would sweep this shift's bills and every
other open order into the same highlight.

The card SHALL keep the presentation and the position it had in the list, so that
opening an order changes where it is and not what it is. It SHALL keep its place
in the column's scroll and be `sticky` — pinned at an edge only while scrolling
would otherwise take it out of view, and released on the way back — never fixed.
Arriving SHALL be animated, and the animation SHALL be suppressed under a
reduced-motion preference; the docked position SHALL NOT depend on the animation
having run.

**The composer's footer SHALL move into that card for the duration of the edit** —
the total, the customer fields and the terminal actions — leaving the composer as
the items and nothing else. Exactly one footer SHALL be mounted at any time. The
card SHALL NOT show a second copy of anything the composer is editing: not the
item list, which is live beside it, and not a second total.

#### Scenario: Biller opens a saved order for editing
- **WHEN** the biller taps edit on an open order
- **THEN** the card leaves the list, travels left to meet the composer's edge, and both it and the composer take the accent outline while the rest of the activity column does not

#### Scenario: Biller scrolls the activity column while editing
- **WHEN** the biller scrolls the activity column through this shift's bills during an edit
- **THEN** the card holds its place until scrolling would take it out of view, pins at that edge, and returns to its place when the column is scrolled back

#### Scenario: Where the controls are during an edit
- **WHEN** an order is being edited
- **THEN** the total, customer fields and Save changes / Cancel edit are on the card, the composer shows the items alone, and no duplicate of either exists

#### Scenario: Biller finishes or abandons the edit
- **WHEN** the biller saves the changes or cancels the edit
- **THEN** the card leaves the composer's edge, the outline returns to neutral, the footer returns to the composer, and the order reappears in the ordinary list

### Requirement: Frequent counter actions are tap-first and actor-neutral

The direct-payment and saved-order payment actions SHALL be labelled Mark Paid,
not Paid, Pay now or Pay in full. Saving food-first work SHALL be labelled Order,
use a non-save icon and be the primary composer action. Mark Paid SHALL be
secondary in the composer and primary on an already-open order. Payment SHALL use a touch keypad and method tiles; cancellation
SHALL use icon actions, preset reasons and one editable reason field. The phone
input SHALL request the native numeric keypad on touch devices. Keyboard entry
SHALL remain optional for cancellation and otherwise limited to customer details.

#### Scenario: Biller records ordinary full payment
- **WHEN** the biller taps Mark Paid and then one tender method without keying an amount
- **THEN** the entire remaining balance is allocated to that method

#### Scenario: Biller cancels for a common reason
- **WHEN** the biller taps the cancel icon, selects a preset reason and confirms
- **THEN** cancellation completes without opening the keyboard

## MODIFIED Requirements

### Requirement: Customer identity is optional to the database and prompted by the counter

Both customer snapshots SHALL remain nullable, and the **database** SHALL never
require either: a bill or order carrying no customer at all is valid, and nothing
downstream may assume one.

The counter UI SHALL nonetheless require **either** a customer name or a customer
phone before Order or Mark Paid, as a reversible operating trial the owner can end
without a migration. Neither individual field SHALL be required. A phone that has
been typed SHALL be a complete Indian mobile number, canonicalised by the same rule
the database uses, or be refused — reported once the biller leaves the field rather
than while they are still typing it. An empty phone SHALL remain acceptable.

#### Scenario: A bill with no customer reaches the database
- **WHEN** a bill or order is written with both customer fields null
- **THEN** the database accepts it, because the requirement is the counter's habit and not the schema's promise

#### Scenario: The counter is given only a name
- **WHEN** the biller enters a customer name and no phone
- **THEN** both terminal actions are available

#### Scenario: The counter is given a number that is not one
- **WHEN** the phone field holds an incomplete or malformed number and the biller leaves the field
- **THEN** the reason is stated under the field and neither terminal action can be used until it is corrected or cleared, so a bad number cannot reach a bill while the customer record silently fails to save

### Requirement: A queued bill carries a local reference, never a bill number

Until a bill has been sent, the surface SHALL identify it by a short local
reference that cannot be mistaken for a bill number, and SHALL state in plain words
that it is not sent yet and that its number arrives when it does. A bill number
SHALL be assigned only on a successful send, per outlet and sequentially.

**No surface SHALL use the word provisional**, here or anywhere else in billing. A
biller at 9pm needs to know what to do next, and a word nobody says out loud is
where that stops.

#### Scenario: A bill that has not yet synced
- **WHEN** a settled bill is still queued
- **THEN** it is shown with a short local reference that is not formatted as a bill number, and the words not sent yet

#### Scenario: A cancelled bill consumes no number
- **WHEN** a queued bill is cancelled before it is sent and a later bill is then sent
- **THEN** the later bill's number is the next in the outlet's sequence, with no gap left by the cancelled one

### Requirement: Mark Paid opens exact tender capture with cash visually distinct

The Mark Paid action SHALL open Cash, UPI, Swiggy and Zomato as touch targets
and SHALL NOT offer Card or Other. It SHALL mark cash distinctly from the others by a
means other than colour alone, because only the cash allocation reaches the
drawer. Confirmation SHALL require exact allocations equal to the bill total.

#### Scenario: Full balance uses one method

- **WHEN** a biller opens Mark Paid and taps one payment method with no amount keyed
- **THEN** the full balance is allocated to that method and can be confirmed as Mark Paid

#### Scenario: Unsupported methods are absent

- **WHEN** the billing payment choices render
- **THEN** Card and Other are not present and cannot be selected

#### Scenario: Confirming with no allocation

- **WHEN** the tender dialog opens and no method has been allocated
- **THEN** its Mark Paid confirmation is disabled and the current bill remains intact

### Requirement: A manager reviews outlet history, voids, and clears stranded orders

A Franchise Admin SHALL review their outlets' paid bills and a Super Admin any
outlet, with revenue-business-date, status and payment filters, and bill detail.
Detail SHALL show payment time and payment business date when they differ from
the order clock. They SHALL void a paid bill with a reason. The corrected sale
SHALL then be manually rung as a new bill on the enrolled counter tablet; the
manager surface SHALL create no payment command, cross-device draft or automatic
prefill. They SHALL see any open order at that outlet and cancel it with a reason.

#### Scenario: A paid bill is corrected
- **WHEN** an authorised admin voids a paid bill and an operator manually rings the corrected contents at the counter
- **THEN** the original stays unchanged as void and the replacement carries a new identity and number

#### Scenario: History is filtered by revenue date
- **WHEN** an order and its payment fall on different business dates
- **THEN** the bill is found under its order business date and detail separately names the later payment time and payment business date

#### Scenario: An order is stranded on a tablet
- **WHEN** an order remains open at an outlet whose tablet is unavailable and the manager cancels it with a reason
- **THEN** the order is cancelled with that manager recorded, and nothing is transferred anywhere

### Requirement: Delivery states are shown in words, without blocking the counter

The surface SHALL distinguish not sent yet, retrying, needs attention, void,
cancelled and sent, in plain words. It SHALL keep the composer usable and SHALL
NOT present ordinary unsent state as a dialog. Correction and discard of a
needs-attention command SHALL be available only on its originating tablet to an
operator holding that tablet's live shift. Correction SHALL use a new UUID linked
to the refused command. Discard SHALL require a non-blank reason, and both SHALL
retain actor, time and the refused trace. Manager diagnostics SHALL be read-only
and SHALL expose no payload or customer details.

#### Scenario: A paid command has not reached the server
- **WHEN** local acceptance succeeded but delivery has not
- **THEN** the bill reads as not sent yet, with the sync indicator, and shows no bill number

#### Scenario: A command will never succeed
- **WHEN** the server refuses a command permanently
- **THEN** it reads as needing attention, in a sentence naming what a person should do, and the counter keeps working

#### Scenario: The originating tablet corrects a command
- **WHEN** its current operator corrects a needs-attention command
- **THEN** a new linked UUID carries the correction and the refused command remains in the trace

#### Scenario: A manager inspects the same problem
- **WHEN** an authorised manager opens delivery diagnostics on their phone
- **THEN** they see non-identifying status metadata and no correction, discard, payload or customer details

## RENAMED Requirements

- FROM: `### Requirement: Payment is one tap, then settle, with cash visually distinct`
- TO: `### Requirement: Mark Paid opens exact tender capture with cash visually distinct`

- FROM: `### Requirement: Customer name and phone are optional and never block settling`
- TO: `### Requirement: Customer identity is optional to the database and prompted by the counter`

- FROM: `### Requirement: A queued bill carries a provisional reference, never a bill number`
- TO: `### Requirement: A queued bill carries a local reference, never a bill number`
