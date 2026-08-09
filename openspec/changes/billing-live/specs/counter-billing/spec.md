## ADDED Requirements

### Requirement: The live counter supports immediate payment and payment on handover

The live billing adapter SHALL support direct paid bills and editable open
orders, using the same typed lifecycle demonstrated in `ui-billing-lifecycle`. A
bill SHALL exist only after full payment succeeds. V1 SHALL expose no discount
control and SHALL submit `discount_paise` as zero.

#### Scenario: Customer pays upfront
- **WHEN** an operator chooses Pay now and the command is durably accepted locally
- **THEN** the counter clears, reads as not sent yet, and later shows the exactly-once bill number

#### Scenario: Customer undoes Pay now
- **WHEN** an operator uses Undo during the guaranteed six-second window
- **THEN** delivery has not begun, the local command is removed, and the complete composer is restored

#### Scenario: Customer pays on handover
- **WHEN** an operator saves an order and later pays it from the tablet that took it
- **THEN** the order stays editable until payment, and the payment produces one immutable bill

### Requirement: Live open-order actions stay on the tablet that took the order

Ordinary edit, payment and cancellation of an open order SHALL be available only
on the tablet that owns it, to any operator holding its live shift. Clearing an
order stranded on an unavailable tablet SHALL be an ordinary reasoned
cancellation by that outlet's manager, and no transfer or recovery path SHALL
exist.

#### Scenario: Another operator uses the same tablet
- **WHEN** a different operator's shift begins on the order's tablet
- **THEN** they may edit, pay or cancel it and the action is attributed to them

#### Scenario: The tablet is unavailable
- **WHEN** an order remains open at an outlet whose tablet cannot be used
- **THEN** the outlet's manager cancels it with a reason from their own device, and nothing is transferred

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
