# Proposal: The Backlog Index Cannot Drift Silently

> **Model**: Opus · **Kind**: process defect fix, not a roadmap change · **Gate**: **`npm run lint` fails, naming the file, on a tree where a note in `openspec/todos/` is absent from the index**, fails equally when a row points at a note that is gone, and passes on the tree once the one unlisted note is filed.

## Why

`openspec/todos/README.md` is the only page that reads as the backlog. The note
files hold the detail, but the index holds the Type, the Status, the Area and the
trigger that has to fire before an item is worth promoting, and it is what a
person or `/next-change` reads when asking what is waiting.

A note that is not in that table is not deferred work, it is lost work. It still
has a filename, so nothing looks broken; it simply stops being read.
`page-headers-reserve-their-own-space.md` has been in exactly that state since
2 August, a Defect nobody would find by looking at the backlog. The table is
maintained by hand and nothing checked it, so the defect is in the process rather
than in anybody's diligence.

## What Changes

- A pipeline check compares the notes in `openspec/todos/` against the links in
  its index and fails naming any file the index does not mention.
- The same check fails on the opposite drift: an index row linking to a note that
  no longer exists, which is what a promoted item leaves behind when its file is
  removed and its row is not moved to "Graduated / Absorbed".
- It runs inside `npm run lint`, so it gates every pull request and every publish
  through the workflow that already exists, with no change to CI.
- The one unlisted note is filed into the Items table with its trigger.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-scaffold`: the promise that structural honesty is enforced by tooling
  rather than by review extends to the behaviour backlog's index, which until now
  was the one hand-maintained index in the repo with nothing checking it.

## Impact

One new check script, one line of `package.json`, one row of
`openspec/todos/README.md`, and a unit test. No app code, no schema, no policy,
no CI workflow edit.

## Non-goals

- **Deciding anything about the filed note.** Reserving header space in
  `PageHeader` is a shared-layout change with its own blast radius; this change
  makes it visible in the backlog and nothing more.
- **The specs index.** `openspec/specs/README.md` has the same class of drift and
  is a harder problem — it indexes directories and carries a separately stale
  "Expected capabilities" line — so it stays its own backlog item.
- **Generating the index.** The table is authored: the trigger column is a
  judgement nothing can derive. The check verifies coverage, it does not write
  rows.
- **Checking the Type, Status or Area cells against the note's own front matter.**
  A second source of truth for those is a bigger idea than the drift being fixed.

## Docs to update before archive

`docs/TESTING.md` (what `npm run lint` now covers, and why the backlog index is
gated rather than trusted).
