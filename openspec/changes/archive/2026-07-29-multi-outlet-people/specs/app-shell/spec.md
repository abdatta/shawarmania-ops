# app-shell — delta for multi-outlet-people

## ADDED Requirements

### Requirement: An outlet-scoped surface picks its outlet on the surface, never in the session

A surface that operates on one outlet SHALL take that outlet from a selector on
the surface itself, defaulted to the person's single such outlet and rendered
only when they hold assignments at more than one.

That selection SHALL be scoped to the surface: it SHALL NOT persist into any
other surface, SHALL NOT survive as session state, and SHALL NOT change what
any write is permitted to do — the database decides that from the assignment,
regardless of what is selected. No "acting as", active role, or session-level
outlet mode SHALL exist.

#### Scenario: A single-outlet manager sees no selector

- **WHEN** a Franchise Admin holding one assignment opens an outlet-scoped
  surface
- **THEN** the surface shows their outlet with no selector to operate

#### Scenario: A two-outlet manager picks per surface

- **WHEN** a Franchise Admin holding assignments at two outlets opens two
  different outlet-scoped surfaces
- **THEN** each surface offers its own outlet selector, and choosing on one
  does not change the other

#### Scenario: The selector confers no authority

- **WHEN** a request is crafted naming an outlet the person holds no live
  assignment at, whatever the surface selector shows
- **THEN** the database refuses it

## RENAMED Requirements

- FROM: `### Requirement: Navigation derives from the gate registry`
- TO: `### Requirement: Navigation derives from the gate registry and the session's assignments`

## MODIFIED Requirements

### Requirement: One bundle serves four role shells

The application SHALL ship as one bundle containing four role shells. The
Super Admin, Franchise Admin, and Employee shells SHALL be phone-first with
bottom tab navigation on phone widths; the Biller shell SHALL be
tablet-first with fixed chrome in which the primary action region never
scrolls out of view. All four SHALL be usable on a desktop browser.

A person SHALL be placed in the shell of the highest role they hold a live
assignment for, and SHALL be able to reach any other shell they hold a live
assignment for. One person SHALL never require more than one login to reach
every shell their assignments entitle them to.

#### Scenario: Phone roles get bottom tabs

- **WHEN** the Super Admin, Franchise Admin, or Employee shell renders on a
  phone viewport
- **THEN** navigation renders as a bottom tab bar reachable one-handed

#### Scenario: The Biller shell keeps fixed chrome

- **WHEN** the Biller shell renders on a tablet viewport
- **THEN** its header chrome and primary action region remain fixed, and no
  interaction causes the chrome to scroll away

#### Scenario: Every shell renders on desktop

- **WHEN** any role shell renders on a desktop viewport
- **THEN** it is fully usable, with navigation adapted to the wider layout

#### Scenario: The highest held role chooses the shell

- **WHEN** a person holding both a Franchise Admin and an Employee assignment
  signs in
- **THEN** they land on the Franchise Admin shell

### Requirement: Navigation derives from the gate registry and the session's assignments

Each shell's navigation SHALL be derived from the surface registry and the
current session, never hand-maintained per shell. Surfaces whose state excludes
them from the current mode SHALL produce no navigation entry.

Navigation SHALL be the union of the surfaces every live assignment entitles
the person to, so that a person who manages one outlet and works at another
reaches both sets of surfaces without any switching step.

#### Scenario: A registry change moves the navigation

- **WHEN** a surface's registry state changes such that it becomes visible
  to a role in the current mode
- **THEN** that role's navigation shows it with no navigation-specific code
  change

#### Scenario: Navigation unions the roles a person holds

- **WHEN** a person holds a Franchise Admin assignment at one outlet and an
  Employee assignment at another
- **THEN** their navigation contains the manager surfaces and their own
  attendance together, with no switcher and no duplicate entries

### Requirement: A uniform session context serves real and demo modes

Shell components and features SHALL read the current assignments, display name,
and the conveniences derived from them — the highest live role, and the single
outlet when there is exactly one — from a single session interface that both
the real and the demo session providers implement, so that the same shell
components serve both modes unchanged.

#### Scenario: The same shell serves both providers

- **WHEN** a shell component renders under the demo session provider or a
  real session provider
- **THEN** the component reads assignments, role, outlet, and display name
  identically, with no mode-conditional branches inside shell or feature code

#### Scenario: A single-assignment session reads as it did

- **WHEN** a session holds exactly one live assignment
- **THEN** the derived role and outlet are that assignment's, so surfaces
  written against a single outlet keep working unchanged
