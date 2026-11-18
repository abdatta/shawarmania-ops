## ADDED Requirements

### Requirement: A deactivation is noted from the business day it happened on

The By day roll-call SHALL note a listed person as deactivated on the business
day their account was deactivated and on every later day they are listed, and
SHALL NOT note them on an earlier day, when they could still sign in. That
business day SHALL be resolved from the moment of deactivation through the
cutover of the outlet the row belongs to, never from the calendar date, so a
deactivation made after midnight and before the cutover is noted on the business
day still running. An inactive account whose moment of deactivation is not
recorded SHALL be noted on every day it is listed.

#### Scenario: Deactivated in the night, noted on the day before

- **WHEN** a Biller was deactivated at 02:00 on 13 October, before their
  outlet's 04:00 cutover, and a manager opens 12 October
- **THEN** the Biller is listed on 12 October, noted as deactivated

#### Scenario: Deactivated during late service, noted that same night

- **WHEN** a manager deactivates an Employee at 00:55 and opens today's
  roll-call before the cutover
- **THEN** the Employee's row on that business day is noted as deactivated
