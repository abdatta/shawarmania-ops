## ADDED Requirements

### Requirement: Machine principals derive outlet scope only from their device row

A counter machine session SHALL derive its one outlet and active status from
`counter_devices`, not from a profile, assignment, request body, or token role
claim. A machine principal SHALL NOT require or receive a human profile row.

#### Scenario: Device requests another outlet
- **WHEN** a valid machine session hand-crafts a read or write naming another outlet
- **THEN** the database returns no rows and accepts no write

#### Scenario: Machine has no profile
- **WHEN** session loading resolves an active counter device whose Auth ID has no profile
- **THEN** it enters device context without inventing a person or assignment

### Requirement: The database permits one active counter device per outlet at launch

The database SHALL enforce that no outlet has more than one unrevoked counter
device, including under concurrent enrollment requests.

#### Scenario: Concurrent enrollment
- **WHEN** two authorized requests concurrently enroll different devices for one outlet
- **THEN** exactly one becomes active and the other is refused

### Requirement: Billing grants narrow machine use to an eligible attributed operator

A machine principal SHALL create or act on counter work only through a live or
historically valid grant whose outlet and device match it. Grant creation SHALL
re-derive the human caller's current eligibility from database assignments.

#### Scenario: Request body claims another operator
- **WHEN** a caller asks to create a grant naming a different eligible person's ID
- **THEN** the function attributes only the authenticated human caller or refuses the request
