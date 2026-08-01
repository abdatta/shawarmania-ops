# demo-mode (delta)

## MODIFIED Requirements

### Requirement: The demo dataset includes a person who works at both outlets

Demo fixtures SHALL include at least one person holding live assignments at
both outlets, with attendance recorded at each, so that the multi-outlet path
is walkable rather than asserted. The demo dataset SHALL also include the
owner holding a Franchise Admin assignment at one outlet, and at least one
owner-recorded non-cash entry in that outlet's books.

The owner persona SHALL reach the outlet-level surfaces of **both** outlets,
including the one they hold no assignment at, so that the owner's reach is
walkable rather than asserted. The difference between the two outlets SHALL be
what the surfaces offer rather than whether they open: the drawer is offered at
the outlet they manage and at no other.

The demo persona switcher remains the way a demonstrator views the app as
another role, and SHALL NOT be presented as, or confused with, an in-app role
switch — no such thing exists.

#### Scenario: The split-shift person is walkable

- **WHEN** a demonstrator opens the demo as the person assigned to both outlets
- **THEN** their own attendance shows days worked at each outlet, each naming
  its outlet, and their check-in action offers no outlet choice

#### Scenario: The owner-as-manager is walkable

- **WHEN** a demonstrator opens the demo as the owner and selects the outlet
  they hold a manager assignment at
- **THEN** that outlet's operational surfaces are reachable and its day can be
  closed

#### Scenario: The owner at the outlet they do not manage is walkable

- **WHEN** a demonstrator opens the demo as the owner and selects the outlet
  they hold no assignment at
- **THEN** that outlet's attendance is shown and a waiting day there can be
  approved, while its cash surface offers neither a day close nor a withdrawal

#### Scenario: The owner is not on either outlet's attendance day

- **WHEN** a demonstrator opens the demo as the owner and views each outlet's
  attendance day
- **THEN** the owner does not appear on either, since they hold no staff
  assignment at either

#### Scenario: An owner-recorded entry reads as the owner's

- **WHEN** a demonstrator opens the expenses or stock ledger of the outlet the
  owner recorded into
- **THEN** that entry is shown as the owner's, distinguishable from the
  manager's own entries
