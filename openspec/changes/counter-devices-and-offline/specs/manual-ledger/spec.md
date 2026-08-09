## MODIFIED Requirements

### Requirement: An expense may be recorded from the counter tablet, attributed to the shift's operator

A counter device session SHALL be able to record a manual-ledger expense for its
own tablet's outlet **only while it holds a live shift**, and the row SHALL be
attributed to that shift's operator, read from the shift rather than from the
request body. The device session SHALL gain no other reach over the ledger: it
SHALL NOT read or write a day record, SHALL NOT read a month's aggregate, and
SHALL NOT record an expense for a past business date.

Voiding an expense recorded this way SHALL remain governed by the rules already
in force for the outlet's staff, and a voided expense SHALL stay visible.

#### Scenario: Biller records a cash expense at the counter
- **WHEN** a tablet holding a live shift records a cash expense for today at its own outlet
- **THEN** the row is stored, attributed to the person holding that shift, and appears in the outlet's expense list

#### Scenario: No live shift
- **WHEN** a tablet with no live shift hand-crafts an expense insert
- **THEN** the database refuses it

#### Scenario: Another outlet
- **WHEN** a tablet hand-crafts an expense insert naming an outlet that is not its own
- **THEN** the database refuses it

#### Scenario: A past day
- **WHEN** a tablet hand-crafts an expense insert for an earlier business date
- **THEN** the database refuses it

#### Scenario: The body names somebody else
- **WHEN** a tablet submits an expense naming a different person as the one who recorded it
- **THEN** the stored row is attributed to the shift's operator instead

#### Scenario: The day record stays out of reach
- **WHEN** a tablet hand-crafts a read or write of a manual-ledger day record or a month aggregate
- **THEN** the database returns no rows and accepts no write
