---
name: openspec-apply-change
description: Implement tasks from an OpenSpec change in this repository. Use when the user asks to apply, implement, continue, or finish an active change, including prompts such as "/opsx:apply CHANGE" or "$openspec-apply-change CHANGE".
---

# Apply an OpenSpec Change

Implement the selected change until every task is complete or a genuine
blocker requires user input.

## Select and Resolve

1. Use a change name supplied by the user.
2. Otherwise infer it from the conversation or auto-select only when exactly
   one active change exists.
3. If ambiguous, list the directories in `openspec/changes/` (excluding
   `archive/` and `ROADMAP.md`), show the candidates, and ask the user one
   concise selection question.
4. Announce `Using change: <name>` and say that another name can override it.

If `tasks.md` is missing, the change is not apply-ready: explain that and
recommend `$openspec-propose`. If every task is already `- [x]`, report that
and recommend `$openspec-archive-change`.

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

## Load Context and Plan

Read every artifact present in `openspec/changes/<name>/` — `proposal.md`,
`design.md`, each `specs/<capability>/spec.md`, and `tasks.md`. Read applicable
`AGENTS.md` instructions before acting.

Use `update_plan` when available to track the implementation. Show overall
progress as `N/M tasks complete` and the remaining task groups.

## Implement

For each pending task:

1. State the task being handled.
2. Make the smallest complete change within its scope.
3. Preserve unrelated user work in a dirty worktree.
4. Verify the task in proportion to its risk and the repository's current
   verification rules.
5. Mark the task `- [x]` only after implementation and relevant verification
   succeed.
6. Re-run `npm run roadmap:sync` after implementation has begun when the
   project provides it.
7. Continue without pausing unless:
   - The task is materially ambiguous.
   - Implementation contradicts the design or specification.
   - Required authority or external state is missing.
   - A real blocker remains after safe in-scope investigation.
   - The user interrupts.

When implementation exposes a design issue, update the OpenSpec artifacts only
when that stays within the user's requested change; otherwise explain the
scope decision and ask.

## Finish

Report:

- Change name and schema.
- Tasks completed this session.
- Overall completed/total progress.
- Verification run and results.
- Any unrun checks, blockers, or user-only gates.

When every task is complete, recommend `$openspec-archive-change <name>`.

## Guardrails

- **If a change alters a surface's layout, that surface's shimmer is reshaped in the same change.** The placeholder reserves the shape of what is arriving; when the arriving shape moves and the placeholder does not, the surface reflows again — see docs/DESIGN_SYSTEM.md.
- Read all CLI-resolved context before editing.
- Read the change folder's own artifacts; do not guess filenames.
- Keep task and code changes synchronized.
- Never weaken tests merely to make them pass.
- Never archive as part of this skill.
- Do not guess through a genuine design conflict.
