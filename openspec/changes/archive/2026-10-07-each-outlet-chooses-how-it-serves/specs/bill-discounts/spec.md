## ADDED Requirements

### Requirement: The gold packaging waiver is the packaging line's whole discount

A packaging line's discount SHALL be either nothing or its whole line total at
one hundred percent, and SHALL mean exactly one thing: the packaging was waived
for a gold member. No menu discount SHALL reach a packaging line.

Unlike a menu discount, the waiver SHALL NOT be captured when the line is created.
It SHALL follow the order's customer while the order is open, and SHALL be fixed
at payment.

The waiver SHALL count in the parent's discount like any line discount, inside the
existing cap at the subtotal. A bill discount SHALL continue to be computed
against the whole subtotal, packaging included.

#### Scenario: What gold cost

- **WHEN** a reader sums the discounts on packaging lines for a month
- **THEN** the result is exactly the packaging waived for gold members that month

#### Scenario: A partial packaging discount

- **WHEN** a payload carries a packaging line discounted by less than its whole total
- **THEN** the command is refused and nothing is written
