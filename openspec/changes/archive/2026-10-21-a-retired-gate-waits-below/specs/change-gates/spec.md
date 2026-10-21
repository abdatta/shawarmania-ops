# change-gates — delta

## ADDED Requirements

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
