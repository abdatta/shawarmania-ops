## ADDED Requirements

### Requirement: Changing the outlet keeps the reader's place in time

On an outlet-scoped surface that also chooses a period — a business date, a month
or a range — changing the outlet selection SHALL keep the chosen period. The
period is a fact about what the reader is reading, not about which outlet they
are reading it at.

Each outlet resolves its own today through its own cutover, so two rules SHALL
apply at the switch, and no other change SHALL be made to the period:

- a reader who was on the previous outlet's today SHALL be on the new outlet's
  today, because "today" is what they chose;
- a chosen period later than the new outlet's today SHALL be brought back to that
  today, because the database refuses a future business date.

A surface that rebuilds its per-outlet state on a switch — a selection being
built, a sheet half filled in — SHALL still keep the period.

#### Scenario: A past date survives a switch

- **WHEN** a reader on 12 September at one outlet switches to another outlet
- **THEN** the surface reads 12 September at the new outlet

#### Scenario: A past month survives a switch

- **WHEN** a reader on June's month at one outlet switches to another outlet
- **THEN** the surface reads June at the new outlet

#### Scenario: Today follows the outlet

- **WHEN** a reader on one outlet's today switches to an outlet whose cutover has already begun the next business date
- **THEN** the surface reads the new outlet's today, not the previous outlet's

#### Scenario: A date past the new outlet's today is brought back

- **WHEN** a reader on one outlet's today switches to an outlet whose cutover has not yet begun that business date
- **THEN** the surface reads the new outlet's today

#### Scenario: Surfaces that choose a date

- **WHEN** a reader has stepped to an earlier date on the Ledger, Billing history, Expenses or Attendance's day view and changes the outlet
- **THEN** that surface keeps the earlier date
