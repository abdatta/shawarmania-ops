## ADDED Requirements

### Requirement: Points used are a bill discount of their own source

A bill-level discount SHALL record its source: the biller, or points. A points
discount SHALL be an amount in whole rupees equal to the points used, SHALL be at
most one on an order or a bill, SHALL require the order's customer, and SHALL be
carried from the order to the bill exactly as a biller's bill discount is.

It SHALL read on the order and the receipt as its own line naming the points it
used, and SHALL count in the parent's stored discount like every other discount.

Every bill-level discount recorded before sources existed SHALL read as the
biller's.

#### Scenario: What points cost
- **WHEN** a reader sums the points discounts at an outlet for a month
- **THEN** the result is exactly what points paid for there that month

#### Scenario: A discount from before
- **WHEN** a bill discount recorded before this change is read
- **THEN** its source is the biller

## MODIFIED Requirements

### Requirement: Discounts combine additively against gross, and cap at the subtotal

Every discount SHALL be computed against the gross total of its own scope: a
category discount against the lines in that category, a bill discount against the
bill's subtotal. The results SHALL then be summed.

**One exception, and it is an amount rather than a basis.** A points discount is a
fixed number of rupees, and its **ceiling** is computed against the order after
every other discount, because the owner set the cap there (2026-09-28). It SHALL be
re-evaluated whenever the order changes, and lowered to its ceiling when it
exceeds it, so the outcome still does not depend on the order in which discounts
were applied.

The order in which discounts are applied SHALL NOT change the outcome.

A discount in rupees SHALL apply per unit and SHALL multiply by the line's
quantity.

The summed discount SHALL be capped at the subtotal, so that no bill's discount
exceeds what it discounts and no total is ever negative.

#### Scenario: A percentage and an amount together

- **WHEN** a 15% menu discount and a ₹50 bill discount both apply
- **THEN** both are computed against gross, summed, and the result is the same
  whichever was applied first

#### Scenario: An amount against a quantity

- **WHEN** a ₹20 per-item discount reaches a line carrying three of that item
- **THEN** the line's recorded discount is ₹60

#### Scenario: Discounts exceed the order

- **WHEN** the discounts applied to a bill total more than its subtotal
- **THEN** the stored discount is the subtotal, and the total before rounding is
  nought

#### Scenario: A discount added after points

- **WHEN** a biller adds a discount by hand to an order already carrying the most points allowed
- **THEN** the points fall to the new ceiling, and the total is the same as if the discount had come first
