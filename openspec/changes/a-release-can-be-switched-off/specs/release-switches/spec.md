# Delta: release-switches (new capability)

## Purpose

Defines release switches: how a change to a live surface is deployed switched off
and released by the owner, how every device reads and applies a switch, why
turning one off never strands queued work, the owner's Releases page, the health
each tablet reports, and the probe that proves the path end to end.

## ADDED Requirements

### Requirement: A release switch is declared once and its name is never reused

A release switch SHALL be a row in `release_switches`, inserted by the migration of
the change that introduces it, with a key, a kind (`release` or `ops`), an
owner-facing title, one sentence saying what *On* means, one saying what *Off*
means, the introducing change's name, and its current answer, which a migration
SHALL declare off. A switch's answer SHALL be one answer for the whole business.
Its key SHALL be its primary key, and a switch row SHALL never be deleted, so a
retired switch's key can never be declared again. A retired switch SHALL carry its
retirement time, SHALL read off everywhere and SHALL refuse to be turned.

#### Scenario: A retired name cannot come back

- **WHEN** a migration inserts a switch whose key an earlier migration inserted
- **THEN** the database refuses it, and a fresh reset of the local stack fails

#### Scenario: A new switch starts off

- **WHEN** a migration declares a switch and nobody has turned it
- **THEN** every device reads it as off

### Requirement: Only the owner turns a release

Turning a switch SHALL be possible only through `set_release_switch`, which SHALL
re-derive the caller's authority from their own token and SHALL refuse every caller
who is not the owner with one sentence, whatever the request body says. It SHALL
refuse an unknown or retired key. Each call SHALL record an event — switch, state,
who, when, an optional reason of at most 200 characters, and `app` — in the same
statement as the answer, and setting the current answer SHALL record the event and
change nothing else.

`release_switch_force` SHALL perform the same write for an operator in the
Supabase dashboard, record `operator` as its source, and SHALL be executable only by
the database owner and the service role.

`release_switch_events` SHALL be append-only: no role SHALL update or delete a
row.

#### Scenario: A Franchise Admin is refused

- **WHEN** a Franchise Admin sends a hand-crafted request to turn a switch
- **THEN** the database refuses it and no switch or event row changes

#### Scenario: A tablet is refused

- **WHEN** a counter or kitchen device session calls `set_release_switch`
- **THEN** it is refused

#### Scenario: The owner turns a release off

- **WHEN** the owner turns a switch off with a reason
- **THEN** it reads off, and the history shows the owner, the time, the reason and
  `app`

#### Scenario: The dashboard fallback

- **WHEN** an operator runs `release_switch_force` from the Supabase dashboard
- **THEN** the answer changes and the event records `operator`, and the function
  cannot be called by `anon` or `authenticated`

### Requirement: Every signed-in principal reads switches; only the owner reads their history; tablet health is isolated by outlet

`release_switches` SHALL be readable by every authenticated principal — every
person and every counter and kitchen device — and by no anonymous caller.
`release_switch_events` SHALL be readable by the owner only. `device_health` is
outlet-scoped: a row SHALL be readable by the owner and by that outlet's Franchise
Admins, and by nobody else. No client role SHALL insert, update or delete a row in
any of the three tables directly.

#### Scenario: Another outlet's tablet health is invisible

- **WHEN** a Franchise Admin and a counter device of one outlet each hand-craft a
  select of another outlet's device health
- **THEN** each receives nothing

#### Scenario: A Biller reads no tablet health

- **WHEN** a Biller hand-crafts a select of their own outlet's device health
- **THEN** they receive nothing

#### Scenario: No direct writes

- **WHEN** any client role inserts, updates or deletes a row in `release_switches`,
  `release_switch_events` or `device_health` directly
- **THEN** the database refuses it

### Requirement: A page decides each switch once, when it loads

Every page SHALL read release switches through the adapter seam into a snapshot
taken at boot, before the first render, from the answers this device last saved,
and SHALL keep that snapshot unchanged for the life of the page. A toggle point
SHALL read the snapshot and never the network, by a key the code declares. A key
with no saved answer SHALL read off. A failed read SHALL never throw, SHALL keep
saved answers, and SHALL read off any key never seen.

A device that cannot reach the server SHALL keep running on its last saved answers.
A device that has never had an answer SHALL run every release switched off.

#### Scenario: A brand-new device runs off

- **WHEN** a tablet signs in for the first time while a release is on
- **THEN** its first page runs the release off, learns the answer, and takes it at
  its next free moment

#### Scenario: Offline keeps the last answer

- **WHEN** a tablet whose last answer was on restarts with no connection
- **THEN** it runs the release on

#### Scenario: Nothing changes on an open screen

- **WHEN** a switch's answer changes while a page is open
- **THEN** no component on that page changes behaviour until the page reloads

### Requirement: A turned switch reaches a device within a minute and applies at a free moment

A device SHALL refresh its answers on a change to `release_switches` delivered by
the live connection, on returning to the foreground, on regaining connectivity, at
least every sixty seconds while visible, and once after boot — one read at a time,
retaining one trailing read. When a fresh answer differs from the page's snapshot,
the device SHALL save it and SHALL apply it exactly as a new build is applied: at
the first moment the app is connected, nothing is typed, no surface has unsaved
work and no write is in flight, re-confirmed after the settle delay, by one reload.
The header's update action SHALL apply it at once when tapped.

#### Scenario: An idle tablet follows the owner

- **WHEN** the owner turns a release off while a counter is idle and connected
- **THEN** the counter reloads into the switched-off behaviour within a minute, and
  nobody presses anything on it

#### Scenario: A busy tablet waits

- **WHEN** a release is turned while a biller is typing on the counter
- **THEN** the counter does not reload until the typing has stopped and the settle
  delay has passed, and its header offers the update action meanwhile

#### Scenario: The live connection is down

- **WHEN** the live connection delivers nothing
- **THEN** the once-a-minute read still finds the turned switch

### Requirement: Turning a release off strands no queued work

The outbox SHALL deliver every command it holds regardless of release switches; no
command type's dispatch SHALL be behind a toggle point. While a release switch is
declared, the database functions its switched-on path calls SHALL remain. A change
to a command envelope SHALL be additive: new types and new optional fields only.

Every release whose switched-on path persists anything SHALL be covered by a
round-trip test: work done with the switch on, including work queued offline; the
switch turned off; the page reloaded; the same orders finished on the old path; and
each write settled exactly once with nothing lost.

#### Scenario: Work queued while on settles after off

- **WHEN** a tablet queues writes on a release's switched-on path while offline, the
  owner turns the release off, and the tablet reloads and reconnects
- **THEN** every queued write is delivered and settles exactly once

### Requirement: The owner turns releases from a Releases page

The account menu SHALL carry a **Releases** link for a holder of the Super Admin
role, beside **View Demo**, and for no other role. The Releases surface SHALL have
no navigation entry; the account menu SHALL be its only way in. It SHALL list every
non-retired switch
read from the database — not from the running build — with its title, its change
and its state. Each row SHALL open the release's own page, showing what *On* and
*Off* mean, one **Turn on** or **Turn off** behind a confirmation with an optional
reason, the history of every turn, and every tablet, grouped by outlet, as a live
reading: its build, whether it is running the release's current state or waiting
for a free moment, its failed and total requests and slowest request in the last
minute, and how long ago it reported, stale after two minutes.

The Releases page SHALL never be behind a release switch. It SHALL be absent for
every role except the owner.

#### Scenario: An old build turns off a new release

- **WHEN** the owner's phone runs a build older than the one that added a switch
- **THEN** the Releases page still lists that switch and can turn it off

#### Scenario: The owner watches a release land

- **WHEN** the owner turns a release off
- **THEN** each tablet reads *waiting* until it reloads and then *running*, with its
  build and its last minute's failures and slowest request

#### Scenario: The owner opens Releases from the account menu

- **WHEN** the owner opens the account menu
- **THEN** it offers **Releases**, which opens the list, and the navigation bar has
  no Releases entry

#### Scenario: Nobody else sees Releases

- **WHEN** a Franchise Admin, a Biller or an Employee opens the account menu or the
  app
- **THEN** there is no Releases link and no reachable route for Releases

### Requirement: Tablets report their health without content

When the `device-health` switch was on at a tablet's boot, every request the app
makes through its Supabase client SHALL be counted by resource — the table, RPC,
Edge Function or auth endpoint — with whether it failed (a network error, a
timeout, a 5xx, a 408 or a 429) and how long it took, over a sixty-second window.
Query strings, headers and bodies SHALL never be read for it. The counting SHALL
never fail a request.

The counter and the kitchen SHALL report, with their one-minute heartbeat and once
immediately after boot, their build, the switches the page booted with on, and the
window's requests, failures and slowest duration, through `report_device_health`,
which SHALL take the device and outlet from the caller's own device session. A
failed report SHALL be ignored.

#### Scenario: A report carries no customer data

- **WHEN** the counter looks up a customer by phone number with health reporting on
- **THEN** the report names the resource it called and nothing of the number

#### Scenario: Health is off by default

- **WHEN** `device-health` is off
- **THEN** tablets install no counting fetch and send no health report

### Requirement: The database reads a switch for triggers and policies only

`app_release_switch(key)` SHALL return whether a switch is on, false for an unknown
key or a retired switch. It SHALL be used by triggers and row-level policies, which
have no caller to choose a path; a function a client calls SHALL instead be
versioned so the client's own snapshot chooses it.

#### Scenario: A guarded trigger follows its switch

- **WHEN** a trigger guarded by a switch fires with the switch off, then on
- **THEN** it does nothing the first time and its new behaviour the second

### Requirement: A release is pulled once before it is trusted

A change SHALL NOT be archived until its switch's history shows it turned on in
production and, after that, turned off and on again, so that its way back has been
proved on real devices before anyone depends on it.

#### Scenario: Archive waits for the pull

- **WHEN** a change's switch has been turned on in production and never off
- **THEN** the archive workflow refuses, naming the step that is missing

### Requirement: The probe proves the path

The `release-probe` switch SHALL change only the build stamp, which SHALL read
`· probe` after the build identifier while it is on. It SHALL be turned on and off
in production by the owner, and then retired by its own retirement path — its
toggle point and declaration removed, its key kept as a tombstone, and its switch
marked retired by a contract migration.

#### Scenario: The probe appears and disappears

- **WHEN** the owner turns the probe on, then off
- **THEN** every tablet's build stamp gains `· probe` and later loses it, each at
  its next free moment, with no deploy
