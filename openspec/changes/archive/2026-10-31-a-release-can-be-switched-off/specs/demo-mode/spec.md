# Delta: demo-mode

The demo shows every change gate on and lets a walkthrough turn one off from
the same Change gates page the owner uses; the gate registry and change gates stay
separate layers. Design D1, D15.

## ADDED Requirements

### Requirement: Gates and change gates are separate layers

The gate registry SHALL remain a build-time declaration of whether each surface
exists and is real, changed only by a reviewed edit. It SHALL carry no runtime
state, and no change gate SHALL decide whether a surface exists. A change gate
SHALL decide only which behaviour a surface that exists runs.

#### Scenario: A gate cannot hide a surface

- **WHEN** a change gate is off
- **THEN** every surface the gate registry makes reachable remains reachable

### Requirement: The demo shows every change gate on, and turns one off from its Change gates page

In demo mode, change gates SHALL be read from the mock adapter, with every
declared gate on by default. The Change gates page SHALL be walkable in demo mode,
served by the mock adapter: **Turn off** and **Turn on** SHALL change only the
demo's local answers, stored in the tab's session storage with their history so a
demo reload keeps both, and reset with the demo scenario; and SHALL never reach the
backend. A turn SHALL take effect at once: the demo's screens restart under the new
answers, as a real page would after its reload, and the demo's data is kept. Its mock tablets SHALL show
every state the page can show: running, waiting for a free moment, stale and
failing.

The demo's Change gates page SHALL be reached by its address, `/demo/owner/change-gates`,
reconstructing the owner role from the URL as every demo deep link does. The demo
SHALL add no account menu, banner control or navigation entry for it.

#### Scenario: The newest behaviour is what the demo shows

- **WHEN** a change adds a change gate and the demo is opened
- **THEN** the demo runs that change on

#### Scenario: A walkthrough compares old and new

- **WHEN** a release is turned off from the demo's Change gates page
- **THEN** after reload the demo runs it off, no request leaves the app origin, and
  resetting the demo turns it back on

#### Scenario: The demo page opens from its address

- **WHEN** `/demo/owner/change-gates` is opened in a fresh browser
- **THEN** the demo's Change gates page renders in the owner role, and no demo screen
  links to it
