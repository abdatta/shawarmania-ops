# Delta: attention-badges

## ADDED Requirements

### Requirement: A badge on a surface that shows one scope at a time decomposes to its switch

Where a badged surface reads several scopes and shows one of them at a time —
one channel, one outlet — its navigation badge SHALL count the waiting work
across every scope that surface can reach, and the control that switches
between them SHALL carry that work broken down per scope.

A reader SHALL NOT have to change the selection to discover that work exists
behind it: each scope's count SHALL be readable on arrival, without selecting
that scope. A navigation badge that counts more than the visible scope holds and
does not say where the difference is SHALL be treated as a defect, because it
sends the reader hunting through selections for work the application already
knows the location of.

Counts SHALL be scoped by the same authority as the surface, so a decomposed
badge reveals no scope the reader could not open.

#### Scenario: A tab badge adds up to what the switch shows

- **WHEN** one channel has two matters waiting and another has one
- **THEN** the navigation entry badges three, and the switch shows two against
  the first channel and one against the second

#### Scenario: Nothing waits invisibly behind an unselected scope

- **WHEN** the surface opens on a scope with no waiting work while another scope
  holds some
- **THEN** the unselected scope carries its own count immediately, without the
  reader selecting it

#### Scenario: A decomposed badge respects tenancy

- **WHEN** a reader may open only some of the scopes a surface can read
- **THEN** both the navigation badge and the per-scope counts cover only the
  scopes they may open
