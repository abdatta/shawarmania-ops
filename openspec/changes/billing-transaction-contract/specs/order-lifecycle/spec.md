## ADDED Requirements

### Requirement: An unpaid order is mutable until payment or cancellation

An unpaid order SHALL carry a client UUID, outlet, originating device, creator,
grant, original creation time, explicit business date, optimistic version,
customer/form snapshots, lines, and integer-paise totals. Only `open` orders
SHALL accept revision. Payment or cancellation SHALL make the order immutable.

#### Scenario: Order is revised
- **WHEN** its owning device submits the current expected version under an eligible grant
- **THEN** all validated changes commit atomically and the version increments once

#### Scenario: Paid order is edited
- **WHEN** any caller attempts to revise an order already marked paid
- **THEN** the database refuses the transition

### Requirement: Normal order actions stay on the originating device

Create SHALL bind the order to the registered device. Ordinary revise, pay, and
cancel commands SHALL require that same current device, though any eligible
operator authenticated there may act. The order creator and later actors SHALL
remain separately attributable.

#### Scenario: Another operator uses the same device
- **WHEN** an eligible incoming operator revises the open order on its device
- **THEN** the revision succeeds with that actor recorded and the creator unchanged

#### Scenario: Another device attempts payment
- **WHEN** a different device hand-crafts a pay command for the order
- **THEN** the database refuses it even if the device belongs to the same outlet

### Requirement: Stale order versions never overwrite current state

Every revise, pay, cancel, or transfer SHALL name the expected order version and
lock the row. A mismatch SHALL return a conflict with the current safe metadata
and SHALL change no order, line, event, bill, or bill number.

#### Scenario: Competing revisions
- **WHEN** two commands submit the same expected version
- **THEN** one may commit and the other receives a version conflict without overwriting it

### Requirement: Cancellation is attributed and leaves history

An open order SHALL be cancellable in full with a nonblank reason. Cancellation
SHALL record actor, device, grant, time, command, and reason; no client role SHALL
hard-delete the order or its events.

#### Scenario: Eligible operator cancels
- **WHEN** an eligible operator on the owning device cancels with a reason
- **THEN** the order becomes immutable cancelled history and no bill number is consumed

### Requirement: Recovery transfers or cancels only stranded orders

An FA of the outlet or SA SHALL transfer an open order to the outlet's active
replacement device, or cancel it administratively, only after the source device
is revoked and with a nonblank reason. The action SHALL append an event containing
actor, old/new device where relevant, time, reason, and versions.

#### Scenario: Stranded order is transferred
- **WHEN** an authorized admin transfers from a revoked device to the active replacement at the same outlet
- **THEN** ownership and version change atomically and the replacement device may act next

#### Scenario: Healthy-device transfer is attempted
- **WHEN** an admin attempts recovery transfer while the source remains active
- **THEN** the request is refused and ordinary same-device ownership remains

### Requirement: Order events contain accountability without duplicating PII

Every successful state-changing order command SHALL append an immutable event
with action, versions, actor/device/grant/command IDs, time, and required reason.
Events SHALL NOT copy customer phone, customer name, or full line payloads.

#### Scenario: Order history is reviewed
- **WHEN** an authorized admin reads an order's events
- **THEN** they can identify who performed each transition without receiving duplicate customer PII from the event rows

### Requirement: Open orders are business-day sign-off blockers

An outlet business date SHALL NOT be settlement-ready while any order with that
original business date remains open. Paying or cancelling every such order SHALL
remove the order blocker without changing its original business date.

#### Scenario: Unpaid order remains at close
- **WHEN** the settlement-readiness contract is evaluated for a date with an open order
- **THEN** it reports that order as a blocker and no day-sign-off transaction may succeed

#### Scenario: Earlier order is paid on a later payment date
- **WHEN** the last open order is paid after cutoff under a fresh eligible grant
- **THEN** its original business date becomes order-settled while its cash remains attributed to the payment business date
