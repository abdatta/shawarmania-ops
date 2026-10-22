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
changes only status, kind and void-attribution fields. Deleting a bill SHALL be
impossible for every client role. Voiding SHALL be available to the bill's
outlet FA and SA with a reason from any time after settlement, and additionally
to the originating tablet through the reasoned unwind commands while the
five-minute grace window from the bill's stored `paid_at` is open. Every void
SHALL stamp a structured kind. Any replacement sale SHALL be a separate new
bill rather than edited totals.

A tender edit during the five-minute window SHALL append a separate attributed
payment-correction record and replacement allocation set. It SHALL NOT update
the bill, its item snapshots or its original payment rows. Reads that need
current tender SHALL derive the latest effective allocation from that immutable
history.

#### Scenario: Editing a paid bill's totals

- **WHEN** any session attempts to update a paid bill's amounts, items, clocks, or attribution
- **THEN** the database rejects the update

#### Scenario: Appending an eligible tender correction

- **WHEN** the originating tablet submits an exact changed Cash/UPI allocation within five minutes
- **THEN** the database appends the attributed correction and leaves every original bill and payment row unchanged

#### Scenario: Voiding a bill

- **WHEN** an authorized admin voids with a reason
- **THEN** status/void attribution change, the kind reads `manager_void`, and every original sale field remains unchanged

#### Scenario: The counter takes its own payment back

- **WHEN** the originating tablet fires an unwind command inside the grace window
- **THEN** the bill transitions to void with its counter kind, the order effect applies in the same transaction, and no other field of the bill changes

#### Scenario: Counter attempts to void outside the window

- **WHEN** a counter device session attempts the void transition more than five minutes after settlement, or by direct write ever
- **THEN** the database rejects it

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

### Requirement: The menu is searchable at the counter, and every available item is reachable

The billing surface SHALL present every menu item for the outlet in one
scrolling column on a counter tablet, under a search field that stays visible
while the column scrolls. An unavailable item SHALL NOT be sellable from the
grid.

Typing in the search field SHALL narrow the grid, in the browser and without a
request, to the items whose name or category name contains every
whitespace-separated word typed, ignoring case and order. A category with no
matching item SHALL be hidden. A matching unavailable item SHALL remain shown
and unsellable. When nothing matches, the column SHALL say so.

The search SHALL persist when an item is added from the grid. It SHALL be
cleared only by its clear control or by the Escape key, and clearing SHALL
remove focus from the field. Escape SHALL NOT clear the search while a dialog
or a menu is open, nor while focus is in another text field.

#### Scenario: Searching narrows the grid

- **WHEN** a biller types "chee chi" into the menu search
- **THEN** only items whose name or category contains both "chee" and "chi" are shown, and categories left empty are hidden

#### Scenario: A search by category

- **WHEN** a biller types a category's name
- **THEN** every item in that category is shown

#### Scenario: The search outlives a tap

- **WHEN** a biller adds an item from a filtered grid
- **THEN** the item is on the bill and the search and its results are unchanged

#### Scenario: Clearing the search

- **WHEN** a biller presses the search's clear control, or presses Escape with no dialog or menu open
- **THEN** the search is empty, the whole menu is shown, and the search field does not have focus

#### Scenario: Escape belongs to an open dialog

- **WHEN** a dialog is open over a counter with a search typed and the biller presses Escape
- **THEN** the dialog closes and the search is unchanged

#### Scenario: Nothing matches

- **WHEN** the search matches no item
- **THEN** the column says that no item matches what was typed

#### Scenario: An unavailable item

- **WHEN** the menu contains an item marked unavailable
- **THEN** that item cannot be added to the current bill, whether or not a search is shown

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
- **THEN** the two stay as they are, locked, and a new line of one Chicken Shawarma is added, which the composer shows on the same row as the two

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

### Requirement: A customer is identified by their phone, and their name is recorded with it

Both customer snapshots SHALL remain nullable, and the database SHALL never
require either: a bill or order carrying no customer at all is valid, and nothing
downstream may assume one.

The phone is the identity that resolves a returning customer and creates a
customer record. The name is that customer's own name, given with their number
and snapshotted onto the order and bill as it stood at the sale.

A name SHALL be recorded only for a customer identified by phone. The counter
SHALL NOT request or store a name for an order whose customer gave no number;
the preparation pipeline and shift list SHALL identify it by its order number.
Previously captured historical names SHALL remain intact.

Customer entry SHALL be optional when placing or editing an order. The counter
SHALL NOT require identification or Skip before Order or Save changes. At outlets
collecting customer details, payment SHALL ask for a number when none is attached
and offer one-tap Skip before tender. An attached number SHALL be shown and kept.
Collection off SHALL hide entry and bypass the payment prompt. No database
constraint SHALL be added for this UI checkpoint.

A phone SHALL be a complete Indian mobile number canonicalised by the same rule
the database uses, or resolve and create nothing. The counter SHALL NOT report a
number as malformed while it is still being typed.

#### Scenario: A bill with no customer reaches the database
- **WHEN** a bill or order is written with both customer fields null
- **THEN** the database accepts it without a customer requirement

#### Scenario: An order is rung for a customer who gave no number
- **WHEN** the biller places an order without entering a customer or pressing Skip
- **THEN** the order carries no customer name, phone or id, no customer record is created or matched, and its order number identifies it

#### Scenario: An identified customer is snapshotted whole
- **WHEN** the biller identifies a customer and the order is accepted
- **THEN** the order and bill carry the customer id, canonical phone and name, not the id alone

#### Scenario: The saved profile is never rewritten from the till
- **WHEN** a name differing from the matched customer's saved name is given at the counter
- **THEN** that name is snapshotted onto this order and bill only, and the saved global profile is unchanged

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

### Requirement: Unsent work shows the shape of its number, and is said to be unsent once

Until a bill or an order has been sent it has no number, because numbers are
assigned by the server on a successful send, per outlet and sequentially. Until
then the surface SHALL show, where the number will be, **a placeholder in the
shape of the number** — and SHALL NOT show any other reference, token or
identifier in its place.

**Nothing that can be read as an identifier may stand in for one.** A short
reference of the kind this requirement used to demand was honest about not being
a number and still read as one, because a few characters in an identifier slot is
what an identifier looks like — so the real number replacing it read as the work
changing identity rather than as its number arriving. That is the confusion the
reference was introduced to prevent, arriving by another door.

The placeholder carries no text, so the surface SHALL give it an accessible
description stating that the number has not been assigned yet; a placeholder
that is silent to a screen reader is an absent one.

**The surface SHALL state in plain words that work is not sent yet, once**, in
its sync indicator, which is permanently visible and counts exactly the items
waiting. It SHALL NOT repeat that statement on each unsent item: the indicator
already names the condition and the count, and a second copy on every card is the
same sentence thirty times.

**No surface SHALL use the word provisional**, here or anywhere else in billing. A
biller at 9pm needs to know what to do next, and a word nobody says out loud is
where that stops.

Where unsent work must be *named* — in an accessible name, a confirmation, or a
heading — the surface SHALL name it in words rather than by an identifier it does
not have.

#### Scenario: An order that has not yet synced
- **WHEN** an order is saved at the counter and has not been delivered
- **THEN** its card shows a placeholder the shape of the order number, no number and no other reference, and an accessible description saying the number is not yet assigned

#### Scenario: The number arrives
- **WHEN** the server assigns the number and the surface reads it back
- **THEN** the placeholder is replaced by that number, and nothing that was shown before it was an identifier

#### Scenario: A bill that has not yet synced
- **WHEN** a settled bill is still queued
- **THEN** it shows no bill number and no stand-in for one, and the sync indicator states that work is not sent yet

#### Scenario: The unsent condition is stated once
- **WHEN** several orders are waiting to be sent
- **THEN** the sync indicator names the condition and the count, and no individual card repeats it

#### Scenario: Unsent work is named in words
- **WHEN** an unsent order is named in an accessible name or a confirmation
- **THEN** it is named in words, never by a generated reference standing in for its number

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
outlet. The surface SHALL ask two questions of the page — which outlet, and
which revenue business date. By default every bill of the selected outlet-day
SHALL be listed whatever its status or tender, newest payment first, because
each summary already names its own state and tender.

The list SHALL be read a page at a time: about a screenful and a margin first,
and the next page as the reader nears the end, until every matching bill of the
day is shown. Paging SHALL neither repeat nor skip a bill when bills are paid
while the reader scrolls. Each listed row SHALL carry only what its collapsed
summary shows, and SHALL NOT carry the customer's name or phone. Sorting and
filtering SHALL be done by the server over the whole outlet-day, never over the
rows already shown.

The Bills tab SHALL offer one Filter control opening a sheet that sorts and
narrows the listed bills of that outlet-day and nothing else. Sort SHALL be by
paid time, order time, amount, or wait (paid time less order time), each in
either direction named in the sort's own words (newest or oldest first, highest
or lowest first, longest or shortest first), ties broken by bill number in the
same direction. Filters SHALL be: Bill (Paid, Cancelled, Cancelled after paid,
Payment undone); Paid with (Cash, UPI, Split); Customer as a single choice (All,
With number, Without, Gold), where a bill carrying a name but no phone counts as
Without; Service (Dine-in, Takeaway); Only bills that (Had a discount, Payment
changed, Receipt failed); and Tablet, listing each billing tablet by name and
shown only on a day two or more tablets took bills. Choices within a group SHALL
widen the list and choices across groups SHALL narrow it; a group with no choice
SHALL not filter. The control SHALL name the choices in force and offer Clear
while any is chosen. The Bills tab SHALL read the shown and total counts while a
filter hides bills. The day's Cash, UPI, Total and AOV SHALL be unaffected by
any filter, and SHALL be the selected outlet-day's counter takings as the shared
revenue definition counts them — the figures Overview and the Ledger read —
never a sum of the rows on the phone. Choices SHALL survive a change of day or
outlet, SHALL be cleared on leaving the page, and SHALL NOT be written to browser
storage. A change of choice SHALL re-read the list from its first page and
nothing else.

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
bill directly beneath the summary, with at most one bill expanded at a time.
What the summary carries SHALL show at once and the rest of the detail SHALL be
read with one request the first time that bill is opened. A bill's detail, once
read, SHALL be kept in memory until the reader leaves the page, so collapsing it,
opening another bill and returning to it SHALL NOT read or show a loading state
again; it SHALL NOT be written to browser storage. The
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
transition while the surface calls the result Cancelled. The cancelled bill SHALL then
replace its own row and detail in place, still expanded, without a loading state over the
list or a change of scroll position, and the day's figures SHALL refresh beside it. The
corrected sale SHALL then be
manually rung as a new bill on the enrolled counter tablet; the manager surface SHALL
create no payment command, cross-device draft or automatic prefill. The manager SHALL see
any open order at that outlet whose business date is the selected day, and no other, and
cancel it with a reason. The Open orders view SHALL name the unpaid total of the listed
orders — open, unpaid orders only, in integer paise — and its tab count SHALL be that
day's. The Open orders view SHALL be read in one round trip, its orders and their
kitchens' answers asked for together. Returning to the page after more than two minutes
away SHALL re-read the day's figures and the rows already shown, keeping the filter, the
expanded bill and the scroll position. Each open order SHALL show its
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
- **THEN** every one of them is listed, each naming its own state, with no filter chosen and none needed to see either kind

#### Scenario: A manager finds the day's cancelled bills by size
- **WHEN** a manager chooses Cancelled and Cancelled after paid, sorted by Amount, highest first
- **THEN** only those bills are listed, largest first, the control reads what is chosen, the Bills tab reads the shown and total counts, and Cash, UPI, Total and AOV still read the whole day

#### Scenario: Customer choices cannot contradict
- **WHEN** a manager chooses Without under Customer
- **THEN** bills with no phone, including those carrying only a name, are listed, and Gold cannot be chosen at the same time

#### Scenario: A filter finds nothing
- **WHEN** the chosen filters match no bill of the day
- **THEN** the list reads No bills match with a Clear action, and Clear restores every bill in the default order

#### Scenario: A one-tablet day
- **WHEN** every bill of the day was taken on one billing tablet
- **THEN** the sheet offers no Tablet group

#### Scenario: Open orders follow the day
- **WHEN** a manager steps back to yesterday while today has open orders
- **THEN** Open orders lists only yesterday's orders still open, usually none, with that day's count and unpaid total

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

#### Scenario: A busy day opens with its first page
- **WHEN** a manager opens a day of 128 bills
- **THEN** the first page of rows is listed with the day's Cash, UPI, Total and AOV for all 128, and the next page is read only as the manager scrolls towards the end

#### Scenario: A bill is paid while the manager scrolls
- **WHEN** a new bill is paid after the first page was read and the manager scrolls to the second
- **THEN** no bill appears twice and none is missing from the pages read

#### Scenario: A filter is answered by the server
- **WHEN** a manager chooses Cancelled on a day whose cancelled bills are not among the rows already shown
- **THEN** the list re-reads and shows every cancelled bill of the day, and the Bills tab reads the shown and total counts

#### Scenario: A reopened bill does not load again
- **WHEN** a manager opens a bill, collapses it, opens another, and opens the first again
- **THEN** the first bill's detail reads once in all, and reopening it shows no loading state

#### Scenario: A cancelled bill stays where it was
- **WHEN** a manager cancels a bill halfway down a long list
- **THEN** that row reads Cancelled in place, its detail stays open, the list shows no loading state, the scroll position holds, and Cash, UPI, Total and AOV refresh

#### Scenario: The day's figures agree with Overview
- **WHEN** a manager opens today's Billing history and Overview's Today's revenue
- **THEN** Billing history's Cash and UPI equal Overview's counter figures for today

#### Scenario: A list row keeps the customer out
- **WHEN** a manager's list is read for a day whose bills carry customer phones
- **THEN** no listed row carries a customer name or phone until that bill's detail is opened

#### Scenario: Another outlet's rows are asked for
- **WHEN** a franchise admin requests the bill rows of an outlet they do not manage
- **THEN** no row is returned

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

The billing composer SHALL offer primary Order and secondary Paid when at least
one line exists, required service choices are answered and local acceptance is
not busy. Customer entry SHALL NOT govern either action's availability. The same
rule SHALL permit Save changes on an anonymous order.

Order SHALL create a tablet-owned order without assigning a bill number and
clear the composer only after the adapter accepts it. Paid SHALL open checkout,
asking for a missing number where collection is on, then show customer benefits,
the final total and tender. Exact payment allocation SHALL be required for
settlement. Both customer snapshots SHALL remain nullable.

The composer SHALL offer Add discount below the lines in the bill column, and
both paths SHALL carry the discount, its basis and rounding.

#### Scenario: Customer pays upfront
- **WHEN** the operator opens Paid, supplies or skips a missing number where required, allocates the exact total and confirms
- **THEN** a paid result is created directly, with no order saved first

#### Scenario: A discount is applied before the order leaves
- **WHEN** the operator adds a discount and chooses Order or Paid
- **THEN** the accepted command carries that discount, its basis and the bill's rounding

#### Scenario: Food has to be made first
- **WHEN** the operator chooses Order without touching customer entry
- **THEN** the order appears at the newest end of the pipeline with its order number and no bill number

#### Scenario: The biller has not decided yet
- **WHEN** the current bill has items, required service choices are answered and customer entry is untouched
- **THEN** Order and Paid are available without Skip; payment asks for the missing number when collection is on

#### Scenario: The biller skipped
- **WHEN** the biller has skipped identification while ordering
- **THEN** both actions remain available and payment still asks if no number is attached and collection is on

#### Scenario: Required service choice is missing
- **WHEN** the outlet requires a service or table decision that has not been answered
- **THEN** Order, Save changes and Paid remain unavailable regardless of customer entry

#### Scenario: Empty or busy composer
- **WHEN** no line exists or a local acceptance is in progress
- **THEN** Order, Save changes and Paid remain unavailable

### Requirement: A saved order enters the preparation pipeline

On saving, the surface SHALL put the order directly into the pipeline list at
its newest end, where its complete quantity-and-item lines SHALL be the primary
information, followed by the customer name when one exists and the prominent
total. Where the order was rung for a member, its card SHALL carry the member
mark, read from the order's own snapshot, so preparation can be ordered or
handled differently. Its order number SHALL remain visible as a secondary
reference until payment or cancellation. The surface SHALL NOT add a separate
latest-order card that can represent only one of several rapid orders. The order
number SHALL be visually distinct from a bill number wherever both could be
seen.

The order SHALL be in the pipeline list as soon as the tablet has saved it,
drawn from the tablet's own record, without waiting for any server response.
Until the server assigns its number, the card SHALL show the shape of the number
and nothing else. The card SHALL be as usable as any other order on the rail,
and SHALL NOT be shown disabled, greyed or as a loading placeholder while the
server's answer is outstanding. When the server answers, its answer SHALL
replace what was drawn.

#### Scenario: The order is saved

- **WHEN** an order is accepted
- **THEN** its preparation items and total appear immediately at the newest end of the pipeline list, its customer is shown when known, and its order number remains available as a small reference

#### Scenario: The order is saved on a slow connection

- **GIVEN** the server has not yet answered any read made after the save
- **WHEN** the biller presses Order
- **THEN** the order's card is on the rail with its dishes, notes, label, customer and total, and the awaiting shape of its number, before any server response arrives

#### Scenario: A just-saved order is worked before the server answers

- **GIVEN** an order was saved while the server has not answered
- **WHEN** the biller ticks one of its dishes, pays it, edits it or cancels it
- **THEN** the action is taken exactly as it is on any other order of this tablet

#### Scenario: The server answers

- **GIVEN** a saved order drawn from the tablet's own record
- **WHEN** the server's read arrives with the order and its number
- **THEN** the card shows the number in place of its shape, and nothing else on the card moves

#### Scenario: A member's order reaches the pipeline

- **WHEN** an order rung for a member appears in the pipeline list
- **THEN** its card carries the member mark, and it carries no membership date, actor or figure

#### Scenario: The order is paid

- **WHEN** an order becomes a paid bill
- **THEN** the bill number identifies it from that point and the two numbers are never presented as interchangeable

### Requirement: Pipeline orders remain editable until they are paid

The pipeline SHALL list this outlet's unpaid orders, each with its reference,
complete quantity-and-item lines and total. A card SHALL show its temporary label and how long ago it was ordered. Customer entry remains in payment and composer edit. Items SHALL
NOT be truncated or collapsed because these lists are preparation work. Any
operator holding the owning tablet's live shift SHALL reopen and change lines,
quantities, notes, label and customer form values until payment or cancellation,
except that a locked line SHALL take no more and keep its note: the composer SHALL
nonetheless show every line of one dish, note and captured price as one row with
its true total and how many are made, its + SHALL grow the food not made yet (or
start a line for it) and its − SHALL take food not made yet off first, and the
row SHALL NOT say *Locked*. The note action on a partly made row SHALL apply to the
food not made yet and say so; on a row all made it SHALL say the note cannot change. No discount
control SHALL appear. The original order time and business date SHALL remain
unchanged, and visible on the order while it is edited. On the combined tablet workspace, edit SHALL use the
same menu and composer used for a new order, laid over the rail's left half. Any
in-progress new-order draft SHALL be restored exactly after the edit is saved
or cancelled. Once an order is paid, revision SHALL close for it everywhere.

#### Scenario: Staff scans work to prepare

- **WHEN** a pipeline order contains several different items and has a customer name
- **THEN** every item and quantity is readable without expansion, the total is prominent, the card labels its reference as Order # followed by the number, and customer details remain in payment and edit, while a small line under the label says how long ago it was ordered

#### Scenario: A partly made dish in the composer

- **WHEN** an order with one ticked Paneer Shawarma is opened for edit and the biller taps its + twice
- **THEN** the composer shows one Paneer Shawarma row of three, *1 made*, and saving keeps the ticked line and adds a new line of two

#### Scenario: Each edit's food on the rail

- **WHEN** an edit adds food to an order on the rail, and a later edit adds more
- **THEN** the card lists the order's first food, then a plain dashed divider and the first edit's food, then another divider and the second's, with packaging last of all

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

### Requirement: A complete number resolves itself inside the customer dialog

The counter SHALL request an exact customer match only when a complete valid
phone has been entered, and SHALL make at most one request per distinct complete
number rather than one per keystroke.

The dialog SHALL present the outcome without the biller asking for it: a match
SHALL show the saved name and offer to use it; a complete number with no match
SHALL offer to save it, asking for the customer's name, which is the one moment
a saved profile's name is set; an incomplete number SHALL show nothing at all.
Accepting a match SHALL affect only this order. A number saved this way SHALL be
created when the order or paid bill is accepted, and SHALL NOT block the sale.

A match served from the tablet's last successful read SHALL be distinguished from
one read live, and SHALL say that it will be checked again on sync.

A lookup that is refused, rate-limited or fails SHALL be presented to the biller
the same way a number with no match is presented, disclosing nothing about which
occurred.

#### Scenario: A saved customer is recognised
- **WHEN** a complete phone matches a saved customer
- **THEN** the dialog shows the saved name and the action offers to use it

#### Scenario: An unknown number is offered for saving
- **WHEN** a complete phone matches nobody
- **THEN** the dialog asks for the customer's name and will not save the number without one

#### Scenario: Nine digits say nothing
- **WHEN** fewer than ten digits have been entered
- **THEN** the dialog shows no match, no absence of a match, and no validation message

#### Scenario: The tablet is offline and remembers the number
- **WHEN** a complete phone matches the tablet's remembered customers while the network is unreachable
- **THEN** the match is offered, marked as read earlier, and stated to be subject to recheck on sync

#### Scenario: The lookup is rate-limited
- **WHEN** the lookup bound is exceeded or the caller is refused
- **THEN** the dialog reads exactly as it does for a number that matched nobody, and the sale continues

### Requirement: Counter history is limited to the current shift

My shift SHALL show paid bills belonging to this tablet's current shift. Each
bill SHALL be collapsed by default and expand to immutable item names,
quantities, captured unit prices, line totals, payment facts, total and
optional customer snapshot. It SHALL NOT show other shifts or another outlet.

The shared counter SHALL show aggregate Cash and UPI payment totals for its
current shift, in the two-column total cards. The manager's Billing History
SHALL show the selected outlet-day Cash and UPI totals, the day's combined
takings, and its average order value **outside its view tabs**: one row of four
cards below the day control and above the tab strip, on screen whichever view is
open, and SHALL NOT repeat them inside the Status view. That row SHALL hold a
silhouette of its own height until the outlet's day has resolved, so choosing a
view does not move under the reader. Its fourth card SHALL be labelled `AOV`.
Both scopes SHALL use the same total-card component, the manager's in its dense
four-column presentation. A card SHALL keep the same padding, label size, left
alignment and height in either presentation. In the four-column row each figure
SHALL be sized to its own card: the display face wherever it fits, shrunk only as
far as that card's content box requires and no further, and never below the size
of the label above it. The row SHALL NOT scroll horizontally, nor wrap to a second
line, at a 360px viewport.

Combined takings SHALL be the sum of the Cash and UPI figures shown beside it,
never a separately derived number, so that the cards always reconcile. The
average order value SHALL be those combined takings over the number of paid bills
in the same scope, in integer paise, and SHALL read as zero when that scope holds
no paid bill. Cancelled bills SHALL contribute to neither figure.

The list SHALL include locally accepted payments immediately and SHALL use each
bill's latest effective allocation, including a durably accepted correction that
is still unsent. An eligible expanded bill SHALL carry its relative `Edit (N
min)` or `Edit (N sec)` action without making any other bill fact editable.

#### Scenario: Operator opens My shift
- **WHEN** this tablet has bills from its shift and older outlet bills exist
- **THEN** only the current shift's bills appear and its Cash and UPI aggregates
  reflect only that shift

#### Scenario: Manager opens Billing History
- **WHEN** a manager opens Billing History for an outlet day
- **THEN** the outlet-day Cash and UPI aggregates, combined takings and AOV are
  already on screen with the Bills list, and stay on screen when Open orders or
  Status is chosen, without altering the counter's current-shift scope

#### Scenario: Manager opens Status
- **WHEN** a manager opens the Billing History Status view for an outlet day
- **THEN** the view shows tablet sync activity alone, with the day's figures
  still readable above the tabs rather than repeated inside it

#### Scenario: A day with no paid bills has no average
- **WHEN** a manager opens Billing History for an outlet day on which nothing was paid
- **THEN** the AOV card reads zero rather than an undefined or infinite figure

#### Scenario: Operator inspects a closed bill
- **WHEN** the operator expands a bill in My shift or the combined tablet rail
- **THEN** its item snapshots, quantities, prices, line totals, payment facts and total appear without exposing another shift

#### Scenario: A tender correction changes shift cash
- **WHEN** an eligible bill is corrected from Cash to UPI
- **THEN** the same bill remains listed and both current-shift and outlet-day
  totals use its latest effective allocation

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

### Requirement: Item names and prices are read, not decoded

A menu tile, a bill line and a closed bill's line SHALL show the item's full
name, never truncated with an ellipsis, because the end of the name is what
distinguishes items on this menu from each other. A menu tile SHALL carry its
price at the top right, in the same place whatever the name above it does, and an
unavailable item SHALL be labelled **Unavailable** **instead of** showing its price.

Bills in a list SHALL name today as today rather than repeating the date on
every row. Yesterday SHALL retain its relative label; an earlier date in the
current calendar year SHALL omit the repeated year, and a date from an older
year SHALL retain it. Every comparison SHALL use Asia/Kolkata rather than the
browser's local timezone.

#### Scenario: Two items with a long shared prefix

- **WHEN** a category holds items whose names differ only near the end
- **THEN** both names are shown in full, the tile growing to fit rather than clipping, and every tile in that row keeps the same height

#### Scenario: An item the kitchen has run out of

- **WHEN** an item is unavailable
- **THEN** its tile shows an Unavailable label where its price would be, and shows no price at all, so a figure that cannot be sold cannot be quoted

#### Scenario: A shift's bills across calendar dates

- **WHEN** the biller reads this shift's closed bills
- **THEN** each row says Today with the time, says Yesterday for a shift that crossed midnight, omits the year for any earlier date in the current calendar year, and retains the year for an older year

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

### Requirement: Frequent counter actions are tap-first and actor-neutral

The direct-payment and saved-order payment actions SHALL be labelled Mark Paid,
not Paid, Pay now or Pay in full. Saving food-first work SHALL be labelled Order,
use a non-save icon and be the primary composer action. Mark Paid SHALL be
secondary in the composer and primary on an already-open order. Payment SHALL use a touch keypad and method tiles; cancellation
SHALL use icon actions, preset reasons and one editable reason field. The phone
input SHALL request the native numeric keypad on touch devices. Keyboard entry
SHALL remain optional for cancellation and otherwise limited to customer details
and to the on-screen number pads below.

Every on-screen number pad in a billing dialog SHALL also take a physical
keyboard where one is attached: a typed digit SHALL press that digit's key, a
typed decimal point the pad's decimal key where it has one, Backspace its delete
key, and Enter the dialog's primary action. A key the pad has disabled SHALL
stay disabled when typed. A pad SHALL NOT gain a text field for this, so a touch
screen never raises its own keyboard over it. An auto-repeated Enter SHALL NOT
act. Typing into a text field, and Enter on a control reached with Tab, SHALL
keep their ordinary behaviour.

#### Scenario: Biller records ordinary full payment
- **WHEN** the biller taps Mark Paid and then one tender method without keying an amount
- **THEN** the entire remaining balance is allocated to that method

#### Scenario: Biller cancels for a common reason
- **WHEN** the biller taps the cancel icon, selects a preset reason and confirms
- **THEN** cancellation completes without opening the keyboard

#### Scenario: Biller types on a pad from a physical keyboard
- **WHEN** a number pad is open on a counter with a keyboard attached and the biller types digits, Backspace and then Enter
- **THEN** the readout changes as if the matching keys had been tapped, and Enter does what the dialog's primary action does

#### Scenario: A held Enter confirms once
- **WHEN** the biller holds Enter on a pad whose primary action is enabled
- **THEN** the action happens once, and nothing reaches the dialog that opens after it

#### Scenario: A touch screen never raises its keyboard over a pad
- **WHEN** a number pad opens on a touch screen with no keyboard attached
- **THEN** no text field takes focus and the device's own keyboard stays down

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

Ordinary edit, payment, cancellation and preparation of an order SHALL be
available only on the tablet that owns it, to any operator holding its live
shift. Clearing an order stranded on an unavailable tablet SHALL be an ordinary
reasoned cancellation by that outlet's manager, and no transfer or recovery
path SHALL exist. Cards across the pipeline SHALL label secondary numbers as
Order #, show complete item lines, and omit the creator when the current shift
holder took the order. The payment action
SHALL read Paid and the preparation action Prepared.

#### Scenario: Another operator uses the same tablet
- **WHEN** a different operator's shift begins on the order's tablet
- **THEN** they may prepare, edit, pay or cancel it and the action is attributed to them

#### Scenario: The tablet is unavailable
- **WHEN** an order remains open at an outlet whose tablet cannot be used
- **THEN** the outlet's manager cancels it with a reason from their own device, and nothing is transferred

#### Scenario: Another tablet of the outlet sees but cannot act
- **WHEN** a second billing device at the outlet displays the pipeline and its operator attempts to act on the first tablet's order
- **THEN** the database refuses the command under the owning-tablet rule while the order remains visible with its creator named

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
**five minutes after the ticket is finished** — the later of the bill's original
`paid_at` and its order's `prepared_at` — and, for a bill with no order, until
five minutes after its own `paid_at`. While the order's preparation is
unrecorded the edit SHALL remain available with no deadline. The edit SHALL
reopen the shared payment dialog prefilled with the bill's current effective
Cash/UPI allocations. It SHALL permit only one or more unique positive
integer-paise Cash/UPI allocations that sum exactly to the unchanged bill total.
Item and customer snapshots, quantities, prices, totals, bill number, payment
time and business dates SHALL remain locked.

The collapsed bill SHALL carry a compact pencil indicator while it remains
editable. Where a deadline exists, the expanded control SHALL use relative text:
`Edit (N min)` while at least one minute remains, rounding up to the next whole
minute, then `Edit (N sec)` below one minute. **Where no deadline exists yet the
control SHALL NOT draw a countdown**, and SHALL say instead that the bill stays
editable until its order is prepared: a countdown that has not started must not
be drawn as one, and must never be drawn as expired. The control SHALL disappear
at expiry without leaving a persistent expiry message. The rendered timer SHALL
NOT grant authority: the database SHALL enforce that the immutable correction
command creation time falls inside the same window it draws. A correction SHALL
NOT restart the deadline.

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
- **WHEN** the originating tablet corrects the tender of an order paid on handover inside its window
- **THEN** it follows the same append-only correction path and retains the order's bill identity and number

#### Scenario: The tender is corrected while the food is still being made
- **WHEN** the originating tablet corrects the tender of an unprepared order's payment half an hour after taking it
- **THEN** the correction is accepted, because the ticket is not finished

#### Scenario: The edit dialog opens
- **WHEN** the operator opens an eligible bill's payment edit
- **THEN** its effective Cash/UPI allocations are prefilled, sale facts are locked, and confirmation is unavailable until an exact changed allocation is present

#### Scenario: A clock that has not started draws no countdown
- **WHEN** the bill's order is not yet marked prepared
- **THEN** the collapsed bill still shows its pencil indicator and the expanded control offers the edit without a countdown, saying it stays editable until the order is prepared

#### Scenario: More than one minute remains
- **WHEN** 4 minutes and 1 second remain in the window
- **THEN** the collapsed bill shows its pencil indicator and the expanded control reads `Edit (5 min)`

#### Scenario: Less than one minute remains
- **WHEN** 59 seconds remain in the window
- **THEN** the control reads `Edit (59 sec)` and counts down in seconds

#### Scenario: The deadline expires
- **WHEN** five minutes have elapsed since the ticket was finished
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

### Requirement: A payment can be taken back within five minutes

On the originating tablet, the operator SHALL be able to take a payment back
through a reasoned confirmation until **five minutes after the ticket is
finished**, where finished means the later of the bill's stored `paid_at` and the
order's `prepared_at`. While the order's preparation is unrecorded the action
SHALL remain available with no deadline, because the food is still owed and the
ticket is not finished. A bill with no order behind it SHALL keep a deadline of
five minutes after its own `paid_at`.

Taking the payment back SHALL void the bill, stop it counting in shift totals,
and reopen the order with its preparation state preserved, leaving its card in
place in the pipeline list. The confirmation SHALL name the amount and tender
being taken back. After the deadline the action SHALL disappear from the
interface and be refused by the database. The rendered state SHALL NOT grant
authority: the interface and the database SHALL compute the same deadline from
the same two stored facts.

#### Scenario: Wrong tender, taken back

- **WHEN** the operator takes back a Cash payment before the deadline
- **THEN** the bill reads void with kind `counter_unpay`, shift cash drops by its amount, and the order card stands ready to be paid again correctly

#### Scenario: The food is still being made

- **WHEN** the operator takes back the payment on an unprepared order twenty minutes after paying it
- **THEN** the take-back is offered and accepted, because the ticket is not finished

#### Scenario: The clock starts at preparation

- **WHEN** an order paid upfront is marked prepared
- **THEN** its take-back deadline becomes five minutes from that moment and expires there

#### Scenario: The clock starts at payment when payment came last

- **WHEN** a prepared order is paid on handover
- **THEN** its take-back deadline is five minutes from the payment, not from the earlier preparation

#### Scenario: The window has closed

- **WHEN** the operator opens a finished ticket's actions five minutes after it was finished
- **THEN** no take-back action is offered, and a hand-crafted command is refused by the database

#### Scenario: A direct sale keeps its own clock

- **WHEN** a bill rung and paid without a saved order reaches five minutes past its payment
- **THEN** its take-back is refused, because there is no preparation for its clock to wait on

### Requirement: Cancelling after payment warns before it unwinds money

Cancelling an order that has already been paid SHALL require a confirmation
that names the amount and tender taken and states plainly that the money goes
back out of the drawer, before accepting a non-blank reason. Confirming SHALL
void the bill with kind `cancelled_after_paid` and cancel the order in one
action. The cancelled order SHALL leave the pipeline and remain reviewable with
actor, time and reason. The action SHALL be available on the same deadline as
taking the payment back — five minutes after the ticket is finished, and with no
deadline while its preparation is unrecorded — and SHALL be refused by the
database outside it.

#### Scenario: A paid takeaway is cancelled

- **WHEN** the operator cancels a ₹389 Cash order after paying it, inside the window
- **THEN** the dialog warned that ₹389 in Cash goes back to the customer, and confirming voids the bill and cancels the order together

#### Scenario: The customer leaves while the food is being made

- **WHEN** the operator cancels an unprepared order that was paid an hour earlier
- **THEN** the cancellation is accepted with its reason and its warning, because the ticket was never finished

### Requirement: Post-settlement voids carry structured kinds the manager can read

Every post-settlement void SHALL stamp `bills.void_kind` at write time —
`manager_void` for the manager path, `counter_unpay` for a taken-back payment,
`cancelled_after_paid` for a paid order cancelled at the counter — alongside
the existing actor, time and reason attribution. Manager billing history SHALL
render `cancelled_after_paid` as a distinct Cancelled-after-paid marker on the
bill summary. Voided bills SHALL contribute to no total, whatever their kind.

#### Scenario: The owner recognises the case

- **WHEN** a manager reviews an outlet-day carrying a counter-cancelled paid order
- **THEN** that bill summary carries the Cancelled-after-paid marker beside its Cancelled state, with who, when and why readable in detail

#### Scenario: Kinds are stamped, never inferred

- **WHEN** any surface renders a voided bill
- **THEN** the marker it shows comes from the stored kind, not derived from timestamps or reasons

### Requirement: Post-departure bills preserve money and expose qualified attribution

An accepted bill recorded after remote shift end SHALL carry the original shift
and operator as last-known context, the immutable remote end time, and an explicit
after-departure flag. It SHALL receive an ordinary bill number and participate in
revenue, tender totals and drawer arithmetic. It SHALL NOT become part of a later
operator's My Shift.

Manager and owner billing history SHALL disclose the exception without exposing
it to an unrelated incoming operator. An authorised reviewer SHALL append one
attributed outcome: confirm the original operator, name another eligible person,
or state that the operator cannot be established with a reason. Review SHALL NOT
rewrite the bill, its original operator, shift, command receipt, or flag.

#### Scenario: Owner reads a flagged bill

- **WHEN** the owner opens billing history containing a sale recorded after remote departure
- **THEN** the bill states the original operator context, sale time, shift end time and review state while remaining included in every financial total

#### Scenario: Franchise Admin reviews their outlet

- **WHEN** an assigned manager records an attribution outcome for a flagged bill at their outlet
- **THEN** one append-only review stores the outcome, reviewer and instant, while another outlet's manager is refused by the database

#### Scenario: Next operator reads My Shift

- **WHEN** Priya opens a new shift on the same tablet
- **THEN** Rahul's flagged bill is absent from Priya's My Shift and creates no alert for her

### Requirement: A resumed counter states what it remembers and when it read it

A counter opened from a resume record SHALL carry a persistent line saying the
tablet is offline and when it last read successfully, and the menu grid, the
preparation pipeline and Bills this shift SHALL each be readable as of that time.

Because the pipeline is outlet-wide, an offline counter SHALL present it as a
remembered outlet read rather than as current work, and SHALL NOT imply that
another tablet's cards or a manager's clearance have been seen. The existing sync
indicator SHALL continue to carry pending counts and its escalated state
unchanged.

When the last observed server time and the device clock materially disagree, the
counter SHALL show both and SHALL correct neither.

#### Scenario: The workspace is read after a cold start

- **WHEN** an operator uses a counter resumed from a resume record
- **THEN** the offline line names the last successful read, and the menu, pipeline and bills are each labelled as of it

#### Scenario: The clock disagrees with the last server reading

- **WHEN** the device clock differs materially from the server time observed at the last successful read
- **THEN** both are shown, the counter warns, and neither clock is silently adjusted

### Requirement: Finish Day says why it cannot run offline

Finish Day SHALL require authoritative server state. With no backend reachable
the readiness sheet SHALL open, state that the day cannot be finished until the
tablet reconnects, list the local work outstanding by category, and offer no
completion. It SHALL NOT present a countdown, a local confirmation, or a way to
proceed.

#### Scenario: Finish Day during an outage

- **WHEN** an operator opens Finish day with no backend reachable
- **THEN** the sheet explains that server state is unavailable, names the unsent and needs-attention categories, and offers only to keep billing

#### Scenario: Finish Day immediately after reconnecting

- **WHEN** the backend becomes reachable and the drain resolves every command
- **THEN** the ordinary readiness sheet applies unchanged, including its advisory tender-edit prompt

### Requirement: Finish Day names food owed on a paid order, and closes the window

Finish Day SHALL name every order at this tablet's business date that is **paid and
not marked prepared**, in the biller's words and separately from open orders and
from recent payments, as an **advisory** stating that it will be marked prepared at
the outlet's business-day cutover, with that cutover's time shown. It SHALL NOT
refuse the day close on that account. Finishing the day SHALL NOT mark such an
order prepared: the food may still be cooking, and the order SHALL remain on the
rail until a Prepared tick or the cutover, whichever comes first.

Finishing the day SHALL otherwise proceed immediately, **ending any open payment
edit window early** rather than refusing until it elapses. No guard SHALL refuse
the day close on the grounds that a payment is still editable. After the day is
finished, taking a payment back, cancelling after payment and correcting a tender
SHALL all be refused by the database, and that refusal SHALL be proved by a
hand-crafted request rather than assumed from the absence of a live shift.

An order that is open and unpaid SHALL continue to block the day close.

#### Scenario: A paying customer is still owed food

- **WHEN** an operator opens Finish Day with one order paid and not marked prepared, at an outlet whose cutover is 04:00
- **THEN** the sheet names that order as paid but not marked prepared, says it will be marked prepared at 04:00, and offers to finish

#### Scenario: Finishing leaves the food owed visible

- **WHEN** the operator finishes the day with that order still unprepared
- **THEN** the day closes, the order is still unprepared, and it remains on every rail at the outlet until it is ticked or the cutover passes

#### Scenario: An unpaid order still holds the day open

- **WHEN** an operator opens Finish Day with one order open and unpaid
- **THEN** the sheet refuses and names it, and the database refuses a hand-crafted day close for that date

#### Scenario: A recent payment does not hold the day open

- **WHEN** an operator finishes the day one minute after taking a payment on a finished ticket
- **THEN** the day closes at once and that payment's edit window ends with it

#### Scenario: Nothing moves after the day is closed

- **WHEN** a hand-crafted take-back, cancel-after-paid or tender correction is submitted for a bill whose day has been finished, including one whose order is still unprepared
- **THEN** the database refuses it

### Requirement: A shift summary is one tablet's, and outlet history is both

Bills this shift and My shift SHALL show only what this tablet's current shift
produced. Authorised FA and SA outlet history MAY aggregate every tablet at the
outlet, SHALL count each bill exactly once, and SHALL identify the tablet that
took the order and the tablet that took the payment wherever accountability
depends on it.

Neither surface SHALL order accounting history by bill number as a proxy for
time; ordered time, payment time and business date are what say when.

#### Scenario: Two counters work one outlet

- **WHEN** each tablet has taken payments during its own shift
- **THEN** each counter shows its own totals only, while the manager's outlet history reconciles both with no bill counted twice

#### Scenario: A late sync reorders the numbers

- **WHEN** one tablet's earlier sale is numbered after the other tablet's later one because it synced late
- **THEN** the history reads in time order with both times shown, and the numbers are presented as identifiers rather than as sequence

### Requirement: Adding a discount is a keypad panel built like tender capture

The Add discount control SHALL open a panel assembled from the same parts as the
tender dialog, so that the counter learns one interaction rather than two.

The panel SHALL show a single readout beginning at nought and displaying the
entered value with its unit. It SHALL offer a percentage unit and a rupee unit,
and switching between them SHALL NOT require the entry to be cleared. Its keypad
SHALL carry the digits one to nine, a decimal point, nought positioned centrally,
and a backspace, and SHALL NOT carry a double-nought key.

The panel SHALL NOT display a resulting total, because a discount is not set by
aiming at a final amount.

The panel SHALL offer the outlet's configured percentage presets, between none and
four of them, on a single row that never wraps.

#### Scenario: The unit is decided after the number

- **WHEN** an operator enters a value and then taps the other unit
- **THEN** the unit changes, the entered value is preserved, and no clearing step
  is required

#### Scenario: A fractional percentage

- **WHEN** an operator enters a percentage carrying a decimal
- **THEN** it is accepted and the resulting discount is exact integer paise

#### Scenario: No presets are configured

- **WHEN** the outlet has no percentage presets configured
- **THEN** the panel shows none, and the keypad and units are unaffected

### Requirement: Discounts read as rows in the bill column, saying what they were

Each discount SHALL appear in the bill column alongside the items, as a row
carrying its reduction and a subtext naming what it applied to.

A menu discount row SHALL name its basis and value, and its subtext SHALL name the
categories it covered. Where one value covers several categories they SHALL be
combined into one row listing them. Where it covers every category in the outlet's
menu the subtext SHALL say so as a single phrase rather than listing them. Where
different values apply, each SHALL have its own row.

A discount applied to the bill SHALL say so in its subtext.

A menu discount row SHALL carry no control to change or remove it. A bill discount
row SHALL carry an edit control, which reopens the panel on that discount, and a
delete control.

The rounding SHALL appear as its own row, below the discounts and above the total.

#### Scenario: One value over two categories

- **WHEN** one menu discount covers two categories and lines from both are on the
  bill
- **THEN** one row appears, and its subtext names both categories

#### Scenario: Two values over different categories

- **WHEN** two menu discounts at different values each reach lines on the bill
- **THEN** two rows appear, each naming its own value and its own categories

#### Scenario: The whole menu is discounted

- **WHEN** a menu discount covers every category in the outlet's menu
- **THEN** its row's subtext says so as one phrase rather than listing every
  category

#### Scenario: A biller reconsiders their own discount

- **WHEN** a biller taps edit on a discount they applied to the bill
- **THEN** the panel reopens carrying that discount's value and unit, and
  confirming replaces it rather than adding another

### Requirement: A bill's receipt is sent or opened from the bill itself

> Restated by `a-receipt-goes-out-on-whatsapp`. #54 built one Share control. The
> owner used it almost only to reach the link, and wanted a customer's own bill
> sent to the number already on it. Automatic SMS delivery (#59) has since
> shipped beside it, and Send receipt remains the manual way to send.

An expanded bill in Billing history SHALL offer **exactly one receipt action**,
for the Super Admin and the Franchise Admin, positioned in the same action row as
the cancellation control and **before** it in reading order, with the
cancellation control at the row's far end.

The receipt action SHALL be **Send receipt** where the bill's customer phone
normalises to a canonical Indian mobile number, and **Open receipt** otherwise.
A bill SHALL NOT offer both. A phone value that does not normalise SHALL be
treated as no number, never corrected into a guess.

The receipt action SHALL be offered only for a bill that is not void and that has
a receipt link, and SHALL NOT be offered on the counter tablet, which shows a
receipt in the app instead and sends, opens and shares nothing.

The action SHALL read a link that already exists rather than creating one, and
SHALL grant no visibility a role did not already hold: a role SHALL be able to
act only on a bill it can already read, and never another outlet's.

#### Scenario: A bill with the customer's number

- **WHEN** the Super Admin expands a settled bill whose customer phone is
  `+919876543210`
- **THEN** Send receipt is offered before the cancellation control, Open receipt
  is not, and the cancellation control sits at the right-hand end of the row

#### Scenario: A bill with no number

- **WHEN** a settled bill carrying no customer phone is expanded
- **THEN** Open receipt is offered, Send receipt is not, and following it opens
  that bill's receipt page outside the app

#### Scenario: A legacy number that is not a mobile

- **WHEN** a bill rung before customer identification carries a phone value that
  does not normalise
- **THEN** Open receipt is offered and no WhatsApp link is built from the value

#### Scenario: A franchise admin and another outlet

- **WHEN** a Franchise Admin uses Billing history
- **THEN** they may act on bills at their own outlet only, because those are the
  only bills the surface shows them

#### Scenario: A cancelled bill

- **WHEN** a void bill is expanded
- **THEN** no receipt action and no cancellation control are offered, and any
  link already issued for it continues to resolve and reports the cancellation

#### Scenario: A bill the server has not accepted

- **WHEN** a bill without a receipt link is expanded
- **THEN** no receipt action is offered and the cancellation control still sits
  at the right-hand end of the row

### Requirement: The customer is identified from one control that opens a keypad

At outlets collecting details, the composer SHALL present optional customer
identification as one control, rather than separate name and phone inputs,
reading in three states: nothing chosen, a customer chosen or deliberately
skipped. It SHALL show a chosen customer's name and canonical phone. There SHALL
be no separate action beside it; tapping SHALL reopen the dialog, and accepting
a different number or skipping there SHALL revise the choice.

Where the chosen customer holds membership, the control SHALL carry the member
mark, and the dialog SHALL carry it on a resolved match or partial-number
suggestion before acceptance.

The dialog SHALL carry an on-screen numeric keypad in the tender-capture idiom.
It SHALL NOT offer a search button; entry alone SHALL suffice. The composer
SHALL NOT add a sentence instructing the biller to enter a customer or disable
ordering to force use of the control.

#### Scenario: The biller opens the control
- **WHEN** the customer control is tapped
- **THEN** a dialog opens with a numeric keypad and an empty number readout

#### Scenario: A member is resolved in the dialog
- **WHEN** a complete phone matches a customer holding membership
- **THEN** the match carries the member mark before acceptance, without a date, actor or figure

#### Scenario: A member is suggested from a partial number
- **WHEN** a partial number suggests a member this outlet has served
- **THEN** the suggestion carries the member mark, without a date, actor or figure

#### Scenario: A chosen customer is changed
- **WHEN** the biller taps the chosen customer's control
- **THEN** the dialog reopens, and the choice changes only on accepting another number or skipping

#### Scenario: The number is entered without a system keyboard
- **WHEN** the biller enters a number in the dialog
- **THEN** every digit can be entered from its on-screen pad without a device keyboard

### Requirement: Skipping customer identification is deliberate and takes one tap

The dialog SHALL offer a skip that records no customer facts at all. The order
SHALL then be identified by its order number, which is what the preparation
pipeline and the shift's bill list display for it.

Skip SHALL be reachable only from inside the dialog, and SHALL NOT appear as a
control on the composer beside the customer row.

Skipping SHALL NOT prompt for a reason, SHALL NOT require an approval, and SHALL
NOT be limited in number.

#### Scenario: A customer gives no number
- **WHEN** the biller skips
- **THEN** the order is accepted carrying no customer name and no phone, no customer record is created, both terminal actions become available, and the preparation card identifies the order by its order number

#### Scenario: An order rung before this change is reopened
- **WHEN** an order carrying a name but no phone is reopened at the counter
- **THEN** the name it was rung under is preserved unchanged, and nothing about it identifies a customer or creates a record

#### Scenario: Skip is not reachable from the composer
- **WHEN** the composer is displayed with a bill in progress
- **THEN** no control on it skips customer identification without opening the dialog first

### Requirement: Send receipt opens WhatsApp on the bill's own number with the message typed

Send receipt SHALL be a link to `https://wa.me/` followed by the bill's canonical
phone without its `+`, carrying a prefilled message as its `text` parameter. The
message SHALL name the bill number and its total, formatted from integer paise by
the one money formatter, and SHALL end with the receipt link on its own line. It
SHALL carry no offer, no points prompt and no customer name.

Following it SHALL NOT send anything by itself. The message SHALL be sent only by
the person, from within WhatsApp.

The link SHALL open outside the app in a new browsing context and SHALL NOT pass
the app's address as a referrer.

Send receipt SHALL be outlined like the cancellation control, with WhatsApp's
mark and its label in a WhatsApp green that passes AA in both themes, read from
semantic tokens.

#### Scenario: The link and the message

- **WHEN** bill 1489, totalling 26000 paise, with phone `+919876543210` and
  receipt link `https://shawarmania.in/bill/abc`, offers Send receipt
- **THEN** its link is `https://wa.me/919876543210?text=` followed by the encoded
  message, whose last line is `https://shawarmania.in/bill/abc` and which names
  `1489` and `₹260`

#### Scenario: Nothing is sent by following it

- **WHEN** the owner follows Send receipt
- **THEN** WhatsApp opens on that number's chat with the message in the compose
  field, and nothing is sent until the owner sends it

### Requirement: Open receipt opens the receipt page outside the app

Open receipt SHALL be a link to the bill's receipt URL, opening in a new browsing
context without a referrer. It SHALL NOT offer a share sheet, write to the
clipboard, or reveal the link as text. On an installed app the platform decides
the browsing context, and on Android that is a Chrome Custom Tab.

#### Scenario: Opening a receipt

- **WHEN** the owner follows Open receipt on a bill with no number
- **THEN** that bill's receipt page opens outside the app, and the app stays where
  it was

### Requirement: A demonstration bill behaves as a real one

> The owner decided on 2026-09-30 that demo mode works exactly as production
> here. Following Send receipt sends nothing, so opening WhatsApp on a demo
> customer's number is as safe as opening it on a real one.

Where a bill's receipt link is a demonstration link, the receipt action SHALL be
chosen and SHALL behave exactly as for any other bill: Send receipt SHALL link to
WhatsApp on the bill's number with the message typed, and Open receipt SHALL link
to the receipt URL. A note SHALL say that the receipt link will not open, because
the bill behind it is invented. Whether a bill is a demonstration SHALL be read
from its receipt link, never from the session.

#### Scenario: Demo mode

- **WHEN** a demo bill carrying a demo customer's phone is expanded
- **THEN** Send receipt links to `wa.me` with that number and the message whose
  last line is the demo receipt link, and the note says the link will not open

### Requirement: The counter shows a bill's receipt without leaving the app

> Added 2026-09-30. #54 kept a share affordance off the counter tablet because the
> tablet is shared hardware in a shop. This requirement hands nothing out: it
> shows a bill the tablet can already read, on its own screen.

An expanded bill in the counter's Bills this shift SHALL offer **View receipt**,
which SHALL open that bill's receipt page in a pop-up inside the app. The page
SHALL be shown in a frame that permits scripts and no same-origin access, form,
pop-up, download or navigation of the app, and SHALL be requested without a
referrer. The pop-up SHALL grow with the receipt, to the height the page reports
from its own frame, up to its ceiling on the screen, and SHALL scroll within
beyond it. Closing the pop-up SHALL return the counter exactly as it was.

View receipt SHALL read the link the bill already carries and SHALL NOT create
one. Where the bill has no link yet, because it has not reached the server, View
receipt SHALL be shown disabled with the reason. A void bill SHALL NOT offer it.
Where the browser reports the tablet offline, the pop-up SHALL say that the
receipt needs the internet instead of showing the frame. Until the page has
loaded, the pop-up SHALL show that it is loading, in the space the receipt will
fill. The page SHALL be requested in its counter view (`view=counter`), which the
receipt site draws for a pop-up (without its download link, among other trims).
While the pop-up is open, the counter behind it SHALL be
blurred so that nothing on it can be read, because the tablet is turned to a
customer and the counter carries other customers' names and totals.

#### Scenario: Waiting for the receipt

- **WHEN** View receipt is opened and the page has not loaded yet
- **THEN** the pop-up says the receipt is loading, and the receipt replaces that
  when it arrives

#### Scenario: Showing a customer their bill

- **WHEN** a biller expands a synced bill in Bills this shift and taps View
  receipt
- **THEN** a pop-up inside the app shows that bill's receipt page, and the
  counter is unchanged once it is closed

#### Scenario: A link on the receipt

- **WHEN** anything on the receipt that is a link is tapped inside the pop-up
- **THEN** nothing opens or downloads and the tablet stays in the app

#### Scenario: A short receipt and a long one

- **WHEN** a receipt shorter than the screen is shown
- **THEN** the pop-up is as tall as the receipt, with no gap beneath it
- **WHEN** a receipt taller than the pop-up's ceiling is shown
- **THEN** the receipt scrolls inside the pop-up while its header and Close stay
  in place

#### Scenario: A height that is not from the receipt

- **WHEN** a height message arrives from anything but the pop-up's own frame, or
  carries something that is not a sensible number of pixels
- **THEN** the pop-up ignores it

#### Scenario: A bill still in the outbox

- **WHEN** a bill rung offline has not reached the server
- **THEN** View receipt is disabled and says the receipt appears once the bill
  syncs

#### Scenario: Offline

- **WHEN** View receipt is opened while the tablet is offline
- **THEN** the pop-up says the receipt needs the internet and shows no frame

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

### Requirement: The counter's header says when the kitchen is offline

The counter's header SHALL show its status as one segmented control: *Kitchen
offline*, in words, while the outlet has at least one kitchen tablet set up and none
of them holds a live kitchen shift; the sync state; and the time the shift opened.
An outlet with no kitchen tablet SHALL never be shown *Kitchen offline*. The counter's
read of its kitchens SHALL therefore also say how many kitchen tablets the outlet
has set up.

#### Scenario: The kitchen tablet's shift ends

- **WHEN** an outlet's only kitchen tablet has no live kitchen shift
- **THEN** the counter's header reads *Kitchen offline*, and no rail card shows a bell

#### Scenario: An outlet without a kitchen screen

- **WHEN** an outlet has no kitchen tablet set up
- **THEN** the counter's header never reads *Kitchen offline*

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

### Requirement: The rail's cards are tickets

Cards SHALL retain the torn ticket edge and prominent display-face order number.
Dish quantities SHALL remain visible separately from fixed checkboxes. A one-dish
card SHALL remain compact at approximately nine rem or less, without stretching
to a taller neighbour. Independent kitchen slots SHALL fit between the total
and overflow control without enlarging the card or adding an ACK-dot cluster.

#### Scenario: Compact independent cards

- **WHEN** a short one-dish ticket sits beside a noted multi-dish ticket
- **THEN** it keeps its own compact height, and the next card fills the space below it

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

Each open order on the billing history's Orders tab SHALL show, compactly: its
number, label and total; when it was ordered and how long ago, who rang it, and
its table or takeaway; whether it is paid; each kitchen's answer in words (sent,
seen, ready, served); each dish with its quantity, note and price in one of four
states — placed, acknowledged, Done, handed over — in the counter's marks (✓, ✓✓,
the bell, a ticked box), each named on hover and to a screen reader; and the
customer on one line beside Cancel order. A dish SHALL read acknowledged only when
every kitchen still owing it has acknowledged at least what it owes. The kitchens'
answers SHALL come from a read that only the owner and that outlet's franchise
admins may make. Opening the page SHALL only count the open orders; choosing the
Orders tab, or tapping it again, SHALL read the orders and their kitchens afresh,
never on a timer; if the kitchens' read fails the orders SHALL still list.

#### Scenario: The owner checks an order from away

- **WHEN** the owner opens the Orders tab while Kitchen 1 has acknowledged one dish of an unpaid order, marked another Done and the counter has handed over a third
- **THEN** the card says Not paid and Kitchen 1 · ready, and the three dishes show ✓✓, the bell and a ticked box

#### Scenario: Another outlet's manager cannot read these kitchens

- **WHEN** a franchise admin of another outlet asks for this outlet's kitchens
- **THEN** the read is refused, as reading its orders is

### Requirement: The counter draws its own saves before the server answers

Every change this tablet saves to an order or a bill SHALL be on screen as soon
as the tablet has saved it, drawn from the tablet's own record, and SHALL NOT
wait for a server response. This covers an edited order's card, a payment's bill
in Bills this shift (from Pay now or from a rail card) with the shift's cash and
UPI totals, a corrected tender, a payment taken back (its order back on the
rail), and an order cancelled after payment.

Each save SHALL cause the one server read it would cause without the drawing,
and no more. A read that began before a save SHALL NOT draw the rail or Bills
without that save. When the server's read arrives, it SHALL replace what was
drawn.

#### Scenario: Save on a slow connection

- **GIVEN** an order with two dishes is open for edit
- **WHEN** the biller adds a third dish and presses Save while the server has not answered
- **THEN** the order's card shows all three dishes and the new total at once

#### Scenario: Pay now on a slow connection

- **GIVEN** the server has not answered
- **WHEN** the biller settles a bill with Pay now
- **THEN** the bill is in Bills this shift at once with the awaiting shape of its number, and the cash or UPI total includes it

#### Scenario: Taking a payment back from Bills

- **GIVEN** the server has not answered
- **WHEN** the biller takes back a paid order's payment from Bills this shift
- **THEN** the bill shows as taken back and the order is back on the rail, unpaid, at once

#### Scenario: An older read lands after a save

- **GIVEN** a rail read began before the biller pressed Order
- **WHEN** that read's answer arrives after the order was drawn
- **THEN** the new order's card stays on the rail throughout

#### Scenario: The counter makes no extra requests

- **WHEN** an idle counter, an ACK and a payment are measured with every gate on
- **THEN** their requests are within the request budget, unchanged by this requirement

### Requirement: A re-read that fails after a save does not report the save as failed

A save's confirmation SHALL stand once the tablet has saved it, and a failure of
the server read that follows SHALL NOT replace it with the save's failure words.
A server read of Bills this shift that fails while the panel shows a list SHALL
keep the list and SHALL show no error; the panel SHALL say it could not load the
shift only when it has nothing to show.

#### Scenario: Take back, then the re-read fails

- **WHEN** the biller takes back a payment and the server read that follows fails
- **THEN** the panel says the payment was taken back, and does not say the item could not be resolved

#### Scenario: Bills keeps its list when the server fails

- **GIVEN** Bills this shift shows the shift's bills
- **WHEN** a re-read of the shift fails
- **THEN** the bills stay on screen with no error message

### Requirement: The table picker opens on the tables the counter already knows are busy

Opening the table picker SHALL mark busy every table held by an order the tablet
already holds, without waiting for a server response, and SHALL then correct
itself from the server's read.

#### Scenario: A table taken a moment ago

- **GIVEN** an order for table 4 was just saved on this tablet while the server has not answered
- **WHEN** the biller opens the table picker for the next order
- **THEN** table 4 is marked busy

### Requirement: The Stats tab reads the chosen day

Billing history's third tab SHALL be named Stats. It SHALL show, for the
selected outlet and business day and from one read, three groups stacked one
below the other, each a single card divided into a 2 × 2 grid with each number
above its caption: Counter (Placed, Updated, Cancelled, Paid), Kitchen (Seen,
Ready, Avg to ready, Avg handover) and Bills (Bills cancelled, Cancelled after
paid, Payment undone, Payment changed). Placed SHALL count the day's orders;
Updated those with at least one accepted revision, counted once per order;
Cancelled and Paid those in that state; Seen those a kitchen acknowledged; Ready
those with a live kitchen Ready mark. Avg to ready SHALL average the last live
Ready less the order time, and Avg handover the counter's Prepared mark less the
last live Ready, each over the orders it can be measured on, excluding orders the
day change finished; an average with nothing to average SHALL read as a dash.
The Bills figures SHALL count the day's bills cancelled by a manager (legacy
cancellations included), cancelled after payment at the counter, whose payment
the counter undid, and whose tender was corrected, each bill once. The groups
SHALL NOT be drawn as the tiles that carry the day's Cash, UPI, Total and AOV.

Above the groups a sync chip SHALL report the tablets' sync: in sync with the
age of the outlet's newest received command, which SHALL be independent of the
selected day, or the number of sync problems with each problem listed beneath in
plain words, naming its order where the refusal named one and saying where a
resend cannot help. The sync problems SHALL be every refused command the outlet
received on the selected business day, through the outlet's cutover, however
many commands that day received — never a fixed count of the newest commands. It
SHALL show no technical-details disclosure, payload or customer detail. The tab
label SHALL carry the selected day's problem count in parentheses, coloured as a
warning, only while it is above zero.

The figures, the sync problems and the day's Cash, UPI, Total and AOV SHALL
arrive in one read when the page opens or the day changes, so choosing the Stats
tab SHALL read nothing.

The read SHALL answer the owner and that outlet's franchise admins and refuse
everyone else, including a manager's crafted request for another outlet.

#### Scenario: A busy day is counted whole
- **WHEN** a manager opens Stats on a day with more than a hundred tablet commands
- **THEN** every figure counts that whole day's orders and bills, matching a count of the day's rows

#### Scenario: A past day
- **WHEN** a manager steps the day bar back a week while Stats is open
- **THEN** the three groups and the sync problems read that day's, and the chip's in-sync age still speaks for now

#### Scenario: An order goes to two kitchens
- **WHEN** one kitchen marks its part Ready at 12:04 and the other at 12:09, and the counter marks the order prepared at 12:11
- **THEN** the order counts once under Ready, its time to ready runs to 12:09, and its handover is two minutes

#### Scenario: Nothing to average
- **WHEN** no order of the day was marked Ready
- **THEN** Avg to ready and Avg handover read a dash, not zero

#### Scenario: A refusal waits
- **WHEN** a tablet command was refused
- **THEN** the tab reads Stats (1) with the count as a warning, and the chip names the problem and the order it concerned

#### Scenario: A lunchtime refusal is still there in the evening
- **WHEN** a command was refused at 13:00 and the outlet's tablets sent 600 more commands before 21:00
- **THEN** at 21:00 that day the tab still reads Stats (1) and the chip still lists the refusal

#### Scenario: A past day's refusals
- **WHEN** a manager steps back to a day on which one command was refused, while today has none
- **THEN** the tab reads Stats (1), the chip lists that day's refusal, and stepping back to today clears the count

#### Scenario: Stats opens without a read
- **WHEN** a manager chooses the Stats tab after the page has opened
- **THEN** the figures and the chip show at once and no request is made

#### Scenario: Another outlet is asked for
- **WHEN** a franchise admin requests the stats of an outlet they do not manage
- **THEN** the read is refused
