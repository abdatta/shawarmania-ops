## MODIFIED Requirements

### Requirement: The entry form groups each aggregator with its own rate and result, and its explanations are available rather than displayed

Each aggregator SHALL be presented as one group showing what was measured: the
stated revenue, the commission charged on it, and what those two produce. That
group SHALL contain **no revenue field and no commission field**, for every
aggregator the ledger sources, whether or not a figure has arrived for that day
yet. Where commission is not yet known, the group SHALL say so and SHALL NOT
present the stated figure as though all of it had arrived.

The withdrawal is total rather than conditional on the day being sourced. A form
offering fields for one channel and a reading for another invites the reader to
believe the difference is about the day rather than about the channel, and the
figures no longer live on the row the form saves, so there is nothing for a field
to write to.

Where the ledger does not source a channel, that channel SHALL keep its entry
fields, and the form SHALL state why the two channels differ rather than leaving
the asymmetry to read as a fault.

The explanations of how the ledger treats a figure — a capital purchase recorded
as cash out, a refund recorded as negative revenue, a provisional figure that
will be replaced when the week settles, a commission that may never be determined
— SHALL be reachable from the section they govern rather than displayed
permanently beside the fields. They SHALL be reachable by tap as well as by
pointer, SHALL state whether they are open, and SHALL be dismissable from the
keyboard.

Every entry field's accessible name SHALL identify the figure unambiguously,
including which drawer movement it belongs to, whatever the visible label is
shortened to. No entry field's font size SHALL fall below the threshold at which
a mobile browser zooms the viewport on focus.

#### Scenario: A sourced aggregator offers nothing to type

- **WHEN** the owner opens the entry form for any business date
- **THEN** the sourced aggregator's group shows its figures as a reading, and carries no revenue field and no commission field

#### Scenario: A day with no figures yet still offers nothing to type

- **WHEN** the owner opens a day for which no aggregator figure has arrived
- **THEN** the group says no figure has arrived, and still carries no field for entering one

#### Scenario: An undetermined commission says so

- **WHEN** a sourced day's commission is not yet known
- **THEN** the group states the commission is not known yet, and does not present the stated revenue as the amount received

#### Scenario: A channel the ledger does not source keeps its fields

- **WHEN** the owner opens the entry form and one aggregator is sourced while another is not
- **THEN** the unsourced channel keeps its revenue and commission fields, and the form states why the two differ

#### Scenario: An explanation is asked for

- **WHEN** the reader opens a section's explanation
- **THEN** it appears without displacing the fields, reports itself as open, and can be dismissed from the keyboard

#### Scenario: A shortened label still identifies its field

- **WHEN** two drawer-movement fields present identical visible labels
- **THEN** each field's accessible name names its movement and its unit, so they are distinguishable without seeing them

### Requirement: A trading day is one row per outlet, holding revenue by channel and the drawer

The ledger SHALL record at most one day row per outlet per business date,
enforced by a uniqueness constraint in the database. Each row SHALL hold, in
integer paise: revenue received as cash and as UPI; revenue for each aggregator
channel the ledger does **not** source; cash brought into the drawer; cash taken
out of the drawer; opening cash; and the drawer count at close. It SHALL also
hold a reason for any non-zero cash movement and an optional free-text note.

A sourced channel's revenue and commission SHALL NOT be columns on this row. They
belong to `aggregator-figures`, because this row cannot exist without a drawer
count while a sourced figure must be readable for a day nobody counted.

Money SHALL be integer paise throughout, so that no figure on this surface is
ever a float. The business date SHALL be an explicit `date` column and SHALL NOT
be derived from a timestamp when read.

A negative revenue figure SHALL be permitted, because a cash refund is recorded
by reducing that day's cash revenue. A negative opening cash, drawer count,
cash-in or cash-out figure SHALL be refused, as SHALL a future business date.

#### Scenario: A day is recorded for one outlet

- **WHEN** the owner records cash and UPI revenue, any unsourced aggregator revenue, a drawer count and any cash movements for an outlet and business date
- **THEN** one day row is stored in integer paise against that explicit business date

#### Scenario: A second row for the same day is refused

- **WHEN** a second day row is submitted for an outlet and business date that already has one, including by a hand-crafted request
- **THEN** the database refuses it and the existing row is unchanged

#### Scenario: Both outlets keep separate days

- **WHEN** the same business date is recorded for both outlets
- **THEN** two independent rows exist and neither outlet's figures contribute to the other's day or month

#### Scenario: A cash movement states its reason

- **WHEN** cash in or cash out is non-zero
- **THEN** a reason is required and stored, and a blank or whitespace-only reason is refused by the database

#### Scenario: A refund reduces cash revenue

- **WHEN** cash is returned to a customer
- **THEN** it is recorded by lowering that day's cash revenue, and the negative figure is accepted

#### Scenario: An impossible figure is refused

- **WHEN** a negative drawer count, negative opening cash, negative cash movement or future business date is submitted by a hand-crafted request
- **THEN** the database refuses the write

#### Scenario: A sourced figure cannot be attached to the day row

- **WHEN** a day row is submitted carrying a sourced channel's revenue or commission, including by a hand-crafted request
- **THEN** the database refuses the write rather than accepting the row and discarding those figures
