## ADDED Requirements

### Requirement: A closed outlet accepts no new check-ins and never blocks a check-out

A check-in recorded against an outlet whose active state is off SHALL be
refused, and the refusal SHALL name the reason so that the person holding the
phone learns the shop is marked closed rather than that something broke.

A check-out SHALL never be refused for this or any other reason. Someone whose
outlet is deactivated mid-shift SHALL still be able to close the day they
started.

#### Scenario: Check-in at a deactivated outlet

- **WHEN** an employee attempts to check in and their outlet is deactivated
- **THEN** the check-in is refused by the database, and the surface explains
  that the outlet is marked closed

#### Scenario: Check-out survives a mid-shift deactivation

- **WHEN** an employee checked in while the outlet was active and the outlet is
  deactivated before they check out
- **THEN** the check-out is recorded normally

#### Scenario: Reactivating restores check-in

- **WHEN** a deactivated outlet is reactivated
- **THEN** check-ins are accepted again with no other intervention

### Requirement: An employee with no linked roster row is told what is missing

An account whose profile is linked to no roster row SHALL be told, on its own
attendance surface, that it is not on the staff list and that an admin must add
them — not shown an empty day, an error, or a check-in control that cannot
work.

#### Scenario: A signed-in Employee who is on no roster

- **WHEN** an Employee with no linked roster row opens their attendance surface
- **THEN** they are told they are not on the staff list yet and that their
  manager can add them, and no check-in control is offered
