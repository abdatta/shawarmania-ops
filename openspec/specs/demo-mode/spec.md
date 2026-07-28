# Demo Mode

## Purpose

Guarantees that the entire four-role experience is demonstrable from a deployed URL with fabricated data and no authentication, without any possibility of touching real data: screens read through typed adapter interfaces with mock and real implementations, every surface is gated by a single registry, a demo session is structurally incapable of reaching the backend, a real signed-in user never enters the demo silently, and the demo is always visibly a demo.

## Requirements

### Requirement: Screens read data through typed adapter interfaces

Screens and features SHALL depend on typed data-adapter interfaces, one per
domain area, and SHALL NOT depend on the database client or on a concrete
adapter implementation. Each domain interface SHALL admit two
implementations — a real adapter backed by the database client and a mock
adapter backed by fixtures — and swapping one for the other SHALL require no
change to any screen.

#### Scenario: A screen is served by the mock adapter

- **WHEN** a screen is rendered inside the demo provider tree
- **THEN** it receives its data from the mock adapter through the same
  interface the real adapter implements, with no screen-level code aware of
  which implementation served it

#### Scenario: Swapping the implementation does not touch the screen

- **WHEN** the adapter provided for a domain is changed from mock to real
- **THEN** the screens consuming that domain compile and render unchanged

### Requirement: Mock fixtures are typed from the generated schema types

Every mock fixture SHALL be typed from the TypeScript types generated from
the database schema, so that a fixture describing data the database could not
serve is a compile error.

#### Scenario: A drifted fixture fails to compile

- **WHEN** a fixture references a column that does not exist in the generated
  schema types, or assigns a value of the wrong type
- **THEN** the typecheck fails

### Requirement: Every surface is gated by a single registry

Every user-facing surface SHALL be declared in a single registry with exactly
one state: `hidden`, `demo`, or `live`. Navigation and routing SHALL derive
from the registry. A `hidden` surface SHALL be absent — producing no
navigation entry and no reachable route — rather than disabled or greyed out.

#### Scenario: A hidden surface is absent

- **WHEN** a surface's registry state is `hidden`
- **THEN** no navigation entry for it is rendered in any mode, and navigating
  to its path directly does not render the surface

#### Scenario: A demo surface renders only in demo mode

- **WHEN** a surface's registry state is `demo`
- **THEN** it is reachable and navigable inside demo mode, and is not
  reachable outside demo mode

#### Scenario: The registry is the single declaration point

- **WHEN** a surface's state changes (for example `demo` to `live`)
- **THEN** the change is a single registry edit, with no per-screen or
  per-navigation conditional to update

### Requirement: Demo mode renders the four-role experience without authentication

Demo mode SHALL present the product's four role shells — Super Admin,
Franchise Admin, Biller, and Employee — populated with mocked data, without
requiring any authentication, from a shareable URL.

#### Scenario: An unauthenticated visitor opens the demo

- **WHEN** a visitor with no session opens a demo URL
- **THEN** the corresponding role shell renders with mocked data, and no
  sign-in is requested

#### Scenario: The role switcher flips between all four roles

- **WHEN** the visitor uses the demo role switcher
- **THEN** the shell switches to the selected role's experience without any
  sign-in or page reload beyond client-side navigation

### Requirement: A demo session cannot write to the backend

A demo session SHALL be structurally incapable of reaching the backend: the
demo experience SHALL be served entirely from mock adapters, the database
client SHALL fail loudly if invoked while demo mode is active, and an
automated test SHALL fail if any demo interaction attempts a network request
to the backend.

#### Scenario: Demo interactions produce no backend traffic

- **WHEN** every demo surface is exercised, including every write-shaped
  interaction the mock adapters expose
- **THEN** no network request is made to the backend

#### Scenario: The database client trips in demo scope

- **WHEN** code attempts to obtain the database client while demo mode is
  active
- **THEN** the call fails immediately and loudly rather than returning a
  usable client

#### Scenario: An escaped write fails the test suite

- **WHEN** a code change causes any demo interaction to attempt a backend
  request
- **THEN** an automated test fails

### Requirement: A real session never enters demo mode silently

If a real authenticated session is present, navigating to demo mode SHALL
interpose an explicit interstitial naming the signed-in state and requiring a
deliberate choice before any demo surface renders. The choice to proceed
SHALL NOT persist beyond the browser tab in which it was made.

#### Scenario: A signed-in user navigates to a demo URL

- **WHEN** a real session exists and the user navigates to any demo URL
- **THEN** an interstitial renders instead of the demo surface, offering an
  explicit continue-to-demo action and a way back

#### Scenario: The continue choice does not outlive the tab

- **WHEN** the user chose to continue to the demo and later opens a demo URL
  in a new tab while still signed in
- **THEN** the interstitial renders again

#### Scenario: No session means no interstitial

- **WHEN** no real session exists and a visitor opens a demo URL
- **THEN** the demo renders directly

### Requirement: The demo indicator is always visible and cannot be dismissed

Every demo surface SHALL display a persistent demo indicator identifying the
data as fabricated. The indicator SHALL offer no dismiss affordance and SHALL
remain visible on every demo route, in both themes, on phone and tablet
viewports. On the Biller shell it SHALL NOT occlude the billing actions.

#### Scenario: The indicator is present on every demo route

- **WHEN** any demo route renders, in either theme, on a phone or tablet
  viewport
- **THEN** the demo indicator is visible

#### Scenario: The indicator cannot be dismissed

- **WHEN** a user inspects the demo indicator for controls
- **THEN** it exposes no affordance that hides or closes it, and no
  interaction on the page removes it short of leaving demo mode

### Requirement: Demo data is obviously synthetic

Demo fixtures SHALL contain no real people. Invented staff and customers are
required; the real outlets and the real menu MAY appear, as public business
facts. Money values in fixtures SHALL be integer paise, matching the schema.

#### Scenario: Personas are invented

- **WHEN** the demo fixtures are reviewed
- **THEN** every person appearing in them is invented, and no fixture value
  is a real person's name or phone number

### Requirement: A demo deep link reconstructs its session from the URL

The demo role SHALL be encoded in the URL, so that a deep link into any demo
surface — opened fresh or reloaded — reconstructs the same role's experience
without any stored state.

#### Scenario: Reloading a demo deep link

- **WHEN** a demo URL for a specific role and surface is reloaded, or opened
  in a fresh browser session
- **THEN** the same role's shell renders the same surface

### Requirement: Demo fixtures include the unconfigured states, not only the finished one

Demo fixtures SHALL include at least one app account with no roster row and at
least one roster row with no app account, so that both halves of *"this person
cannot check in"* are visible in the walkthrough and the linking that resolves
them can be demonstrated rather than described.

This exists because fixtures that describe an already-configured business are
what allowed a feature to ship unreachable: every test started from a wired-up
world, and none asked how that world comes to exist.

#### Scenario: The demo shows a person who cannot check in

- **WHEN** the demo Staff surface renders
- **THEN** at least one person is shown as having no app account, and at least
  one demo account is shown as being on no roster

#### Scenario: Linking is demonstrable, not pre-baked

- **WHEN** a demo walkthrough links an unlinked account to an unlinked roster row
- **THEN** both surfaces update to show the person as able to check in, without
  the demo tree making any request beyond the app origin

### Requirement: Outlet setup is exercised in demo mode

The demo SHALL support creating and editing an outlet through the same surface
the real session uses, served by the mock adapters, so that the first-outlet
path is walkable without a backend.

#### Scenario: Creating an outlet in demo mode

- **WHEN** a demo Super Admin creates an outlet
- **THEN** it appears in the demo outlet list and can be assigned accounts,
  and no request leaves the app origin

### Requirement: The activation handover is demonstrable without leaving the app origin

Demo mode SHALL show the same activation handover a real admin gets — the link
and a machine-readable image of it — built entirely in the browser. No part of
the handover SHALL be produced by a request to any host other than the app's own
origin.

#### Scenario: The demo issues a handover with a link and a code image

- **WHEN** an admin persona provisions an account in demo mode
- **THEN** the issued-code panel shows an activation link and a scannable image
  of it

#### Scenario: Producing the handover makes no off-origin request

- **WHEN** the demo walk provisions an account and renders the handover
- **THEN** no network request leaves the app's own origin

### Requirement: The Employee's demo experience is a complete attendance day

Because attendance is the whole of what an Employee does, the demo tree SHALL
serve the attendance surfaces from mock adapters covering at least a normal
completed day, a blocked check-in awaiting an override, and a day cleared by an
approved override — so that a four-role walkthrough reaches a working fourth
role rather than an empty shell.

#### Scenario: A demo Employee walks their own surfaces

- **WHEN** the demo tree is entered as the Employee persona
- **THEN** the home screen offers a working check-in action and the attendance history shows the normal, blocked, and overridden days

#### Scenario: A demo check-in reaches no network

- **WHEN** a check-in, check-out, override request, or override approval is performed anywhere in the demo tree
- **THEN** the result is served from fixtures, and no request leaves the application origin

#### Scenario: A demo manager approves an override

- **WHEN** the demo tree is entered as the Franchise Admin persona and an override awaiting approval is approved
- **THEN** the row updates in the demo session to show the approver and reason, without any backend write
