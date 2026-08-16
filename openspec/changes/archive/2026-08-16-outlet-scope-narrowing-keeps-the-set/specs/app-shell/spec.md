# Delta: app-shell

## MODIFIED Requirements

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

Choosing one outlet on a surface that reads a single outlet SHALL NOT narrow a
wider remembered selection when the chosen outlet is already part of it. The
selection SHALL be kept whole and the chosen outlet SHALL become the one a
single-outlet surface opens on, so that a surface reading several outlets is
still about all of them on return. Choosing an outlet that is not part of the
selection SHALL replace the selection with it, because that is a move to another
outlet rather than a narrower reading of the same ones.

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

#### Scenario: A single-outlet surface reads one of several selected outlets

- **WHEN** a person with two outlets selected chooses one of those two on a
  surface that reads a single outlet, and then returns to the surface that
  reads several
- **THEN** the surface reading several is still about both outlets, and the
  single-outlet surface reopens on the one they chose

#### Scenario: A single-outlet surface moves to an unselected outlet

- **WHEN** a person with two outlets selected chooses a third outlet on a
  surface that reads a single outlet
- **THEN** the selection becomes that outlet alone, and every outlet-scoped
  surface follows them to it

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
