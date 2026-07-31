## ADDED Requirements

### Requirement: A badge counts work somebody else is waiting on

A badge SHALL mean one thing across the whole application: how many items are
waiting for the person reading it to act. It SHALL NOT be used for totals,
status, decoration, or anything that resolves without a human doing something.

A badge with a known count SHALL state the number. Where the count is known to
be non-zero but the number itself is not meaningful to the reader, a bare dot
SHALL be shown instead. A count of zero SHALL render nothing at all, so the
absence of a badge always means there is nothing waiting.

#### Scenario: Work is waiting

- **WHEN** a surface reports three items waiting for the current person
- **THEN** a badge showing 3 is rendered against that surface

#### Scenario: Nothing is waiting

- **WHEN** a surface reports no items waiting
- **THEN** no badge is rendered, and no empty or zero badge appears in its place

#### Scenario: A badge is not a status light

- **WHEN** a surface has a condition that resolves on its own, such as a sync in
  progress
- **THEN** no badge is shown for it

### Requirement: The number carries the meaning, never the colour alone

A badge SHALL carry an accessible name stating what is waiting and how many, so
that it is understood without seeing it. Colour SHALL NOT be the only signal
distinguishing a badge from its surroundings.

The badge SHALL use the same colour pair as the primary action, so that the
thing demanding attention and the button that clears it read as the same
concern, and so that no new colour pair enters the system unverified.

#### Scenario: A badge is read aloud

- **WHEN** a screen reader reaches a nav item carrying a badge of three
- **THEN** it announces the surface and that three arrivals are waiting for
  approval, rather than announcing the bare number three

#### Scenario: A bare dot still says what it means

- **WHEN** a dot with no number is rendered
- **THEN** it carries an accessible name describing what is waiting there

### Requirement: A surface declares its own count

A surface SHALL declare where its badge count comes from, and the shell SHALL
render it without knowing what the count is about. Adding a badge to a further
surface SHALL NOT require changing the shell.

A count SHALL be scoped by the same authority as the surface it belongs to: a
badge SHALL never reveal that work exists somewhere the reader could not open.

#### Scenario: A second surface is badged

- **WHEN** a further surface declares a count source
- **THEN** its navigation entry carries a badge with no change to either shell

#### Scenario: A badge respects tenancy

- **WHEN** a Franchise Admin holding one outlet reads a badged surface while
  another outlet holds waiting work
- **THEN** their badge counts only their own outlet's work

### Requirement: A count is fresh on arrival, not live

A badge count SHALL be read when the surface or shell that shows it is first
rendered, and SHALL be read again when the application returns to the
foreground. It SHALL NOT be polled on a timer and SHALL NOT hold an open
subscription.

A badge is therefore accurate as of the reader's last arrival, and may lag work
that arrives while a screen sits open. This is a deliberate trade against
battery on a device that spends its day in an apron.

#### Scenario: The app is brought back

- **WHEN** the application returns to the foreground after work arrived while it
  was backgrounded
- **THEN** the count is read again and the badge reflects it

#### Scenario: No timer runs

- **WHEN** a badged screen is left open and untouched
- **THEN** no repeated network request is made on its behalf
