# Proposal: a-retired-gate-waits-below

> **Model**: Opus · **Kind**: owner-screen correction, no roadmap row · asked by
> the owner on 18 October 2026.

## Why

Retiring a gate happens in two halves (`retire-gate`): a code change that deletes
the off path and tombstones the key, then, at least a week after every tablet runs
that build, a contract migration that marks the gate's row retired. Between the
two, the row is still live in the database, so the Change gates page lists it
exactly as it lists a gate in use: the same state word, the same arrow, a page
with a switch that turns it.

On 18 October the owner opened the page on build `ac4ce56`, which retired
`dish-ticks`, `kitchen-ready`, `instant-saves` and `outside-tap-closes`, saw all
four still listed and switchable, and concluded the retirement had not happened.
Worse, the switch still does something. A tablet on an older build would fall
back to the old counter, and `order_label_leaves_the_rail` still reads
`dish-ticks` in the database, so turning DT off would change the new build too.
The page invites the one turn nobody should make.

## What changes

- The Change gates list splits in two. **Gates in use** stay on top, as today.
  Below, under a heading, **Retired · waiting for cleanup**: every listed gate the
  running build has tombstoned in `RETIRED_CHANGE_GATES`. The heading is the
  only explanation.
- A retired row is muted and does not open. No arrow, no link. It still shows its
  title, code, change and state, because a retired gate that reads **Off** is
  worth seeing.
- A retired gate's own page, reached by an old link, shows **Retired · waiting
  for cleanup** where the switch was, and no switch. Its gates are drawn as
  rows that do not open.
- When the contract migration retires the row, it leaves the page altogether,
  as it does today.

## Non-goals

- **The database still lets the owner turn a retired row.** `change_gate_turn`
  is unchanged. This change only removes the way in from the page. A turn from
  the Supabase dashboard is still possible, and still deliberate.
- **No tablet build count on the retired section.** Each gate's page already
  shows every tablet's build. A "3 of 3 tablets on the retirement build" reading
  needs to know which build retired which key, and that is a bigger change than
  the owner asked for.
- **An owner's phone on a build older than the retirement** still lists the gate
  as in use, as it does today. It cannot know about a tombstone it does not carry.
- The `retire-gate` checklist's missing step (search the database for anything
  that still reads the key before the contract migration) is an agent-file edit,
  separate from this change.

## Change gate

No gate: a revert is enough. (1) The revert is clean. The change reads nothing
new and writes nothing: it sorts rows the page already loads, using a list the
build already carries, so the old build finds every table, row and stored value
exactly as it left them. (2) It cannot reach the counter or kitchen. The Change
gates pages are the owner's alone, reached only from the Super Admin's account
menu, and the change touches no app-wide code and no query. Its one shared edit
is an optional `shrink` on `DataTable`'s columns, which only these pages pass,
so every other table renders byte for byte as before (design D4).

## Docs to update before archive

- `docs/SCREENS.md`: the **Change gates** and **A gate's page** entries.
- `docs/RELEASES.md`: the retirement step, where it says what the owner sees
  between the two halves.
