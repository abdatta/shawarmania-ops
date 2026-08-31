## ADDED Requirements

### Requirement: A carried legacy observation shows its date and no hour

An observation created by carrying a historical hand-recorded day SHALL be a
first-class observation, participating in the same interval arithmetic and the
same carry-forward, and SHALL be marked **legacy imprecise**, distinctly from the
ordinary approximate marker.

A legacy observation SHALL NOT be presented with a time of day and SHALL NOT
carry a rupee tolerance, because the instant it is placed at is a boundary chosen
by the carry-over rather than a moment anybody observed.

**It SHALL show the date it does have, and SHALL NOT say in words that the hour
is missing** [owner, 2026-08-31]. Every other count on the same list carries a
date and a time; a carried one carrying only a date says what it has and what it
does not by the shape of the row. A sentence saying so as well spent the line
that the date should have been on, which is how the drawer's own history came to
show carried counts that could not be placed in time at all.

**The date SHALL be the business date resolved through the outlet's own
cutover**, never the calendar date of the stored instant. Those differ by a day
for every carried row by construction: the instant is the cutover boundary, so a
count recorded for 05 August is stored at 06 August 03:59:59.999999. Formatting
the instant produces a date that is wrong and plausible at once.

Where the cutover is not yet known to the reader, the date SHALL be omitted
rather than assumed from the default every outlet currently uses — an assumption
that is right today is what makes a wrong one impossible to notice later.

**The counted figure SHALL be converted, not copied.** The historical record
counted the drawer after the collection was taken, while an observation counts it
before, so a carried observation's counted total SHALL be the source row's
counted cash plus its cash removed, the removal SHALL be recorded separately, and
the following opening SHALL be the source row's counted cash. A migration SHALL
assert this identity per row.

The source row's cash removed SHALL become cash out of kind `spend` where it
carried a reason and `collection` where it did not, at the same instant, recorded
as **that observation's own** movement so it reduces the following opening.

A source row's cash added SHALL become a **negative** cash out of kind
`collection` at the same instant, retaining its original reason, and SHALL NOT be
recorded as the observation's own movement. The historical record placed cash
added among the day's inflows and compared the count against them, so the count
already holds it; treating it as the observation's own would raise the following
opening by that amount and charge the same amount to the difference a second
time.

#### Scenario: A carried day renders without a time

- **WHEN** a legacy observation is shown on a surface that is not already scoped to one date
- **THEN** it shows its business date and its figures, with no time of day, no tolerance, and no sentence about the missing hour

#### Scenario: A carried day on a surface that already names the date

- **WHEN** a legacy observation is shown on a reading of one business date
- **THEN** it shows its figures with no time of day, and does not repeat the date the page already carries

#### Scenario: The date is the business date, not the boundary instant's

- **WHEN** a legacy observation for business date 2026-08-05 is stored at the 04:00 cutover boundary, 2026-08-06 03:59:59.999999
- **THEN** the surface shows 05 Aug and never 06 Aug

#### Scenario: A legacy observation anchors the balance like any other

- **WHEN** the observation after a legacy one is recorded
- **THEN** its opening is the legacy observation's counted total less that observation's own cash out, by the ordinary rule

#### Scenario: The counted figure is converted across the collection

- **WHEN** a historical row recorded ₹490 counted with ₹2,500 removed
- **THEN** the carried observation's counted total is ₹2,990, its cash out is ₹2,500, and the next opening is ₹490

#### Scenario: A carried row that added cash

- **WHEN** a historical row recorded cash added with a reason
- **THEN** it is carried as a negative collection at the observation's instant, keeping that reason, and the drawer balance rises by it

#### Scenario: A carried removal keeps its reason

- **WHEN** a source row recorded cash removed with a reason
- **THEN** the carried cash out is of kind spend and carries that reason

#### Scenario: An approximate observation and a legacy one are distinguishable

- **WHEN** both appear in one month's reading
- **THEN** they carry different markers, and only the approximate one carries a tolerance figure

### Requirement: The carry-over reproduces figures already known, or it does not complete

The migration carrying historical rows SHALL assert, inside the same transaction
that performs it, that the carried data reproduces totals established before it
ran: each outlet's monthly cash and non-cash expense totals, each outlet's count
of expense rows including voided ones, and each carried observation's counted
total against its source row.

It SHALL further assert that every carried row carries a recording account, that
every corrected row carries a correcting account, and that every voided row
carries its reason.

A failed assertion SHALL abort the whole migration, leaving every source row and
every existing record untouched.

#### Scenario: A carry-over that does not reconcile

- **WHEN** any asserted total differs from the figure established before the migration
- **THEN** the transaction raises and nothing is archived, renamed or dropped

#### Scenario: Attribution is not optional

- **WHEN** a source row would carry across without its recording account
- **THEN** the migration raises rather than writing an unattributed row

## MODIFIED Requirements

### Requirement: The opening is stored per observation, and a break is reported rather than repaired

Each observation SHALL store its opening rather than deriving it from earlier
rows at read time. Where a stored opening disagrees with the previous
observation's carry-forward, the surface SHALL report the discrepancy and SHALL
NOT silently replace either figure.

**A break SHALL NOT be invented.** The carry-forward it is measured against is
the previous observation's counted total less that observation's **own** cash
movement, so it SHALL be computed from a complete reading of that observation's
movements — never from a sample of the outlet's recent ones. A movement missing
from such a sample raises the carry-forward and reports a break of exactly that
movement's amount where none exists, which is the same fabrication the
report-never-repair rule exists to prevent, arriving from the other direction.

For the same reason, the figures a count presents for itself — the amount
collected from it and the amount left after it — SHALL come from that
observation's own movements rather than from a recent-movement sample, and the
count of movements since the last observation SHALL be bounded by that
observation's instant rather than by the same sample, so it cannot disagree with
the total shown beside it.

#### Scenario: An adjusted earlier count leaves later openings alone

- **WHEN** an adjustment changes an earlier observation's counted total
- **THEN** no later observation's stored opening changes, and the surface reports the break

#### Scenario: A burst of spends does not invent a break on an earlier count

- **WHEN** the first page of counts is read at an outlet where many cash movements have been recorded since those counts
- **THEN** every count on that page shows the amount actually collected from it, and no break is reported for a count whose stored opening agrees with its predecessor's carry-forward
