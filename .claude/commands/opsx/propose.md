---
name: "OPSX: Propose"
description: Propose a new change - create it and generate all artifacts in one step
category: Workflow
tags: [workflow, artifacts]
---

Expand a change idea into every artifact implementation needs: `proposal.md`
(what & why), `design.md` (how), `specs/` deltas (the contract), `tasks.md`
(the steps). When they are written, run `/opsx:apply`.

**Input**: the argument after `/opsx:propose` is the change name (kebab-case),
OR a description of what the user wants to build.

## This repo has no `openspec` CLI

There is no `openspec` binary on PATH, in `node_modules`, or in
`package.json` — do not call one, and do not report its absence as a problem.
The workflow is plain files under a fixed layout, and everything the CLI would
have resolved is a constant here:

| What the CLI would return | Value in this repo |
|---|---|
| `schemaName` | `spec-driven` |
| `planningHome.changesDir` | `openspec/changes/` |
| `changeRoot` | `openspec/changes/<name>/` |
| `applyRequires` | `tasks.md` |
| main specs | `openspec/specs/<capability>/spec.md` |
| `context` and `rules` | the `context:` and `rules:` keys of `openspec/config.yaml` |

Read `openspec/config.yaml` for the project context and the per-artifact rules.
They are constraints on what you write — never copy them into an artifact.

**Steps**

1. **If no input provided, ask what they want to build**

   Use the **AskUserQuestion tool** (open-ended, no preset options):
   > "What change do you want to work on? Describe what you want to build or fix."

   Derive a kebab-case name from their answer. Names here read as short
   statements of the behaviour (`a-discount-is-a-line-on-the-bill`,
   `cash-is-counted-not-closed`), not ticket labels — match that voice.

   **IMPORTANT**: do NOT proceed without understanding what they want built.

2. **Check the name is free**

   If `openspec/changes/<name>/` exists, ask whether to continue that change or
   pick a new name. Also check `openspec/changes/archive/` for a dated folder
   with the same suffix — reusing an archived name is almost always a mistake.

3. **Read the ground truth before writing**

   - `openspec/config.yaml` — context and the `rules:` for each artifact
   - `AGENTS.md` — the agent contract, including the non-negotiables
   - `openspec/changes/ROADMAP.md` — where this change sits and its phase gate
   - the `openspec/specs/<capability>/spec.md` of every capability you will touch
   - one recent archived change under `openspec/changes/archive/` as a shape
     reference for tone and structure

4. **Create the folder and its artifacts**

   Use the **TodoWrite tool** to track progress. Write in dependency order —
   each artifact reads the ones before it:

   ```
   openspec/changes/<name>/
     .openspec.yaml              schema: spec-driven
                                 created: YYYY-MM-DD
     proposal.md                 what changes, for whom, and why now
     design.md                   how, and what was rejected
     specs/<capability>/spec.md  the delta (see below)
     tasks.md                    ordered, checkable steps
   ```

   Honour the `rules:` from `openspec/config.yaml` as you write — at the time of
   writing that means a proposal states user-visible behaviour and carries a
   "Non-goals" section and the `docs/` pages it will update; a design records
   rejected alternatives and calls out any RLS policy, money arithmetic or
   offline semantics; tasks pair every outlet-scoped table with an isolation
   test and end with a PHASE GATE task naming the checkpoint from ROADMAP.md.
   Re-read the file rather than trusting this summary.

   **Spec deltas** use the header vocabulary `## ADDED Requirements`,
   `## MODIFIED Requirements`, `## REMOVED Requirements`,
   `## RENAMED Requirements`, with `### Requirement: <name>` beneath, written in
   SHALL language with `#### Scenario:` blocks. A change that decides nothing
   contractual needs no delta.

   If context is critically unclear, use **AskUserQuestion** — but prefer a
   reasonable decision to keep momentum.

5. **Verify and report**

   Confirm each file exists and `tasks.md` is non-empty, then summarise the
   change name, its location, and the artifacts written. Prompt:
   "Run `/opsx:apply <name>` to start implementing."

**Reconcile the roadmap board**

If the change carries a ROADMAP.md row, run `npm run roadmap:sync` so its
status-icon and Status cells derive from the now-expanded folder (→ 📝,
`proposed`). The reconciler reads `changes/` and `archive/` and never
hand-stamps, so it self-corrects drift. **Fixes and agent tooling get a change
folder only when they change what ships; they never get a ROADMAP.md row** —
skip this step for those.

**Guardrails**
- Write every artifact implementation needs, `tasks.md` above all.
- Always read the artifacts you depend on before writing a new one.
- `context` and `rules` guide what you write and never appear in the output.
- A proposal that violates a non-negotiable in `openspec/config.yaml` is wrong,
  however well argued.
