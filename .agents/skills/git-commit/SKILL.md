---
name: git-commit
description: "Review, stage, and create Git commits in this repository using Shawarmania's narrative commit convention: an outcome-led header, problem/decision/implementation body, exact verification evidence, and truthful model attribution. Use when the user invokes Git Commit or `$git-commit`, asks to commit changes, requests a repository-style commit message, or asks for correct Codex/Claude co-author attribution. Do not push, amend, or open a PR unless separately requested."
---

# Git Commit

Create one intentional commit whose scope, message, evidence, and attribution
can all be defended from the current work. The message convention is encoded
below; do not inspect old commits to rediscover or imitate it.

## 1. Confirm authority and scope

Treat an explicit request to commit, including "use Git Commit," as authority
to stage and commit the intended work. If the user asks only to draft or review
a message, do not mutate Git.

Never push, amend, rebase, switch branches, or open a pull request unless the
user separately requests that action. Commit on `main` only when the user
explicitly asked for `main` or clearly asked to commit the already-current
`main` worktree.

Read the applicable `AGENTS.md`, then run:

```text
git branch --show-current
git status --short
git diff --stat
git diff
```

Preserve unrelated user changes. Classify every changed path as intended,
unrelated, or ambiguous. If intended and unrelated edits overlap in a way that
cannot be staged safely, stop and ask for the scope instead of guessing.

## 2. Verify and stage the exact commit

Before staging:

1. Run `git diff --check`.
2. Run the gates proportionate to the change, or reuse gates completed in the
   current task when their evidence still applies.
3. Never claim a gate, count, visual check, deployment, or production result
   that was not actually observed.
4. If a required gate fails, fix it within scope or report the failure. Do not
   turn a red result into a green commit message.

Stage intended paths explicitly. Do not use `git add -A`, `git add .`, or a
broad glob in a mixed worktree.

After staging, run:

```text
git diff --cached --stat
git diff --cached
git diff --cached --check
git status --short
```

The cached diff, not the working-tree summary, defines what the message must
describe. The cached whitespace check also covers brand-new files that the
pre-staging check cannot see.

## 3. Choose an outcome-led header

Write a standalone, sentence-case header with no trailing period. Lead with
the business, user, or architectural outcome rather than file activity.
Include the OpenSpec number when the commit belongs to a numbered change.

Use the matching shape:

```text
<Capability> (#N): <decisive observable outcome>
Seed <change> (#N): <compact gate or decision>
Propose <change> (#N)
Archive #N, <what became durable>
<Direct maintenance outcome>
The <thing> stops <incorrect behavior>
```

Representative examples of the encoded style:

```text
Multi-outlet people (#22): authority becomes an assignment
Seed multi-outlet-hiring (#23): one hire, several outlets, one code that lives
Drop the access-token hook now that nothing registers it
The cutover field stops reading like an opening time
Archive #21, merging staff-as-accounts into specs and docs
```

Prefer a colon when the left side names a capability and the right side states
its decisive outcome. Use `Seed`, `Propose`, or `Archive` when lifecycle is the
primary action. Avoid "update files," "misc fixes," tool names, generic praise,
and conventional prefixes for material product work. A truly atomic docs or
deployment commit may use `docs:` or `deploy:` and omit the body when its
header completely explains the change.

## 4. Write a causal narrative body

For every material commit, explain the change rather than inventorying files.
Use this sequence:

1. **Problem or decision.** State what was wrong, newly decided, or unsafe.
   Start with the old behavior when the contrast makes the result clearer.
2. **Resulting contract.** Explain the new behavior and the mechanism that
   makes it true.
3. **Trust boundaries.** Name RLS, authority derivation, transactionality,
   failure handling, migration survival, offline behavior, demo safety, UI
   compatibility, or documentation when material.
4. **Evidence.** End with exact observed verification when meaningful.
5. **Attribution.** End with one truthful co-author trailer.

Use several explanatory paragraphs for identity, tenancy, migrations, billing,
offline, or other high-risk work. Use a shorter, denser body for a seed,
archive, documentation correction, or narrow validator fix. Keep one idea per
paragraph and wrap prose at roughly 72-80 columns.

Prefer concrete domain language and causal statements:

- Say "the database refuses the write" when the database is the boundary.
- Say which account, assignment, row, session, or history survives a migration.
- Explain why an ordering or transaction prevents the old failure.
- Use backticks for code identifiers and paths only when they help.
- Avoid bullet soup, speculative benefits, and a list of touched files.

## 5. Report verification exactly

Use an evidence paragraph only for results actually observed in the current
work:

```text
Gates: 549 unit, 152 e2e, 554 pgTAP, 116 REST/RLS probes, 12 auth e2e,
50 contrast pairs across both themes, generated types current.
```

For planning-only work:

```text
Planning gates: strict OpenSpec validation, roadmap reconciliation,
formatting, lint with no errors, and 549 unit/component tests.
```

Use `Verified end to end:` when the evidence is a migration rehearsal or
workflow rather than a list of standard gates. Omit the paragraph when no
meaningful gate ran. Never write "all tests pass" without the command result,
and never turn an unrun check into an implied success.

## 6. Attribute the actual agent

End a material commit with exactly one blank line and one truthful trailer:

```text
Co-Authored-By: <agent identity> <noreply address>
```

Known repository identities:

```text
Codex GPT-5.6 Sol <noreply@openai.com>
Claude Fable 5 <noreply@anthropic.com>
Claude Opus 5 <noreply@anthropic.com>
Claude Sonnet 5 <noreply@anthropic.com>
```

Attribute the agent that actually performed the current work. The prose style
does not authorize copying another agent's trailer. When the current agent is
Codex GPT-5.6 Sol, use:

```text
Co-Authored-By: Codex GPT-5.6 Sol <noreply@openai.com>
```

For another explicitly known Codex model, use `Codex <exact model display
name> <noreply@openai.com>`. If the actual model identity is unavailable, ask
instead of inventing one. Never add the human Git author as a co-author unless
the user explicitly requests it.

## 7. Commit without an editor

Use a multiline message passed non-interactively to `git commit`. On
PowerShell, use a single-quoted here-string assigned to a task-specific
variable:

```powershell
$gitCommitMessage = @'
Header

Problem or decision paragraph.

Resulting contract and boundary paragraph.

Gates: only results actually observed.

Co-Authored-By: Codex GPT-5.6 Sol <noreply@openai.com>
'@
git commit -m $gitCommitMessage
```

Do not amend an existing commit unless explicitly requested.

## 8. Verify and report

After the commit, run:

```text
git status --short
git show -s --format=fuller --decorate HEAD
```

Report the short hash, exact header, branch, whether the worktree is clean, and
whether anything remains unstaged. Say explicitly that the commit was not
pushed unless the user separately asked for a push.
