## ADDED Requirements

### Requirement: The roll-call's people are the people the reader may see

The people Attendance lists as staff at an outlet in scope SHALL be every person
the reader may see who holds a live staff assignment there, as the database's
row-level policies decide what a reader may see. Whether the reader may
**manage** that person's account — deactivate them, re-issue their code, edit
their assignments — SHALL NOT decide whether they are listed.

Attendance SHALL obtain those people without the privileged account function:
it SHALL NOT read login identifiers, invites, account emails or account state
fingerprints, and opening it SHALL NOT wait on them.

#### Scenario: A staff member who also works elsewhere is on the manager's roll-call

- **WHEN** a person holds a live Employee assignment at Kalyani and another at
  Kanchrapara, and the Kalyani Franchise Admin, who does not run Kanchrapara,
  opens Kalyani's attendance day
- **THEN** that person is listed as staff, whether or not they carry a record on
  the day, and is not marked as off the staff list

#### Scenario: The manager sees only their own outlet's assignment

- **WHEN** the same Kalyani Franchise Admin reads that person on Attendance
- **THEN** the person's Kanchrapara assignment is not returned to them

#### Scenario: Opening Attendance does not call the account function

- **WHEN** any reader opens Attendance
- **THEN** no request is made to the privileged account function
