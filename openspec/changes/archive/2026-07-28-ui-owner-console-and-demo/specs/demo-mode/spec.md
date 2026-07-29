# Demo Mode

## ADDED Requirements

### Requirement: The demo dataset is one internally consistent scenario across every surface

The demo dataset SHALL be one set of records spanning every feature, for more
than one outlet, over a realistic recent period — and figures on one surface
SHALL be derived from the records another surface shows, never authored
independently.

Specifically: an outlet's sales figure SHALL be the sum of the bills the
counter holds for it; its cash close SHALL reconcile against those of its
bills paid in cash; its stock quantities SHALL equal the sum of their own
movements; and its profit SHALL follow from those sales, expenses and
movements.

A dataset that contradicts itself SHALL fail at construction, not on screen.

#### Scenario: The dashboard agrees with the counter

- **WHEN** a walkthrough reads an outlet's sales on the owner console and then opens that outlet's bills
- **THEN** the bills sum to the figure the console showed

#### Scenario: A contradictory fixture is rejected

- **WHEN** the demo dataset is constructed with a stored figure that its own records do not produce
- **THEN** construction throws, naming what disagreed

### Requirement: Every outlet in the demo dataset numbers its own bills

Bill numbers in the demo dataset SHALL be sequential within each outlet and
independent between outlets, mirroring the per-outlet sequence the database
enforces.

#### Scenario: Two outlets both start at one

- **WHEN** the demo dataset is constructed for two trading outlets
- **THEN** each outlet's bills are numbered from one, without reusing or skipping a number

### Requirement: The demo scenario includes states where something has gone wrong

The demo dataset SHALL include, without any staging by the person running it:
a stock item at or below its threshold, a business day closed with a
difference, a bill that arrived after its day was closed, a check-in blocked
by the geofence and awaiting a decision, and an open alert at high priority.

#### Scenario: The awkward states are present on arrival

- **WHEN** a walkthrough opens the demo with no interaction beyond navigation
- **THEN** the low-stock item, the cash difference, the reconciliation exception, the blocked check-in and the open high-priority alert are all reachable

### Requirement: Demo state resets to the starting scenario on demand

Demo mode SHALL offer a control, reachable from every demo surface, that
returns the dataset to its starting state. The control SHALL state what it
does before doing it, and SHALL keep the reader on the role they are viewing.

#### Scenario: Resetting mid-walkthrough

- **WHEN** a walkthrough that has recorded bills, movements and expenses resets the demo
- **THEN** the dataset returns to its starting state, and the reader remains on the same role's surface

#### Scenario: The reset is announced

- **WHEN** the reset control is used
- **THEN** the consequence is stated before anything is discarded

### Requirement: The demo link is found in the owner's account menu, not on the public landing page

The public landing page SHALL NOT offer a route into demo mode. The Super
Admin's account menu SHALL offer one, together with an action that copies the
link, and that link SHALL address demo mode itself rather than any single
role.

Demo mode SHALL remain reachable without authentication, so that a shared link
works for a recipient who has no account.

#### Scenario: The public landing page

- **WHEN** a visitor with no session opens the application root
- **THEN** no route into demo mode is offered

#### Scenario: The owner produces the link

- **WHEN** the Super Admin opens their account menu
- **THEN** a demo entry and a copy-link action are offered, and the copied link addresses demo mode rather than one role's path

#### Scenario: A recipient with no account

- **WHEN** somebody with no session opens the copied link
- **THEN** demo mode renders, without a sign-in being requested

### Requirement: The owner's own demo link meets the signed-in interstitial

Following the demo link while signed in SHALL render the signed-in
interstitial, for every role including the Super Admin. No role SHALL be
given a path into demo mode that skips it.

#### Scenario: The owner follows their own link

- **WHEN** a signed-in Super Admin opens demo mode from their account menu
- **THEN** the interstitial naming the signed-in state is shown, and continuing is an explicit choice

### Requirement: A documented walkthrough route ships with the demo

The repository SHALL document a route through all four roles that someone who
did not build the product can follow, and that document SHALL open by saying
where the demo link is found.

#### Scenario: Somebody who did not build it runs a demo

- **WHEN** a reader follows the documented walkthrough from its first step
- **THEN** the document tells them where to obtain the link before it asks them to open anything
