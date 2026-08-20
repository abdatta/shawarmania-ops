## ADDED Requirements

### Requirement: A channel's measured figures are their own record, not part of the day a person keeps

A channel's measured revenue and commission for a business date SHALL be stored
as one row per outlet, per channel, per business date, in a record separate from
the day row a person records.

They SHALL NOT be columns on the day row. The day row requires an opening cash
figure and a drawer count, so a figure held there cannot exist for a day nobody
counted; and a day nobody counted is exactly the day whose aggregator revenue
still needs to be readable. Making those two columns nullable is not an
alternative, because it would make "counted zero" and "never counted" the same
value and remove the only check the drawer has.

Money SHALL be integer paise. Commission MAY be absent, meaning **undetermined**
rather than nil, and an absent commission SHALL NOT be read as zero anywhere.

#### Scenario: A measured day exists without a recorded day

- **WHEN** a channel's figures are stored for a business date at which no day row exists
- **THEN** the write succeeds, no day row is created, and no opening balance or drawer count is invented

#### Scenario: A past date with no day row still reads its figures

- **WHEN** a reader opens a past business date that has aggregator figures and no day row
- **THEN** the aggregator figures are shown, and the drawer figures are shown as never recorded rather than as zero

#### Scenario: An absent commission is not zero

- **WHEN** a day's commission is undetermined
- **THEN** every reading of that day states the commission is not known yet, and no total treats it as nought

### Requirement: No client may write a measured figure

A measured figure SHALL be writable only by the ingest path, authenticated as
itself. No role reachable from the app, including a Super Admin, SHALL hold
insert, update or delete on these rows.

The freeze SHALL be enforced by the absence of a permitted writer rather than by
a disabled control, so that a hand-crafted request is refused by the same rule
that removes the field from the screen.

#### Scenario: Every client role is refused

- **WHEN** a Super Admin, Franchise Admin, Biller or Employee submits a hand-crafted insert, update or delete against a measured figure
- **THEN** the database refuses it, and the stored figure is byte-for-byte unchanged

#### Scenario: A day saved by a person cannot carry aggregator figures

- **WHEN** a day row is saved with any aggregator revenue or commission value attached
- **THEN** the write is refused rather than silently ignoring the attached figures

### Requirement: A figure states where it came from and what it replaced

Each measured figure SHALL record which origin wrote it: the daily reader, a
settlement statement, or a statement supplied by hand. Where a settlement
replaces a figure an earlier origin wrote, the earlier figure SHALL be retained
with the moment it was replaced, and SHALL participate in no total.

#### Scenario: A reading names its origin

- **WHEN** a reader opens a day whose figures came from a settlement statement
- **THEN** the reading names that origin, distinguishably from a figure the daily reader wrote

#### Scenario: A replaced figure stays visible and stays out of the total

- **WHEN** a settlement replaces a figure the daily reader wrote, with a different amount
- **THEN** both figures are readable, the earlier marked as replaced with its moment, and only the later one reaches the day's and the month's totals
