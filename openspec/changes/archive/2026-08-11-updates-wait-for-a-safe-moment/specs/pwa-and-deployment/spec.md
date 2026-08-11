# PWA And Deployment (delta)

## RENAMED Requirements

- FROM: `### Requirement: Updates are checked on launch and applied on the next load`
- TO: `### Requirement: Updates are discovered continuously and applied only when a reload costs nothing`

## MODIFIED Requirements

### Requirement: Updates are discovered continuously and applied only when a reload costs nothing

The service worker registration SHALL check for a new version on launch, on
every return to the foreground, on regaining network connectivity, and at least
every five minutes while the app remains open. No cooldown SHALL suppress a
check, so closing and reopening the app is always a reliable way to force one.

A found update SHALL be activated so that the next load runs the new build, and
SHALL NOT reload the running page. The app SHALL own the reload decision rather
than leaving it to the service-worker registration library.

A recorded update SHALL be applied to the running page only from a state in
which the app reports network connectivity, no surface declares unsaved work,
no meaningful typed work is present, and no write is in flight. The app SHALL
re-confirm that state after a settle delay before reloading, so a reload cannot
land in the gap between two pieces of work. A detected update SHALL cause at
most one reload.

#### Scenario: A deployed update reaches a cached client

- **WHEN** a new build is deployed and a client that cached the old build
  launches, then loads again
- **THEN** the second load runs the new build

#### Scenario: An update never reloads an occupied session

- **WHEN** a new build is published while the app is open and holding typed
  work, an undelivered composition, or a write in flight
- **THEN** the running page is not reloaded
- **AND** the header offers an update action instead

#### Scenario: An unoccupied session takes the update by itself

- **WHEN** a new build is published while the app is open, online, with nothing
  typed, nothing declared unsaved, and no write in flight
- **THEN** the page reloads onto the new build without being asked

#### Scenario: Work clearing releases a deferred update

- **WHEN** an update is deferred because the page was occupied, and every
  condition then clears
- **THEN** the page reloads onto the new build without a further action
- **AND** it does not reload if the page becomes occupied again during the
  settle delay

#### Scenario: Discovery does not require a relaunch

- **WHEN** the app has been open for longer than the check interval, or returns
  to the foreground, or regains connectivity, and a new build was published in
  the meantime
- **THEN** the app discovers that build without being relaunched

#### Scenario: Reopening always checks

- **WHEN** the app is closed and opened again, however recently it last checked
- **THEN** it checks for a new build

#### Scenario: A disconnected device does not reload

- **WHEN** an update has been recorded and the app reports no network
  connectivity
- **THEN** the page is not reloaded, whatever else is true of it

#### Scenario: One update, one reload

- **WHEN** a single update has been detected and applied
- **THEN** the app reloads the page at most once for it

## ADDED Requirements

### Requirement: Work at risk from a reload is detected without per-surface registration

The app SHALL determine whether a reload would discard work by observing input
events at the document root, so that a surface added later is covered without
registering anything. Typed work SHALL count as meaningful when the person has
typed into three or more separate fields, or has entered a substantial amount of
text into any single field. A single short entry, such as a search term or a
filter, SHALL NOT defer an update.

Work that a reload would discard but that is not held in form controls SHALL be
declarable by the surface holding it. The bill composer SHALL declare it while
an order has lines, because an order is held in application state and renders no
form control that any generic measure could observe.

Writes in flight SHALL be counted once, at the adapter seam every write already
passes through, rather than per surface.

#### Scenario: A form written later is covered without being registered

- **WHEN** a surface containing form controls that was never made aware of
  update handling holds typing across several of its fields
- **THEN** an available update is deferred

#### Scenario: A single short entry does not defer an update

- **WHEN** the only typing on the page is one short entry, such as a search term
- **THEN** an available update is applied

#### Scenario: A long single entry defers an update

- **WHEN** one field holds a substantial amount of typed text, such as a written
  reason
- **THEN** an available update is deferred

#### Scenario: A composed order defers an update

- **WHEN** the bill composer holds an order with at least one line, and no form
  control on the page has been typed into
- **THEN** an available update is deferred

#### Scenario: A write in flight defers an update

- **WHEN** a write issued through the adapter seam has not yet settled
- **THEN** an available update is deferred

### Requirement: The header carries one app action, and installation outranks an update

The public header and the real phone and counter shells SHALL render at most one
app-owned action in their existing action slot. When installation is actionable
and an update is available at the same time, the header SHALL show the
installation action only. The update action SHALL appear when an update is
available and installation is not actionable, SHALL remain visible until that
update is applied rather than appearing and disappearing as the page changes,
and SHALL apply the update when activated. It SHALL use the same semantic
control styling, minimum touch target and accessible naming conventions as the
installation action.

Unlike the installation action, which teaches its label once per tab, the update
action SHALL keep reintroducing itself: its label SHALL expand and collapse on a
repeating cycle for as long as the update is unapplied, so that a device nobody
is watching still declares that it is holding a build back. Under reduced motion
the cycle SHALL NOT run and the label SHALL remain visible without animating.
The accessible name SHALL NOT change at any point in the cycle.

A demo shell SHALL render no app-owned action, and SHALL still take an available
update automatically when its page is unoccupied.

#### Scenario: Installation outranks an update

- **WHEN** the browser reports installation capability and an update is
  available at the same time
- **THEN** the header shows the installation action and no update action

#### Scenario: The update action appears when installation is not offered

- **WHEN** an update is available and installation is neither actionable nor
  applicable
- **THEN** the header shows an update action

#### Scenario: The update action does not flicker

- **WHEN** the update action is visible and the page's occupancy changes while
  the update is still unapplied
- **THEN** the action remains visible

#### Scenario: The update action keeps reintroducing itself

- **WHEN** the update action has been visible and unapplied for longer than one
  reveal cycle, without reduced motion
- **THEN** its label has expanded and collapsed more than once
- **AND** its accessible name has not changed

#### Scenario: Reduced motion states it without moving

- **WHEN** the update action is visible and the user prefers reduced motion
- **THEN** its label is visible and does not cycle

#### Scenario: Activating the action applies the update

- **WHEN** the update action is activated
- **THEN** the page reloads onto the new build

#### Scenario: Demo mode shows no action but still updates

- **WHEN** an update is available while a demo shell is visible
- **THEN** the demo shell renders no app-owned action
- **AND** the update is still applied automatically once the page is unoccupied
