## ADDED Requirements

### Requirement: The Hyperpure health line carries the same repair as Zomato's

The Hyperpure health line on the sync surface SHALL offer Reconnect once
capture is proven, wired to the same reconnect dispatch as Zomato's, and SHALL
state which of its states holds in the surface's existing vocabulary: alive,
reading, lapsed (with Reconnect offered), awaiting a code (the shared code
card), or shape-changed (a maintainer's). A session that has ended SHALL point
at repair rather than only at the manual upload; the manual upload SHALL remain
available regardless of state.

#### Scenario: A lapsed Hyperpure offers a working reconnect

- **WHEN** the Hyperpure session has ended and the Zomato parent is alive
- **THEN** the line reads "Session ended" with a Reconnect action, and acting
  on it completes without any code

#### Scenario: The line returns to quiet after a successful capture

- **WHEN** a capture-only run stores a working Hyperpure session and the next
  read succeeds
- **THEN** the line reads "All quiet" with its last-run time, and the manual
  upload remains present but unremarkable

#### Scenario: A shape change stays a maintainer's

- **WHEN** the Hyperpure reader cannot understand the aggregator's response
- **THEN** the line reads "Stuck" with the maintainer note, and offers no
  reconnect that could not help

### Requirement: A half-successful reconnect is named at the moment it happens

When a reconnect signs Zomato in but does not land a Hyperpure session — or
the reverse, should a Hyperpure-only path ever exist — the surface SHALL name
the channel that did not follow at that moment, on that channel's own health
line, rather than reporting an unqualified success or leaving the manual
upload as the only signal. Each channel's outcome SHALL be knowable
separately.

#### Scenario: Zomato signed in, Hyperpure did not follow

- **WHEN** a reconnect ends with the Zomato session stored and no Hyperpure
  token captured
- **THEN** the Zomato line reports success while the Hyperpure line says the
  handoff did not follow and offers trying again

#### Scenario: Success is per channel, not one word for both

- **WHEN** a reconnect completes with both channels stored
- **THEN** each line independently reports its own channel as signed in
