## MODIFIED Requirements

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
