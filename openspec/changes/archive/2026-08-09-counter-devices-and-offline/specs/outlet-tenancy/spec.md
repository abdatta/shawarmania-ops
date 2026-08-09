## ADDED Requirements

### Requirement: Device sessions derive outlet scope only from their tablet row

A counter device session SHALL derive its one outlet and active state from
`counter_devices`, not from a profile, an assignment, a request body or a token
claim. A device session SHALL NOT require or receive a human profile row.

#### Scenario: Tablet requests another outlet
- **WHEN** a valid device session hand-crafts a read or write naming another outlet
- **THEN** the database returns no rows and accepts no write

#### Scenario: Tablet has no profile
- **WHEN** session loading resolves an active tablet whose Auth ID has no profile
- **THEN** it enters tablet context without inventing a person or an assignment

### Requirement: The database permits one active counter tablet per outlet at launch

The database SHALL enforce that no outlet has more than one tablet without a
removal timestamp, including under concurrent setup requests.

#### Scenario: Concurrent setup
- **WHEN** two authorised requests concurrently set up different tablets for one outlet
- **THEN** exactly one becomes active and the other is refused

### Requirement: Shift requests and shifts are outlet-bound and person-bound

A shift request and a shift SHALL each name exactly one outlet and one tablet.

A **shift** SHALL be readable by that tablet's device session, the person holding
it, and the admins already entitled to that outlet's data — who is standing at a
counter is an operational fact about the outlet. The tablet's own reach SHALL be
limited to the shift that is live on it, not to every shift it has ever held.

A **request** SHALL be readable by that tablet and the named person, and by
nobody else, including those admins. There is no fallback approver, so no third
party has a reason to read a pending request, and a row fewer parties can read is
one fewer place the handshake can be observed from.

No client role SHALL read another outlet's requests or shifts, no person SHALL
read a request naming somebody else, and **no reader SHALL be able to tell from a
request whether the username it names belongs to anybody**.

#### Scenario: The request names a name that belongs to nobody
- **WHEN** a tablet reads back its own request for an invented username
- **THEN** nothing it can read distinguishes that request from one naming a real person

#### Scenario: Another outlet's manager reads a request
- **WHEN** an FA hand-crafts a read of a shift request at an outlet they do not manage
- **THEN** the database returns no rows

#### Scenario: A colleague reads a request
- **WHEN** a person hand-crafts a read of a shift request naming a different person at their own outlet
- **THEN** the database returns no rows

### Requirement: Counter work requires a live or historically valid shift

A device session SHALL create or act on counter work only through a shift whose
outlet and tablet match it, and which was live at the work's client creation
time.

#### Scenario: Work created with no shift
- **WHEN** a device session submits counter work while holding no shift
- **THEN** the database refuses it
