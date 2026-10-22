## MODIFIED Requirements

### Requirement: Ordinary order actions stay on the owning tablet

Create SHALL bind the order to the tablet that made it. While `any-counter-acts`
is off, ordinary revise, pay and cancel commands SHALL require that same tablet,
though any eligible operator holding its live shift may act. While it is on,
they SHALL be accepted from any tablet holding a live counter shift at the
order's outlet. The creator and each later actor, with the tablet they acted
on, SHALL remain separately attributable.

Every revise, pay and cancel command a build sends under `any-counter-acts`, or
in answer to a waiter's request, SHALL name the order version it was made
against, and the database SHALL refuse it `order_changed` when the order has
been revised since. A refused command SHALL change nothing and consume no bill
number. Preparation ticks SHALL name no version and SHALL remain judged line by
line.

#### Scenario: Another operator uses the same tablet

- **WHEN** an incoming operator holding the new shift revises the open order on that tablet
- **THEN** the revision succeeds with that actor recorded and the creator unchanged

#### Scenario: Another tablet attempts payment

- **WHEN** `any-counter-acts` is off and a different tablet hand-crafts a pay command for the order
- **THEN** the database refuses it even if that tablet belongs to the same outlet

#### Scenario: Another tablet pays with the gate on

- **WHEN** `any-counter-acts` is on and a different tablet at the outlet pays the order at its current version
- **THEN** the bill is created, attributed to the paying tablet and operator, and the order's creator is unchanged

#### Scenario: Two tablets edit one order

- **WHEN** two tablets both open version V of an order and each saves an edit
- **THEN** the first revision lands, the second is refused `order_changed`, and the order holds only the first
