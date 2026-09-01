## ADDED Requirements

### Requirement: Navigation has two levels, and a group is not a destination

A navigation entry MAY declare that it belongs to a **group**. A group SHALL be a
labelled, icon-bearing heading with entries beneath it and **no surface of its
own**: it SHALL NOT be a link, SHALL NOT resolve to an address, and SHALL be
reached only by expanding it. Only its children SHALL navigate.

Group membership SHALL be declared as navigation metadata on the surface. A
surface's path SHALL NOT change because of the group it is drawn in, so grouping
SHALL never invalidate a link a reader already holds.

A group SHALL appear only when at least one of its children is visible to the
current session in the current mode, so a group SHALL never render as an empty
heading.

Groups and ungrouped entries SHALL be ordered against one another on a single
scale, so a group takes its place among the top-level entries rather than being
pushed to one end. An entry's declared order SHALL sort it against the entries it
is drawn beside — the other top-level entries and the groups when it is
ungrouped, the rest of its group when it is grouped — and SHALL be unique within
that set.

Path-derived nesting SHALL NOT be applied inside a group: an entry whose address
extends another's SHALL be drawn as its sibling when both sit in the same group.

#### Scenario: A group is expanded, not opened

- **WHEN** a reader activates a navigation group
- **THEN** its children become reachable and the reader's location does not change

#### Scenario: Grouping does not move an address

- **WHEN** a surface is placed in a group
- **THEN** the address that reached it before still reaches it

#### Scenario: An empty group is not drawn

- **WHEN** no child of a group is visible to the session in the current mode
- **THEN** that group produces no navigation entry at all

#### Scenario: Two entries in different groups may share an order

- **WHEN** two entries carry the same order in different groups
- **THEN** each sorts correctly among its own siblings and neither is ambiguous

### Requirement: An entry drawn in two shells is drawn in the same group in both

Navigation is the union of the surfaces a session can reach, deduplicated by
label, and the more senior role's entry wins. Where two roles declare an entry
under one label, those entries SHALL declare the same group.

A senior role's placement SHALL NOT be able to silently override a junior role's
different one, because the two readers would then hold different maps of one
application while the code claimed a single source.

#### Scenario: One door, one place

- **WHEN** two roles declare a navigation entry sharing a label
- **THEN** both declare the same group, and a mismatch is a defect

### Requirement: Which group is presented follows the address, and every group toggles

Where a navigation group is presented in a form that shows one group's children
at a time, which group that is SHALL be derived from the reader's current
address, on arrival and again on every move. A group the reader expanded by hand
SHALL therefore survive a move between siblings within it, because the address
names the same group on both sides of that move — and SHALL NOT survive a move
to anywhere outside it, whether or not the entry left behind belonged to a group.

**Activating a group SHALL toggle it, including the group the reader is
currently inside.** A reader inside a group whose children are hidden SHALL be
able to bring them back by activating it again, so its siblings are never
further away than any other entry.

The space the expanded form occupies SHALL be reserved whether or not a group is
expanded, so expanding one does not move the content beneath the reader.

#### Scenario: Arriving inside a group

- **WHEN** a reader opens a surface that belongs to a group
- **THEN** that group is presented and the entry is lit

#### Scenario: Leaving a group

- **WHEN** a reader navigates to a top-level entry outside every group
- **THEN** no group's children are presented, including where the entry they
  came from was also outside every group

#### Scenario: Moving between one group's own entries

- **WHEN** a reader navigates from one entry inside a group to another inside
  the same group
- **THEN** that group's children stay presented

#### Scenario: Closing the group you are standing in

- **WHEN** a reader inside a group activates that group
- **THEN** its children are hidden, the entry stays lit because the reader has
  not moved, and activating it again brings them back

#### Scenario: Expanding shifts nothing

- **WHEN** a reader expands a group
- **THEN** the content of the surface beneath does not move

## MODIFIED Requirements

### Requirement: One bundle serves four role shells

The application SHALL ship as one bundle containing four role shells. The
Super Admin, Franchise Admin, and Employee shells SHALL be phone-first with
bottom tab navigation on phone widths; the Biller shell SHALL be
tablet-first with fixed chrome in which the primary action region never
scrolls out of view. All four SHALL be usable on a desktop browser.

The phone-first shells SHALL present **no more than five top-level navigation
entries**, and the bottom tab bar SHALL NOT require horizontal scrolling to
reach any of them. Where the surfaces a session can reach exceed that, they SHALL
be reached through groups rather than by widening the bar, because an entry the
reader must remember exists and scroll sideways to find is not navigation.

A person SHALL be placed in the shell of the highest role they hold a live
assignment for, and SHALL be able to reach any other shell they hold a live
assignment for. One person SHALL never require more than one login to reach
every shell their assignments entitle them to.

#### Scenario: Phone roles get bottom tabs

- **WHEN** the Super Admin, Franchise Admin, or Employee shell renders on a
  phone viewport
- **THEN** navigation renders as a bottom tab bar reachable one-handed

#### Scenario: The bar does not scroll sideways

- **WHEN** the Super Admin — who reaches every surface in the application —
  renders their shell on a phone viewport
- **THEN** every top-level entry is visible at once without horizontal scrolling

#### Scenario: The Biller shell keeps fixed chrome

- **WHEN** the Biller shell renders on a tablet viewport
- **THEN** its header chrome and primary action region remain fixed, and no
  interaction causes the chrome to scroll away

#### Scenario: Every shell renders on desktop

- **WHEN** any role shell renders on a desktop viewport
- **THEN** it is fully usable, with navigation adapted to the wider layout

#### Scenario: The highest held role chooses the shell

- **WHEN** a person holding both a Franchise Admin and an Employee assignment
  signs in
- **THEN** they land on the Franchise Admin shell
