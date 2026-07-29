---
name: openspec-propose
description: Turn a Shawarmania change idea into all OpenSpec artifacts required for implementation, including proposal, design, capability deltas, and tasks. Use when the user asks to propose, scope, design, or prepare a change, including "/opsx:propose CHANGE" or "$openspec-propose CHANGE".
---

# Propose an OpenSpec Change

Create every artifact required by the selected OpenSpec schema, stopping when
the change is apply-ready. Do not implement the change.

## Resolve the Request

Accept either a kebab-case change name or a clear description. If neither is
clear, ask one concise open-ended question about what the user wants to build
or fix. Derive a kebab-case name from a description.

Before creating anything, check whether the change already exists. If it does,
ask whether to continue it or create a differently named change.

## Create and Inspect

Run:

```bash
openspec new change "<name>"
openspec status --change "<name>" --json
```

Read:

- `applyRequires`
- Artifact statuses and dependencies
- `planningHome`
- `changeRoot`
- `artifactPaths`
- `actionContext`

Use these values instead of assuming repository-local paths.

If the status reports a workspace-planning mode that does not permit the
required writes, stop and explain the constraint.

## Build Artifacts

Use `update_plan` when available to track artifact creation.

Repeat until every artifact in `applyRequires` is complete:

1. Pick an artifact with `status: "ready"`.
2. Run:

   ```bash
   openspec instructions <artifact-id> --change "<name>" --json
   ```

3. Read every completed dependency path.
4. Treat `context` and `rules` as instructions, not output content.
5. Fill the returned `template` according to `instruction`.
6. Write to `resolvedOutputPath`.
7. Verify the artifact exists and is coherent.
8. Re-run status before selecting the next artifact.

If critical product context is missing, ask one focused question. Otherwise
make reasonable, explicitly recorded decisions and keep momentum.

## Repository Requirements

- Honor `AGENTS.md` and the project's spec-driven workflow.
- Preserve tenancy, money, time, billing, privacy, design-token, demo-gate, and
  adapter-seam rules in every relevant artifact.
- Define verification tasks that mirror the current CI and add risk-specific
  checks.
- Name every durable docs page that must change before archive.
- Keep implementation out of the proposal turn.

## Finish

Run:

```bash
openspec status --change "<name>"
```

When the repository provides it, run `npm run roadmap:sync`.

Report:

- Change name and resolved location.
- Artifacts created.
- Important decisions or unresolved questions.
- Apply readiness.

Recommend `$openspec-apply-change <name>` as the next step.

## Guardrails

- Create all artifacts required by `applyRequires`.
- Always read dependencies before writing downstream artifacts.
- Never copy the CLI's context/rules blocks into artifacts.
- Never implement application code in this skill.
- Never hand-edit roadmap status cells.
