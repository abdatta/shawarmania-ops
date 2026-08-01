## ADDED Requirements

### Requirement: Multiple devices do not weaken order ownership
Normal revise, pay, and cancel commands SHALL require the order's current owning device even when several devices share its outlet. An FA or SA SHALL be able to transfer a stranded open order to another active same-outlet device through an attributed, reasoned, expected-version recovery command.

#### Scenario: Another device attempts ordinary payment
- **WHEN** an eligible operator on a different same-outlet device submits payment for an order they do not own
- **THEN** the server refuses the command without changing the order or allocating a bill number

#### Scenario: Admin transfers a stranded order
- **WHEN** an FA or SA transfers an open order from an unusable device to an active same-outlet device with the expected version and reason
- **THEN** ownership and version change atomically, an audit event records the transfer, and the target device may act after refresh
