## MODIFIED Requirements

### Requirement: Navigation derives from the gate registry and the session's assignments

Each shell's navigation SHALL be derived from the surface registry and the
current session, never hand-maintained per shell. Surfaces whose state excludes
them from the current mode SHALL produce no navigation entry.

Navigation SHALL be the union of the surfaces every live assignment entitles
the person to, so that a person who manages one outlet and works at another
reaches both sets of surfaces without any switching step.

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

#### Scenario: A surface with work waiting is badged in navigation

- **WHEN** a registry entry declares a count source and that source reports
  work waiting for the current person
- **THEN** that navigation entry carries a badge with the count, in both the
  phone and counter shells

#### Scenario: A surface with nothing waiting is not badged

- **WHEN** a registry entry declares a count source and that source reports
  nothing waiting
- **THEN** the navigation entry renders exactly as an unbadged entry does
