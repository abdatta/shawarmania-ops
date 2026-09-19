## ADDED Requirements

### Requirement: Agent instruction files do not call a toolchain the repo lacks

Lint SHALL scan the agent instruction files under `.claude/` and `.agents/` and
SHALL exit non-zero, naming each file and line, when one of them invokes the
`openspec` CLI — bare, `npx`-prefixed, or by its path in `node_modules/.bin`.

This repo drives OpenSpec through plain files and has no `openspec` binary. An
instruction file that tells an agent to run one does not fail loudly: the agent
discovers the absence, explains it, and improvises a fallback, so the change
folder it produces depends on which agent improvised it. The files were vendored
from a project where the binary exists, and the upstream copies remain the
obvious thing to crib from, so the regression is a copy-paste away rather than a
hypothetical.

Describing the CLI SHALL remain permitted. The stripped files carry a table
mapping what it would have returned to the constant it is here, and that table
names the CLI's own vocabulary; what the check forbids is an instruction to
execute it.

#### Scenario: A reintroduced CLI call fails lint

- **WHEN** an instruction file under `.claude/` or `.agents/` gains a line
  invoking `openspec` with a subcommand, and lint runs
- **THEN** lint exits non-zero, naming the file, the line number and the call

#### Scenario: Describing the CLI passes

- **WHEN** an instruction file names the CLI's vocabulary in prose or in the
  mapping table, without instructing an agent to run it, and lint runs
- **THEN** the check passes

#### Scenario: An openspec path is not a call

- **WHEN** an instruction file refers to `openspec/changes/`,
  `openspec/config.yaml` or `openspec/specs/`, and lint runs
- **THEN** the check passes

### Requirement: Both agent trees cover the same workflows

Lint SHALL compare the workflows in `.claude/commands/opsx/` against those in
`.agents/skills/openspec-*` and SHALL exit non-zero, naming the missing side,
when a workflow exists in one and not the other.

Claude reads the first tree and Codex reads the second. Nothing syncs them and no
page documents the split, so an edit to one leaves the other behind without any
visible breakage — the asymmetry surfaces later as the two agents behaving
differently on the same repository, which reads as a model difference rather than
a missing file.

The check SHALL NOT compare their contents. The trees are written for different
hosts and their prose legitimately differs; the invariant is coverage.

#### Scenario: A workflow Codex is missing fails lint

- **WHEN** `.claude/commands/opsx/` holds a workflow with no counterpart under
  `.agents/skills/`, and lint runs
- **THEN** lint exits non-zero, naming the counterpart that is absent

#### Scenario: A workflow Claude is missing fails lint

- **WHEN** `.agents/skills/` holds an OpenSpec workflow with no counterpart in
  `.claude/commands/opsx/`, and lint runs
- **THEN** lint exits non-zero, naming the counterpart that is absent

#### Scenario: Files outside the workflow are ignored

- **WHEN** either tree holds a skill or command that is not part of the OpenSpec
  workflow, such as `git-commit` or `next-change`, and lint runs
- **THEN** the check passes, because correspondence is required only of the
  workflows themselves
