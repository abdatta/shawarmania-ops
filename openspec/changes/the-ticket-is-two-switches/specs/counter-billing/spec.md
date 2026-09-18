## MODIFIED Requirements

### Requirement: The right rail is the preparation pipeline

The activity column SHALL present this outlet's unfinished work as **one
list** — not as sections — ordered newest order first, holding every order that
is not yet both prepared and paid. There SHALL be no divider, no section
heading, no band, and no informational bar inserted when an action lands. An
order's place in the list SHALL be decided by when it was taken and by nothing
else: recording preparation or payment SHALL NOT move a card. The list SHALL
cover the whole outlet, showing the creator's name when another operator took
the order and the till when another till did. A paid order whose preparation is
not yet recorded SHALL remain in the list, because its food is still owed. An
order SHALL leave the list only when it is both prepared and paid.

The list SHALL scroll as one and SHALL announce the work outside its viewport:
when orders are clipped above, a control SHALL float at the top edge saying how
many and scrolling to the newest order when activated; when orders are clipped
below, the same SHALL appear at the bottom edge for the oldest. Each control
SHALL appear only while orders are actually clipped in its direction. The
bottom control SHALL additionally carry a non-textual marker whenever any order
hidden below it is prepared and still unpaid, so preparation waiting for money
is never invisible.

Saving an order SHALL return the list to its newest end, so the order just
taken is on screen.

#### Scenario: An order lands at the top of the list

- **WHEN** an operator saves an order
- **THEN** it appears at the newest end of the list immediately, without waiting for delivery, and the list is scrolled to show it

#### Scenario: Marking prepared moves nothing

- **WHEN** the operator marks an order prepared
- **THEN** the card stays exactly where it is and only its controls change appearance

#### Scenario: Unmarking prepared moves nothing either

- **WHEN** the operator un-marks a prepared unpaid order
- **THEN** the card stays where it is and its preparation control returns to unchecked

#### Scenario: The upfront payer stays visible

- **WHEN** an order is paid before being marked prepared
- **THEN** it stays in the list with its payment control checked and no bill created, and marking it prepared settles it into Bills

#### Scenario: Both states recorded ends the ticket

- **WHEN** the second of preparation and payment is recorded
- **THEN** the card leaves the list and lands in Bills this shift

#### Scenario: Orders above and below the fold are announced

- **WHEN** the list holds more orders than its viewport shows
- **THEN** a control at the clipped edge says how many are hidden there and scrolls to that end when activated, and it is absent when nothing is clipped in that direction

#### Scenario: Money waiting out of sight is marked

- **WHEN** an order hidden below the viewport is prepared and unpaid
- **THEN** the bottom control carries its marker, and the marker is absent when no hidden order is waiting for money

#### Scenario: Another tablet's order is on the board

- **WHEN** a second billing device at the outlet saves an order
- **THEN** it appears in the same list with its creator named

### Requirement: The counter is one three-column workspace at every width

The counter SHALL render three touch-safe columns at **every** width: the
tappable menu, a middle column that holds **Bills this shift** by default and
gives way to the current-bill composer while an order is being composed or
edited, and one continuous activity column holding the preparation pipeline as a
single list. Each column SHALL scroll internally and SHALL NOT move the
composer's controls off screen.

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

#### Scenario: All unfinished work shares one list

- **WHEN** a biller uses the counter at landscape-tablet width
- **THEN** every unfinished order stands in one continuous right column with no divider and no bill list in that column

#### Scenario: The workspace is wider than the screen

- **WHEN** the viewport is narrower than three columns and their gaps
- **THEN** all three columns keep their width and the workspace scrolls sideways, with the composer's controls reachable by scrolling to that column rather than by navigating

#### Scenario: Spare width

- **WHEN** the viewport is wider than three columns need
- **THEN** the extra width goes to the menu, and the middle and activity columns stay equal to one another

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

## ADDED Requirements

### Requirement: A pipeline card states both of its answers in two fixed controls

A pipeline card SHALL show its reference with the number part in the brand's
bright primary colour, one meta line — customer name when present, relative age,
creator when another operator took the order, till when another till did — the
total prominent at the right, and complete untruncated item lines with bold
quantity prefixes. Per-line prices SHALL NOT appear on a pipeline card. A
one-item card SHALL stand no taller than about 120px so at least six fit the rail
at landscape tablet height without scrolling. Item names SHALL never truncate.

Beneath that, every card SHALL carry exactly two state controls, **Prepared**
then **Paid**, in that order and at equal width, on every card in every state.
Neither control SHALL be reordered, resized, renamed or withheld because of the
order's state: the words **Prepared** and **Paid** SHALL be the only words those
controls ever read, and the interface SHALL contain no Reprepare and no Un-pay.

Each control SHALL draw a checkbox stating whether that fact is recorded. An
unrecorded fact SHALL draw an unchecked box in its own colour on an otherwise
ordinary secondary control — preparation in the brand primary, payment in the
success colour. A recorded fact SHALL fill its control with that colour and draw
the checked box and its mark in that control's own foreground token, so the mark
stays legible on the fill in both themes. Recorded and unrecorded SHALL differ in
**shape** as well as colour. No separate paid badge SHALL be drawn, because the
checked payment control already says it.

Activating an unchecked payment control SHALL open the tender dialog, and the
control SHALL become checked only once payment is recorded. Activating a checked
payment control SHALL open the reasoned take-back confirmation. Activating either
preparation state SHALL record it directly.

Where a fact cannot be changed from this tablet — which in the pipeline means
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

#### Scenario: Recording preparation changes only the card's appearance

- **WHEN** the operator checks Prepared
- **THEN** that control fills with the preparation colour and shows a checked box, the payment control is untouched in place and wording, and no badge appears

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
- **THEN** both controls are drawn as statements without control chrome rather than as dimmed controls, and the card names the till

#### Scenario: State survives without colour

- **WHEN** the two controls are compared without relying on hue
- **THEN** checked and unchecked differ by the shape inside the box

#### Scenario: Rare actions keep their safety

- **WHEN** the operator opens a card's overflow menu
- **THEN** each action is a labelled row at least 40px tall, and cancellation still requires its reasoned confirmation

#### Scenario: A paid order cannot be edited

- **WHEN** the operator opens the overflow of a paid card
- **THEN** Edit is absent or refused with guidance to take the payment back first, and the composer cannot load a paid order's lines for revision

### Requirement: Only a finished ticket travels

A card SHALL NOT be animated from one place to another within the pipeline list,
because recording preparation or payment no longer moves it. When an order
becomes both prepared and paid, its card SHALL fly from its position in the list
into the bills column, which SHALL first show a shimmer placeholder sized to the
arriving card, while the space it left collapses and its siblings settle without
jumping. The flight SHALL complete within about 300ms, SHALL be driven by the
same state change however it originated — local tap, another tablet, or a
manager's action — and SHALL coalesce rapid successive moves rather than queuing
them. Under a reduced-motion preference the flight SHALL be replaced by a simple
crossfade, and no position shall depend on the animation having run. Loading
shimmers SHALL reserve the shape of the redesigned cards.

#### Scenario: Recording one fact animates nothing

- **WHEN** the operator records preparation or payment and the order is not yet both
- **THEN** no card flies anywhere and the list does not reflow

#### Scenario: Settlement flies left

- **WHEN** the second of preparation and payment is recorded
- **THEN** the card travels into the bills column, which had shown a placeholder for it, and the shift totals update

#### Scenario: Reduced motion

- **WHEN** the system requests reduced motion
- **THEN** the settlement crossfades without flight and lands in an identical final position

### Requirement: Finish Day refuses while food is owed on a paid order, and otherwise closes the window

Finish Day SHALL refuse while any order at this tablet's business date is **paid
and not marked prepared**, and SHALL name that work in the biller's words rather
than counting it among open orders or among recent payments. Closing a day while
a paying customer is still owed food is wrong on its own terms, and an
open-ended edit window behind a confirmed day would let money move after the
figures were settled.

Finishing the day SHALL otherwise proceed immediately, **ending any open payment
edit window early** rather than refusing until it elapses. No guard SHALL refuse
the day close on the grounds that a payment is still editable. After the day is
finished, taking a payment back, cancelling after payment and correcting a tender
SHALL all be refused by the database, and that refusal SHALL be proved by a
hand-crafted request rather than assumed from the absence of a live shift.

#### Scenario: A paying customer is still owed food

- **WHEN** an operator opens Finish Day with one order paid and not marked prepared
- **THEN** the sheet refuses, names that order as paid but not prepared, and points at the pipeline

#### Scenario: A recent payment does not hold the day open

- **WHEN** an operator finishes the day one minute after taking a payment on a finished ticket
- **THEN** the day closes at once and that payment's edit window ends with it

#### Scenario: Nothing moves after the day is closed

- **WHEN** a hand-crafted take-back, cancel-after-paid or tender correction is submitted for a bill whose day has been finished
- **THEN** the database refuses it

## REMOVED Requirements

### Requirement: Pipeline cards are compact tickets with visible next steps

**Successor**: *A pipeline card states both of its answers in two fixed
controls*, above. The removed requirement made the card's band decide its one
primary action, which is the premise this change withdraws: with no bands, there
is no section to decide anything, and the card states both facts instead of
shouting one next step. Everything it said about the ticket's contents — the
coloured reference, the single meta line, untruncated item lines, no per-line
prices, the ~120px one-item height, the overflow rows — is carried forward
unchanged by the successor.

### Requirement: Stage changes animate between sections

**Successor**: *Only a finished ticket travels*, above. There are no sections to
animate between. The settlement flight into Bills, its placeholder, its 300ms
budget, its coalescing and its reduced-motion crossfade are carried forward
unchanged; the Preparing-to-Unpaid-Prepared flight is deleted along with the
bands it connected.
