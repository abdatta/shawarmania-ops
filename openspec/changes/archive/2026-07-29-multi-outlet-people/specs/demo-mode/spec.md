# demo-mode — delta for multi-outlet-people

## ADDED Requirements

### Requirement: The demo dataset includes a person who works at both outlets

Demo fixtures SHALL include at least one person holding live assignments at
both outlets, with attendance recorded at each, so that the multi-outlet path
is walkable rather than asserted. The demo dataset SHALL also include the
owner holding a Franchise Admin assignment at one outlet, and at least one
owner-recorded non-cash entry in that outlet's books.

The demo persona switcher remains the way a demonstrator views the app as
another role, and SHALL NOT be presented as, or confused with, an in-app role
switch — no such thing exists.

#### Scenario: The split-shift person is walkable

- **WHEN** a demonstrator opens the demo as the person assigned to both outlets
- **THEN** their own attendance shows days worked at each outlet, each naming
  its outlet, and their check-in action offers no outlet choice

#### Scenario: The owner-as-manager is walkable

- **WHEN** a demonstrator opens the demo as the owner
- **THEN** the outlet they hold a manager assignment at is reachable with its
  operational surfaces, and the other outlet is not

#### Scenario: An owner-recorded entry reads as the owner's

- **WHEN** a demonstrator opens the expenses or stock ledger of the outlet the
  owner recorded into
- **THEN** that entry is shown as the owner's, distinguishable from the
  manager's own entries

## MODIFIED Requirements

### Requirement: Demo fixtures include the unconfigured states, not only the finished one

Demo fixtures SHALL include the people states an admin actually has to
recognise and repair: at least one account with a migration placeholder address
(cannot be invited until it is corrected), at least one with an invite
outstanding (activated by nobody yet), at least one person holding no live
assignment (formerly "departed" — off every staff list, history intact), at
least one whose assignment at one outlet has ended while another continues, and
at least one deactivated person who still holds a live assignment.

#### Scenario: The People surface demonstrates every unfinished state

- **WHEN** a demonstrator opens the People surface in demo mode
- **THEN** the placeholder-address, invite-outstanding, no-assignment,
  one-assignment-ended and deactivated states are all present and each states
  what is wrong and what to do next
