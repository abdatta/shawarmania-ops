## ADDED Requirements

### Requirement: The receipt states the points a bill earned, used and left

When a bill has points entries, the receipt SHALL show the points it used, the
points it earned, and the balance after it, each read from the bill's own stored
entries and never recomputed or read from the customer's current balance.

These figures SHALL NOT identify the customer, and the receipt SHALL continue to
name no customer.

A bill with no points entries SHALL show no points section.

#### Scenario: A bill that earned and used
- **WHEN** a bill that used 20 points and earned 5 is served, leaving 42
- **THEN** the receipt shows 20 used, 5 earned and a balance of 42, and nothing naming the customer

#### Scenario: The balance moves afterwards
- **WHEN** the same customer pays another bill and the first receipt is opened again
- **THEN** it still shows a balance of 42

#### Scenario: A bill from before points
- **WHEN** a bill rung before its outlet turned points on is served
- **THEN** no points section appears
