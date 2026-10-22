## MODIFIED Requirements

### Requirement: Ownership survives having a neighbour

While `any-counter-acts` is off, ordinary revise, pay, cancel and preparation
SHALL continue to require the order's owning tablet even when several tablets
share the outlet. Another tablet MAY see the order on the outlet pipeline with
its creator named and SHALL be refused if it acts. Clearing an order stranded on
an unusable tablet SHALL remain a reasoned cancellation by that outlet's
manager.

While `any-counter-acts` is on, any tablet holding a live counter shift at the
outlet SHALL act on any open order there, and the database SHALL keep two
tablets from undoing each other by refusing a revise, pay or cancel made against
a version that is no longer current. A tablet SHALL act on an order it did not
take only while online. Correcting a payment's tender and taking a payment back
SHALL stay with the tablet that took the payment. No transfer of ownership SHALL
be introduced.

#### Scenario: The neighbouring tablet attempts payment

- **WHEN** `any-counter-acts` is off and an eligible operator on the other tablet submits payment for an order it does not own
- **THEN** the database refuses it, the order does not change, and no bill number is consumed

#### Scenario: A tablet becomes unusable mid-service

- **WHEN** `any-counter-acts` is on and one tablet dies with open orders on it
- **THEN** the other tablet edits, pays and cancels those orders, and nothing is transferred

#### Scenario: A tablet becomes unusable with the gate off

- **WHEN** `any-counter-acts` is off and one tablet is destroyed or removed with an open order on it
- **THEN** the outlet's manager cancels that order with a reason from their own device and the counter re-rings it

#### Scenario: An offline payment races an edit

- **WHEN** tablet A, offline, takes cash for its own order while tablet B adds a dish to it online
- **THEN** A's payment is refused `order_changed` when it arrives, A shows the refusal, and the order stays open at its new total to be paid again

#### Scenario: Another tablet's order offline

- **WHEN** tablet B is offline and its operator opens an order tablet A took
- **THEN** edit, pay, cancel and tick are greyed with Needs a connection
