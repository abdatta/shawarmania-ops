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

The indicator SHALL carry a control that **leaves the demo**, returning to the
application root. Leaving is not dismissing: the indicator goes only because the
fabricated data it warns about has gone with it, so every control in the
indicator either stays within the demo or leaves it entirely, and none of them
hides fabricated data that is still on screen.

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

Demo fixtures SHALL include the people states an admin actually has to
recognise and repair: at least one account with a migration placeholder address
(cannot be invited until it is corrected), at least one with an invite
outstanding (activated by nobody yet), at least one person holding no live
assignment (formerly "departed" — off every staff list, history intact), at
least one whose assignment at one outlet has ended while another continues, and
at least one deactivated person who still holds a live assignment.

#### Scenario: The People surface demonstrates every unfinished state

- **WHEN** a demonstrator opens the People surface in demo mode
- **THEN** the placeholder-address, invite-outstanding, no-assignment,
  one-assignment-ended and deactivated states are all present and each states
  what is wrong and what to do next

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
serve the attendance surfaces from mock adapters covering at least an arrival
waiting for approval, an arrival a manager has approved on site, an arrival
approved from elsewhere with a reason, a late arrival, and a day with no
arrival at all past its deadline — so that a four-role walkthrough reaches a
working fourth role rather than an empty shell, and so the month view
demonstrates a pattern rather than a single row.

#### Scenario: A demo Employee walks their own surfaces

- **WHEN** the demo tree is entered as the Employee persona
- **THEN** the home screen offers a working check-in action, states that a recorded arrival waits for a manager, and the attendance history shows the waiting, approved, late and absent days over a range

#### Scenario: A demo check-in reaches no network

- **WHEN** a check-in or an approval is performed anywhere in the demo tree
- **THEN** the result is served from fixtures, and no request leaves the application origin

#### Scenario: A demo manager approves on site

- **WHEN** the demo tree is entered as the Franchise Admin persona and a waiting day is approved with the demo position inside the outlet's fence
- **THEN** the row updates in the demo session to show the approver and that they were at the outlet, with no reason asked for and no backend write

#### Scenario: A demo manager approves from elsewhere

- **WHEN** the demo Franchise Admin approves a waiting day with the demo position outside the outlet's fence
- **THEN** a reason is required before the approval is accepted, and the row then shows the approver, their reason, and that they were not at the outlet

#### Scenario: A demo manager reads one person's month

- **WHEN** the demo Franchise Admin opens a staff member's attendance over a range
- **THEN** the fixtures serve present, late, absent and waiting days with a summary, served entirely from mocks

### Requirement: A manual attendance entry is demonstrable

The demo Franchise Admin SHALL be able to record a past-time check-in for a
person at their outlet, served entirely by the mock adapters, and the
resulting row SHALL show who entered it — so the escape hatch that replaced
the kiosk is walkable, not described. No request SHALL leave the app origin.

#### Scenario: The demo manager records a morning check-in at noon

- **WHEN** the demo Franchise Admin records a check-in for a colleague with
  an earlier time on the current business day
- **THEN** the day updates to show the event marked as manually entered by
  the demo manager, settled without a separate approval, and no request leaves
  the app origin

### Requirement: The address search is demonstrable without leaving the app origin

Demo mode SHALL serve address suggestions and district lookups from fixtures
rather than from any external service, so the whole outlet-creation walk —
including picking an address — makes no request to any host but the app's own
origin.

The fixtures SHALL include a place whose PIN code is absent, so the demo shows a
partial fill rather than only the case where everything arrives.

#### Scenario: Picking an address in the demo fills the form

- **WHEN** a demo Super Admin searches while creating an outlet and picks a
  suggestion
- **THEN** the address fields fill from the fixture

#### Scenario: The demo address search makes no off-origin request

- **WHEN** the demo walk searches for an address and picks a suggestion
- **THEN** no network request leaves the app's own origin

#### Scenario: The demo shows a place that fills only part of the address

- **WHEN** a demo admin picks the fixture that carries no PIN code
- **THEN** the fields that place supplies are filled and the rest are left empty
  for typing

### Requirement: The demo dataset is one internally consistent scenario across every surface

The demo dataset SHALL be one set of records spanning every feature, for more
than one outlet, over a realistic recent period — and figures on one surface
SHALL be derived from the records another surface shows, never authored
independently.

Specifically: an outlet's sales figure SHALL be the sum of the bills the
counter holds for it; its cash close SHALL reconcile against those of its
bills paid in cash; its stock quantities SHALL equal the sum of their own
movements; and its profit SHALL follow from those sales, expenses and
movements.

A dataset that contradicts itself SHALL fail at construction, not on screen.

#### Scenario: The dashboard agrees with the counter

- **WHEN** a walkthrough reads an outlet's sales on the owner console and then opens that outlet's bills
- **THEN** the bills sum to the figure the console showed

#### Scenario: A contradictory fixture is rejected

- **WHEN** the demo dataset is constructed with a stored figure that its own records do not produce
- **THEN** construction throws, naming what disagreed

### Requirement: Every outlet in the demo dataset numbers its own bills

Bill numbers in the demo dataset SHALL be sequential within each outlet and
independent between outlets, mirroring the per-outlet sequence the database
enforces.

#### Scenario: Two outlets both start at one

- **WHEN** the demo dataset is constructed for two trading outlets
- **THEN** each outlet's bills are numbered from one, without reusing or skipping a number

### Requirement: The demo scenario includes states where something has gone wrong

The demo dataset SHALL include, without any staging by the person running it:
a stock item at or below its threshold, a business day closed with a
difference, a bill that arrived after its day was closed, a check-in blocked
by the geofence and awaiting a decision, and an open alert at high priority.

#### Scenario: The awkward states are present on arrival

- **WHEN** a walkthrough opens the demo with no interaction beyond navigation
- **THEN** the low-stock item, the cash difference, the reconciliation exception, the blocked check-in and the open high-priority alert are all reachable

### Requirement: Demo state resets to the starting scenario on demand

Demo mode SHALL offer a control, reachable from every demo surface, that
returns the dataset to its starting state. The control SHALL state what it
does before doing it, and SHALL keep the reader on the role they are viewing.

#### Scenario: Resetting mid-walkthrough

- **WHEN** a walkthrough that has recorded bills, movements and expenses resets the demo
- **THEN** the dataset returns to its starting state, and the reader remains on the same role's surface

#### Scenario: The reset is announced

- **WHEN** the reset control is used
- **THEN** the consequence is stated before anything is discarded

### Requirement: The demo link is found in the owner's account menu, not on the unauthenticated entry screen

Nothing an unauthenticated visitor can reach SHALL offer a route into demo mode.
The Super Admin's account menu SHALL offer one entry into it, and that entry
SHALL address demo mode itself rather than any single role. Sharing the link is
left to the browser, so no in-app copy action is required.

Demo mode SHALL remain reachable without authentication, so that a shared link
works for a recipient who has no account.

Leaving demo mode SHALL continue to return to the application root, and the
screen the root resolves to for a visitor with no session is not demo mode's
concern. The exit exists for the owner who was demonstrating, so arriving at the
way in is the correct outcome of leaving.

#### Scenario: The unauthenticated entry screen

- **WHEN** a visitor with no session opens the application root and reaches the
  screen it resolves to
- **THEN** no route into demo mode is offered

#### Scenario: The owner produces the link

- **WHEN** the Super Admin opens their account menu
- **THEN** a demo entry is offered, and it addresses demo mode rather than one role's path

#### Scenario: A recipient with no account

- **WHEN** somebody with no session opens the shared link
- **THEN** demo mode renders, without a sign-in being requested

#### Scenario: Leaving the demo still returns to the root

- **WHEN** a visitor uses the indicator's exit
- **THEN** the application root is reached and resolves as it would for any
  visitor, and the demo indicator is gone

### Requirement: The owner's own demo link meets the signed-in interstitial

Following the demo link while signed in SHALL render the signed-in
interstitial, for every role including the Super Admin. No role SHALL be
given a path into demo mode that skips it.

#### Scenario: The owner follows their own link

- **WHEN** a signed-in Super Admin opens demo mode from their account menu
- **THEN** the interstitial naming the signed-in state is shown, and continuing is an explicit choice

### Requirement: A documented walkthrough route ships with the demo

The repository SHALL document a route through all four roles that someone who
did not build the product can follow, and that document SHALL open by saying
where the demo link is found.

#### Scenario: Somebody who did not build it runs a demo

- **WHEN** a reader follows the documented walkthrough from its first step
- **THEN** the document tells them where to obtain the link before it asks them to open anything

### Requirement: The demo dataset includes a person who works at both outlets

Demo fixtures SHALL include at least one person holding live assignments at
both outlets, with attendance recorded at each, so that the multi-outlet path
is walkable rather than asserted. The demo dataset SHALL also include the
owner holding a Franchise Admin assignment at one outlet, and at least one
owner-recorded non-cash entry in that outlet's books.

The owner persona SHALL reach the outlet-level surfaces of **both** outlets,
including the one they hold no assignment at, so that the owner's reach is
walkable rather than asserted. The difference between the two outlets SHALL be
what the surfaces offer rather than whether they open: the drawer is offered at
the outlet they manage and at no other.

The demo persona switcher remains the way a demonstrator views the app as
another role, and SHALL NOT be presented as, or confused with, an in-app role
switch — no such thing exists.

#### Scenario: The split-shift person is walkable

- **WHEN** a demonstrator opens the demo as the person assigned to both outlets
- **THEN** their own attendance shows days worked at each outlet, each naming
  its outlet, and their check-in action offers no outlet choice

#### Scenario: The owner-as-manager is walkable

- **WHEN** a demonstrator opens the demo as the owner and selects the outlet
  they hold a manager assignment at
- **THEN** that outlet's operational surfaces are reachable and its day can be
  closed

#### Scenario: The owner at the outlet they do not manage is walkable

- **WHEN** a demonstrator opens the demo as the owner and selects the outlet
  they hold no assignment at
- **THEN** that outlet's attendance is shown and a waiting day there can be
  approved, while its cash surface offers neither a day close nor a withdrawal

#### Scenario: The owner is not on either outlet's attendance day

- **WHEN** a demonstrator opens the demo as the owner and views each outlet's
  attendance day
- **THEN** the owner does not appear on either, since they hold no staff
  assignment at either

#### Scenario: An owner-recorded entry reads as the owner's

- **WHEN** a demonstrator opens the expenses or stock ledger of the outlet the
  owner recorded into
- **THEN** that entry is shown as the owner's, distinguishable from the
  manager's own entries
