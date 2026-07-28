## ADDED Requirements

### Requirement: The Employee's demo experience is a complete attendance day

Because attendance is the whole of what an Employee does, the demo tree SHALL
serve the attendance surfaces from mock adapters covering at least a normal
completed day, a blocked check-in awaiting an override, and a day cleared by an
approved override — so that a four-role walkthrough reaches a working fourth
role rather than an empty shell.

#### Scenario: A demo Employee walks their own surfaces

- **WHEN** the demo tree is entered as the Employee persona
- **THEN** the home screen offers a working check-in action and the attendance history shows the normal, blocked, and overridden days

#### Scenario: A demo check-in reaches no network

- **WHEN** a check-in, check-out, override request, or override approval is performed anywhere in the demo tree
- **THEN** the result is served from fixtures, and no request leaves the application origin

#### Scenario: A demo manager approves an override

- **WHEN** the demo tree is entered as the Franchise Admin persona and an override awaiting approval is approved
- **THEN** the row updates in the demo session to show the approver and reason, without any backend write
