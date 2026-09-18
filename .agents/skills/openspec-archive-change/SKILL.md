---
name: openspec-archive-change
description: Finalize and archive a completed OpenSpec change, including artifact checks, task checks, intelligent delta-spec sync, required documentation checks, the dated archive move, and roadmap reconciliation. Use when the user asks to archive or finalize a change, including "/opsx:archive CHANGE".
---

# Archive an OpenSpec Change

Archiving is deliberate and moves an active change into immutable history.
Resolve exact paths and check completeness before moving anything.

## Select the Change

If the user did not provide a name, list the directories in
`openspec/changes/` (excluding `archive/` and `ROADMAP.md`), show them, and ask
one concise selection question. Do not guess.

## The Layout (there is no `openspec` CLI)

There is no `openspec` binary on PATH, in `node_modules`, or in `package.json`.
Do not call one, and do not report its absence as a problem. Everything the CLI
would have resolved is a constant in this repo:

| What the CLI would return | Value here |
|---|---|
| `schemaName` | `spec-driven` |
| active changes | the directories in `openspec/changes/` (excluding `archive/` and `ROADMAP.md`) |
| `changeRoot` | `openspec/changes/<name>/` |
| `contextFiles` | `proposal.md`, `design.md`, `specs/**/spec.md`, `tasks.md` in that folder |
| delta specs | `openspec/changes/<name>/specs/**/spec.md` |
| main specs | `openspec/specs/<capability>/spec.md` |
| archive dir | `openspec/changes/archive/` |
| progress | the `- [ ]` / `- [x]` lines in `tasks.md` |

**Tasks complete is not the archive trigger.** A change archives after it has
been deployed and watched in real use, and the owner calls it. If you cannot
show that it shipped, say so and stop.

## Check Completion

1. List incomplete artifacts. Ask for explicit confirmation before continuing
   with any.
2. Read the resolved tasks file when present. Count incomplete tasks and ask
   for explicit confirmation before continuing with any.
3. Read the proposal's named documentation updates. In this repository, docs
   affected by a change must be current before archive; do not treat them as
   follow-up work.
4. Look for delta specs at `openspec/changes/<name>/specs/**/spec.md`.

## Sync Delta Specs

If delta specs exist:

1. Read each delta and corresponding main spec.
2. Summarize additions, modifications, removals, and renames.
3. Ask whether to sync now or archive without syncing. Recommend syncing.
4. If selected, load and follow `$openspec-sync-specs` in the primary agent.
   Do not delegate this merge to a subagent.

If the main specs already contain the deltas, say so and offer archive, sync
again, or cancel.

## Archive Safely

1. The change is `openspec/changes/<name>/`; the archive is
   `openspec/changes/archive/`.
2. Verify both paths remain inside `openspec/changes/`.
3. Build `YYYY-MM-DD-<change-name>` using the current local date.
4. If that target exists, stop and report the collision.
5. Create the archive directory if necessary.
6. Move the complete change directory with the current shell's native move
   operation. Preserve `.openspec.yaml` and all artifacts.
7. Run `npm run roadmap:sync` when the project provides it.

On Windows, keep path resolution and the move in PowerShell and use literal
paths. Do not compose a destructive cross-shell command.

## Report

Report the change, schema, absolute archive path, spec-sync result,
documentation status, roadmap reconciliation, and any warnings accepted by the
user.

## Guardrails

- **If a change alters a surface's layout, that surface's shimmer is reshaped in the same change.** The placeholder reserves the shape of what is arriving; when the arriving shape moves and the placeholder does not, the surface reflows again — see docs/DESIGN_SYSTEM.md.
- Never auto-select an ambiguous change.
- Never hide incomplete artifacts or tasks.
- Never skip delta analysis when deltas exist.
- Never overwrite an existing dated archive.
- Never hand-stamp roadmap status.
- Never delete change contents; archive by a verified move.
