## ADDED Requirements

### Requirement: The app exposes installation only when it is actionable

The app SHALL expose an app-owned installation action in public and real
application chrome when the current browser can complete either a native PWA
installation or the documented iOS Safari manual path. The action SHALL be
absent when the app is installed, the browser is unsupported or ineligible,
or the user is in demo mode.

#### Scenario: Native installation is offered

- **WHEN** an uninstalled browser reports native PWA installation capability
  on a public page or in a real role shell
- **THEN** the header shows an action named “Install Shawarmania Ops as an app”
- **AND** activating it opens the browser's native installation prompt at most
  once
- **AND** the action is removed after the browser records the user's choice

#### Scenario: Native capability survives sign-in navigation

- **WHEN** the browser reports native installation capability on a public page
  and the user then signs in and reaches a real role shell
- **THEN** the shell still shows the install action
- **AND** activating it opens the originally captured native prompt

#### Scenario: Installation elsewhere removes the action

- **WHEN** the browser reports that the PWA was installed through any
  installation surface
- **THEN** the app-owned install action is removed immediately

#### Scenario: An installed app offers no installation action

- **WHEN** the app is running in standalone or fullscreen display mode, or
  iOS reports that it is running standalone
- **THEN** no app-owned install action is rendered

#### Scenario: iOS Safari explains its manual path

- **WHEN** an uninstalled iPhone or iPad opens the app in Safari browser mode
- **THEN** the header shows the install action
- **AND** activating it explains Share, Add to Home Screen, Open as Web App and
  Add in that order
- **AND** it does not claim to have opened a native prompt

#### Scenario: Unsupported or ineligible browser offers no dead action

- **WHEN** the app is not installed but the browser supplies neither native
  installation capability nor the supported iOS Safari manual path
- **THEN** no app-owned install action is rendered

#### Scenario: Demo mode does not promote installation

- **WHEN** native or iOS installation capability exists while a demo shell is
  visible
- **THEN** the demo shell renders no app-owned install action

### Requirement: The install action fits persistent operational chrome

The install action SHALL use the app's semantic control tokens, SHALL remain a
44 px header control at rest, SHALL teach its visible “Install” label once per
tab, and SHALL remain understandable without motion. It SHALL appear before
theme and account actions on public and real phone chrome, and after sync
status but before theme and account actions on real counter chrome.

#### Scenario: The label teaches itself once

- **WHEN** installation first becomes actionable in a tab without reduced
  motion
- **THEN** the icon-sized action expands after three seconds to show “Install”
- **AND** it collapses again after five seconds
- **AND** navigating or reloading within that tab does not replay the timed
  reveal

#### Scenario: Hover and focus reveal the label

- **WHEN** the collapsed action receives pointer hover or keyboard focus
- **THEN** its visible “Install” label is revealed without changing its
  accessible name

#### Scenario: Reduced motion keeps a stable label

- **WHEN** installation is actionable and the user prefers reduced motion
- **THEN** the full “Install” label is visible without a width animation
- **AND** it remains stable until the action is used or ceases to be available

#### Scenario: The action remains usable in every supported shell layout

- **WHEN** the public header, a real phone shell and a real counter shell are
  rendered at their supported phone and landscape-tablet widths in either
  theme
- **THEN** the install action uses semantic primary styling
- **AND** it does not obscure, truncate or displace the shell's navigation,
  sync, theme or account controls
