## ADDED Requirements

### Requirement: The behaviour backlog's index lists every note in it

Lint SHALL compare the notes in `openspec/todos/` against the links in
`openspec/todos/README.md` and SHALL exit non-zero, naming each file, when either
has drifted from the other: a note no link mentions, or a link to a note that no
longer exists.

That index is the page the backlog is read from. The note files hold the detail,
but the index holds each item's Type, Status, Area and the trigger that has to
fire before it is worth promoting, so a note the index does not mention is not
deferred work but lost work — nothing about the repository looks broken while it
goes unread. The second direction matters as much as the first, because a
dangling row is what a promoted item leaves behind when its file is removed and
its row is not moved to the graduated table.

The index remains authored rather than generated. The trigger column is a
judgement no tool can derive, so the check verifies coverage only and SHALL NOT
write, reorder or reword rows.

#### Scenario: A note added without its row fails lint

- **WHEN** a note is added to `openspec/todos/` and no link in the index mentions
  it, and lint runs
- **THEN** lint exits non-zero, naming the file and where the row belongs

#### Scenario: A promoted note whose row was left behind fails lint

- **WHEN** an index row links to a note that no longer exists, and lint runs
- **THEN** lint exits non-zero, naming the file

#### Scenario: An index in sync passes

- **WHEN** every note is mentioned by the index and every link resolves, and lint
  runs
- **THEN** the check passes, including for a note reached only from the graduated
  table
