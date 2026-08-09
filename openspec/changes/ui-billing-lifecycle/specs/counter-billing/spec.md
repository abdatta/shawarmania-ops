## ADDED Requirements

### Requirement: The composer supports immediate payment and saving an order

The billing composer SHALL offer Pay now and Save order once at least one line
exists. Pay now SHALL retain the existing single-method fast path. Save order
SHALL create a tablet-owned order without assigning a bill number, and SHALL
clear the composer only after the adapter accepts it. V1 SHALL offer no discount
control, and both paths SHALL carry `discount_paise` as zero.

#### Scenario: Customer pays upfront
- **WHEN** an operator selects one payment method and confirms Pay now
- **THEN** a paid result is created directly, with no order saved first

#### Scenario: No discount is offered
- **WHEN** an operator composes, saves, reopens or pays an order
- **THEN** no discount control appears and the accepted command carries a zero discount

#### Scenario: Food has to be made first
- **WHEN** an operator chooses Save order
- **THEN** the order appears in Open orders with its order number and no bill number

### Requirement: Pay now retains a guaranteed unsent Undo

After local acceptance, a Pay now confirmation SHALL offer Undo for the existing
six-second window and SHALL NOT begin delivery while that action is visible. Undo
SHALL remove the still-unsent command and restore the composer exactly. Once the
window ends or delivery begins, no Undo SHALL appear and correction SHALL require
an attributed manager void plus a new bill.

#### Scenario: Operator undoes Pay now
- **WHEN** the operator uses Undo during the confirmation window
- **THEN** the command is removed before delivery and its lines, customer form and payment method return to the composer

#### Scenario: The Undo window has ended
- **WHEN** the Pay now command becomes eligible for delivery
- **THEN** Undo is absent and the accepted sale cannot be edited in place

### Requirement: A saved order shows its order number where it cannot be missed

On saving, the surface SHALL show the order number prominently enough to be read
aloud across a counter, and SHALL keep it visible on that order everywhere it
appears until it is paid or cancelled. The order number SHALL be visually
distinct from a bill number wherever both could be seen.

#### Scenario: The order is saved
- **WHEN** an order is accepted
- **THEN** its order number is displayed immediately and large enough to be called out

#### Scenario: The order is paid
- **WHEN** an order becomes a paid bill
- **THEN** the bill number identifies it from that point and the two numbers are never presented as interchangeable

### Requirement: Open orders remain editable on the tablet that took them

Open orders SHALL list only orders owned by this tablet, each with its order
number, age, customer label, items and total. Any operator holding the tablet's
live shift SHALL reopen and change lines, quantities and customer form values
until payment or cancellation. No discount control SHALL appear. The original
order time and business date SHALL remain visible and unchanged.

#### Scenario: Incoming operator edits an order
- **WHEN** a different operator's shift begins on the same tablet and they edit its open order
- **THEN** the order keeps its creator and original date while recording the new acting operator

#### Scenario: A manager cancelled it first
- **WHEN** an operator tries to pay an order that the outlet's manager cancelled moments earlier
- **THEN** the attempt stops, states that the order was cancelled and by whom, and creates no bill

### Requirement: Payment finalises the displayed order in one method

An open order SHALL be payable in full through exactly one payment method,
including the aggregator methods used when a rider collects. Successful payment
SHALL show the bill number once known, or state plainly that it is not sent yet
while delivery is pending. No partial, deposit or split payment control SHALL
appear.

#### Scenario: A rider collects an aggregator order
- **WHEN** an operator opens an aggregator order and pays it by that aggregator's method
- **THEN** the order becomes a paid bill with that method and leaves Open orders

#### Scenario: An order is paid after cutover
- **WHEN** an operator pays an order taken before the outlet's cutover
- **THEN** the paid view keeps the order's original business date and shows the payment time separately

### Requirement: Open orders are cancelled with attribution, never deleted

An operator holding the live shift SHALL cancel an open order only after
confirming a non-empty reason. A cancelled order SHALL leave the actionable list
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
running totals by payment method. It SHALL NOT show other shifts, outlet-wide
totals, or another outlet.

#### Scenario: Operator opens My shift
- **WHEN** this tablet has bills from its shift and older outlet bills exist
- **THEN** only the current shift's bills and their method totals appear

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
