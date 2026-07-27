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

### Requirement: Navigation derives from the gate registry

Each shell's navigation SHALL be derived from the surface registry and the
current session, never hand-maintained per shell. Surfaces whose state
excludes them from the current mode SHALL produce no navigation entry.

#### Scenario: A registry change moves the navigation

- **WHEN** a surface's registry state changes such that it becomes visible
  to a role in the current mode
- **THEN** that role's navigation shows it with no navigation-specific code
  change

### Requirement: A uniform session context serves real and demo modes

Shell components and features SHALL read the current role, outlet, and
display name from a single session interface that both the real and the demo
session providers implement, so that the same shell components serve both
modes unchanged.

#### Scenario: The same shell serves both providers

- **WHEN** a shell component renders under the demo session provider or a
  real session provider
- **THEN** the component reads role, outlet, and display name identically,
  with no mode-conditional branches inside shell or feature code

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
`counter`, `staff` — used consistently by routing, the registry, and shared
links, in both real and demo trees.

#### Scenario: Role deep links are stable

- **WHEN** a link to a role's surface is shared and later opened
- **THEN** the path still resolves to that role's surface
