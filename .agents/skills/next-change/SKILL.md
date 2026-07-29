---
name: next-change
description: Recommend the next Shawarmania roadmap change, report its prescribed roadmap model tier, and build a pre-flight checklist from live repository state. Use when the user asks what is next, which change to do, what model the roadmap names, whether a change is blocked, or for a roadmap status or health check.
---

# Next Change Advisor

Answer from the live repository, never from memory. Treat
`openspec/changes/ROADMAP.md`, active change folders, archived change folders,
and task checkboxes as the source of truth.

## Workflow

1. Inspect the worktree and roadmap state.
   - For a read-only status question, do not rewrite files. Read folder state
     directly and report any roadmap drift.
   - When the user has authorized reconciliation, run
     `npm run roadmap:sync` before reading the roadmap.
2. Read `openspec/changes/ROADMAP.md` in full, including the inventory,
   dependencies, execution waves, standing principles, and deferred work.
3. Inspect each plausible candidate:
   - Archived folder: done.
   - `tasks.md`: count complete and incomplete tasks and identify gate-only
     work.
   - Proposal plus `.openspec.yaml` only: seeded and needs
     `$openspec-propose`.
   - Inventory row with no corresponding folder: drift.
4. Compute unblocked work from hard dependencies. Order by the Wave column,
   then inventory order. Do not infer waves from change numbers.
5. Recommend one primary change that advances the critical path. Put genuinely
   parallel options in a separate section. Prefer finishing an active change
   with non-gate tasks over opening another.
6. Read the recommended change's proposal and derive its pre-flight checklist,
   including:
   - First workflow action.
   - Dependency gates.
   - Current branch and intentionally scoped worktree state.
   - Context files and docs named by the proposal.
   - Migration, Supabase, seed, tenancy, offline, UI, or theme implications.
   - Work only the user can perform, such as real hardware or on-site checks.
7. Read the Model cell and proposal banner. Report that label exactly as
   roadmap metadata. Do not claim that Claude labels such as Opus, Fable, or
   Sonnet map to the current Codex model. If asked for a Codex model choice,
   explain the mismatch and recommend using the current capable coding model
   unless the user specifies another available model.

## Output

For the full briefing, use this compact structure. Keep every bullet on one
line and omit empty optional sections.

```markdown
## Roadmap - Wave <X> - <N> archived / <N> active / <N> seeded

## Do next: `<change-name>` (#<n>)

| | |
|---|---|
| **Why now** | <one line> |
| **Roadmap model** | <source label> - <brief rationale> |
| **First action** | `$openspec-propose <change-name>` or the concrete apply step |

## Pre-flight

- [ ] <most blocking item first>
- [ ] USER: <user-only item>

## Parallel options

| Change | Roadmap model | One-line note |
|---|---|---|

## Waiting on you

- <change -> exact gate task>

## Drift

- <mismatch -> one-line correction>
```

For a narrow question such as "is X blocked?" or "what model does X name?",
answer only that question after the same live derivation.

## Repository Rules

- Never recommend UI work before the tenancy model and adapter/gate seam it
  depends on.
- Never recommend a `*-live` change before its UI exists.
- Never recommend `billing-live` before `counter-devices-and-offline`.
- Prefer the attendance path when it and later UI work are both unblocked.
- Put newly discovered out-of-scope work in `openspec/todos/`; do not silently
  widen a change.
- Pair every new outlet-scoped table with RLS and isolation tests.
- Keep `ui-*` work behind a gate and against adapters/mocks, never direct
  Supabase imports.
- When a change finishes, recommend `$openspec-archive-change`; archiving must
  also update the docs named by the proposal.
- The roadmap is complete only when every active change has been archived.
