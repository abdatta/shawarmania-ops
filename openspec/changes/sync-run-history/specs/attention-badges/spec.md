# Delta: attention-badges

## ADDED Requirements

### Requirement: A badge on a surface that shows one scope at a time decomposes to its switch

Where a badged surface reads several scopes and shows one of them at a time —
one channel, one outlet — its navigation badge SHALL count the waiting work
across every scope that surface can reach, and the control that switches between
them SHALL carry that work broken down per scope.

A reader SHALL NOT have to change the selection to discover that work exists
behind it: each scope's count SHALL be readable on arrival, without selecting
that scope. A navigation badge that counts more than the visible scope holds and
does not say where the difference is SHALL be treated as a defect, because it
sends the reader hunting through selections for work the application already
knows the location of.

**Where a surface carries more than one such control, they SHALL nest, and the
count on each SHALL be the share belonging to what is selected above it.** The
outermost control SHALL decompose the navigation badge; every control beneath it
SHALL decompose the selection made above it. Two controls that each split the
badge along a different axis would hand the reader two numbers that both look
like the whole, and following either one down would arrive somewhere the other
denied — so a count SHALL NOT be scoped more widely than the controls above it
on the same surface.

It follows that **a control's count changes when a selection above it changes,
and never when one below it does.** A count that moved because of a control
further down the page would be describing something other than what the reader
had chosen.

Counts SHALL be scoped by the same authority as the surface, so a decomposed
badge reveals no scope the reader could not open.

#### Scenario: A tab badge adds up to the outermost control

- **WHEN** one outlet has four matters waiting and another has six
- **THEN** the navigation entry badges ten, and the outlet control shows four
  against the first and six against the second

#### Scenario: An inner control splits what the outer one selected

- **WHEN** the reader is on the outlet holding four, of which one is on one
  channel and three on the other
- **THEN** the channel switch shows one and three, which add up to that outlet's
  four rather than to the entry's ten

#### Scenario: Choosing a different outlet re-splits the switch beneath it

- **WHEN** the reader moves to the outlet holding six, split two and four
- **THEN** the channel switch shows two and four, and the outlet counts above it
  are unchanged

#### Scenario: Nothing waits invisibly behind an unselected scope

- **WHEN** the surface opens on a scope with no waiting work while another scope
  holds some
- **THEN** the unselected scope carries its own count immediately, without the
  reader selecting it

#### Scenario: A decomposed badge respects tenancy

- **WHEN** a reader may open only some of the scopes a surface can read
- **THEN** both the navigation badge and the per-scope counts cover only the
  scopes they may open
