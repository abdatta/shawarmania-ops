# Delta: change-gates (new capability)

## Purpose

Defines change gates — the owner's toggles that apply or remove one change while
the app runs: how a change to a live surface is deployed with its gate off and
released by the owner, how gates depend on each other and run side by side, how every device reads and applies a gate, why
turning one off never strands queued work, the owner's Change gates page, the health
each tablet reports, and the probe that proves the path end to end.

## ADDED Requirements

### Requirement: A change gate is declared once, and its key is never reused

A change gate SHALL be a row in `change_gates`, inserted by the migration of the
change that introduces it, with a key; a code of two characters, capitals or
digits, at least one a letter; a kind (`change` or `ops`); an owner-facing title;
one sentence saying what *On* means and one saying what *Off* means; the OpenSpec
change that introduced it, and its roadmap number only where it has one; the gates
it depends on, if any, as rows of `change_gate_dependencies`; and its current
answer, which a migration SHALL declare off. A gate's answer SHALL be one answer
for the whole business. Its key SHALL be its primary key, and a gate row SHALL
never be deleted, so a retired key can never be declared again. Its code SHALL be
unique among gates not yet retired, refused by the database when a gate is
declared, and MAY be given to a new gate once its old gate is retired. A retired
gate SHALL carry its retirement time, SHALL read off everywhere and SHALL refuse to
be turned.

#### Scenario: A retired name cannot come back

- **WHEN** a migration inserts a gate whose key an earlier migration inserted
- **THEN** the database refuses it, and a fresh reset of the local stack fails

#### Scenario: Two live gates cannot share a code

- **WHEN** a migration declares a gate with a code a live gate already has
- **THEN** the database refuses it

#### Scenario: A retired gate's code can be given out again

- **WHEN** a migration declares a gate with the code of a retired gate
- **THEN** the database accepts it

#### Scenario: A new gate starts off

- **WHEN** a migration declares a gate and nobody has turned it
- **THEN** every device reads it as off

### Requirement: Only the owner turns a change gate

Turning a gate SHALL be possible only through `set_change_gate`, which SHALL
re-derive the caller's authority from their own token and SHALL refuse every caller
who is not the owner with one sentence, whatever the request body says. It SHALL
refuse an unknown or retired key. Each call SHALL record an event — gate, state,
who, when, an optional reason of at most 200 characters, and `app` — in the same
statement as the answer, and setting the current answer SHALL record the event and
change nothing else.

`change_gate_force` SHALL perform the same write for an operator in the
Supabase dashboard, record `operator` as its source, and SHALL be executable only by
the database owner and the service role.

`change_gate_events` SHALL be append-only: no role SHALL update or delete a
row.

#### Scenario: A Franchise Admin is refused

- **WHEN** a Franchise Admin sends a hand-crafted request to turn a gate
- **THEN** the database refuses it and no gate or event row changes

#### Scenario: A tablet is refused

- **WHEN** a counter or kitchen device session calls `set_change_gate`
- **THEN** it is refused

#### Scenario: The owner turns a change gate off

- **WHEN** the owner turns a gate off with a reason
- **THEN** it reads off, and the history shows the owner, the time, the reason and
  `app`

#### Scenario: The dashboard fallback

- **WHEN** an operator runs `change_gate_force` from the Supabase dashboard
- **THEN** the answer changes and the event records `operator`, and the function
  cannot be called by `anon` or `authenticated`

### Requirement: Every signed-in principal reads gates; only the owner reads their history; tablet health is isolated by outlet

`change_gates` SHALL be readable by every authenticated principal — every
person and every counter and kitchen device — and by no anonymous caller.
`change_gate_events` SHALL be readable by the owner only. `device_health` is
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

- **WHEN** any client role inserts, updates or deletes a row in `change_gates`,
  `change_gate_events` or `device_health` directly
- **THEN** the database refuses it

### Requirement: A page decides each gate once, when it loads

Every page SHALL read change gates through the adapter seam into a snapshot
taken at boot, before the first render, from the answers this device last saved,
and SHALL keep that snapshot unchanged for the life of the page. A toggle point
SHALL read the snapshot and never the network, by a key the code declares. A key
with no saved answer SHALL read off. A failed read SHALL never throw, SHALL keep
saved answers, and SHALL read off any key never seen.

A device that cannot reach the server SHALL keep running on its last saved answers.
A device that has never had an answer SHALL run every gate off.

#### Scenario: A brand-new device runs off

- **WHEN** a tablet signs in for the first time while a gate is on
- **THEN** its first page runs the change off, learns the answer, and takes it at
  its next free moment

#### Scenario: Offline keeps the last answer

- **WHEN** a tablet whose last answer was on restarts with no connection
- **THEN** it runs the change on

#### Scenario: Nothing changes on an open screen

- **WHEN** a gate's answer changes while a page is open
- **THEN** no component on that page changes behaviour until the page reloads

### Requirement: A turned gate reaches a device within a minute and applies at a free moment

A device SHALL refresh its answers on a change to `change_gates` delivered by
the live connection, on returning to the foreground, on regaining connectivity, at
least every sixty seconds while visible, and once after boot — one read at a time,
retaining one trailing read. When a fresh answer differs from the page's snapshot,
the device SHALL save it and SHALL apply it exactly as a new build is applied: at
the first moment the app is connected, nothing is typed, no surface has unsaved
work and no write is in flight, re-confirmed after the settle delay, by one reload.
The header's update action SHALL apply it at once when tapped.

#### Scenario: An idle tablet follows the owner

- **WHEN** the owner turns a change gate off while a counter is idle and connected
- **THEN** the counter reloads into the gated-off behaviour within a minute, and
  nobody presses anything on it

#### Scenario: A busy tablet waits

- **WHEN** a release is turned while a biller is typing on the counter
- **THEN** the counter does not reload until the typing has stopped and the settle
  delay has passed, and its header offers the update action meanwhile

#### Scenario: The live connection is down

- **WHEN** the live connection delivers nothing
- **THEN** the once-a-minute read still finds the turned gate

### Requirement: Turning a change gate off strands no queued work

The outbox SHALL deliver every command it holds regardless of change gates; no
command type's dispatch SHALL be behind a toggle point. While a change gate is
declared, the database functions its on path calls SHALL remain. A change
to a command envelope SHALL be additive: new types and new optional fields only.

Every release whose on path persists anything SHALL be covered by a
round-trip test: work done with the gate on, including work queued offline; the
gate turned off; the page reloaded; the same orders finished on the old path; and
each write settled exactly once with nothing lost.

#### Scenario: Work queued while on settles after off

- **WHEN** a tablet queues writes on a gate's on path while offline, the
  owner turns the gate off, and the tablet reloads and reconnects
- **THEN** every queued write is delivered and settles exactly once

### Requirement: The owner turns change gates from a Change gates page

The account menu SHALL carry a **Change gates** link for a holder of the Super
Admin role, beside **View Demo**, and for no other role. The Change gates surface
SHALL have no navigation entry; the account menu SHALL be its only way in. It SHALL
list every non-retired gate read from the database — not from the running build —
with its title, its code, its OpenSpec change (with the roadmap number where there
is one), its state, and the codes of the gates it depends on; a gate SHALL be
listed after the gates it depends on. Each row SHALL open the gate's own page,
which SHALL show first its state and a switch that turns it, and then its code,
what *On* and *Off* mean, the gates it depends on and the gates that depend on it
as rows drawn as the list draws them, the history of every turn, and every tablet,
grouped by outlet, as a live reading: its build; whether it is *running* the
gate's current state or *waiting* for a free moment to reload into it; its
requests, failures and slowest request in the last minute, which are the same for
that tablet on every gate's page; and how long ago it reported, silent after two
minutes. Turning the switch SHALL ask for confirmation with an optional reason
before anything changes.

The Change gates pages SHALL never be behind a change gate. They SHALL be absent
for every role except the owner.

#### Scenario: An old build turns off a new gate

- **WHEN** the owner's phone runs a build older than the one that added a gate
- **THEN** the Change gates page still lists that gate and can turn it off

#### Scenario: The owner watches a change land

- **WHEN** the owner turns a change gate off
- **THEN** each tablet reads *waiting* until it reloads and then *running*, with its
  build and its last minute's requests, failures and slowest request

#### Scenario: Dependencies are rows on both gates' pages

- **WHEN** a gate depends on another
- **THEN** the list names the other by code on its row, its page lists the other
  under **Dependent on**, and the other's page lists it under **Needed by**, each
  row opening that gate

#### Scenario: The owner opens Change gates from the account menu

- **WHEN** the owner opens the account menu
- **THEN** it offers **Change gates**, which opens the list, and the navigation bar
  has no Change gates entry

#### Scenario: Nobody else sees Change gates

- **WHEN** a Franchise Admin, a Biller or an Employee opens the account menu or the
  app
- **THEN** there is no Change gates link and no reachable route for it

### Requirement: Several gates run at once, and a gate runs only while every gate it depends on runs

Any number of declared gates SHALL be on at once, each independent unless it
declares dependencies. A gate MAY depend on any number of others, and no chain of
dependencies SHALL loop, refused by the database. Turning a gate on SHALL be
refused while any gate it depends on is off, with a sentence naming them. Turning a
gate off SHALL turn off every gate that depends on it, at any depth, that is on,
each recorded as its own turn with the reason *Turned off with* and the gate's
title, in the same transaction; the confirmation SHALL name them before it happens.
Turning that gate back on SHALL leave them off. A page SHALL run a gate only while
that gate and every gate it depends on, at any depth, are on, whatever the stored
answers say.

#### Scenario: A gate waits for what it depends on

- **WHEN** the owner tries to turn on a gate that depends on a gate that is off
- **THEN** the database refuses it, and the page shows the switch disabled and says
  which gate to turn on first

#### Scenario: Turning a gate off takes its dependents with it

- **WHEN** the owner turns off a gate that another gate, on, depends on
- **THEN** the confirmation names that gate, both turn off, and each has its own
  line in the history

#### Scenario: Coming back is one change at a time

- **WHEN** the owner turns that gate back on
- **THEN** the gate depending on it stays off until it is turned on itself

#### Scenario: Two dependencies

- **WHEN** a gate depends on two gates and one of them is off
- **THEN** pages run it off, and it cannot be turned on

#### Scenario: Two independent gates

- **WHEN** two gates that depend on nothing are on and the owner turns one off
- **THEN** the other stays on, and tablets run it

### Requirement: Tablets report their health without content

When the `tablet-health` gate was on at a tablet's boot, every request the app
makes through its Supabase client SHALL be counted by resource — the table, RPC,
Edge Function or auth endpoint — with whether it failed (a network error, a
timeout, a 5xx, a 408 or a 429) and how long it took, over a sixty-second window.
Query strings, headers and bodies SHALL never be read for it. The counting SHALL
never fail a request.

The counter and the kitchen SHALL report, once a minute and once
immediately after boot, their build, the gates the page booted with on, and the
window's requests, failures and slowest duration, through `report_device_health`,
which SHALL take the device and outlet from the caller's own device session. A
failed report SHALL be ignored.

#### Scenario: A report carries no customer data

- **WHEN** the counter looks up a customer by phone number with health reporting on
- **THEN** the report names the resource it called and nothing of the number

#### Scenario: Health is off by default

- **WHEN** `tablet-health` is off
- **THEN** tablets install no counting fetch and send no health report

### Requirement: The database reads a gate for triggers and policies only

`app_change_gate(key)` SHALL return whether a gate and every gate it depends on, at
any depth, are on,
false for an unknown key or a retired gate. It SHALL be used by triggers and row-level policies, which
have no caller to choose a path; a function a client calls SHALL instead be
versioned so the client's own snapshot chooses it.

#### Scenario: A guarded trigger follows its gate

- **WHEN** a trigger guarded by a gate fires with the gate off, then on
- **THEN** it does nothing the first time and its new behaviour the second

### Requirement: A change gate is pulled once before it is trusted

A change SHALL NOT be archived until its gate's history shows it turned on in
production and, after that, turned off and on again, so that its way back has been
proved on real devices before anyone depends on it.

#### Scenario: Archive waits for the pull

- **WHEN** a change's gate has been turned on in production and never off
- **THEN** the archive workflow refuses, naming the step that is missing

### Requirement: The probe proves the path

The `probe` gate (code *PB*) SHALL have no toggle point: its only effect SHALL be
its code appearing in the build code while it is on. It SHALL be turned on and off
in production by the owner, and then SHALL stay declared as the gate system's own
test switch, which the browser suites and the staging smoke run turn. It SHALL
never be retired.

#### Scenario: The probe appears and disappears

- **WHEN** the owner turns the probe on, then off
- **THEN** every tablet's build code gains *PB* and later loses it, each at its
  next free moment, with no deploy

### Requirement: A gate retired in code waits apart, and cannot be turned from the page

The Change gates list SHALL draw a listed gate whose key the running build carries
in `RETIRED_CHANGE_GATES` in a separate section below the gates in use, under the
heading **Retired · waiting for cleanup**. Such a row SHALL show its title, code, change and state, muted,
and SHALL NOT open the gate's page. The section SHALL be absent when no listed gate
is retired. A retired gate's own page, reached by its address, SHALL show
**Retired · waiting for cleanup** in place of its switch and SHALL offer no way to
turn it.

#### Scenario: A retirement build is running and the contract migration has not run

- **WHEN** the owner opens Change gates on a build that tombstoned `dish-ticks`,
  and its row is still live in the database
- **THEN** Dish ticks is listed under **Retired · waiting for cleanup**, below every
  gate in use, with its code and state, and tapping it opens nothing

#### Scenario: The contract migration has run

- **WHEN** a retired gate's row is marked retired in the database
- **THEN** it is not listed at all, and with no other retired row the section is
  absent

#### Scenario: An old link opens a retired gate's page

- **WHEN** the owner opens `/owner/change-gates/dish-ticks` on that build
- **THEN** the page reads **Retired · waiting for cleanup** with no switch, and
  still shows its tablets and history
