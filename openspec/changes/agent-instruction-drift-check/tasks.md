## 1. Catch the drift

- [x] 1.1 Add `scripts/check-agent-instructions.mjs`: a pure `findInstructionDrift({ sources, claudeCommands, agentSkills })` returning both drift kinds, plus the CLI entry guard the other check scripts use, with the reason the check exists recorded in the header.
- [x] 1.2 Prove it against the tree before the fix: run the exported rule over `7a46bf9~1` and confirm it names every call. It found **47 invocations across 17 files**, and reports the current tree clean, so the 16 remaining files are confirmed as not false positives.
- [x] 1.3 Wire it into `npm run lint` as `lint:agents`, following the `lint:tokens` pattern.
- [x] 1.4 Unplanned, found while proving 1.2: the first proof script reported zero invocations. `execSync` runs through `cmd.exe` on Windows, where `^` is the escape character, so `7a46bf9^` silently resolved to `7a46bf9` — it was measuring the post-fix commit. Re-run with `~1`. A defect in the throwaway proof, not the rule, but it is exactly the shape of false green the repo's "prove it by breaking it" discipline exists to catch.
- [x] 1.5 Unplanned, found by the first real run: the error message printed Windows-shaped paths and captured the delimiter preceding the call, so it read `` `openspec status `` against `.claude\commands\opsx\apply.md`. Both fixed — paths normalise to forward slashes so `path:line` stays clickable, and the captured call is trimmed to the call itself.

## 2. Pin it

- [x] 2.1 Add `scripts/check-agent-instructions.test.mjs` covering: a fenced call with its line number, the `npx` and `node_modules/.bin` spellings, a call inline in prose, `openspec/` paths left alone, the explanatory mapping table left alone, and both directions of tree correspondence plus the non-workflow files that must be ignored.
- [x] 2.2 Prove the gate by breaking the tree rather than by reasoning about it. Injecting `openspec status` into `.claude/commands/opsx/apply.md` failed naming file and line; removing `.agents/skills/openspec-sync-specs/` failed naming the absent counterpart; the restored tree passed.

## 3. Close the tier gap the wiring exposed

- [x] 3.1 Unplanned, and the reason this change is larger than one script: **CI has two path tiers, and `.claude/**` sits in the prose tier**, which runs only `format:check`, `lint:todos` and `lint:specs`. A `.claude/`-only commit runs neither `ci.yml` nor full lint, so `lint:agents` would have been disarmed for precisely the commits that can reintroduce the calls — the trap `docs.yml` already documents in capitals for the backlog check. Add an `Agent instructions do not call a missing toolchain` step to the `Prose` job.
- [x] 3.2 `.agents/**` appeared in none of the four path lists, so a Codex-tree commit fell through to the full suite. Harmless but wrong-tiered, and it would have left the new Prose step unreachable for half the files it checks. Added to all four lists — `ci.yml`, `deploy.yml`, and both of `docs.yml` — keeping them exact complements as `check-workflow-path-tiers.test.mjs` requires.
- [x] 3.3 Extend that standing test to assert the Prose tier invokes `lint:agents`, so the step cannot be quietly dropped later. Proved it fails without the step by replacing the step and re-running, not by reasoning.

## 4. Record the rule

- [x] 4.1 `docs/TESTING.md`: what `lint:agents` covers and why describing the CLI stays permitted while calling it does not; that it runs in the `Prose` tier as well as full lint, and why. Corrected two lines the change made stale — the `npm run lint` summary comment and the two-tier paragraph, which named three prose gates and omitted `.agents/`.

## 5. PHASE GATE

- [x] 5.1 **Gate**: `npm run lint` fails, naming file and line, on a tree where an instruction file calls the `openspec` CLI; fails equally when a workflow exists in one agent tree and not the other; and passes on the current tree. Both failing directions were proved by breaking the tree (2.2), and the new Prose-tier assertion by removing the step (3.3), rather than by argument. Ran `npm run lint` (clean, `lint:agents` reporting 16 files checked), `npm run typecheck` (clean), `npx vitest run scripts/` (14 files, 136 tests passed), and `npm run format:check` — which failed on the six files this change touched and passed after `prettier --write`; the suites and the check were re-run afterwards, since the rewrite reflowed the rule's own source.
