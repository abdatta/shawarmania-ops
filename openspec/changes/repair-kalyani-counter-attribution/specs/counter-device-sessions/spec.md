# Delta: counter-device-sessions

## ADDED Requirements

### Requirement: An authorised admin edits a tablet's name and current outlet

The Tablets surface SHALL offer an Edit action for each tablet the signed-in
administrator may administer. The edit SHALL be prefilled with the tablet's
current name and outlet, the same two properties chosen at setup.

A Super Admin MAY change either the name, the outlet, or both. A Franchise Admin
MAY change the name of a tablet currently at an outlet they actively manage and
SHALL NOT move a tablet between outlets. The database SHALL enforce this role
split independently of what the surface offers.

A name-only edit MAY succeed while a shift is live. An outlet change SHALL use
the transfer preconditions below. When name and outlet are submitted together,
both changes SHALL commit atomically or neither SHALL change. A submitted name
SHALL be trimmed, non-blank and unique among active tablets at the destination
under the same normalized comparison used during setup.

The surface SHALL ask for confirmation before changing the outlet and SHALL name
the tablet, current outlet and destination. After success it SHALL refresh the
grouped tablet reading so the tablet appears at its new current outlet without a
setup code or password.

Editing the outlet SHALL affect current and future device context only. It SHALL
NOT rewrite any historical bill, order, shift, command, expense or attendance
row.

Every successful name or outlet change SHALL preserve the previous name and
outlet in a non-overlapping effective interval and open the new interval in the
same transaction as the current-row edit. A refused edit and a submission that
changes neither field SHALL create no interval.

Bill and order history SHALL resolve the tablet name effective at the event's
`paid_at` or `ordered_at` instant. It SHALL NOT display the tablet's mutable
current name for an older event and SHALL NOT copy a display name onto the bill
or order. A history page SHALL obtain these labels in a bounded batch backed by
an index on device and effective instant, not one request per row.

#### Scenario: A Super Admin renames a tablet

- **WHEN** a Super Admin edits only the name to a unique non-blank value
- **THEN** the name changes, the current outlet and session remain unchanged,
  and no setup is required

#### Scenario: A Franchise Admin renames their outlet's tablet

- **WHEN** a Franchise Admin edits the name of a tablet at their active managed
  outlet
- **THEN** the rename succeeds and the outlet is shown as fixed

#### Scenario: A Franchise Admin tries to move a tablet

- **WHEN** a Franchise Admin hand-crafts an edit naming another outlet
- **THEN** the edit is refused and neither name nor outlet changes

#### Scenario: A Super Admin changes name and outlet together

- **WHEN** a Super Admin confirms an edit with a valid new name and a different
  outlet, and every transfer precondition is satisfied
- **THEN** both fields change in one transaction, the tablet appears under the
  destination, and its existing browser session remains proven

#### Scenario: The destination label collides

- **WHEN** the submitted name is already held by an active tablet at the
  destination
- **THEN** the edit is refused with an actionable label message and neither
  field changes

#### Scenario: A later rename does not rewrite old billing history

- **WHEN** a tablet named `Kanchrapara` took a bill and is later renamed
  `Kalyani Counter 2`
- **THEN** that old bill still shows `Kanchrapara`, while a bill taken after the
  rename shows `Kalyani Counter 2`, and neither bill stores a copied label

#### Scenario: Historical labels are loaded as one bounded read

- **WHEN** an authorised admin opens a page containing bills from several
  device-identity intervals
- **THEN** the page resolves all visible event labels in one batched database
  read whose temporal lookup uses the device/effective-time index

### Requirement: The normal admin path may transfer a proven tablet without setup

The normal authorised-admin operation MAY change a proven, non-removed tablet's
current outlet without replacing its machine identity or requiring another
setup code. The operation SHALL NOT be exposed to the tablet or to an ordinary
application role. Incident-specific operator repairs are outside this reusable
product requirement.

A transfer SHALL succeed only when both outlets are active, the tablet has no
live shift or pending shift request, its most recent sufficiently fresh device
report states zero unresolved local work, and its label is unique at the target
outlet. Any failed precondition SHALL leave the device, its session and every
historical row unchanged.

The transfer SHALL preserve the device/Auth UUID, proven-session state, setup
attribution and browser credentials. Historical records SHALL remain attributed
to the outlet stored on each record; future shift requests and shifts SHALL use
the tablet's new current outlet.

Every device-authorised database read SHALL intersect a historical row's outlet
with the tablet's current outlet and SHALL retain the existing live-shift rule.
A transferred tablet SHALL NOT retain access to rows from its former outlet by
virtue of matching `device_id`, including through a hand-crafted request.

#### Scenario: A closed, fully synced tablet moves outlets

- **WHEN** the normal admin path transfers a proven tablet with no live shift,
  no pending request and a fresh zero-unresolved report from outlet A to active
  outlet B under a unique label
- **THEN** the same browser session remains proven, its next ordinary shift opens
  at B, and no setup code or password is requested

#### Scenario: Historical facts stay with their recorded outlet

- **WHEN** a tablet that previously traded at outlet A is transferred to B
- **THEN** authorised A managers still read those historical A rows, future rows
  are recorded at B, and the device itself cannot read the A rows after transfer

#### Scenario: An idle transferred tablet reaches neither outlet

- **WHEN** the transferred tablet has no live shift and makes direct reads for
  either its former outlet or its current outlet
- **THEN** both reads return no operational data

#### Scenario: Unresolved local work blocks transfer

- **WHEN** a tablet's recent report names unresolved local operations, or no
  sufficiently fresh report can establish that the count is zero
- **THEN** transfer is refused and its outlet, session and history are unchanged

#### Scenario: A live or pending shift blocks transfer

- **WHEN** the tablet has a live shift or an unresolved shift request
- **THEN** transfer is refused until that lifecycle is ended cleanly

#### Scenario: The target label is already in use

- **WHEN** the requested label matches another active tablet at the target
  outlet under the database's normalized label rule
- **THEN** transfer is refused without changing either tablet
