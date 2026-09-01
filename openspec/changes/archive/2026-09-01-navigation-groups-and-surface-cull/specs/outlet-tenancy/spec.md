## ADDED Requirements

### Requirement: A Franchise Admin reads the outlets their assignments name

A Franchise Admin SHALL be able to read the outlets their live assignments name,
and SHALL NOT be able to read any other. The list SHALL be scoped by the database
from the assignment, never by the surface.

They SHALL NOT be able to create, edit, close, reopen or delete an outlet, or
capture its position. Every one of those SHALL remain the Super Admin's, and each
SHALL be refused by the database rather than by the absence of a control.

This surface exists because tablet administration is reached from the outlet the
tablet stands in. Without it a Franchise Admin would have no route to the only
screen that issues a counter setup code, which is the one repair they cannot make
anywhere else.

#### Scenario: A manager reads their own outlets

- **WHEN** a Franchise Admin opens the outlets surface
- **THEN** they read the outlets their live assignments name and no others

#### Scenario: A manager is refused every outlet write

- **WHEN** a Franchise Admin submits a create, edit, close or delete for any
  outlet, by a hand-crafted request
- **THEN** the database refuses it

#### Scenario: A manager reaches their counter from their outlet

- **WHEN** a Franchise Admin opens an outlet they are assigned to
- **THEN** they reach the tablet administration for that outlet

### Requirement: An outlet is read alongside what it is raising and the tablet standing at it

An outlet's card SHALL carry what that outlet is currently raising and the state
of the counter tablet at it, so that the question "is this shop all right?" is
answered where the shop is, rather than on a separate screen the reader has to
know to visit.

Administering that tablet SHALL be reached from the outlet it stands in, and
SHALL open scoped to **that** outlet rather than to a picker the reader must then
set.

#### Scenario: The card says what the shop is raising

- **WHEN** an outlet has something raised against it
- **THEN** its card states it, without the reader opening another surface

#### Scenario: Tablet administration arrives already scoped

- **WHEN** a reader opens tablet administration from an outlet's card
- **THEN** it opens on that outlet's tablets
