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

## The Layout (there is no `openspec` CLI)

There is no `openspec` binary on PATH, in `node_modules`, or in `package.json`.
Do not call one, and do not report its absence as a problem. Everything the CLI
would have resolved is a constant in this repo:

| What the CLI would return | Value here |
|---|---|
| `schemaName` | `spec-driven` |
| `planningHome.changesDir` | `openspec/changes/` |
| `changeRoot` | `openspec/changes/<name>/` |
| `applyRequires` | `tasks.md` |
| main specs | `openspec/specs/<capability>/spec.md` |
| `context` and `rules` | the `context:` and `rules:` keys of `openspec/config.yaml` |

Create the folder yourself:

```bash
mkdir -p "openspec/changes/<name>"
printf 'schema: spec-driven
created: %s
' "$(date +%F)" > "openspec/changes/<name>/.openspec.yaml"
```

Before writing, read `openspec/config.yaml` (context and the per-artifact
`rules:`), `AGENTS.md` (the contract and its non-negotiables),
`openspec/changes/ROADMAP.md` (where this change sits and its phase gate), the
`openspec/specs/` entry of every capability you will touch, and one recent
folder under `openspec/changes/archive/` as a shape reference.

The context and rules are constraints on what you write. Never copy them into
an artifact.

## Build Artifacts

Use `update_plan` when available to track artifact creation.

Write the artifacts in dependency order — each one reads the ones before it:

```
openspec/changes/<name>/
  .openspec.yaml              schema: spec-driven / created: YYYY-MM-DD
  proposal.md                 what changes, for whom, and why now
  design.md                   how, and what was rejected
  specs/<capability>/spec.md  the delta
  tasks.md                    ordered, checkable steps
```

For each artifact:

1. Read every artifact it depends on.
2. Apply the matching `rules:` entry from `openspec/config.yaml` — a proposal
   states user-visible behaviour and carries "Non-goals" and the `docs/` pages
   it will update; a design records rejected alternatives and calls out any RLS
   policy, money arithmetic or offline semantics; tasks pair every outlet-scoped
   table with an isolation test and end with a PHASE GATE task naming the
   checkpoint from ROADMAP.md. Re-read that file rather than trusting this
   summary.
3. Write it, then verify it exists and reads coherently.

Spec deltas use `## ADDED Requirements`, `## MODIFIED Requirements`,
`## REMOVED Requirements` and `## RENAMED Requirements`, with
`### Requirement: <name>` beneath, in SHALL language and `#### Scenario:`
blocks. A change that decides nothing contractual needs no delta.

The change is apply-ready when `tasks.md` exists and is non-empty.

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

Confirm each artifact file exists and `tasks.md` is non-empty.

If the change carries a ROADMAP.md row, run `npm run roadmap:sync`. Fixes and
agent tooling get no ROADMAP.md row — skip it for those.

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
