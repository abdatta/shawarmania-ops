## MODIFIED Requirements

### Requirement: Membership is business-wide, and it is a label

A customer's membership SHALL apply across the whole business, not per outlet, so
that one person holds one membership however many outlets the business trades
from.

Membership SHALL confer no automatic price change, with **one exception an outlet
may choose**: an outlet that waives packaging for gold members SHALL charge a
member nothing for packaging. No other discount, benefit or charge SHALL be
computed from membership. Anything else a member is given SHALL be decided by the
person serving them, using the discount controls that already exist.

#### Scenario: A member is recognised anywhere

- **WHEN** a member is identified at any outlet
- **THEN** the same membership is in force, with no outlet qualification

#### Scenario: Membership changes no total

- **WHEN** an order is rung for a member with no discount applied by hand, at an outlet that does not waive packaging for gold members
- **THEN** its subtotal, discount and total are identical to the same order rung for a non-member

#### Scenario: The one exception

- **WHEN** a takeaway order is rung for a member at an outlet that waives packaging for gold members
- **THEN** it differs from the same order for a non-member only by the packaging line's waiver
