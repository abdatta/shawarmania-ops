## ADDED Requirements

### Requirement: A collapsed navigation group carries what its children are waiting on

Where navigation entries are folded into a group, a **collapsed** group SHALL
carry a badge counting the waiting work across every child it holds. An
**expanded** group SHALL carry no badge of its own, and each child SHALL carry
its own count instead.

This is the rule that already governs a surface's scope switch, applied one level
higher: a reader SHALL NOT have to expand a group to discover that work exists
behind it. Folding an entry into a group SHALL NOT fold its waiting work out of
sight.

No waiting item SHALL be counted twice on screen. The sum and the parts SHALL
never be visible at the same time, because two numbers describing one queue would
leave the reader to work out whether they overlap.

A group whose children are all at zero SHALL render no badge at all, so a group
with nothing waiting is indistinguishable from a group that was never badged —
the same rule an individual entry already follows.

The count SHALL obey the same authority scoping as its parts: a group badge SHALL
never reveal that work exists somewhere the reader could not open.

#### Scenario: Waiting work is visible through a shut group

- **WHEN** a surface inside a collapsed group has items waiting for the reader
- **THEN** the group carries a badge stating how many, without the reader
  expanding it

#### Scenario: Expanding replaces the sum with the parts

- **WHEN** the reader expands that group
- **THEN** the group's badge disappears and each child carries its own count

#### Scenario: A quiet group is unbadged

- **WHEN** every child of a collapsed group has nothing waiting
- **THEN** the group renders exactly as an unbadged entry does

#### Scenario: A group never reveals unreachable work

- **WHEN** a group holds a child the reader could not open
- **THEN** that child's work is absent from the group's count
