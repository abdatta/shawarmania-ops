## ADDED Requirements

### Requirement: An attendance command with no position is accepted

Every attendance command SHALL state each fact the database asks of it,
including the facts that are unknown. Where no position was taken, the command
SHALL say so explicitly rather than omit the coordinates and the accuracy, so
that a missing reading is a value the database records and never a request it
cannot recognise.

A check-in submitted with no position SHALL be recorded at the named outlet with
its time, unknown coordinates, unknown accuracy and unknown distance, and SHALL
wait for that outlet's manager on the same terms as any other unlocated arrival.
An approval submitted with no position SHALL be recorded and treated exactly as
an off-site one.

This SHALL hold over the transport the phone actually uses, not only against a
test double: the position-free path of each command SHALL be exercised against a
real database.

#### Scenario: A person with several assignments checks in with no position

- **WHEN** a person assigned to two outlets, whose device can supply no
  position, chooses the outlet they are at
- **THEN** the attendance row is recorded at the chosen outlet with unknown
  coordinates, unknown accuracy and unknown distance, and its manager sees it
  waiting for approval

#### Scenario: A person with one assignment records it anyway with no position

- **WHEN** a person holding one assignment, whose device can supply no
  position, chooses to record the check-in anyway
- **THEN** the attendance row is recorded at that outlet with unknown
  coordinates, and the screen states it is waiting for their manager

#### Scenario: A manager approves with no position

- **WHEN** a manager whose device can supply no position approves a waiting day
  with a reason
- **THEN** the approval is recorded, the row keeps the reason, and every surface
  reading it shows that the approver's position is unknown

#### Scenario: A position-free command is refused by nothing but its own rules

- **WHEN** either command is submitted with no position over the transport the
  phone uses
- **THEN** the database receives it, applies the same rules it applies to a
  located command, and no failure arises from the shape of the request

### Requirement: A command the backend cannot accept is reported, not retried

An attendance action that fails because the backend could not accept the
request at all SHALL be distinguished from one that failed for a reason the
person can act on and from one that may succeed on a second attempt. Its
message SHALL tell the person the action could not be sent and ask them to
report it, and SHALL NOT invite them to try again in a moment.

#### Scenario: The backend cannot resolve the command

- **WHEN** an attendance command is rejected because the backend cannot accept
  a request of that shape
- **THEN** the screen states that the action could not be sent and asks the
  person to report it, rather than presenting it as a transient failure

#### Scenario: A refusal the person can act on is unaffected

- **WHEN** an attendance command is refused by one of the rules the database
  enforces on it
- **THEN** that rule's own message is shown, unchanged by this classification
