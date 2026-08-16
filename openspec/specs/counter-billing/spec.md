# Counter Billing

## Purpose

The write contract for bills, enforced in the database so that every writer — the counter tablet today, the offline outbox later — inherits it. Bill numbers are the server's to assign, settled bills are history, line items are snapshots, and a business date the cutover cannot produce is refused. The billing surface itself arrives with later changes; these requirements bind every writer from day one.

## Requirements

### Requirement: Bill numbers are server-assigned and per-outlet sequential

Bill numbers SHALL be assigned by the database when a paid bill is created from
a pay-now or pay-order command, from a per-outlet sequence inside that command's
transaction. Orders SHALL consume no bill number. A client-supplied number MUST
be ignored. Numbers SHALL be unique within an outlet, and a failed command or
exact replay MUST NOT consume another number.

#### Scenario: Concurrent payment at one outlet

- **WHEN** two valid payment commands for the same outlet execute concurrently
- **THEN** they receive distinct consecutive numbers in that outlet's sequence

#### Scenario: Client supplies its own number

- **WHEN** a payment command carries a bill number chosen by the client
- **THEN** the stored bill carries the database-assigned number instead

#### Scenario: Exact replay burns no number

- **WHEN** an accepted payment command is replayed and a new payment then succeeds
- **THEN** the replay returns its original number and the new bill receives the next number with no gap

### Requirement: Bills are append-only once settled

A paid bill SHALL accept no modification other than the void transition, which
changes only status and void-attribution fields. Deleting a bill SHALL be
impossible for every client role. Voiding SHALL be available only to the bill's
outlet FA and SA, require a reason, and preserve any replacement link as a
separate new bill rather than edited totals.

A tender edit during the five-minute window SHALL append a separate attributed
payment-correction record and replacement allocation set. It SHALL NOT update the
bill, its item snapshots or its original payment rows. Reads that need current
tender SHALL derive the latest effective allocation from that immutable history.

#### Scenario: Editing a paid bill's totals

- **WHEN** any session attempts to update a paid bill's amounts, items, clocks, or attribution
- **THEN** the database rejects the update

#### Scenario: Appending an eligible tender correction

- **WHEN** the originating tablet submits an exact changed Cash/UPI allocation within five minutes
- **THEN** the database appends the attributed correction and leaves every original bill and payment row unchanged

#### Scenario: Voiding a bill

- **WHEN** an authorized admin voids with a reason
- **THEN** status/void attribution change and every original sale field remains unchanged

#### Scenario: Counter attempts to void

- **WHEN** a counter device session attempts the void transition
- **THEN** the database rejects the update

### Requirement: Bill line items snapshot the sale and stay internally consistent

Bill line items SHALL store final item name and unit price snapshots and remain
valid if the menu later changes or removes the item. The database SHALL enforce
line total equals unit price times quantity, bill subtotal equals the sum of all
line totals, and total equals subtotal minus discount plus tax, in integer paise.
Bill and every line SHALL be inserted atomically.

#### Scenario: Menu price changes after order creation

- **WHEN** an existing captured order line is paid after the live menu price changes
- **THEN** the bill uses the order's captured name/price and historical values never change

#### Scenario: Parent subtotal differs from lines

- **WHEN** a payment command's bill subtotal does not equal its submitted line totals
- **THEN** the entire command is refused without a numbered bill

### Requirement: Counter writes are idempotent by client identity

Every bill and command SHALL have client-generated UUIDs. Submitting an exact
command twice SHALL store its effects once and return the same result. Reusing
an identity with different content SHALL be refused as conflict.

#### Scenario: The same paid command arrives twice

- **WHEN** the same payload, version, hash, and command UUID are submitted twice
- **THEN** exactly one bill exists and both responses identify it

#### Scenario: Identity content differs

- **WHEN** the UUID is replayed with a changed payment method or total
- **THEN** no second bill exists and the response is an identity conflict

### Requirement: Revenue date and payment date are explicit and independently validated

Every paid bill SHALL carry `ordered_at` and an explicit `business_date` for
revenue, plus `paid_at` and an explicit `payment_business_date` for the drawer.
Each date SHALL equal what the outlet cutover implies for its matching timestamp.
Paying an order SHALL preserve that order's original pair; a pay-now sale SHALL
resolve both pairs from that transaction's actual times.

The two dates are almost always the same, because an order is paid minutes after
it is taken. They are stored separately so that the exception is representable
rather than silently mis-dated.

#### Scenario: Order before cutover is paid after cutover

- **WHEN** an order created at 03:50 is paid in cash at 04:10 under a 04:00 cutover
- **THEN** its revenue business date is the earlier day and its payment business date is the later day

#### Scenario: Either date is impossible

- **WHEN** a command supplies a revenue or payment date contradicting its matching timestamp/cutover
- **THEN** the database refuses the entire command

### Requirement: The whole menu is visible at once on a counter tablet

The billing surface SHALL present every available menu item for the outlet at
the same time on a counter tablet, without vertical scrolling and without
requiring a search or a category drill-down. An unavailable item SHALL NOT be
sellable from the grid.

#### Scenario: The menu fits the tablet

- **WHEN** the billing surface is rendered at a counter tablet viewport with the outlet's full menu
- **THEN** the menu region's content height does not exceed its visible height, so nothing is scrolled out of reach

#### Scenario: An unavailable item

- **WHEN** the menu contains an item marked unavailable
- **THEN** that item cannot be added to the current bill

### Requirement: Tapping an item adds it, tapping again increases its quantity

Tapping a menu item SHALL add one of it to the current bill, and tapping the
same item again SHALL increase that line's quantity by one. The item's tile
SHALL show the quantity currently on the bill.

#### Scenario: Adding the same item twice

- **WHEN** a biller taps an item twice
- **THEN** the bill contains one line for that item with a quantity of two

#### Scenario: The tile reflects the bill

- **WHEN** an item is on the current bill
- **THEN** its tile shows the quantity on the bill

### Requirement: Quantity is adjusted on the bill line, and removing a line is possible before settling

Each line on the current bill SHALL offer a decrease and an increase control,
and reducing a line's quantity below one SHALL remove the line. The bill's
running total SHALL update immediately with every change.

#### Scenario: Reducing a line to nothing

- **WHEN** a line with a quantity of one is decreased
- **THEN** the line is removed from the bill and the total is reduced by that line's total

### Requirement: Bill totals are computed by a pure function over integer paise

The current bill's subtotal, tax, discount and total SHALL be computed by a
pure function enforcing `lineTotal = unitPrice × quantity` on every line and
`total = subtotal − discount + tax`, in integer paise. A non-integer paise
value SHALL be rejected rather than rounded.

#### Scenario: A three-line order

- **WHEN** a bill contains lines whose unit prices and quantities are known
- **THEN** each line total equals its unit price times its quantity, and the bill total equals subtotal minus discount plus tax

#### Scenario: A float reaches the money path

- **WHEN** a non-integer paise value is passed to the totals function
- **THEN** it throws rather than rounding

### Requirement: Bill lines snapshot the item name and unit price when the line is created

A line added to the current bill SHALL capture the item's name and unit price
at that moment, and a later change to the menu item SHALL NOT alter a line
already on the bill or a bill already settled.

#### Scenario: A price changes mid-order

- **WHEN** a menu item's price is changed after a line for it is on the current bill
- **THEN** that line's unit price and line total are unchanged

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

### Requirement: Mark Paid opens exact tender capture with cash visually distinct

The Mark Paid action SHALL open Cash and UPI as touch targets and SHALL NOT
offer Swiggy, Zomato, Card or Other. It SHALL mark cash distinctly from UPI by a
means other than colour alone, because only the cash allocation reaches the
drawer. When no allocation exists, Cash and UPI SHALL use the same neutral visual
treatment and neither SHALL appear selected by default. Confirmation SHALL require
exact allocations equal to the bill total. The two-method dialog geometry SHALL
otherwise remain unchanged.

Swiggy and Zomato were touch targets when this requirement was written for #31,
and V1 withdraws them by owner decision on 2026-08-11: aggregator revenue stays
a typed manual-ledger figure with its commission rate beside it, so a tendered
aggregator bill would be the same money counted twice. The withdrawal SHALL be
enforced by the database enum rather than by the absence of a button, under the
same rule that removed Card and Other.

#### Scenario: Full balance uses one method

- **WHEN** a biller opens Mark Paid and taps one payment method with no amount keyed
- **THEN** the full balance is allocated to that method and can be confirmed as Mark Paid

#### Scenario: Unsupported methods are absent

- **WHEN** the billing payment choices render
- **THEN** Swiggy, Zomato, Card and Other are not present and cannot be selected

#### Scenario: Confirming with no allocation

- **WHEN** the tender dialog opens and no method has been allocated
- **THEN** Cash and UPI both appear neutral, its Mark Paid confirmation is disabled, and the current bill remains intact

### Requirement: Settling never waits for the network and clears the screen at once

Settling SHALL hand the bill to the queue and return without awaiting any
network operation, and the bill panel SHALL be cleared for the next customer
immediately. A confirmation SHALL be shown that clears itself without needing
acknowledgement.

#### Scenario: Settling while offline

- **WHEN** a bill is settled with no connectivity
- **THEN** the bill panel clears, the bill is queued, and no error is shown to the biller

#### Scenario: The confirmation clears itself

- **WHEN** a bill has been settled
- **THEN** the confirmation disappears on its own without the biller acknowledging it

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


### Requirement: Counter writes are idempotent by client identity in every implementation

A bill SHALL be identified by a client-generated UUID from the moment it is
created, and submitting the same identity twice SHALL result in exactly one
bill, with the second submission reported as a duplicate.

#### Scenario: The same queued bill submitted twice

- **WHEN** the same client-generated bill identity is enqueued twice
- **THEN** exactly one bill exists and the second attempt is reported as a duplicate

### Requirement: Every bill carries a business date resolved from the outlet cutover

A bill SHALL be stamped, at the moment it is settled, with the business date
its creation time implies under that outlet's cutover — never with a date
derived from a timestamp when it is read.

#### Scenario: A bill rung after midnight

- **WHEN** a bill is settled at 00:20 local time at an outlet whose cutover is 04:00
- **THEN** the bill carries the previous calendar day as its business date

### Requirement: Billing requires a shift, confirmed by a code on the operator's own device

The billing surface SHALL NOT accept counter work unless a shift is live, and
SHALL say what to do when none is. Opening one SHALL require a username on the
tablet, and that person entering the tablet's displayed code from a session that
is not the tablet's, and SHALL succeed only for an active Biller of that outlet,
that outlet's active Franchise Admin, or an active Super Admin. **No counter PIN
SHALL exist, and no password SHALL be typed on the tablet.**

The shift SHALL be attributed to the confirming person and the tablet, carry an
explicit business date, and expire at the outlet's next cutover.

#### Scenario: No shift live
- **WHEN** the billing surface opens with no live shift
- **THEN** it asks for a username rather than showing an actionable billing form

#### Scenario: Waiting for confirmation
- **WHEN** a request has been submitted and not yet resolved
- **THEN** the tablet displays the code large enough to read across the counter, states which person was asked, and offers to cancel

#### Scenario: The counter opens by itself
- **WHEN** the named person enters the correct code on their own device
- **THEN** the tablet enters billing without anybody touching it again

#### Scenario: Unknown username
- **WHEN** a username belonging to nobody is submitted
- **THEN** the tablet displays a code and waits, and times out after the same interval as an unconfirmed real request

#### Scenario: Handover on the same tablet
- **WHEN** one operator's shift ends and another eligible operator's request is approved
- **THEN** new work is attributed to the incoming operator while old work keeps its original attribution

#### Scenario: Cutover expires the shift
- **WHEN** the outlet reaches its cutover
- **THEN** the shift accepts no new work until a fresh request is approved

### Requirement: Sync state is a persistent indicator with an escalated state, never a dialog

The counter chrome SHALL show the state of the queue at all times as synced,
a count pending, or an escalated warning when the queue has been unable to
drain, and SHALL never interrupt billing with a dialog about it.

#### Scenario: Nothing pending

- **WHEN** the queue is empty
- **THEN** the indicator shows the synced state

#### Scenario: Bills waiting

- **WHEN** bills are queued and not yet sent
- **THEN** the indicator shows how many are pending

#### Scenario: The queue cannot drain

- **WHEN** the number of pending bills reaches the escalation threshold, or the oldest pending bill exceeds the escalation age
- **THEN** the indicator escalates to a warning, and no dialog is shown
### Requirement: A manager reviews outlet history, voids, and clears stranded orders

A Franchise Admin SHALL review their outlets' paid bills and a Super Admin any
outlet. The surface SHALL ask two questions and no more — which outlet, and
which revenue business date — and SHALL NOT offer a bill-status or payment-method
filter. Every bill of the selected outlet-day SHALL be listed whatever its status
or tender, because each summary already names its own state and tender.

The outlet SHALL be chosen with the same shared, remembered outlet selector every
other outlet-scoped surface uses, in the page header. The date SHALL be chosen
with the same day control the manual ledger uses: a step to the previous day, a
step to the next, and the day itself opening the platform calendar. Forward
stepping SHALL stop at the selected outlet's current business date. The date
SHALL default to that outlet's current business date and render `Today`; a past
selected date SHALL render as a formatted business date. The visible date control
SHALL open the platform calendar and SHALL NOT present an empty browser date
placeholder. Neither control SHALL overflow horizontally at an ordinary phone
width.

Each bill SHALL have a scannable collapsed summary naming its bill number,
plain-language Paid or Cancelled state, total, tender, outlet-local time and
biller; a timestamp from today or yesterday SHALL use that relative calendar-day
label while retaining its absolute time. Selecting a summary SHALL expand that
bill directly beneath the summary, with at most one bill expanded at a time. The
expanded summary and detail SHALL use ordinary structural borders rather than an
accent-coloured expanded-state outline. Opening and closing detail SHALL use a
brief reduced-motion-aware height/opacity transition. When selection moves from
an earlier expanded bill to a lower bill, the surface SHALL keep the tapped lower
summary visually anchored during that transition, as far as the page has scroll
to give: anchoring is done by scrolling, so a swap near the top of a short list
SHALL let the summary rise by what is still owed rather than insert space above
the page, and SHALL leave it in view.

Expanded detail SHALL structurally separate every immutable item snapshot with quantity,
unit price and line total; effective payment allocations and total; customer name and
phone including an explicit absence for either optional fact; order reference; ordered
and paid clocks; revenue business date; and payment business date when it differs.
Customer phone SHALL remain out of collapsed summaries, delivery diagnostics, logs and
exports. Order items and payment SHALL remain visible as distinct structured cards when a
bill opens. Customer details and Bill timeline SHALL each be a nested disclosure closed by
default, and SHALL reveal their facts in two columns when opened. Item names, values and
actions SHALL remain legible without horizontal scrolling.

An expanded paid bill SHALL initially show no cancellation-reason field. A manager SHALL
deliberately open `Cancel this bill` before the reason input, immutable-history consequence
and final confirmation appear. Confirmation SHALL perform the existing reasoned void
transition while the surface calls the result Cancelled. The corrected sale SHALL then be
manually rung as a new bill on the enrolled counter tablet; the manager surface SHALL
create no payment command, cross-device draft or automatic prefill. The manager SHALL see
any open order at that outlet and cancel it with a reason. Each open order SHALL show its
captured items, total, customer facts including explicit absence, creator and ordered time
before offering an exceptional cancellation action. The cancellation-reason input and final
confirmation SHALL remain hidden until the manager chooses `Cancel this order`.

#### Scenario: A manager opens a bill in place
- **WHEN** an authorised manager selects a collapsed bill in a long result list
- **THEN** that bill's structured detail appears immediately beneath its summary and any previously expanded bill closes

#### Scenario: A manager changes the selected bill
- **WHEN** a manager selects a lower bill while an earlier bill is expanded
- **THEN** the earlier detail visibly closes as the selected detail opens, no accent border is used merely because a bill is expanded, and the tapped summary does not abruptly jump away from its viewport position wherever the page has scroll left to hold it there

#### Scenario: A swap at the top of the page runs out of scroll
- **WHEN** the tapped summary sits above what the collapsing detail was tall, so holding it still would mean scrolling past the top of the page
- **THEN** it rises only by what could not be given back and stays in view, rather than the page inserting space above its header

#### Scenario: A bill has complete attribution
- **WHEN** an expanded bill carries customer name, customer phone, biller, item, tender and timing snapshots
- **THEN** biller attribution is readable in the summary, every remaining fact is readable in its named section, each item shows quantity, unit price and line total, and the phone is absent from the collapsed summary

#### Scenario: A bill has no customer snapshot
- **WHEN** either optional customer fact was not recorded
- **THEN** the corresponding detail reads Not provided rather than omitting the field or inventing a value

#### Scenario: Optional bill detail stays out of the way
- **WHEN** a manager first expands a bill at an ordinary phone width
- **THEN** order items and payment are visible, Customer details and Bill timeline are closed, and opening either nested disclosure presents its facts in two columns

#### Scenario: A recent bill is scanned
- **WHEN** a bill was paid today or yesterday in Asia/Kolkata
- **THEN** its summary reads Today or Yesterday with the absolute payment time

#### Scenario: Cancellation is exceptional
- **WHEN** an authorised manager first expands a paid bill
- **THEN** no cancellation reason is visible until they choose Cancel this bill, and final confirmation requires a non-blank reason

#### Scenario: A paid bill is corrected
- **WHEN** an authorised admin cancels a paid bill and an operator manually rings the corrected contents at the counter
- **THEN** the original stays unchanged with a user-facing Cancelled state and the replacement carries a new identity and number

#### Scenario: History is filtered by revenue date
- **WHEN** an order and its payment fall on different business dates
- **THEN** the bill is found under its order business date and detail separately names the later payment time and payment business date

#### Scenario: Cancelled bills are read alongside paid ones
- **WHEN** a manager opens an outlet-day on which bills were both paid and cancelled
- **THEN** every one of them is listed, each naming its own state, with no filter to operate and none needed to see either kind

#### Scenario: The surface asks the same two questions as its neighbours
- **WHEN** a manager opens Billing history at an ordinary phone width
- **THEN** the outlet is chosen from the shared header selector and the day from a bar with a step either side, both matching the surfaces that ask the same questions, and neither scrolls horizontally

#### Scenario: Billing history opens on the current business day
- **WHEN** a manager opens Billing history
- **THEN** the day control reads Today, the results are scoped to that outlet's current business date, stepping forward is refused, and choosing a past day makes the control read that formatted date

#### Scenario: An order is stranded on a tablet
- **WHEN** an order remains open at an outlet whose tablet is unavailable and the manager cancels it with a reason
- **THEN** the order is cancelled with that manager recorded, and nothing is transferred anywhere

#### Scenario: A manager inspects an open order before cancelling
- **WHEN** a manager opens the Open orders view
- **THEN** each order's items, total, customer facts, creator and ordered time are readable, and no cancellation reason field is visible until they choose Cancel this order

### Requirement: Manager delivery diagnostics summarise sync health before technical evidence

The manager history surface SHALL call command transport evidence `Sync status`, explain that
it describes recent tablet activity reaching the server, and remain read-only. It SHALL lead
with whether any recent result needs attention, group routine successful delivery by familiar
business action and count, and SHALL NOT render every accepted command as a separate default
card. Individual short references, command types, result categories and receipt times SHALL
appear only after the manager opens a technical-details disclosure. Payloads, command contents
and customer details SHALL remain unavailable.

#### Scenario: Routine activity all arrived
- **WHEN** recent diagnostics contain many accepted create, pay and cancel commands and no problem result
- **THEN** Sync status reports no recent sync problems and shows grouped action counts without a chronological card for every receipt

#### Scenario: A result needs attention
- **WHEN** a recent diagnostic has a non-success result
- **THEN** Sync status places a human-readable problem summary before successful activity and directs the manager to check the originating tablet

#### Scenario: Technical evidence is needed
- **WHEN** the manager opens Show technical details
- **THEN** short references, command types, result categories and receipt times become visible while payload and customer facts remain absent

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
allocations from Cash or UPI. The allocations SHALL each be positive integer
paise, SHALL use a method at most once, and SHALL sum exactly to the bill total.
Swiggy, Zomato, Card and Other SHALL NOT be offered or accepted by an application
command, and SHALL NOT be writable by a hand-crafted request either, because the
`payment_method` enum no longer holds them. Successful payment SHALL show the
bill number once known, or state plainly that it is not sent yet while delivery
is pending. Split tender SHALL NOT create a partial-payment state: the bill
becomes paid only after the full total is allocated.

An aggregator order SHALL NOT be rung at the counter in V1. It has no tender
method to be settled with, so there is no state in which one is half recorded.
Swiggy and Zomato trade continues to be recorded once, as that day's typed
revenue in the manual ledger, alongside the commission rate that day carried.

#### Scenario: An aggregator order has no counter path

- **WHEN** an operator looks for a way to ring or settle a Swiggy or Zomato order
- **THEN** no tender method exists for it, no bill is created, and that trade reaches the books only as the ledger's typed aggregator revenue for the day

#### Scenario: An order is paid after cutover
- **WHEN** an operator pays an order taken before the outlet's cutover
- **THEN** the paid view keeps the order's original business date and shows the payment time separately

#### Scenario: Available tender methods
- **WHEN** an operator chooses how a direct bill or saved order was paid
- **THEN** Cash and UPI are available while Swiggy, Zomato, Card and Other are absent

#### Scenario: Customer splits cash and UPI
- **WHEN** a ₹139 bill is allocated as ₹100 Cash and ₹39 UPI
- **THEN** both allocations are retained, their sum is validated as ₹139, and only ₹100 contributes to drawer cash

#### Scenario: Allocations do not cover the bill
- **WHEN** the tender allocations are short, over, duplicated by method or non-positive
- **THEN** Mark Paid remains unconfirmed and no bill is created

#### Scenario: An aggregator allocation is refused below the application

- **WHEN** a hand-crafted request submits a bill allocated to Swiggy or Zomato
- **THEN** the database refuses it, because the value does not exist in the `payment_method` enum

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

My shift SHALL show paid bills belonging to this tablet's current shift. Each
bill SHALL be collapsed by default and expand to immutable item names,
quantities, captured unit prices, line totals, payment facts, total and
optional customer snapshot. It SHALL NOT show other shifts or another outlet.

The shared counter SHALL show aggregate Cash and UPI payment totals for its
current shift. The manager's Billing History Status view SHALL show the selected
outlet-day Cash and UPI totals before its sync activity, and beside them the
day's combined takings and its average bill. Every scope SHALL use the same
total-card presentation.

Combined takings SHALL be the sum of the Cash and UPI figures shown beside it,
never a separately derived number, so that the cards always reconcile. The
average bill SHALL be those combined takings over the number of paid bills in
the same scope, in integer paise, and SHALL read as zero when that scope holds no
paid bill. Cancelled bills SHALL contribute to neither figure.

The list SHALL include locally accepted payments immediately and SHALL use each
bill's latest effective allocation, including a durably accepted correction that
is still unsent. An eligible expanded bill SHALL carry its relative `Edit (N
min)` or `Edit (N sec)` action without making any other bill fact editable.

#### Scenario: Operator opens My shift
- **WHEN** this tablet has bills from its shift and older outlet bills exist
- **THEN** only the current shift's bills appear and its Cash and UPI aggregates
  reflect only that shift

#### Scenario: Manager opens Status
- **WHEN** a manager opens the Billing History Status view for an outlet day
- **THEN** the outlet-day Cash and UPI payment aggregates appear before sync
  activity, with the day's combined takings and average bill beside them, and do
  not alter the counter's current-shift scope

#### Scenario: A day with no paid bills has no average
- **WHEN** a manager opens Status for an outlet day on which nothing was paid
- **THEN** the average bill reads zero rather than an undefined or infinite figure

#### Scenario: Operator inspects a closed bill
- **WHEN** the operator expands a bill in My shift or the combined tablet rail
- **THEN** its item snapshots, quantities, prices, line totals, payment facts and total appear without exposing another shift

#### Scenario: A tender correction changes shift cash
- **WHEN** an eligible bill is corrected from Cash to UPI
- **THEN** the same bill remains listed and both current-shift and outlet-day
  totals use its latest effective allocation

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

### Requirement: The live counter supports immediate payment and payment on handover

The live billing adapter SHALL support direct paid bills and editable open
orders, using the same typed lifecycle demonstrated in `ui-billing-lifecycle`. A
bill SHALL exist only after full payment succeeds. V1 SHALL expose no discount
control and SHALL submit `discount_paise` as zero. Live commands SHALL accept
one or more exact allocations of Cash or UPI and SHALL NOT accept Swiggy,
Zomato, Card or Other. Allocations SHALL be positive integer paise, unique by method
and sum exactly to the bill total before the command is locally accepted. The
composer SHALL keep Order as its primary action and Mark Paid as its secondary
upfront-payment action, and SHALL enable either only when customer name or phone
is nonblank. That identification check SHALL remain a UI rule, not a database
constraint.

#### Scenario: Customer pays upfront
- **WHEN** an operator confirms Mark Paid and the command is durably accepted locally
- **THEN** the counter clears, the paid bill appears in Bills this shift, reads as not sent yet until delivery, and later shows the exactly-once bill number

#### Scenario: Customer corrects an upfront payment
- **WHEN** an operator edits the Cash/UPI allocation within five minutes of an upfront payment
- **THEN** the same paid bill and any assigned bill number remain, an attributed payment correction is appended, and its effective tender becomes the replacement allocation

#### Scenario: Customer pays on handover
- **WHEN** an operator saves an order and later pays it from the tablet that took it
- **THEN** the order stays editable until payment, and the payment produces one immutable bill

#### Scenario: Customer corrects payment on handover
- **WHEN** an operator edits the Cash/UPI allocation within five minutes of paying a saved order
- **THEN** the same correction path, deadline and audit apply as for an upfront payment

#### Scenario: Customer uses mixed tender
- **WHEN** exact Cash and UPI allocations together cover the bill total
- **THEN** one immutable paid bill retains both allocations and only the Cash amount reaches drawer reconciliation

### Requirement: Live open-order actions stay on the tablet that took the order

Ordinary edit, payment and cancellation of an open order SHALL be available only
on the tablet that owns it, to any operator holding its live shift. Clearing an
order stranded on an unavailable tablet SHALL be an ordinary reasoned
cancellation by that outlet's manager, and no transfer or recovery path SHALL
exist. The card SHALL label its secondary number as Order #, show complete item
lines with line amounts, use relative age for today's order, and omit the creator
when the current shift holder created it. Its payment action SHALL read Mark Paid.
On the combined tablet workspace, edit SHALL hand the order to the full composer
and restore any suspended new-order draft after Save changes or Cancel edit.

#### Scenario: Another operator uses the same tablet
- **WHEN** a different operator's shift begins on the order's tablet
- **THEN** they may edit, pay or cancel it and the action is attributed to them

#### Scenario: The tablet is unavailable
- **WHEN** an order remains open at an outlet whose tablet cannot be used
- **THEN** the outlet's manager cancels it with a reason from their own device, and nothing is transferred

### Requirement: The counter's activity rail notices work changed elsewhere

The rail of open orders and this shift's bills SHALL refresh on returning to the
foreground and on a change reported by the backend for its own outlet, and SHALL
NOT depend solely on this tablet's own saves. V1 has one billing tablet per outlet,
but it also has a manager who voids a paid bill and cancels a stranded order from
their own device, so a rail that only knows what this tablet did will offer an
operator an order that no longer exists.

As with the menu, the reported change SHALL be a signal to re-read rather than the
data itself, and the foreground re-read SHALL be sufficient on its own if nothing
is reported, so a silently dead channel degrades the rail to "correct whenever
somebody comes back to it" rather than to wrong.

A refresh SHALL NOT disturb an order currently held in the composer.

#### Scenario: A manager clears a stranded order
- **WHEN** the outlet's manager cancels an open order with a reason from their own device
- **THEN** the tablet's rail stops offering it without the app being reloaded, and an operator cannot open it for payment or edit

#### Scenario: A manager voids a paid bill
- **WHEN** a bill from the current shift is voided from the manager's history surface
- **THEN** the tablet's rail shows it as void rather than continuing to show it as an ordinary bill of the shift

#### Scenario: The rail refreshes during an edit
- **WHEN** the rail re-reads while a saved order is held in the composer
- **THEN** the order stays under edit with its draft intact, and the rest of the rail updates around it

### Requirement: A paid bill's tender can be corrected for five minutes

An immediate payment or saved order paid on handover SHALL appear in Bills this
shift as soon as its payment command is durably accepted locally. On the
originating tablet, its expanded paid-bill card SHALL offer a tender edit until
five minutes after the bill's original `paid_at`. The edit SHALL reopen the shared
payment dialog prefilled with the bill's current effective Cash/UPI allocations.
It SHALL permit only one or more unique positive integer-paise Cash/UPI
allocations that sum exactly to the unchanged bill total. Item and customer
snapshots, quantities, prices, totals, bill number, payment time and business dates
SHALL remain locked.

The collapsed bill SHALL carry a compact pencil indicator while it remains editable.
The expanded control SHALL use relative text: `Edit (N min)` while at least one minute
remains, rounding up to the next whole minute, then `Edit (N sec)` below one
minute. It SHALL disappear at expiry without leaving a persistent expiry message.
The rendered timer SHALL NOT grant authority: the database SHALL enforce that the
immutable correction command creation time is within five minutes of the original
stored `paid_at`. A correction SHALL NOT restart the deadline.

Each accepted edit SHALL append an attributed correction and exact replacement
allocation set without updating the bill or its original payment rows. The same
bill identity and, once assigned, bill number SHALL remain visible. Shift totals,
drawer cash, ledger revenue, history and reports SHALL use the latest accepted
effective allocation.
When the original payment is still queued, the correction SHALL be durably queued
behind it and SHALL remain replay-safe after reconnecting.

#### Scenario: An immediate payment is edited
- **WHEN** the originating tablet corrects a direct-paid bill within five minutes
- **THEN** the same bill stays paid, the original and replacement allocations remain auditable, and the replacement becomes effective

#### Scenario: A saved order's payment is edited
- **WHEN** the originating tablet corrects the tender of an order paid on handover within five minutes
- **THEN** it follows the same append-only correction path and retains the order's bill identity and number

#### Scenario: The edit dialog opens
- **WHEN** the operator opens an eligible bill's payment edit
- **THEN** its effective Cash/UPI allocations are prefilled, sale facts are locked, and confirmation is unavailable until an exact changed allocation is present

#### Scenario: More than one minute remains
- **WHEN** 4 minutes and 1 second remain in the window
- **THEN** the collapsed bill shows its pencil indicator and the expanded control reads `Edit (5 min)`

#### Scenario: Less than one minute remains
- **WHEN** 59 seconds remain in the window
- **THEN** the control reads `Edit (59 sec)` and counts down in seconds

#### Scenario: The deadline expires
- **WHEN** five minutes have elapsed from the original payment time
- **THEN** the edit control disappears, the database refuses a new payment correction, and correction requires the manager void and manual re-ring path

#### Scenario: The original payment is not sent yet
- **WHEN** an operator edits its tender within the window while the backend is unreachable
- **THEN** the correction is committed locally behind the original payment and later lands exactly once without changing the original command

### Requirement: Paid correction respects the personal-device boundary

The originating tablet SHALL be permitted to append a tender-only correction
during the five-minute window. An authorised manager SHALL void a paid bill with
a reason from bill history after that window or when facts other than tender are
wrong. The replacement SHALL be manually rung on the enrolled counter tablet as a new bill.
The manager surface SHALL create no payment command, extend no correction window,
and create no automatic prefill or cross-device draft. Bill history SHALL filter
on revenue `business_date`, SHALL use the latest effective tender, and SHALL show
payment time and payment business date separately when they differ.

#### Scenario: A manager corrects a paid bill
- **WHEN** the manager voids it and the counter operator manually rings the corrected contents
- **THEN** the original remains immutable as void and the replacement receives a new identity and bill number

#### Scenario: A manager inspects an edited tender
- **WHEN** a tablet correction changed a bill from Cash to UPI or changed its split
- **THEN** manager history shows the effective allocation while the append-only audit retains the original and every correction

### Requirement: Live billing shows delivery states in plain words

The counter and authorised history surfaces SHALL distinguish not sent yet,
retrying, sent, needs attention, void and cancelled, without making a paid bill
mutable. Needs-attention correction and reasoned discard SHALL exist only on the
originating tablet under its live shift. Manager diagnostics SHALL be read-only
and expose no payload or customer details.

#### Scenario: A command lands after cutover
- **WHEN** a valid pre-cutover command is accepted after cutover
- **THEN** authorised users can see when it was taken and when it was paid, and the bill stays immutable
