# Demo Mode (delta)

## MODIFIED Requirements

### Requirement: The Employee's demo experience is a complete attendance day

Because attendance is the whole of what an Employee does, the demo tree SHALL
serve the attendance surfaces from mock adapters covering at least an arrival
waiting for approval, an arrival a manager has approved on site, an arrival
approved from elsewhere with a reason, a late arrival, and a day with no
arrival at all past its deadline — so that a four-role walkthrough reaches a
working fourth role rather than an empty shell, and so the month view
demonstrates a pattern rather than a single row.

#### Scenario: A demo Employee walks their own surfaces

- **WHEN** the demo tree is entered as the Employee persona
- **THEN** the home screen offers a working check-in action, states that a recorded arrival waits for a manager, and the attendance history shows the waiting, approved, late and absent days over a range

#### Scenario: A demo check-in reaches no network

- **WHEN** a check-in or an approval is performed anywhere in the demo tree
- **THEN** the result is served from fixtures, and no request leaves the application origin

#### Scenario: A demo manager approves on site

- **WHEN** the demo tree is entered as the Franchise Admin persona and a waiting day is approved with the demo position inside the outlet's fence
- **THEN** the row updates in the demo session to show the approver and that they were at the outlet, with no reason asked for and no backend write

#### Scenario: A demo manager approves from elsewhere

- **WHEN** the demo Franchise Admin approves a waiting day with the demo position outside the outlet's fence
- **THEN** a reason is required before the approval is accepted, and the row then shows the approver, their reason, and that they were not at the outlet

#### Scenario: A demo manager reads one person's month

- **WHEN** the demo Franchise Admin opens a staff member's attendance over a range
- **THEN** the fixtures serve present, late, absent and waiting days with a summary, served entirely from mocks

### Requirement: A manual attendance entry is demonstrable

The demo Franchise Admin SHALL be able to record a past-time check-in for a
person at their outlet, served entirely by the mock adapters, and the
resulting row SHALL show who entered it — so the escape hatch that replaced
the kiosk is walkable, not described. No request SHALL leave the app origin.

#### Scenario: The demo manager records a morning check-in at noon

- **WHEN** the demo Franchise Admin records a check-in for a colleague with
  an earlier time on the current business day
- **THEN** the day updates to show the event marked as manually entered by
  the demo manager, settled without a separate approval, and no request leaves
  the app origin
