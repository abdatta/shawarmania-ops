# Change Archive

**Empty until the first change completes.** Every change that has ever shipped lands here as a dated, immutable folder:

```
openspec/changes/archive/YYYY-MM-DD-<change-name>/
  .openspec.yaml
  proposal.md      what and why
  design.md        how, including rejected alternatives
  tasks.md         the implementation steps, all checked
  specs/<capability>/spec.md    the delta that was merged into openspec/specs/
```

## What this directory is for

This is the project's memory. `docs/` says what the app *is*; the living specs say what it *must do*; this archive says **how it got that way and what was considered along the route**.

When you find yourself asking "why is it built like this?", the answer is usually in a `design.md` here — including the alternatives that were rejected and the reasons, which is exactly the context that is otherwise lost the moment a decision is made.

## Rules

- **Never edit an archived change.** It is a record of what was decided at a point in time, not a description of the present. If it is now wrong, that is information, not a defect.
- Archiving happens through `/opsx:archive`, which merges spec deltas into `openspec/specs/` and dates the folder.
- The folder name's date prefix is what the roadmap reconciler reads to derive `✅ **archived YYYY-MM-DD**`. Do not rename these folders by hand.

The roadmap's definition of done is that every folder under `openspec/changes/` has moved into this one.
