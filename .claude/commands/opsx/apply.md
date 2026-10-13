---
name: "OPSX: Apply"
description: Implement tasks from an OpenSpec change
category: Workflow
tags: [workflow, artifacts]
---

Implement the tasks of an OpenSpec change.

**Input**: optionally a change name (e.g. `/opsx:apply add-auth`). If omitted,
infer it from conversation context. If vague or ambiguous you MUST ask.

## This repo has no `openspec` CLI

There is no `openspec` binary on PATH, in `node_modules`, or in
`package.json` — do not call one, and do not report its absence as a problem.
Everything the CLI would have resolved is a constant here:

| What the CLI would return | Value in this repo |
|---|---|
| `schemaName` | `spec-driven` |
| active changes | the directories in `openspec/changes/` (excluding `archive/` and `ROADMAP.md`) |
| `changeRoot` | `openspec/changes/<name>/` |
| `contextFiles` | `proposal.md`, `design.md`, `specs/**/spec.md`, `tasks.md` in that folder |
| progress | the `- [ ]` / `- [x]` lines in `tasks.md` |

**Steps**

1. **Select the change**

   If a name is given, use it. Otherwise infer from context, or auto-select when
   `openspec/changes/` holds exactly one active change. If still ambiguous, list
   the candidates and use the **AskUserQuestion tool**.

   Always announce: "Using change: <name>", and how to override
   (`/opsx:apply <other>`).

2. **Read the change folder**

   Read every artifact present in `openspec/changes/<name>/` — `proposal.md`,
   `design.md`, each `specs/<capability>/spec.md`, and `tasks.md`. Also read
   `AGENTS.md` for the non-negotiables before touching code.

   **If `tasks.md` is missing**, the change is not apply-ready: say so and
   recommend `/opsx:propose <name>`.

   **If every task is already `- [x]`**, say so and recommend `/opsx:archive`.

3. **Show current progress**

   Display the change name, "N/M tasks complete", and the remaining tasks.

4. **Implement tasks (loop until done or blocked)**

   For each pending task:
   - Say which task is being worked on
   - Make the code changes it calls for, minimal and focused
   - Flip `- [ ]` → `- [x]` in `tasks.md`
   - Continue

   **Pause if:** the task is unclear (ask); implementation exposes a design
   problem (propose updating the artifacts rather than quietly diverging); an
   error or blocker appears (report and wait); the user interrupts.

   A PHASE GATE task is a real gate. Run what it names — do not tick it on the
   strength of having read the code.

   **A change with a gate is built gate first** (AGENTS.md → *Every change can
   be turned off*):
   - Declare the gate in `src/change-gates/gates.ts` and insert its row, off,
     in the migration that serves it, with the Change gate section's words.
   - Leave the off path exactly as it is. The on path is new code behind
     `useChangeGate('<key>')`, and new database objects — `name_v2`, never an
     edit to a function or view a published build calls.
   - Run `npm run lint:migrations` after writing each migration, and fix what it
     says before going on. `npm run lint:change-gates` before you finish.
   - Tag, never rewrite, an existing test the change contradicts:
     `@cg-off:<key>`. New behaviour gets `@cg-on:<key>` and
     `describeChangeGate('<key>', …)`.
   - Anything the on path saves must survive the gate turning off: a
     `@cg-round-trip:<key>` browser test, or `roundTrip: 'none: …'` saying why
     nothing can be stranded.
   - Never make the outbox read a gate.

5. **On completion or pause, show status**

   Tasks completed this session, overall "N/M", and either a suggestion to
   archive or a plain statement of why you stopped.

**Output During Implementation**

```
## Implementing: <change-name>

Working on task 3/7: <task description>
[...implementation happening...]
✓ Task complete
```

**Output On Completion**

```
## Implementation Complete

**Change:** <change-name>
**Progress:** 7/7 tasks complete ✓

### Completed This Session
- [x] Task 1
- [x] Task 2

All tasks complete. Archive with `/opsx:archive <change-name>` once the change
has been deployed and seen real use.
```

**Guardrails**
- Tasks complete is not the archive trigger; deploy and real use are.
- Keep `tasks.md` honest — an unticked box is cheaper than a false one.
