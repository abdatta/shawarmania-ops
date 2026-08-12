## ADDED Requirements

### Requirement: Assignment transitions use the Kolkata calendar

Every atomic assignment-set edit and explicit Mark as left transition SHALL derive its assignment end date from Asia/Kolkata inside the database transaction. All assignments ended by one transition SHALL receive the same date, and that date SHALL NOT precede the start date of an assignment created on the current Kolkata calendar day.

The transition date SHALL NOT be accepted from the browser or derived from the database session's UTC calendar. Existing complete-set authority, atomicity, history-retention, final-Super-Admin, private-email, and account-active-state invariants SHALL remain enforced.

#### Scenario: Assignment edit crosses Kolkata midnight before UTC

- **WHEN** an authorized admin changes an assignment after midnight in Kolkata while UTC is still on the previous date
- **THEN** the former assignment ends on the Kolkata date, the replacement starts validly, and the complete edit commits atomically

#### Scenario: Departure crosses Kolkata midnight before UTC

- **WHEN** an authorized admin confirms Mark as left during the Kolkata/UTC calendar gap
- **THEN** every live assignment ends on the Kolkata date, no end date precedes its start date, and sign-in is deactivated in the same transaction

#### Scenario: Client cannot choose the historical end date

- **WHEN** a caller invokes either account-transition command
- **THEN** the database derives one transition date itself and accepts no client-supplied assignment end date
