## ADDED Requirements

### Requirement: Waiter includes Employee, and Biller includes Waiter

The includes rows SHALL say that a Waiter includes an Employee and that a Biller
includes a Waiter. A Waiter SHALL be admitted wherever a check needs an
Employee, and refused wherever it needs a Biller. Team SHALL offer Waiter beside
Employee and Biller, as alternatives, while `waiter-orders` is on. No Waiter
SHALL be made before `staff-roles-include-other-roles` has been cleaned up.

#### Scenario: A Waiter checks in

- **WHEN** a Waiter checks in at their outlet
- **THEN** it is recorded as an Employee's check-in would be

#### Scenario: A Waiter at the counter

- **WHEN** a Waiter's username is typed on a counter tablet to open a shift
- **THEN** no shift opens, as for an Employee

#### Scenario: Promoted to Biller

- **WHEN** a Waiter is made a Biller at the same outlet
- **THEN** one live Biller assignment replaces the Waiter one, and they still take orders from their phone

#### Scenario: Made by another outlet's manager

- **WHEN** a manager at another outlet hand-crafts a Waiter assignment for this outlet
- **THEN** the database refuses it
