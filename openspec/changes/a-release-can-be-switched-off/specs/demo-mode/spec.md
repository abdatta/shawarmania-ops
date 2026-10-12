# Delta: demo-mode

The demo shows every release switched on and lets a walkthrough turn one off from
the same Releases page the owner uses; the gate registry and release switches stay
separate layers. Design D1, D15.

## ADDED Requirements

### Requirement: Gates and release switches are separate layers

The gate registry SHALL remain a build-time declaration of whether each surface
exists and is real, changed only by a reviewed edit. It SHALL carry no runtime
state, and no release switch SHALL decide whether a surface exists. A release switch
SHALL decide only which behaviour a surface that exists runs.

#### Scenario: A switch cannot hide a surface

- **WHEN** a release switch is off
- **THEN** every surface the gate registry makes reachable remains reachable

### Requirement: The demo shows every release on, and turns one off from its Releases page

In demo mode, release switches SHALL be read from the mock adapter, with every
declared switch on by default. The Releases page SHALL be walkable in demo mode,
served by the mock adapter: **Turn off** and **Turn on** SHALL change only the
demo's local answers, stored in the browser, taking effect on reload and reset with
the demo scenario, and SHALL never reach the backend. Its mock tablets SHALL show
every state the page can show: running, waiting for a free moment, stale and
failing.

The demo's Releases page SHALL be reached by its address, `/demo/owner/releases`,
reconstructing the owner role from the URL as every demo deep link does. The demo
SHALL add no account menu, banner control or navigation entry for it.

#### Scenario: The newest behaviour is what the demo shows

- **WHEN** a change adds a release switch and the demo is opened
- **THEN** the demo runs that release on

#### Scenario: A walkthrough compares old and new

- **WHEN** a release is turned off from the demo's Releases page
- **THEN** after reload the demo runs it off, no request leaves the app origin, and
  resetting the demo turns it back on

#### Scenario: The demo page opens from its address

- **WHEN** `/demo/owner/releases` is opened in a fresh browser
- **THEN** the demo's Releases page renders in the owner role, and no demo screen
  links to it
