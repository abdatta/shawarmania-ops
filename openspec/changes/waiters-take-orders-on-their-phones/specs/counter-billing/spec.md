## MODIFIED Requirements

### Requirement: Live open-order actions stay on the tablet that took the order

While `any-counter-acts` is off, ordinary edit, payment, cancellation and
preparation of an order SHALL be available only on the tablet that owns it, to
any operator holding its live shift, and clearing an order stranded on an
unavailable tablet SHALL be an ordinary reasoned cancellation by that outlet's
manager. While it is on, they SHALL be available on every counter tablet at the
outlet, on another tablet's order only while online, and a command refused
`order_changed` SHALL tell the operator that the order changed on another
counter and to reopen it. No transfer or recovery path SHALL exist. Cards across
the pipeline SHALL label secondary numbers as Order #, show complete item lines,
and omit the creator when the current shift holder took the order. The payment
action SHALL read Paid and the preparation action Prepared.

#### Scenario: Another operator uses the same tablet
- **WHEN** a different operator's shift begins on the order's tablet
- **THEN** they may prepare, edit, pay or cancel it and the action is attributed to them

#### Scenario: The tablet is unavailable
- **WHEN** `any-counter-acts` is off and an order remains open at an outlet whose tablet cannot be used
- **THEN** the outlet's manager cancels it with a reason from their own device, and nothing is transferred

#### Scenario: Another tablet of the outlet sees but cannot act
- **WHEN** `any-counter-acts` is off and a second billing device at the outlet displays the pipeline and its operator attempts to act on the first tablet's order
- **THEN** the database refuses the command under the owning-tablet rule while the order remains visible with its creator named

#### Scenario: Another tablet of the outlet acts
- **WHEN** `any-counter-acts` is on and an online second tablet edits the first tablet's order
- **THEN** the edit lands, attributed to the second tablet, and the first tablet's rail shows it at its next re-read

## ADDED Requirements

### Requirement: Waiting requests lead the rail while waiter ordering is on

While `waiter-orders` is on, the counter's rail SHALL carry the outlet's waiting
requests above its orders, and SHALL learn of new ones through its existing
outlet channel and its foreground re-read, adding no timer. Accepting one SHALL
use the composer the counter uses to ring or edit an order, filled in, and the
create or revise command it already sends. While it is off, the rail SHALL read
and subscribe to no request.

#### Scenario: Idle with the gate on

- **WHEN** a counter sits idle for a measured minute with `waiter-orders` on and no request arrives
- **THEN** it makes no more requests than with the gate off
