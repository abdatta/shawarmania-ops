# Proposal: The Agent Workflow Cannot Call What Is Not There

> **Model**: Opus 5 · **Kind**: process defect fix, not a roadmap change · **Gate**: **`npm run lint` fails, naming file and line, on a tree where an instruction file calls the `openspec` CLI**, fails equally when a workflow exists in one agent tree and not the other, and passes on the current tree.

## Why

This repo drives OpenSpec through plain files: fixed folders under `openspec/`, a
`spec-driven` `config.yaml`, and `npm run roadmap:sync`. There is no `openspec`
CLI — not on PATH, not in `node_modules`, not in `package.json`.

The workflow files were vendored from upstream, where that binary does exist. So
until `7a46bf9` every `/opsx:*` run spent a few failed calls discovering its
absence, explained the gap to the user, then improvised a fallback — differently
each time. The wasted tokens were the visible symptom and the smaller problem;
the real cost was that a change folder's shape depended on which agent happened
to improvise it that day.

`7a46bf9` stripped the calls from all fifteen files. Nothing stops them coming
back. The upstream copies are the obvious thing to crib from the next time one of
these files needs editing, and they are one `openspec init` away in any sibling
project — the landing repo `shawarmania` has the same files with a real CLI
behind them, so the calls there are correct and copying from it would be a
reasonable mistake.

There is a second drift the same check can see. Claude reads
`.claude/commands/opsx/`; Codex reads `.agents/skills/openspec-*`. Nothing syncs
them and no page documents the split, so an edit to one silently leaves the other
behind. That asymmetry is invisible until the two agents behave differently on
the same repo, which reads as a model difference rather than a missing file.

## What Changes

- A pipeline check scans every agent instruction file in `.claude/` and
  `.agents/` and fails, naming file and line, on any `openspec <subcommand>`
  invocation.
- The same check fails on the second drift: a workflow present in one agent tree
  and absent from the other, in either direction.
- It runs inside `npm run lint`, so it gates every pull request and every publish
  through the workflow that already exists, with no change to CI.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-scaffold`: the promise that structural honesty is enforced by tooling
  rather than by review extends to the agent instruction files, which describe a
  toolchain and until now had nothing checking that the toolchain exists.

## Impact

One new check script, one line of `package.json`, a unit test, and a paragraph of
`docs/TESTING.md`. No app code, no schema, no policy, no CI workflow edit.

## Non-goals

- **Diffing the two trees against each other.** They are written for different
  hosts — different frontmatter, `$skill` references against slash commands,
  Codex's `update_plan` against Claude's TodoWrite — so demanding identical prose
  would fail on every legitimate edit. The invariant worth holding is that both
  cover the same workflows.
- **Banning the CLI as an idea.** The check is local to this repo's toolchain.
  The landing repo has the dependency installed and its calls are correct; this
  says nothing about that.
- **Documenting the two-tree split in `AGENTS.md`.** Offered and declined while
  `7a46bf9` was being written. The check enforces the correspondence without
  spending contract space on it, which is the cheaper half of that idea.
- **Generating one tree from the other.** A build step for eleven prose files
  costs more than it saves, and the generated copy would still need hand edits
  for its host.

## Docs to update before archive

`docs/TESTING.md` (what `npm run lint` now covers, and why an instruction file
that calls a missing binary is a defect rather than a cosmetic issue).
