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

A shift request and a shift SHALL each name exactly one outlet and one tablet,
and SHALL be readable only by that tablet's device session, the named person, and
the admins already entitled to that outlet's data. No client role SHALL read
another outlet's requests or shifts, and no person SHALL read a request naming
somebody else.

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
