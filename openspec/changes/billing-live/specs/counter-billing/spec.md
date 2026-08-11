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
- **THEN** the counter clears, reads as not sent yet, and later shows the exactly-once bill number

#### Scenario: Customer undoes Mark Paid
- **WHEN** an operator uses Undo during the guaranteed six-second window
- **THEN** delivery has not begun, the local command is removed, and the complete composer is restored

#### Scenario: Customer pays on handover
- **WHEN** an operator saves an order and later pays it from the tablet that took it
- **THEN** the order stays editable until payment, and the payment produces one immutable bill

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

### Requirement: Paid correction respects the personal-device boundary

An authorised manager SHALL void a paid bill with a reason from bill history.
The replacement SHALL be manually rung on the enrolled counter tablet as a new
bill. The manager surface SHALL create no payment command, automatic prefill or
cross-device draft. Bill history SHALL filter on revenue `business_date` and
SHALL show payment time and payment business date separately when they differ.

#### Scenario: A manager corrects a paid bill
- **WHEN** the manager voids it and the counter operator manually rings the corrected contents
- **THEN** the original remains immutable as void and the replacement receives a new identity and bill number

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
drawer. Confirmation SHALL require exact allocations equal to the bill total.

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
- **THEN** its Mark Paid confirmation is disabled and the current bill remains intact

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
