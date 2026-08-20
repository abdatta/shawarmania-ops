## ADDED Requirements

### Requirement: A category may be reserved, and a reserved category refuses what merely resembles it

A category SHALL be capable of being marked **reserved**, meaning an origin other
than a person owns every row that carries it. A reserved category SHALL be
refused to a person recording an expense, by the database and not only by the
form.

The refusal SHALL extend to a name that merely resembles the reserved one. Case,
spacing and the near-match rules the surface already uses to suggest an existing
category SHALL all be applied to the refusal, so that a second spelling cannot be
used to record by hand what the reserved category exists to keep out. A reserved
category is the one place where the free-text rule's usual defence, that a
refusal is defeated by a different spelling, is not acceptable: the whole purpose
of reserving it is that no hand-typed row may carry that cost.

The refusal SHALL name the origin that owns the category and SHALL say how a
figure reaches the ledger instead, because a person refused without being told
where the number goes will find somewhere worse to put it.

#### Scenario: A reserved category is refused

- **WHEN** a person records an expense under a reserved category
- **THEN** the entry is refused, the owning origin is named, and the person is told how such a cost reaches the ledger instead

#### Scenario: A near-spelling is refused too

- **WHEN** a person records an expense under a name that differs from a reserved category only by case, spacing or a near-match the surface would have suggested
- **THEN** it is refused identically, rather than accepted as a new free-text category

#### Scenario: The refusal holds against a hand-crafted request

- **WHEN** a hand-crafted request submits an expense carrying a reserved category with no origin attached
- **THEN** the database refuses it

#### Scenario: An origin may write its own reserved category

- **WHEN** the owning origin writes a row carrying its reserved category
- **THEN** the write succeeds

## MODIFIED Requirements

### Requirement: A category that would double-count a figure is warned against, not refused

A category naming aggregator commission, cash banked or an owner drawing SHALL
be warned against rather than refused. Each of those is accounted for elsewhere,
so recording one as an expense would count it twice. The warning SHALL state
where the figure belongs instead, and SHALL still accept the entry.

The warning SHALL be dismissable and SHALL NOT block recording, because such a
category is free text and a refusal is defeated by a different spelling, which
the month would then count with nothing to warn about.

This SHALL be understood as a weaker guarantee than a closed list gave. The
system SHALL NOT claim that such a category cannot exist.

A **reserved** category SHALL be treated differently and SHALL be refused, under
the reservation rule above. The distinction is deliberate: a warned category
names a figure recorded elsewhere in the same ledger, where a determined person
typing a second spelling merely mis-files their own record; a reserved category
names a cost that arrives from an origin of its own, where a second spelling
creates a duplicate of money that is already accounted for.

#### Scenario: A commission category is warned against

- **WHEN** a category matching aggregator commission is typed
- **THEN** a dismissable warning explains that commission is netted from aggregator revenue, and the entry is still accepted

#### Scenario: A drawer movement is warned against

- **WHEN** a category matching cash banked or an owner drawing is typed
- **THEN** a dismissable warning explains that cash taken from the drawer is recorded on the day rather than as an expense, and the entry is still accepted

#### Scenario: The warning does not block

- **WHEN** the person recording the expense dismisses the warning and submits
- **THEN** the expense is recorded with that category

#### Scenario: A reserved category is not merely warned against

- **WHEN** a category that is reserved rather than warned is typed
- **THEN** it is refused rather than warned about, and no dismissal accepts it
