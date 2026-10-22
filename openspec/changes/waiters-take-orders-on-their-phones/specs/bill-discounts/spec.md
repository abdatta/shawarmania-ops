## MODIFIED Requirements

### Requirement: A discount is attributed, and belongs to the till that owns the order

Every discount SHALL be attributed to the till, shift and operator that applied
it, through the same command attribution every other billing write carries.

A discount SHALL be applied, edited or removed only from a till that may act on
the order: while `any-counter-acts` is off, the till that owns it, and the
database SHALL refuse it from any other, in the same way it refuses every other
ordinary action on another till's order; while it is on, any till at the
outlet. A waiter SHALL NOT apply, edit or remove a discount, and SHALL NOT use
points.

A discount applied by a menu discount SHALL NOT be editable or removable at the
counter by any operator.

#### Scenario: The neighbouring till

- **WHEN** `any-counter-acts` is off and an operator at one till attempts to discount an order taken at the other till at the same outlet
- **THEN** the control is refused locally and the database refuses a hand-crafted request

#### Scenario: The neighbouring till with the gate on

- **WHEN** `any-counter-acts` is on and an online operator at one till discounts an order taken at the other
- **THEN** the discount lands, attributed to that till, shift and operator

#### Scenario: A biller and the owner's discount

- **WHEN** a menu discount appears on the order in front of a biller
- **THEN** it is shown with no control to change or remove it

#### Scenario: A waiter's request

- **WHEN** a waiter's request reaches the counter
- **THEN** it carries no discount or points, and any the counter adds before Accept is the counter's
