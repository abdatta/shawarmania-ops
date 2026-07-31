# App Shell

## Purpose

Guarantees that one bundle serves four role-appropriate shells — phone-first with bottom tabs for Super Admin, Franchise Admin and Employee, fixed tablet chrome for the Biller — with navigation derived from the gate registry, a uniform session context serving real and demo modes, the theme toggle reachable everywhere, stable role paths, and shared layout primitives every surface composes.

## Requirements

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

A registry entry MAY declare that its surface has work waiting, and where that
count comes from. Where one does, the shell SHALL render the count as a badge
on that navigation entry, in every shell that shows the entry. The shell SHALL
NOT know what any particular count means, so badging a further surface is a
registry change rather than a shell change.

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

#### Scenario: A surface with work waiting is badged in navigation

- **WHEN** a registry entry declares a count source and that source reports
  work waiting for the current person
- **THEN** that navigation entry carries a badge with the count, in both the
  phone and counter shells

#### Scenario: A surface with nothing waiting is not badged

- **WHEN** a registry entry declares a count source and that source reports
  nothing waiting
- **THEN** the navigation entry renders exactly as an unbadged entry does

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

### Requirement: The theme toggle is reachable from every screen

Every shell SHALL expose the theme toggle in its persistent chrome, so the
theme can be changed from any screen without navigating elsewhere.

#### Scenario: Toggling from any shell

- **WHEN** a user activates the theme toggle from any role shell, on any
  screen
- **THEN** the theme switches immediately on that screen

### Requirement: Shared layout primitives exist for every later surface

The shell SHALL provide shared layout primitives — page header, data table,
empty state, form sheet, and confirm dialog — that consume semantic design
tokens only. The data table SHALL render money through the single money
formatter, right-aligned in tabular numerals, and SHALL render a provided
empty state rather than a bare absence of rows. The empty state SHALL state
what to do next. The confirm dialog SHALL state the consequence of the
action in plain words. Form sheet inputs SHALL be at least 16px so mobile
browsers do not zoom on focus.

#### Scenario: Primitives are themed through semantic tokens

- **WHEN** the layout primitives render in light and in dark theme
- **THEN** their colours come from semantic tokens, with no raw hex values
  in component code

#### Scenario: The data table shows an empty state

- **WHEN** a data table receives zero rows
- **THEN** it renders the provided empty state, which says what to do next

#### Scenario: Money cells align

- **WHEN** a data table column is declared as money
- **THEN** its values render right-aligned in tabular numerals through the
  money formatter, from integer paise

### Requirement: Role paths are stable and readable

Each role shell SHALL live under a stable path segment — `owner`, `admin`,
`biller`, `staff` — used consistently by routing, the registry, and shared
links, in both real and demo trees. Each segment SHALL name the person holding
the role, never the place they work or the device they hold.

#### Scenario: Role deep links are stable

- **WHEN** a link to a role's surface is shared and later opened
- **THEN** the path still resolves to that role's surface

### Requirement: A real session provider fills the session interface

The real session provider SHALL construct the session from the authenticated
user's own profile record and access-token claims, and SHALL supply it through
the same session interface the demo provider implements. The real tree SHALL
construct only real data adapters, and the demo tree only mock adapters, with
no shared factory selecting between them at runtime.

#### Scenario: The shells serve a real session unchanged

- **WHEN** a real session renders a role shell
- **THEN** the shell reads role, outlet, and display name through the same
  interface it uses in demo mode, with no mode-conditional branches in shell or
  feature code

#### Scenario: The real tree constructs no mock adapters

- **WHEN** the real tree renders
- **THEN** the adapters it supplies are the real implementations, selected by
  which provider stack mounted rather than by a mode parameter

### Requirement: The shell exposes an account slot alongside the demo banner

Each role shell SHALL accept a slot in its persistent chrome for
session-specific controls, filled by the real tree with the account menu and by
the demo tree left unfilled. Shell components SHALL NOT branch on session mode
to decide what the slot contains.

#### Scenario: The account menu appears only in real mode

- **WHEN** a shell renders under the real provider stack and then under the
  demo provider stack
- **THEN** the account menu is present in the first case and absent in the
  second, with no mode test inside the shell

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
