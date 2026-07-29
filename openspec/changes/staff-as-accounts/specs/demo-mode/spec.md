# demo-mode — delta for staff-as-accounts

## ADDED Requirements

### Requirement: A manual attendance entry is demonstrable

The demo Franchise Admin SHALL be able to record a past-time check-in for a
person at their outlet, served entirely by the mock adapters, and the
resulting row SHALL show who entered it — so the escape hatch that replaced
the kiosk is walkable, not described. No request SHALL leave the app origin.

#### Scenario: The demo manager records a morning check-in at noon

- **WHEN** the demo Franchise Admin records a check-in for a colleague with
  an earlier time on the current business day
- **THEN** the day updates to show the event marked as manually entered by
  the demo manager, and no request leaves the app origin

## MODIFIED Requirements

### Requirement: Demo fixtures include the unconfigured states, not only the finished one

Demo fixtures SHALL include the people states an admin actually has to
recognise and repair: at least one account with a migration placeholder
address (cannot be invited until it is corrected), at least one with an
invite outstanding (activated by nobody yet), at least one departed person
(off the staff list, history intact), and at least one deactivated person who
has not left (access cut, still on the day). Creating a person SHALL be
demonstrable in one step, ending in the issued-code handover.

This exists because fixtures that describe an already-configured business are
what allowed a feature to ship unreachable: every test started from a wired-up
world, and none asked how that world comes to exist.

#### Scenario: The demo shows people who cannot check in, each for its own reason

- **WHEN** the demo People surface renders
- **THEN** a placeholder-address person, an invite-outstanding person, a
  departed person, and a deactivated person are all present, each stating its
  own reason and next step

#### Scenario: Creating a person is demonstrable, not pre-baked

- **WHEN** a demo walkthrough creates a person from the People surface
- **THEN** one step yields the person on the staff list and an issued-code
  handover, without the demo tree making any request beyond the app origin
