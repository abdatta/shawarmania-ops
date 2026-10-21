# Design: a-retired-gate-waits-below

## D1. "Retired" comes from the running build's tombstones

A listed gate is drawn as retired when its key is in `RETIRED_CHANGE_GATES`. The
page still reads its rows from the adapter (a-release-can-be-switched-off D4), and
the tombstone list only decides which section a row sits in. A row the database
has retired never arrives (`retired_at is null` filter), so the section holds
exactly the gates waiting for their contract migration.

D4 says to read from the adapter and never from the build, so that an older
phone can still see and turn a newer gate. That reasoning only works one way. A
tombstone is about the code: it says *this build no longer reads the key*, and
the build carrying it is the authority on that. An older phone without the
tombstone shows the row as in use, which is today's behaviour and still true for
the older builds that phone belongs with.

**Rejected: a database column (`code_retired_at`) set by a migration in the
retirement change.** The column would tell every build, old ones too. But
retirement changes are code only by design (`retire-gate` §1), so this would add
a migration and a data update to each one, and an update to an existing row is
something `lint:migrations` refuses outside a contract. It would buy only the
older-phone case, and that case is the owner's own phone, which reloads onto the
new build the next time the app opens.

**Rejected: hiding retired rows.** The owner asked to see them, apart. And a
retired row that reads **Off** is the one state on this page worth noticing:
for DT it would mean labels stay on the rail.

## D2. A retired row does not open

The row keeps its title, code, change label and state word, muted, with no link
and no chevron. The owner's words were "disabled, non-toggleable". The gate's own
page is where the switch lives, so a row that does not open removes the way in.
`GateTable` takes the retired set and, for those rows, renders the same cell as
plain text with no stretched link.

The gate's page is still reachable by its address (an old bookmark, a history
entry). There, the switch row reads **Retired · waiting for cleanup** with no
`Switch`, and the confirmation sheet is never mounted. The tiles, tablets and
history stay: the tablets' builds are the evidence the contract migration waits
for.

## D3. The section heading, and nothing under it

Heading: **Retired · waiting for cleanup**, drawn as the gate page's quiet
`Section` label. No per-row label, since the heading already says it.

**Rejected: a subtitle under the heading** (*This build no longer uses these. They
go a week after every tablet runs it.*). It was built and the owner removed it
on 18 October: it wraps on narrow screens, and the people who open this page
already know what retired means. Each section keeps its own
dependency order (retired gates depend only on retired gates, which
`lint:change-gates` enforces), and the section is absent when it would be empty.

The empty state for the top list ("No change is gated…") still shows when no gate
is in use, even if the retired section has rows.

## D4. The two tables line up

Two tables with automatic layout share out the spare width by what their cells
say, so **Status** sat a few pixels apart between the gates in use and the
retired ones (found in verification on a phone). The retired rows also keep an
invisible chevron, so the last column exists in both. `DataTable` columns gain an
optional `shrink`: the column is as narrow as its widest cell (`w-px
whitespace-nowrap`) and the gate column takes the rest, so the two tables match
whatever their rows say. No other table passes it.

**Rejected: one table with a section header row.** `DataTable` has no row
spanning its columns, and adding one would be a bigger change to a component the
counter also uses.

On a phone, a retired gate's page put **Retired · waiting for cleanup** beside a
wrapping *On · since…* line, both broken into half-lines. The retired box stacks
the two instead.

## Version skew

No database object changes. The page runs the same `overview()` read. A build
from before this change draws every row as in use, exactly as today.

## RLS, money, offline

None touched. The owner-only read and `change_gate_turn`'s owner check are
unchanged. No outlet-scoped data, no money arithmetic, no outbox.
