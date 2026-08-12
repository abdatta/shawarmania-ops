## ADDED Requirements

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

Shift summaries SHALL show Cash and UPI even when a method's total is zero.

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

## MODIFIED Requirements

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

### Requirement: Counter history is limited to the current shift

My shift SHALL show paid bills belonging to this tablet's current shift and
running totals by payment method. Each bill SHALL be collapsed by default and
expand to immutable item names, quantities, captured unit prices, line totals,
payment facts, total and optional customer snapshot. It SHALL NOT show other
shifts, outlet-wide totals, or another outlet.

Every supported method SHALL remain present in the summary when its total is
zero, so a missing category cannot be confused with zero takings. The supported
methods are Cash and UPI. A shift summary SHALL NOT carry an always-empty Swiggy
or Zomato line, because a method the counter cannot accept reads as takings that
failed to arrive rather than as trade recorded elsewhere.

The list and running totals SHALL include locally accepted payments immediately
and SHALL use each bill's latest effective allocation, including a durably accepted
correction that is still unsent. An eligible expanded bill SHALL carry its relative
`Edit (N min)` or `Edit (N sec)` action without making any other bill fact
editable.

#### Scenario: Operator opens My shift
- **WHEN** this tablet has bills from its shift and older outlet bills exist
- **THEN** only the current shift's bills and their method totals appear

#### Scenario: A supported method has no bills
- **WHEN** this shift has no allocation for Cash or for UPI
- **THEN** both still appear and the unused method shows ₹0

#### Scenario: A withdrawn method is not shown as empty takings
- **WHEN** a shift summary renders
- **THEN** no Swiggy or Zomato line appears at all, rather than appearing at ₹0

#### Scenario: Operator inspects a closed bill
- **WHEN** the operator expands a bill in My shift or the combined tablet rail
- **THEN** its item snapshots, quantities, prices, line totals, payment facts and total appear without exposing another shift

#### Scenario: A tender correction changes shift cash
- **WHEN** an eligible bill is corrected from Cash to UPI
- **THEN** the same bill remains listed, its effective tender reads UPI, and the shift's Cash and UPI totals move by the exact corrected amount

## REMOVED Requirements

### Requirement: A settle can be undone only while the bill is still unsent

**Reason**: The six-second, direct-payment-only cancellation is replaced by one
five-minute tender-correction path beside every paid bill, including orders paid
on handover. A payment is now delivered immediately and corrections append audit
records rather than erasing an unsent sale.

**Migration**: Remove the transient Undo control and queued-payment cancellation
path. Surface the locally accepted paid bill in Bills this shift and use the new
append-only payment-correction command during its five-minute window.

### Requirement: Direct payment retains a guaranteed unsent Undo

**Reason**: Direct payment no longer receives a special delivery hold. Immediate
and on-handover payments share the same five-minute tender-only edit behavior.

**Migration**: Make direct payments eligible for the ordinary drain immediately,
replace the confirmation Undo with the paid-bill edit action, and retain manager
void plus manual re-ring after expiry.
