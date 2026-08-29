## MODIFIED Requirements

### Requirement: The owner records non-cash entries at any outlet, and never cash

**Superseded in part.** A Super Admin SHALL be able to record entries at any
outlet without being assigned to it, **cash included**, and every such row SHALL
carry the owner as the recording account and SHALL be shown as the owner's
wherever it is read.

The refusal this requirement previously imposed on cash is withdrawn
deliberately, and the reasoning is recorded rather than left implied. The
boundary existed so that a drawer was the responsibility of the person assigned
to that outlet, on the premise that a cash count is a claim by whoever counted
the cash. That premise is intact; the inference was wrong. The person who counts
the cash at these outlets **is** the owner, and requiring them to hold a
Franchise Admin assignment to record what they counted described paperwork
rather than accountability. Both Super Admins additionally had their Franchise
Admin rows deleted on 2026-08-01, so the previous rule left no account able to
count a drawer at either outlet.

What replaces the refusal is evidence rather than prohibition. Every cash entry
recorded by an account holding no assignment at that outlet SHALL be marked as
recorded from away, and every drawer record SHALL carry whether the account was
inside that outlet's geofence, with a reason required and stored where it was
not. **No cash entry SHALL be refused for being recorded remotely.** The full
drawer authority, its geofence evidence and its refusals for Biller and Employee
are specified in the `cash-drawer` capability.

A Super Admin who additionally holds a Franchise Admin assignment at an outlet
SHALL be able to perform that outlet's full operational writes there, as before.
That authority now adds nothing to the drawer that the Super Admin assignment
does not already carry.

#### Scenario: The owner records a non-cash expense remotely

- **WHEN** a Super Admin records an expense paid by UPI at an outlet they hold
  no assignment at
- **THEN** the expense is recorded, attributed to them, and reads as the
  owner's entry on that outlet's expenses surface

#### Scenario: The owner records a cash expense remotely

- **WHEN** a Super Admin records a cash expense at an outlet they hold no
  assignment at
- **THEN** the expense is recorded, moves that outlet's drawer, and is marked
  recorded from away so whoever counts next knows why the expected cash moved

#### Scenario: The owner counts a drawer at an outlet they do not manage

- **WHEN** a Super Admin holding no assignment at an outlet records a drawer
  observation and a collection there
- **THEN** both are accepted and carry their account, their position, and a
  reason where they were outside the fence

#### Scenario: A drawer write is never refused for distance

- **WHEN** a permitted account records a drawer entry from away and supplies a
  reason
- **THEN** the write succeeds and the reason is stored on the record

#### Scenario: Outlet staff remain refused

- **WHEN** a Biller or an Employee attempts a drawer read or write at any
  outlet, including one they are assigned to
- **THEN** the database refuses it
