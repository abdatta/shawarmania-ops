# app-shell (delta)

## MODIFIED Requirements

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

### Requirement: An outlet-scoped surface picks its outlet on the surface, never in the session

A surface that operates on one outlet SHALL take that outlet from a selector on
the surface itself, rendered only when the person may see more than one such
outlet, and defaulted to their single one when they may not.

That selection SHALL be remembered for one signed-in person and SHALL be shared
by every outlet-scoped surface, so that choosing an outlet on one surface is the
outlet the next one opens on, and a reload opens where the person left off. It
SHALL be read back only after checking it against the outlets that person may
currently see: a remembered outlet they may no longer see SHALL be replaced by
the default rather than shown, left blank, or refused. It SHALL be discarded
when the session ends, so a shared device hands no choice to the next person.

That selection SHALL NOT survive as session state, SHALL NOT constitute an
"acting as", active role, or session-level outlet mode, and SHALL NOT change
what any write is permitted to do — the database decides that from the
assignment, regardless of what is selected.

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

#### Scenario: A remembered outlet they may no longer see is dropped

- **WHEN** the remembered outlet is one the person may no longer see
- **THEN** the surface opens on its default outlet, and the remembered value is
  replaced rather than shown

#### Scenario: Signing out forgets the choice

- **WHEN** a person chooses an outlet, signs out, and another person signs in on
  the same device
- **THEN** the second person's surfaces open on their own default outlet

#### Scenario: The selector confers no authority

- **WHEN** a request is crafted naming an outlet the person holds no live
  assignment at, whatever the surface selector shows
- **THEN** the database refuses it

## ADDED Requirements

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
