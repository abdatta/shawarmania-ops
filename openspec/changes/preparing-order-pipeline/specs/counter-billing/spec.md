## ADDED Requirements

### Requirement: The right rail is the preparation pipeline

The activity column SHALL present this outlet's unpaid work as two labelled
sections of one continuous rail: **Preparing**, holding saved orders not yet
marked prepared, then a labelled divider, then **Unpaid Prepared Orders**,
holding prepared orders awaiting payment. Both sections SHALL list the whole
outlet's orders, showing the creator's name when another operator took the
order. A paid order whose preparation is not yet recorded SHALL remain in
Preparing wearing a Paid marker, because its food is still owed. An order
SHALL enter Bills only when prepared and paid.

#### Scenario: An order lands in Preparing

- **WHEN** an operator saves an order
- **THEN** it appears in Preparing immediately, without waiting for delivery

#### Scenario: Marked prepared moves it down the rail

- **WHEN** the operator marks a preparing order prepared
- **THEN** it leaves Preparing and appears in Unpaid Prepared Orders

#### Scenario: Reprepare returns it

- **WHEN** the operator reprepares an unpaid prepared order
- **THEN** it returns to Preparing

#### Scenario: The upfront payer stays visible

- **WHEN** an order is paid before being marked prepared
- **THEN** it remains in Preparing marked Paid, and marking it prepared moves it into Bills

#### Scenario: Another tablet's order is on the board

- **WHEN** a second billing device at the outlet saves an order
- **THEN** it appears in the same pipeline with its creator named

### Requirement: Pipeline cards are compact tickets with one primary action

A pipeline card SHALL show one meta line — customer name when present,
reference, relative age, creator when another operator took the order — with
the total prominent at the right, complete untruncated item lines with bold
quantity prefixes, and exactly one primary action naming the section's next
step: **Mark prepared** in Preparing, **Mark paid** in Unpaid Prepared Orders.
Per-line prices SHALL NOT appear on a pipeline card; line amounts remain
available in the composer and on the bill. All uncommon actions SHALL sit
behind one overflow control presenting touch-safe labelled rows: Edit and
Cancel always on an unpaid card, Reprepare only on an unpaid prepared card,
and on a paid card within its window Un-pay and Cancel after paid instead of
Edit, which SHALL be unavailable once an order is paid. A one-item card SHALL
stand no taller than about 120px so at least six fit the rail at landscape
tablet height without scrolling. Item names SHALL never truncate.

#### Scenario: The section's next step is the big button

- **WHEN** a biller reads a Preparing card and an Unpaid Prepared card side by side
- **THEN** the first offers Mark prepared as its primary action and the second Mark paid

#### Scenario: Rare actions keep their safety

- **WHEN** the operator opens a card's overflow menu
- **THEN** each action is a labelled row at least 40px tall, and cancellation still requires its reasoned confirmation

#### Scenario: A paid order cannot be edited

- **WHEN** the operator opens the overflow of a paid card
- **THEN** Edit is absent or refused with guidance to take the payment back first, and the composer cannot load a paid order's lines for revision

### Requirement: Stage changes animate between sections

When an order moves between Preparing, Unpaid Prepared Orders and Bills, its
card SHALL fly from its origin position to its destination while the origin
collapses and the destination first shows a shimmer placeholder sized to the
arriving card, so space visibly opens at both ends and siblings settle without
jumping. The animation SHALL complete within about 300ms, SHALL be driven by
the same state change however it originated — local tap, another tablet, or a
manager's action — and SHALL coalesce rapid successive moves rather than
queuing them. Under a reduced-motion preference the flight SHALL be replaced by
a simple crossfade and no position shall depend on the animation having run.
Both columns' loading shimmers SHALL reserve the shapes of the redesigned
cards.

#### Scenario: Marking prepared animates downward

- **WHEN** the operator marks an order prepared
- **THEN** its card lifts out of Preparing, flies into Unpaid Prepared Orders past a placeholder that collapses on arrival, and the remaining cards glide closed

#### Scenario: Payment flies left

- **WHEN** an order is paid from the rail
- **THEN** its card travels into the bills column, which had shown a placeholder for it, and the shift totals update

#### Scenario: Reduced motion

- **WHEN** the system requests reduced motion
- **THEN** stage changes crossfade without flight and land in identical final positions

### Requirement: A payment can be taken back within five minutes

On the originating tablet, within five minutes of the bill's stored `paid_at`,
the operator SHALL be able to take the payment back through a reasoned
confirmation: the bill becomes void and stops counting in shift totals, the
order reopens with its preparation state preserved, and its card returns to
whichever section it came from. The confirmation SHALL name the amount and
tender being taken back. After the window the action SHALL disappear from the
interface and be refused by the database.

#### Scenario: Wrong tender, taken back

- **WHEN** the operator takes back a Cash payment within the window
- **THEN** the bill reads void with kind `counter_unpay`, shift cash drops by its amount, and the order card stands ready to be paid again correctly

#### Scenario: The window has closed

- **WHEN** the operator opens a paid card's actions after five minutes
- **THEN** no take-back action is offered, and a hand-crafted command is refused by the database

### Requirement: Cancelling after payment warns before it unwinds money

Cancelling an order that has already been paid SHALL require a confirmation
that names the amount and tender taken and states plainly that the money goes
back out of the drawer, before accepting a non-blank reason. Confirming SHALL
void the bill with kind `cancelled_after_paid` and cancel the order in one
action. The cancelled order SHALL leave the pipeline and remain reviewable with
actor, time and reason.

#### Scenario: A paid takeaway is cancelled

- **WHEN** the operator cancels a ₹389 Cash order after paying it, inside the window
- **THEN** the dialog warned that ₹389 in Cash goes back to the customer, and confirming voids the bill and cancels the order together

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

## MODIFIED Requirements

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

### Requirement: The counter is one three-column workspace at every width

The counter SHALL render three touch-safe columns at **every** width: the
tappable menu, a middle column that holds **Bills this shift** by default and
gives way to the current-bill composer while an order is being composed or
edited, and one continuous activity column holding the preparation pipeline —
Preparing, then a labelled divider, then Unpaid Prepared Orders. Each column
SHALL scroll internally and SHALL NOT move the composer's controls off screen.

The middle and activity columns SHALL be the same width as each other, and
spare width SHALL go to the menu. Below the width three columns need, the
workspace SHALL **scroll horizontally** rather than rearrange: no column SHALL
fold into a tab, a route or a disclosure. The page itself SHALL NOT scroll
horizontally — only the workspace. Menu tiles SHALL be laid out against the
width of their own column rather than the viewport's.

#### Scenario: The middle column shows settled money

- **WHEN** a biller uses the counter with nothing being composed
- **THEN** the middle column shows this shift's method totals above its collapsed bills

#### Scenario: Composing replaces, then restores

- **WHEN** the biller taps a menu item, completes or abandons the order
- **THEN** the composer holds the middle column meanwhile and Bills this shift returns afterwards

#### Scenario: Open and closed work share one rail

- **WHEN** a biller uses the counter at landscape-tablet width
- **THEN** Preparing sits above Unpaid Prepared Orders in one continuous right column, separated by a labelled divider, with no bill list in that column

#### Scenario: The workspace is wider than the screen

- **WHEN** the viewport is narrower than three columns and their gaps
- **THEN** all three columns keep their width and the workspace scrolls sideways, with the composer's controls reachable by scrolling to that column rather than by navigating

#### Scenario: Spare width

- **WHEN** the viewport is wider than three columns need
- **THEN** the extra width goes to the menu, and the middle and activity columns stay equal to one another

### Requirement: A saved order enters the preparation pipeline

On saving, the surface SHALL put the order directly into Preparing, where its
complete quantity-and-item lines SHALL be the primary information, followed by
the customer name when one exists and the prominent total. Its order number
SHALL remain visible as a secondary reference until payment or cancellation.
The surface SHALL NOT add a separate latest-order card that can represent only
one of several rapid orders. The order number SHALL be visually distinct from a
bill number wherever both could be seen.

#### Scenario: The order is saved

- **WHEN** an order is accepted
- **THEN** its preparation items and total appear immediately in Preparing, its customer is shown when known, and its order number remains available as a small reference

#### Scenario: The order is paid

- **WHEN** an order becomes a paid bill
- **THEN** the bill number identifies it from that point and the two numbers are never presented as interchangeable

### Requirement: Pipeline orders remain editable until they are paid

The pipeline SHALL list this outlet's unpaid orders, each with its reference,
age, optional customer, complete quantity-and-item lines and total. Items SHALL
NOT be truncated or collapsed because these lists are preparation work. Any
operator holding the owning tablet's live shift SHALL reopen and change lines,
quantities and customer form values until payment or cancellation. No discount
control SHALL appear. The original order time and business date SHALL remain
visible and unchanged. On the combined tablet workspace, edit SHALL use the
same menu and composer used for a new order, overlaying the bills column. Any
in-progress new-order draft SHALL be restored exactly after the edit is saved
or cancelled. Once an order is paid, revision SHALL close for it everywhere.

#### Scenario: Staff scans work to prepare

- **WHEN** a pipeline order contains several different items and has a customer name
- **THEN** every item and quantity is readable without expansion, the customer and total are prominent, and the card labels its reference as Order # followed by the number

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

#### Scenario: Paid closes revision
- **WHEN** an order has been paid and someone attempts to revise it
- **THEN** the attempt is refused and the interface offers no editable copy of it

### Requirement: Live open-order actions stay on the tablet that took the order

Ordinary edit, payment, cancellation and preparation of an order SHALL be
available only on the tablet that owns it, to any operator holding its live
shift. Clearing an order stranded on an unavailable tablet SHALL be an ordinary
reasoned cancellation by that outlet's manager, and no transfer or recovery
path SHALL exist. Cards across the pipeline SHALL label secondary numbers as
Order #, show complete item lines, use relative age for today's order, and omit
the creator when the current shift holder took the order. The payment action
SHALL read Mark Paid and the preparation action Mark prepared.

#### Scenario: Another operator uses the same tablet
- **WHEN** a different operator's shift begins on the order's tablet
- **THEN** they may prepare, edit, pay or cancel it and the action is attributed to them

#### Scenario: The tablet is unavailable
- **WHEN** an order remains open at an outlet whose tablet cannot be used
- **THEN** the outlet's manager cancels it with a reason from their own device, and nothing is transferred

#### Scenario: Another tablet of the outlet sees but cannot act
- **WHEN** a second billing device at the outlet displays the pipeline and its operator attempts to act on the first tablet's order
- **THEN** the database refuses the command under the owning-tablet rule while the order remains visible with its creator named
