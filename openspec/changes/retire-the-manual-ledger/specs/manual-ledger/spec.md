## REMOVED Requirements

The capability is removed whole. It was shipped as a stopgap with a stated exit
and this change performs that exit. Its own removal requirement, *The manual
ledger is a record only, and its rows outlive its surface*, sets the condition:
the rows are carried into the live records first, with every recording account,
correcting account, void state and reason, and recorded-from-away marker intact.
That condition is satisfied by this change's carry-over and asserted inside the
migration before anything is archived or dropped.

**No row is deleted.** `manual_ledger_days` is archived read-only under an
archive name, because it is the only record of August 2026 and a transformation
that cannot be checked against its source is a transformation nobody can trust
later. `manual_ledger_expenses` is not migrated at all: it is **renamed** to
`expenses`, because it is the richer of the two expense tables and the one
holding the real rows, so its content survives in place rather than being copied.

Where a requirement below has a successor, the successor is named. The rest
describe a surface, a form or a table that ceases to exist.

### Requirement: The day record is reachable by owners, and by managers at the outlets they are assigned to

**Reason**: the day record ceases to exist. Reach over the derived reading is
`ledger-statement`'s, and reach over the drawer is `cash-drawer`'s.

### Requirement: Everyone at an outlet reads its expenses, and each staff member corrects only their own, on the day they recorded them

**Successor**: carried into `outlet-expenses` with the promoted table, unchanged
in substance.

### Requirement: A removed expense leaves a trace rather than disappearing

**Successor**: carried into `outlet-expenses`. The void columns move with the
table rather than being reimplemented.

### Requirement: A corrected row says who corrected it, without rewriting who recorded it

**Successor**: carried into `outlet-expenses`.

### Requirement: Outlet staff reach expenses through their own surface, which shows no revenue and no drawer

**Successor**: carried into `outlet-expenses`. The shared component the staff
surface and the ledger both mount survives the ledger it was shared with.

### Requirement: A trading day is one row per outlet, holding revenue by channel and the drawer

**Reason**: replaced by a derived reading with no stored row. See
`ledger-statement`, *A ledger day is derived on read and is never stored*.

### Requirement: An expense is its own row, categorised and marked cash or non-cash

**Successor**: carried into `outlet-expenses` with the table.

### Requirement: Commission and opening cash are snapshotted per day, so editing an old day never rewrites a later one

**Reason**: the day row is gone. The principle survives in `cash-drawer`, *The
opening is stored per observation, and a break is reported rather than repaired*,
which applies it to observations instead of days. Commission remains snapshotted
per day in `aggregator_channel_days`, which this change does not touch.

### Requirement: A day reads as expected cash against the count, with the difference and its note together

**Reason**: superseded by the observation block in `ledger-statement`'s drawer
section and by the difference requirements in `cash-drawer`.

### Requirement: A recorded day is presented as a reading, and its entry fields are reached deliberately

**Reason**: there are no entry fields. The derived reading carries none, by
requirement.

### Requirement: The entry form groups each aggregator with its own rate and result, and its explanations are available rather than displayed

**Reason**: the entry form ceases to exist. Aggregator figures are sourced and
appear in `ledger-statement`'s revenue section as readings.

### Requirement: A month reads as revenue by channel, aggregator revenue net of commission, and cash-basis profit that names its basis

**Successor**: the month reading survives on the derived statement and its basis
rule is `profit-estimates`'. What is removed is its dependence on notebook rows.

### Requirement: The manual ledger is a record only, and its rows outlive its surface

**Reason**: discharged. This is the requirement that authorises the removal, and
its condition is met by the carry-over and the archive.

### Requirement: The rows recorded before categories were free text keep every word already typed into them

**Reason**: satisfied and moot. The promoted rows keep every word because the
table is renamed rather than copied.

### Requirement: An expense may be recorded from the counter tablet, attributed to the shift's operator

**Successor**: carried into `outlet-expenses` with the table.

### Requirement: A live outlet's cash and UPI revenue comes from bills, while its aggregator revenue stays typed

**Reason**: the distinction it draws was `billing_live_from`'s, and that column
is dropped here. Every outlet's cash and UPI come from bills on the derived
statement, and no aggregator figure is typed by anybody.
