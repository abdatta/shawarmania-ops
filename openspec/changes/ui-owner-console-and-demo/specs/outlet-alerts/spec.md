# Outlet Alerts

## ADDED Requirements

### Requirement: An alert carries a category, a priority, a subject and a message

Raising an alert SHALL require a category, a priority, a subject and a
message, and SHALL refuse a blank or whitespace-only subject or message by
naming the field rather than reporting that a required field is missing.

An alert SHALL record the outlet it concerns and who raised it.

#### Scenario: Raising an alert

- **WHEN** a Franchise Admin raises an alert with a category, priority, subject and message
- **THEN** the alert is recorded against their outlet, attributed to them, and appears in the owner's inbox

#### Scenario: A blank message

- **WHEN** an alert is submitted with a whitespace-only message
- **THEN** it is refused, nothing is recorded, and the refusal names the message field

### Requirement: An alert moves through a defined sequence of statuses

An alert SHALL be in exactly one of the statuses open, acknowledged, resolved
or closed. The system SHALL permit only these transitions:

- open → acknowledged
- acknowledged → resolved
- resolved → closed
- acknowledged → open, and resolved → open, for reopening

A closed alert SHALL be terminal. Any other transition SHALL be refused, and
the refusal SHALL name the transition rather than failing silently.

#### Scenario: The ordinary path

- **WHEN** an open alert is acknowledged, then resolved, then closed
- **THEN** each transition is accepted and the alert's status reflects the latest one

#### Scenario: Skipping acknowledgement

- **WHEN** a transition from open directly to closed is attempted
- **THEN** it is refused and the alert's status is unchanged

#### Scenario: A closed alert is final

- **WHEN** any transition is attempted on a closed alert
- **THEN** it is refused

### Requirement: Alerts carry a thread of responses

An alert SHALL carry responses in the order they were made, each attributed to
its author. Responding SHALL NOT change the alert's status on its own, and
changing the status SHALL NOT require a response.

#### Scenario: The owner responds

- **WHEN** the Super Admin responds to an open alert
- **THEN** the response appears on the alert attributed to them, and the alert's status is unchanged

### Requirement: The owner reads alerts across outlets; a manager reads only their own

The Super Admin SHALL see alerts from every outlet in one inbox, ordered so
that the ones needing attention are found first, with each alert's outlet
named. A Franchise Admin SHALL see only their own outlet's alerts, and a
request naming another outlet SHALL return nothing.

#### Scenario: The cross-outlet inbox

- **WHEN** the Super Admin opens the alerts inbox
- **THEN** alerts from every outlet are listed, each naming its outlet, with open and high-priority ones surfaced first

#### Scenario: A manager asks for another outlet

- **WHEN** a Franchise Admin requests alerts for an outlet that is not theirs
- **THEN** no alerts are returned

### Requirement: Priority is conveyed by more than colour

Every place an alert's priority is shown SHALL convey it by a word and by a
non-colour visual distinction, not by colour alone.

#### Scenario: A colour-blind reader

- **WHEN** an alert of any priority is rendered
- **THEN** the priority is stated in words alongside a non-colour marker
