## ADDED Requirements

### Requirement: Outlets opens on one outlet at a time

The Outlets surface SHALL show one outlet at a time, chosen with the shared
single-select outlet picker. Choosing an outlet SHALL replace the one shown and
SHALL NOT add to it.

A reader who may see only one outlet SHALL NOT be offered a picker.

For the owner, the picker SHALL offer closed outlets as well as trading ones,
and SHALL mark a closed outlet as closed. It SHALL do this without widening the
outlets any other surface's picker offers.

The address `outlets/:outletId` SHALL open on that outlet when the reader may see
it, and SHALL otherwise open on the reader's default outlet without an error.

The chosen outlet SHALL confer no authority. Every write SHALL remain decided by
the database from the writer's own assignments.

#### Scenario: The owner switches outlet

- **WHEN** the owner, seeing two outlets, taps the second outlet's chip
- **THEN** the page shows only the second outlet, and the first is no longer shown

#### Scenario: One outlet, no picker

- **WHEN** a reader who may see one outlet opens Outlets
- **THEN** that outlet's page opens and no picker is drawn

#### Scenario: A closed outlet is reached

- **WHEN** the owner opens a closed outlet from the picker
- **THEN** its chip reads as closed and its page offers reopening and deletion

#### Scenario: A link names an outlet

- **WHEN** a reader follows `outlets/:outletId` to an outlet they may see
- **THEN** the page opens on that outlet

#### Scenario: A link names an outlet the reader may not see

- **WHEN** a manager follows `outlets/:outletId` naming an outlet no assignment of theirs names
- **THEN** the page opens on their own default outlet, and nothing about the named outlet is shown

## MODIFIED Requirements

### Requirement: An outlet is read alongside what it is raising and the tablet standing at it

An outlet's page SHALL carry what that outlet is currently raising and the state
of the counter tablet at it, so that the question "is this shop all right?" is
answered where the shop is, rather than on a separate screen the reader has to
know to visit.

Administering that tablet SHALL be reached from the outlet it stands in, and
SHALL open scoped to **that** outlet rather than to a picker the reader must then
set.

Closing and deleting an outlet SHALL be offered apart from its ordinary actions,
after them, so that neither sits among controls a person uses routinely.

#### Scenario: The page says what the shop is raising

- **WHEN** an outlet has something raised against it
- **THEN** its page states it, without the reader opening another surface

#### Scenario: Tablet administration arrives already scoped

- **WHEN** a reader opens tablet administration from an outlet's page
- **THEN** it opens on that outlet's tablets

#### Scenario: Destructive actions are apart

- **WHEN** the owner opens a trading outlet's page
- **THEN** closing it is offered after every ordinary action, set apart from them
