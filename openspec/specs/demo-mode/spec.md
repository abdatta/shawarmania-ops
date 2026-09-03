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

**A surface the business has decided will never be built SHALL be deleted rather
than hidden.** `hidden` is for a surface whose route still resolves in principle
and whose return is plausible; carrying a screen nobody will promote costs every
future refactor more than the one-line reversal is worth. Deletion SHALL remove
the gate, the route, the component and its tests together, so that no half of a
withdrawn surface survives the other.

Deleting a surface SHALL NOT delete the tables behind it. Schema, policies and
isolation coverage SHALL survive the screen that read them, so that withdrawing a
screen stays a reversible decision about the application rather than an
irreversible one about the data. Tables left with no reader SHALL be recorded in
`docs/LIMITATIONS.md`, so that a later reader finds a decision rather than an
apparent oversight.

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

#### Scenario: A withdrawn surface leaves nothing behind

- **WHEN** the business decides a surface will never be built
- **THEN** its gate, route, component and tests are deleted together, and no
  address resolves to it in any mode

#### Scenario: A withdrawn surface leaves its tables standing

- **WHEN** a surface is deleted
- **THEN** the tables it read keep their policies and their isolation coverage,
  and are recorded as having no reader

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

### Requirement: Demo data walks the complete order-to-payment lifecycle

The coherent demo store SHALL include a direct payment with its guaranteed Undo,
an editable open order paid on handover, an aggregator order collected by a
rider, a cancellation with its reason, a bill that is not sent yet, and one
command needing attention on its originating tablet. Manager diagnostics for the
same command SHALL be read-only and non-identifying. Every accepted command SHALL
carry zero discount, and every customer, bill, revenue and drawer figure SHALL
stay internally consistent across role surfaces.

#### Scenario: An order taken before cutover is paid after it
- **WHEN** the demo order is created on one business date and paid in cash after that date's cutover
- **THEN** revenue appears on the order date, cash appears on the payment date, and every summary agrees

#### Scenario: An aggregator order is collected
- **WHEN** the demo aggregator order is paid by that aggregator's method
- **THEN** it leaves Open orders as a paid bill and the outlet's method totals agree

#### Scenario: Demo reset
- **WHEN** the lifecycle is changed during a walkthrough and demo reset is used
- **THEN** every open order, bill, customer, exception and aggregate returns to the canonical scenario

#### Scenario: Demo correction respects the device boundary
- **WHEN** the originating tablet corrects or discards the needs-attention command and a manager later opens diagnostics
- **THEN** the tablet retains the attributed trace while the manager sees only non-identifying read-only status

### Requirement: Demo customer identity is global without exposing outlet history

The synthetic scenario SHALL include one invented phone identity used at both
outlets. Exact lookup SHALL recognise it, while an outlet-scoped history adapter
SHALL return only that outlet's bills.

#### Scenario: The same demo customer visits both outlets
- **WHEN** each outlet enters the complete synthetic phone
- **THEN** both receive the same saved profile and neither receives the other outlet's bills

### Requirement: Live billing promotion preserves the isolated demo composition

Promoting billing capabilities to `live` SHALL connect real tablet sessions to
live adapters while `/demo` continues to use the complete synthetic billing
lifecycle with no authentication, no IndexedDB delivery and no Supabase writes.
The synthetic lifecycle SHALL include the counter's own day-close and departure
behaviour: a Finish Day readiness sheet that drains before deciding and names
each blocker, an advisory rather than blocking recent-payment window, and an
after-departure attribution exception a manager can review.

#### Scenario: Demo is opened after live promotion

- **WHEN** a visitor enters the billing walkthrough through `/demo`
- **THEN** direct and on-handover payment, five-minute tender editing with the same relative countdown, cancelled, unsent, originating-tablet needs-attention, read-only manager-diagnostic and customer-reuse scenarios remain walkable with no discount control, and no live queue or backend mutation is created

#### Scenario: Finish Day explains itself in demo

- **WHEN** Finish day is chosen at the demo counter
- **THEN** the readiness sheet drains, names every hard blocker with its
  resolution, treats a still-editable recent payment as advice rather than a
  refusal, and finishes the day when nothing genuine is blocking

#### Scenario: A manager reviews an after-departure attribution in demo

- **WHEN** a manager opens the flagged bill in billing history
- **THEN** the bill is labelled as recorded after its operator left remotely,
  remains inside the day's takings and every figure derived from them, and offers
  confirming the original operator, naming another, or recording that the
  operator cannot be established — appending the outcome without rewriting the
  original attribution

### Requirement: The demo Biller walkthrough is the enrolled tablet's own shell

The demo Biller surface SHALL be the same counter shell component the enrolled
tablet branch renders, provided with a synthetic counter-device session by a
demo-owned host. The demo SHALL NOT maintain a second implementation of the
counter, and the demo host SHALL NOT import the database client or any real
adapter.

#### Scenario: The demo counter is the production counter

- **WHEN** the Biller walkthrough is opened
- **THEN** it renders the enrolled tablet's own shell — device label, sync
  indicator, Hand over and Finish day above the till with expenses beneath it —
  with no navigation, no account menu and no sign-out

#### Scenario: The demo cannot reach the backend to do it

- **WHEN** the demo host provides the counter session and adapters
- **THEN** every adapter in that tree is a mock, and no import path from the demo
  tree reaches the database client or a real adapter

#### Scenario: The whole counter lifecycle is walkable

- **WHEN** a walkthrough hands over, leaves the counter from a phone, or finishes
  the day
- **THEN** the shift-request screen, its four readable digits, its wait, its
  timeout, its destruction after three wrong codes, and the no-shift resting
  state are all reachable without leaving demo mode

#### Scenario: The counter between shifts

- **WHEN** the demo shift is ended or the day is finished during a walkthrough
- **THEN** the counter shows the shift-request screen a real tablet shows
  overnight, and demo reset restores the open shift the walkthrough starts from

### Requirement: The demo models the live shift table, not the retired one

The demo SHALL hold a counter shift in exactly one representation, and that
representation SHALL be the one the live counter uses. Demo bills, orders and
billing commands SHALL carry the same shift reference production writes, and
SHALL NOT place an identifier from the retired pre-tablet shift model into a
column that references the live one. Confirming a shift request SHALL open a
shift that billing attributes bills to; ending a shift from a phone and
finishing the day SHALL close that same shift with distinguishable reasons; and
the counter, the Tablets surface, every phone's live-shift card and the billing
figures SHALL agree about who holds the counter and since when. A demo shift's
business date and expiry SHALL be resolved through its outlet's own cutover.

#### Scenario: A demo shift reference could exist in production

- **WHEN** the demo creates a bill, an order or a billing command under a shift
- **THEN** the shift reference it stores is the one the live schema declares for
  that column, and no value is written that production's foreign keys would
  reject

#### Scenario: A shift ends for a stated reason

- **WHEN** a shift ends because its operator left, because the day was finished,
  or because it reached the outlet's cutover
- **THEN** the demo records which of those happened, rather than recording only
  that the shift is no longer open

#### Scenario: Tablets and the phone agree about the counter

- **WHEN** a shift is open at the demo outlet
- **THEN** the Tablets surface names its holder and opening time, and that same
  person sees the live-shift card offering **Leave counter** on their own phone

#### Scenario: A confirmed handshake opens a shift that takes money

- **WHEN** a request is approved from a phone and a bill is then rung at the
  counter
- **THEN** the bill is attributed to the person who approved it, and appears in
  their shift's totals and in every figure derived from them

#### Scenario: Leaving the counter closes the shift the counter is showing

- **WHEN** the shift holder chooses Leave counter on their phone
- **THEN** the same shift closes everywhere, and the counter stops offering new
  work rather than continuing against a shift only it can still see

#### Scenario: A demo shift opened after midnight belongs to the trading day

- **WHEN** a shift is opened during a walkthrough held after the outlet's cutover
- **THEN** its business date is the one that outlet's cutover resolves, and every
  surface dating that shift's work agrees with it

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
