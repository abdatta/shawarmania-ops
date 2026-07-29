# outlet-expenses — delta for multi-outlet-people

## ADDED Requirements

### Requirement: An owner-recorded expense is visibly the owner's, and never cash

The Super Admin SHALL be able to record a non-cash expense at any outlet
without holding an assignment there. Such an expense SHALL carry the owner as
the recording person, and the expenses surface SHALL show it as the owner's
entry rather than as an indistinguishable outlet expense.

A cash expense from that path SHALL be refused by the database, not by the
form, so that the owner's remote entries are mathematically incapable of moving
an outlet's drawer.

An expense recorded by a Super Admin who does hold a Franchise Admin assignment
at that outlet is an ordinary manager expense and SHALL be unrestricted,
because that authority comes from the assignment.

#### Scenario: The owner records a UPI expense remotely

- **WHEN** a Super Admin records a UPI expense at an outlet they hold no
  assignment at
- **THEN** the expense is stored, attributed to them, and appears on that
  outlet's expenses surface marked as the owner's

#### Scenario: A remote cash expense is refused by the database

- **WHEN** a Super Admin holding no assignment at an outlet attempts to record
  a cash expense there, including by a hand-crafted request
- **THEN** the database refuses the write and the day's cash position is
  unchanged

#### Scenario: The owner's remote expense does not move the drawer

- **WHEN** a Super Admin records a non-cash expense at an outlet and that
  outlet's daily cash figures are read
- **THEN** the expected closing cash is unchanged, because only cash expenses
  move it
