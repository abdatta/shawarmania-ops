---
name: "OPSX: Archive"
description: Archive a completed change
category: Workflow
tags: [workflow, archive]
---

Archive a change that has shipped.

**Input**: optionally a change name (e.g. `/opsx:archive add-auth`). If omitted,
infer it from conversation context. If vague or ambiguous you MUST ask.

## This repo has no `openspec` CLI

There is no `openspec` binary on PATH, in `node_modules`, or in
`package.json` — do not call one, and do not report its absence as a problem.
Everything the CLI would have resolved is a constant here:

| What the CLI would return | Value in this repo |
|---|---|
| active changes | the directories in `openspec/changes/` (excluding `archive/` and `ROADMAP.md`) |
| `changeRoot` | `openspec/changes/<name>/` |
| delta specs | `openspec/changes/<name>/specs/**/spec.md` |
| main specs | `openspec/specs/<capability>/spec.md` |
| archive dir | `openspec/changes/archive/` |

**Steps**

1. **If no change name provided, prompt for selection**

   List the directories in `openspec/changes/` (excluding `archive/` and
   `ROADMAP.md`) and use the **AskUserQuestion tool**.

   **IMPORTANT**: do NOT guess or auto-select. Always let the user choose.

2. **Check the change actually shipped**

   **Tasks complete is not the archive trigger.** A change archives after it has
   been deployed and watched in real use, and the owner calls it. If you cannot
   show that it shipped, say so and stop — offer to archive once it has.

3. **Check artifact and task completion**

   Confirm `proposal.md` and `tasks.md` exist, and count `- [ ]` against `- [x]`
   in `tasks.md`.

   If artifacts are missing or tasks are unticked, warn with the specifics and
   ask for confirmation. Do not block on it — inform and confirm.

4. **Assess delta spec sync state**

   Look for `openspec/changes/<name>/specs/**/spec.md`. If there are none,
   proceed without a sync prompt — a change that restores behaviour an existing
   requirement already demands was never a contract change.

   **If delta specs exist**, compare each against its main spec at
   `openspec/specs/<capability>/spec.md`, work out what would be applied (adds,
   modifications, removals, renames), and show one combined summary before
   prompting:
   - If changes are needed: "Sync now (recommended)" / "Archive without syncing"
   - If already synced: "Archive now" / "Sync anyway" / "Cancel"

   If the user chooses sync, follow `/opsx:sync` for this change. Proceed to
   archive regardless of their choice.

5. **Perform the archive**

   ```bash
   mkdir -p openspec/changes/archive
   ```

   Target name is `YYYY-MM-DD-<change-name>` using today's date. If that target
   already exists, stop and report rather than merging into it. Otherwise:

   ```bash
   git mv "openspec/changes/<name>" "openspec/changes/archive/YYYY-MM-DD-<name>"
   ```

   `.openspec.yaml` moves with the directory — leave it in place.

6. **Display summary**

   Change name, archive location, spec sync status (synced / skipped / no delta
   specs), and any warnings carried from steps 3 and 4.

**Output On Success**

```
## Archive Complete

**Change:** <change-name>
**Archived to:** openspec/changes/archive/YYYY-MM-DD-<name>/
**Specs:** ✓ Synced to main specs

All artifacts complete. All tasks complete.
```

**Output On Success With Warnings**

```
## Archive Complete (with warnings)

**Change:** <change-name>
**Archived to:** openspec/changes/archive/YYYY-MM-DD-<name>/
**Specs:** Sync skipped (user chose to skip)

**Warnings:**
- Archived with 3 incomplete tasks

Review the archive if this was not intentional.
```

**Output On Error (Archive Exists)**

```
## Archive Failed

**Change:** <change-name>
**Target:** openspec/changes/archive/YYYY-MM-DD-<name>/

Target archive directory already exists.

**Options:**
1. Rename the existing archive
2. Delete the existing archive if it is a duplicate
3. Archive on a different date
```

**Reconcile the roadmap board**

If the change carries a ROADMAP.md row, run `npm run roadmap:sync` after the
move so its status-icon and Status cells derive from the archived folder (→ ✅,
`**archived YYYY-MM-DD**`), and say in the summary whether it reconciled. The
reconciler reads `changes/` and `archive/` and never hand-stamps, so it
self-corrects drift. Fixes and agent tooling carry no ROADMAP.md row — skip it
for those.

**Guardrails**
- **If a change alters a surface's layout, that surface's shimmer is reshaped in
  the same change.** The placeholder reserves the shape of what is arriving;
  when the arriving shape moves and the placeholder does not, the surface
  reflows again — see `docs/DESIGN_SYSTEM.md`.
- **Every affected `docs/` page updates in the same change.** This is what stops
  the wiki rotting; a docs update is part of the work, not follow-up.
- Always prompt for change selection if not provided.
- Do not block archive on warnings — inform and confirm.
- If delta specs exist, always run the sync assessment and show the combined
  summary before prompting.
