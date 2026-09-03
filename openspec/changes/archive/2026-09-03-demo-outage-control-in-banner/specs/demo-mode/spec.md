## MODIFIED Requirements

### Requirement: The demo indicator is always visible and cannot be dismissed

Every demo surface SHALL display a persistent demo indicator identifying the
data as fabricated. The indicator SHALL offer no dismiss affordance and SHALL
remain visible on every demo route, in both themes, on phone and tablet
viewports. On the Biller shell it SHALL NOT occlude the billing actions.

The indicator SHALL carry a control that **leaves the demo**, returning to the
application root. Leaving is not dismissing: the indicator goes only because the
fabricated data it warns about has gone with it, so every control in the
indicator either stays within the demo or leaves it entirely, and none of them
hides fabricated data that is still on screen.

The indicator SHALL be the **only** chrome the demo adds to a surface, and it
SHALL occupy a single row at every supported viewport. No demo control,
setting or explanation SHALL render outside it. A control that does not fit a
narrow viewport at full width SHALL be spelled shorter — its icon kept and its
words moved to an accessible label — and SHALL NOT be hidden by a breakpoint,
moved below the indicator, or allowed to wrap the indicator onto a second row.

A demo setting SHALL NOT displace the surface beneath it. The product begins
immediately below the indicator, so that a reader can tell the demonstration
harness from the application by looking.

#### Scenario: The indicator is present on every demo route

- **WHEN** any demo route renders, in either theme, on a phone or tablet
  viewport
- **THEN** the demo indicator is visible

#### Scenario: The indicator cannot be dismissed

- **WHEN** a user inspects the demo indicator for controls
- **THEN** it exposes no affordance that hides or closes it, and no
  interaction on the page removes it short of leaving demo mode

#### Scenario: A visitor leaves the demo

- **WHEN** a visitor uses the indicator's exit
- **THEN** the application root is shown, the demo indicator is gone, and no
  demo surface remains rendered

#### Scenario: The demo adds no second strip

- **WHEN** any demo surface renders, including the Biller's tablet
- **THEN** the indicator is the only demo-owned chrome present, and the
  surface's own first element sits directly beneath it

#### Scenario: The indicator on a narrow phone

- **WHEN** the indicator renders at a 375px viewport with every control it
  carries
- **THEN** it occupies one row, every control remains present and operable, and
  each control that dropped its words carries them as an accessible label

## ADDED Requirements

### Requirement: The demo reaches both offline scenes from the indicator

The demo SHALL be able to reach, without developer tools and without leaving the
application, the two states a counter tablet meets when its backend is
unreachable:

1. **The network drops while the tablet stays open.** Reads already made remain
   on screen, new work continues to be accepted, commands accumulate undelivered,
   and the sync indicator reports the queue and escalates as it ages.
2. **The tablet is closed and reopened with no backend.** The counter resumes
   from its stored record, and every read is labelled as of the last successful
   read.

These SHALL be offered as one connectivity choice in the demo indicator, whose
options name the state being entered rather than an action being performed, and
whose current option is legible at every supported viewport.

Returning the choice to online SHALL drain the accumulated work exactly once, by
the same delivery path an ordinary reconnection uses. The demo SHALL NOT
introduce a settlement path that production does not have.

The resumed state SHALL be entered from a resume record identical in shape and
schema version to the record a real tablet builds from its own storage, so that
the demonstrated scene is the implemented one.

The demo's connectivity SHALL also honour the browser's own reported
connectivity, so that a genuinely disconnected demonstration behaves as an
offline demonstration rather than claiming to be online.

#### Scenario: The network drops mid-shift

- **WHEN** the demonstrator chooses the dropped-network state and rings a bill
- **THEN** the counter accepts it, the bill is held undelivered, and the sync
  indicator reports the waiting work rather than the counter refusing it

#### Scenario: Reconnecting drains the queue

- **WHEN** connectivity is returned to online after work has accumulated
- **THEN** the waiting commands are delivered exactly once and the sync
  indicator returns to settled, with no bill duplicated

#### Scenario: The tablet is closed and reopened

- **WHEN** the demonstrator chooses the closed-and-reopened state
- **THEN** the counter resumes against its stored record, showing the menu,
  pipeline and this shift's bills labelled as of their last read

#### Scenario: The browser is genuinely offline

- **WHEN** the browser reports no connectivity while the demo choice is online
- **THEN** the demo behaves as offline

### Requirement: Offline is demonstrated only where the application has it

The connectivity choice SHALL be offered on the counter tablet's walkthrough and
nowhere else. It SHALL be **absent** from the indicator on every surface that
has no offline capability, rather than present and inert.

The three personal shells hold no local queue and no resume record, so a control
implying they continue working without a backend would misrepresent the
application. Its absence is the accurate statement.

Absence SHALL follow from the surface being rendered rather than from a test of
which role is being viewed, so that it cannot disagree with what is on screen.

#### Scenario: A phone role's indicator

- **WHEN** the indicator renders for the Super Admin, Franchise Admin or
  Employee walkthrough
- **THEN** no connectivity choice is offered

#### Scenario: A Biller route that is not the tablet

- **WHEN** the indicator renders on a Biller URL that resolves to no tablet
  surface
- **THEN** no connectivity choice is offered, because no counter is present to
  be offline

### Requirement: Demo connectivity is walkthrough state and resets with it

The demo's connectivity SHALL start online, SHALL survive a role switch so that
a scene begun at the counter can be continued from a phone and returned to, and
SHALL return to online when the demo is reset.

#### Scenario: Stepping to a phone mid-outage

- **WHEN** the demonstrator takes the counter offline and switches role to a
  phone and back
- **THEN** the counter is still offline, with its accumulated work intact

#### Scenario: Reset restores connectivity

- **WHEN** the demo is reset while offline
- **THEN** the dataset returns to its starting state and connectivity is online
