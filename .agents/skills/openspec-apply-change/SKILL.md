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
3. If ambiguous, run `openspec list --json`, show the candidates, and ask the
   user one concise selection question.
4. Announce `Using change: <name>` and say that another name can override it.
5. Run:

   ```bash
   openspec status --change "<name>" --json
   openspec instructions apply --change "<name>" --json
   ```

6. Read `schemaName`, `planningHome`, `changeRoot`, `actionContext`,
   `contextFiles`, progress, tasks, and the dynamic instruction from the JSON.
   Never assume artifact paths.

If apply reports `blocked`, explain which artifact is missing and recommend
`$openspec-propose`. If it reports `all_done`, report that and recommend
`$openspec-archive-change`.

If `actionContext.mode` is `workspace-planning` and `allowedEditRoots` is
empty, treat linked repositories as read-only and stop before editing.

## Load Context and Plan

Read every path in `contextFiles`, including proposal, design, specifications,
and tasks when the schema provides them. Read applicable `AGENTS.md`
instructions before acting.

Use `update_plan` when available to track the implementation. Show the schema,
overall progress, remaining task groups, and the CLI's current instruction.

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
- Follow `contextFiles`; do not guess filenames.
- Keep task and code changes synchronized.
- Never weaken tests merely to make them pass.
- Never archive as part of this skill.
- Do not guess through a genuine design conflict.
