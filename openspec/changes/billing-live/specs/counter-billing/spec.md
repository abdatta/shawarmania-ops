## ADDED Requirements

### Requirement: The live counter supports immediate and deferred payment
The live billing adapter SHALL support direct paid bills and mutable unpaid orders using the same typed lifecycle demonstrated in `ui-billing-lifecycle`. An official bill SHALL exist only after full payment succeeds.

#### Scenario: Customer pays upfront
- **WHEN** an eligible operator chooses pay now and the command is durably accepted locally
- **THEN** the counter clears with a provisional reference and later replaces it with the exactly-once official bill result

#### Scenario: Customer pays later
- **WHEN** an eligible operator saves an unpaid order and later pays it from its originating device
- **THEN** the order remains editable until payment and the payment produces one immutable official bill

### Requirement: Live open-order actions remain device-owned
Normal edit, payment, and cancellation of an unpaid order SHALL be available only on its current owning device to any eligible operator with a valid daily grant. Audited FA/SA transfer or recovery cancellation SHALL use the recovery contract when the source device is revoked or unusable.

#### Scenario: Another operator uses the originating device
- **WHEN** a different eligible operator authenticates on the order's owning device
- **THEN** they may edit, pay, or cancel it and the action is attributed to them

### Requirement: Live billing exposes delivery and accounting exceptions
The counter and authorized history surfaces SHALL distinguish provisional, pending, delivered, late, recovered, conflicted, quarantined, void, and replacement states without making a paid bill mutable.

#### Scenario: Historical command lands after cutoff
- **WHEN** a valid pre-cutoff command is accepted after cutoff
- **THEN** authorized users can see its late flag and its distinct revenue and payment business dates where applicable
