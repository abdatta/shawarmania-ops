# Aggregator Figures

## Purpose

A channel's measured gross revenue, commission-and-fee reduction and net order
payout for a business date, held as its own record rather than as columns on the
day a person keeps. A day nobody counted is exactly the day whose aggregator
revenue still needs to be readable, so these figures live apart from the drawer,
are written only by the ingest path, and carry where each came from and what it
replaced.

## Requirements

### Requirement: A channel's measured figures are their own record, not part of the day a person keeps

A channel's measured gross revenue, commission-and-fee reduction and net order
payout for a business date SHALL be stored as one row per outlet, per channel,
per business date, in a record separate from the day row a person records. The
three money values SHALL be integer paise and SHALL preserve the source's exact
normalized values; net plus the order-level reduction SHALL equal gross.

They SHALL NOT be columns on the day row. The day row requires an opening cash
figure and a drawer count, so a figure held there cannot exist for a day nobody
counted; and a day nobody counted is exactly the day whose aggregator revenue
still needs to be readable. Making those two columns nullable is not an
alternative, because it would make "counted zero" and "never counted" the same
value and remove the only check the drawer has.

Commission MAY be absent only for a provisional source that has not supplied an
exact order payout, meaning **undetermined** rather than nil. Net SHALL then
also be absent, and neither value SHALL be read as zero anywhere. A settled row
SHALL have all three figures. Cycle-level deductions whose service date is
unknown SHALL remain cycle records and SHALL NOT be spread across these daily
values.

#### Scenario: A measured day exists without a recorded day

- **WHEN** a channel's figures are stored for a business date at which no day row exists
- **THEN** the write succeeds, no day row is created, and no opening balance or drawer count is invented

#### Scenario: A past date with no day row still reads its figures

- **WHEN** a reader opens a past business date that has aggregator figures and no day row
- **THEN** the aggregator figures are shown, and the drawer figures are shown as never recorded rather than as zero

#### Scenario: An absent commission is not zero

- **WHEN** a provisional day's commission and net payout are undetermined
- **THEN** every reading states that they are not known yet and no total treats
  either as nought

#### Scenario: A cancelled order can produce a negative payout

- **WHEN** a business date has zero gross but carries an order-level
  cancellation charge that makes net payout negative
- **THEN** the row stores zero gross, the positive reduction and the negative
  net without rejecting or converting any value to zero

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

Each channel figure SHALL record its source kind, source reference and the time
through which that source was current. Source kinds SHALL distinguish a live
daily reader, an order/cycle settlement, a statement supplied by hand and a
legacy typed ledger value carried through migration.

Where a higher-authority source replaces an earlier figure, the earlier figure
SHALL be retained with its values, provenance and the moment it was replaced,
and SHALL participate in no total. A legacy typed value SHALL never be
relabelled as an operator statement, because no operator-issued file proved it.

Source authority SHALL be ordered: a final reconciled settlement or confirmed
settlement upload outranks provisional daily data; provisional data SHALL NOT
downgrade a settled row; a legacy typed value participates only until an
authoritative source covers that outlet, channel and date.

#### Scenario: A reading names its origin

- **WHEN** a reader opens a provisional Swiggy figure captured partway through
  today
- **THEN** it names the daily-reader origin, its capture/as-of time and its
  provisional state

#### Scenario: A replaced figure stays visible and stays out of the total

- **WHEN** a settlement replaces a daily-reader or legacy-typed figure with
  different values
- **THEN** both are readable with their distinct provenance, the earlier is
  marked replaced with its moment, and only the later reaches day and month
  totals

#### Scenario: Legacy typing is not presented as a statement

- **WHEN** a migrated Swiggy value has no operator-issued source file
- **THEN** its provenance states legacy typed entry and never supplied-by-hand
  statement

### Requirement: Daily aggregate visibility follows existing ledger authority

A Super Admin SHALL read channel-day rows across outlets. A Franchise Admin
SHALL read channel-day rows only for outlets named by a live assignment, so the
assigned outlet's full ledger remains complete after aggregator inputs are
frozen. A Biller and Employee SHALL read no channel-day row.

Cycle reconciliations, cycle deductions, sync runs, credentials and auth
requests SHALL remain Super Admin-only. Every grant and refusal SHALL be
enforced by Row-Level Security, including hand-crafted requests.

#### Scenario: A manager reads the assigned outlet's channel day

- **WHEN** a Franchise Admin opens a ledger date at an assigned outlet
- **THEN** its Zomato and Swiggy daily aggregate rows are readable and included
  in the ledger

#### Scenario: A manager cannot cross outlets or inspect settlement internals

- **WHEN** a Franchise Admin requests another outlet's channel day or any
  outlet's cycle, deduction, run, credential or auth-request row
- **THEN** the database returns no row

#### Scenario: Outlet staff cannot read channel days

- **WHEN** a Biller or Employee requests a channel-day row for any outlet
- **THEN** the database returns no row
