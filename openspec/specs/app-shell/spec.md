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

Navigation SHALL be the union of the surfaces the session can **reach**. A
session can reach the surfaces of every role it holds a live assignment in, so
that a person who manages one outlet and works at another reaches both sets of
surfaces without any switching step. A session holding the owner role SHALL
additionally reach every outlet-level manager surface, at every outlet, without
holding an assignment at any of them — running every outlet is what that role
is, and the database has always answered it that way.

Reachability SHALL govern navigation and routing only. It SHALL NOT be presented
as a role the person holds: any surface stating which roles somebody holds SHALL
state exactly what their live assignments confer.

Reaching a surface SHALL confer no authority on it. What a session may write is
decided by the database from the assignment, so a reachable surface may still
offer less than it does to the outlet's own manager, and MUST offer nothing the
database would refuse.

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

#### Scenario: The owner reaches the outlet-level surfaces with no assignment

- **WHEN** a Super Admin holding no outlet assignment anywhere signs in
- **THEN** their navigation contains the outlet-level manager surfaces alongside
  their own, and opening one shows an outlet rather than redirecting them home

#### Scenario: Reaching a surface is not holding a role

- **WHEN** a Super Admin holding no outlet assignment opens the surface that
  states which roles they hold
- **THEN** it names the owner role only, and does not claim they are a manager
  of any outlet

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
the surface itself, rendered only when the person may see more than one such
outlet, and defaulted to their single one when they may not.

A surface that can meaningfully read several outlets at once SHALL allow more
than one to be selected, for a person who may see more than one. Such a surface
SHALL show the combined result as one list rather than one list per outlet, and
SHALL name the outlet on each entry so a combined reading is never ambiguous. At
least one outlet SHALL always be selected; clearing the last one SHALL be refused
rather than showing an empty surface. A person who may see one outlet SHALL be
offered no selector, single or multiple.

That selection SHALL be remembered for one signed-in person and SHALL be shared
by every outlet-scoped surface, so that choosing an outlet on one surface is the
outlet the next one opens on, and a reload opens where the person left off. It
SHALL be read back only after checking it against the outlets that person may
currently see: a remembered outlet they may no longer see SHALL be dropped from
the selection rather than shown, left blank, or refused, and a selection left
empty by that check SHALL fall back to the default. It SHALL be discarded
when the session ends, so a shared device hands no choice to the next person.

That selection SHALL NOT survive as session state, SHALL NOT constitute an
"acting as", active role, or session-level outlet mode, and SHALL NOT change
what any write is permitted to do — the database decides that from the
assignment, regardless of what is selected.

Selecting several outlets SHALL widen no reader's reach, because the database
still returns only the outlets they hold a live assignment at.

Changing the selection SHALL clear what was read under the previous one before
anything is rendered, so that no surface shows one outlet's data under another
outlet's name while a read is in flight.

#### Scenario: A single-outlet manager sees no selector

- **WHEN** a Franchise Admin holding one assignment opens an outlet-scoped
  surface
- **THEN** the surface shows their outlet with no selector to operate

#### Scenario: A choice carries to the next surface

- **WHEN** a person who may see two outlets chooses one on an outlet-scoped
  surface and then opens a different outlet-scoped surface
- **THEN** the second surface opens on the outlet they chose

#### Scenario: A choice survives a reload

- **WHEN** a person chooses an outlet on an outlet-scoped surface and reloads
  the application
- **THEN** the surface opens on the outlet they chose

#### Scenario: Several outlets are selected and read together

- **WHEN** a person who may see two outlets selects both on a surface that
  supports it
- **THEN** one combined list is shown, each entry naming the outlet it belongs
  to, and the selection is remembered like any other

#### Scenario: The last outlet cannot be deselected

- **WHEN** a person attempts to clear the only remaining selected outlet
- **THEN** the selection is unchanged and the surface continues to show it

#### Scenario: A remembered outlet they may no longer see is dropped

- **WHEN** the remembered selection includes an outlet the person may no longer
  see
- **THEN** that outlet is dropped from the selection, the rest is kept, and a
  selection left empty falls back to the default outlet

#### Scenario: Signing out forgets the choice

- **WHEN** a person chooses an outlet, signs out, and another person signs in on
  the same device
- **THEN** the second person's surfaces open on their own default outlet

#### Scenario: The selector confers no authority

- **WHEN** a request is crafted naming an outlet the person holds no live
  assignment at, whatever the surface selector shows
- **THEN** the database refuses it

#### Scenario: Changing the selection does not show stale data

- **WHEN** a person changes the selected outlet on a surface whose data is
  fetched
- **THEN** the previous outlet's data is cleared before anything renders, and
  the surface shows it is loading rather than the old rows under the new name

### Requirement: A navigation entry keeps the reader in the shell they are in

A navigation entry SHALL address its surface within the shell the reader is
currently in, rather than within the shell of the role the surface belongs to, so
that following an entry never reads as becoming somebody else. Every role branch
mounts the same surfaces and the gate resolves a path against the roles the
session can reach, so the surface reached is the same either way.

A **home** is the exception: an index surface SHALL keep its own role's segment,
because two homes cannot share one address. Only a role the session **holds**
SHALL contribute a home to navigation, so that a merely reachable role adds no
second home on a shell that already has one.

#### Scenario: The owner's manager surface stays in the owner's shell

- **WHEN** a Super Admin holding no outlet assignment follows their attendance
  entry
- **THEN** the address is within their own shell, and the outlet's attendance is
  shown there

#### Scenario: A reachable role contributes no second home

- **WHEN** a Super Admin holding no outlet assignment reads their navigation
- **THEN** it contains exactly one home entry, their own

#### Scenario: Two held roles keep two homes

- **WHEN** a person holding a Franchise Admin assignment at one outlet and an
  Employee assignment at another reads their navigation
- **THEN** both homes are present at their own addresses, so the surface carrying
  their own check-in stays reachable

### Requirement: Tablet context overrides personal-role navigation

The application SHALL, when a browser holds a valid counter tablet device
session, render the Counter shell and only the billing, shift, expenses, sync and
tablet surfaces permitted there. It SHALL NOT render personal Employee, FA or SA
navigation based on the person who holds the shift.

#### Scenario: Owner holds the shift
- **WHEN** an SA's shift request is approved for a tablet
- **THEN** the Counter shell stays mounted and no owner or manager route becomes reachable

#### Scenario: Personal device has a Biller account
- **WHEN** the same Biller signs in on an unregistered personal browser
- **THEN** their Employee-capable personal shell renders instead of the Counter shell

### Requirement: Every personal home surfaces a waiting request and a live shift

Each personal shell SHALL show, on its home surface, any shift request awaiting
the reader and any shift the reader currently holds — Employee, Franchise Admin
and Super Admin alike — with the outlet, the tablet and the time. The request card SHALL
ask for the code displayed on that tablet and SHALL offer rejection without one. A
waiting request SHALL raise the same attention count the shell already renders for
other waiting work. Neither SHALL appear on a shell belonging to anybody else.

#### Scenario: A request is waiting
- **WHEN** a person has a pending shift request and opens their home surface
- **THEN** the card is shown with its outlet, tablet and time, asks for the code on the tablet, and offers a rejection that needs no code

#### Scenario: A request arrives while the app is open
- **WHEN** a request is created while that person's home surface is already on screen
- **THEN** the card appears without the person reloading

#### Scenario: A request is withdrawn while the app is open
- **WHEN** the tablet cancels the request, or it expires, while the card is on screen
- **THEN** the card disappears and says why, rather than accepting a code that can no longer work

#### Scenario: Realtime is unavailable
- **WHEN** the live channel cannot be established
- **THEN** the card still appears when the surface is loaded or refocused, and nothing reports a false empty state

#### Scenario: A shift is live
- **WHEN** the reader holds a live shift
- **THEN** their home shows it with the outlet, tablet and opening time, and offers to end it

#### Scenario: Somebody else's request
- **WHEN** a person opens their home while a request names a different person
- **THEN** nothing about that request is shown or counted
