## MODIFIED Requirements

### Requirement: The database suite runs in continuous integration

Continuous integration SHALL bring up a fresh local database stack, apply all
migrations and seeds, and run the database policy suite and the REST-level
isolation probes on every push and pull request. A failure in any of these
SHALL fail the workflow.

The suite SHALL report the same result at every hour of the day. A fixture
labelling a row whose business date the database validates SHALL derive that
business date from **the same instant it stamps the row with**, through the same
definition the validation uses, and SHALL NOT derive it from a calendar date in
any timezone. A calendar date answers a different question from a trading day,
and the two disagree for the period between the outlet cutover and the calendar
rollover.

The validation itself SHALL NOT be weakened to accommodate a fixture. It protects
every figure that sums by business date, and a fixture that finds it inconvenient
is the thing that is wrong.

The suite SHALL prove this property without depending on the hour it runs: it
SHALL assert, from fixed timestamps on both sides of the cutover, that the
validation accepts a matching business date and rejects a mismatched one.

#### Scenario: A policy regression is pushed

- **WHEN** a commit that weakens or omits a Row-Level Security policy is pushed
- **THEN** the database job fails the workflow

#### Scenario: The suite runs between the cutover and the calendar rollover

- **WHEN** the database suite runs at an instant at which the outlet's business
  date has rolled over and the UTC calendar date has not
- **THEN** it reports the same result as a run at any other hour, and no test
  fails because a fixture and the validation disagreed about the day

#### Scenario: A fixture and its own row disagree

- **WHEN** a fixture labels a guarded row with a business date derived from
  something other than that row's timestamp
- **THEN** the database rejects the row, and the suite reports it as the fixture
  defect it is rather than as a failure of the behaviour under test

#### Scenario: The guard is still a guard

- **WHEN** a row is written whose stored business date contradicts what its own
  timestamp implies under the outlet's cutover
- **THEN** the database refuses it, from either side of the cutover, exactly as
  before this change

#### Scenario: The proof does not read the clock

- **WHEN** the assertions covering both sides of the cutover are run
- **THEN** they pass or fail identically regardless of the hour, the machine's
  timezone, or the database session's timezone
